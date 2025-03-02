import {
    bearing as calcBearing,
    distance as calcDistance,
    featureCollection as createFeatureCollection,
    lineString as createLinestring,
    point as createPoint,
    envelope,
    area as getArea,
    lineToPolygon,
    unkinkPolygon,
} from '@turf/turf';
import type { Feature, Point } from 'geojson';
// @ts-expect-error - JSTS is not typed
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
// @ts-expect-error - JSTS is not typed
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
// @ts-expect-error - JSTS is not typed
import IsSimpleOp from 'jsts/org/locationtech/jts/operation/IsSimpleOp.js';
// @ts-expect-error - JSTS is not typed
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
// @ts-expect-error - JSTS is not typed
import GeometryGraph from 'jsts/org/locationtech/jts/geomgraph/GeometryGraph.js';
// @ts-expect-error - JSTS is not typed
import ConsistentAreaTester from 'jsts/org/locationtech/jts/operation/valid/ConsistentAreaTester.js';
import { z } from 'zod';
import { validateSchema } from './validate-schema.js';

export const GeoJsonPositionSchema = z.array(z.number());
export const GeoJsonPolygonSchema = z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(GeoJsonPositionSchema)),
    bbox: z.array(z.number()).optional(),
});

export const GeoJsonPointSchema = z.object({
    type: z.literal('Point'),
    coordinates: GeoJsonPositionSchema,
    bbox: z.array(z.number()).optional(),
});

const RemoveIntermediatePointsConfigSchema = z
    .object({ greedyVariance: z.number().int().optional() })
    .strict()
    .optional()
    .describe('Config');

/**
 * Validates GeoJSON polygons.
 */
export class GeojsonPolygonValidator {
    private _geojsonReader: GeoJSONReader;

    constructor() {
        const geomFactory = new GeometryFactory();
        this._geojsonReader = new GeoJSONReader(geomFactory);
    }

    /**
     * Checks if a given GeoJSON geometry is valid.
     */
    isValid(polygonGeometry: GeoJSON.Polygon): boolean {
        validateSchema(polygonGeometry, GeoJsonPolygonSchema, { assert: true, name: 'polygonGeometry' });

        try {
            this.validate(polygonGeometry);
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * Validates a given GeoJSON geometry. Throws an error if not valid.
     */
    validate(polygonGeometry: GeoJSON.Polygon): void {
        validateSchema(polygonGeometry, GeoJsonPolygonSchema, { assert: true, name: 'polygonGeometry' });

        const { coordinates } = this.extractGeometry(polygonGeometry);
        // create a linestring first, then polygonize it => suppresses errors where first coordinate does not equal last coordinate when creating polygon
        const linestringFeature = createLinestring(coordinates);
        const polygonFeature = lineToPolygon(linestringFeature);

        const isValid = this.isValidPolygon(polygonFeature.geometry as GeoJSON.Polygon);
        const isSimple = this.isSimple(polygonFeature.geometry as GeoJSON.Polygon);
        const selfIntersect = this.getSelfIntersections(polygonFeature.geometry as GeoJSON.Polygon);

        if (isValid === false || isSimple === false || selfIntersect) {
            if (selfIntersect) {
                throw new Error('Geometry is invalid due to a self intersection');
            }
            throw new Error('Geometry is invalid');
        }
    }

    /**
     * Tries to fix a given GeoJSON geometry if it is invalid.
     */
    makeValid(polygonGeometry: GeoJSON.Polygon): GeoJSON.Polygon {
        validateSchema(polygonGeometry, GeoJsonPolygonSchema, { assert: true, name: 'polygonGeometry' });

        if (this.isValidPolygon(polygonGeometry)) {
            return polygonGeometry;
        }
        const { coordinates } = this.extractGeometry(polygonGeometry);

        return this.createFixedPolygon(coordinates);
    }

    /**
     * Extracts coordinates and type from GeoJSON geometry.
     */
    extractGeometry(polygonGeometry: GeoJSON.Polygon): { coordinates: GeoJSON.Position[]; type: string } {
        validateSchema(polygonGeometry, GeoJsonPolygonSchema, { assert: true, name: 'polygonGeometry' });

        const { type, coordinates: wrappedCoordinates } = polygonGeometry || {};
        if (type !== 'Polygon') {
            throw new Error(`Geometry type is not 'Polygon'.`);
        }

        // coordinates are always wrapped in array
        const [coordinates] = wrappedCoordinates || [];

        // handle edge case where 3 or less coordinates are defined
        if (coordinates.length <= 2) {
            throw new Error(`Polygon has insufficient number of coordinates: ${coordinates.length}`);
        }

        return { coordinates, type };
    }

    /**
     * Use the largest polygon in collection as the main polygon - assumed is that all kinks are smaller in size
     * and neglectable.
     */
    getLargestPolygon(polygons: GeoJSON.Polygon[]): GeoJSON.Polygon {
        validateSchema(polygons, z.array(GeoJsonPolygonSchema), { assert: true, name: 'polygons' });

        // enforce min 1 feature
        if (polygons.length === 0) {
            throw new Error('Polygons must contain at least one polygon geometry');
        }
        // the first polygon is used to compare against
        let largestPolygon: GeoJSON.Polygon = polygons[0];
        let largestPolygonArea = getArea(polygons[0]);
        // remove the first polygon from the list if there are more than one
        if (polygons.length > 1) polygons.shift();
        // iterate over the rest of the polygons and find the largest one
        for (const polygon of polygons) {
            const area = getArea(polygon);
            if (area >= largestPolygonArea) {
                largestPolygonArea = area;
                largestPolygon = polygon;
            }
        }

        return largestPolygon;
    }

    /**
     * Tries to create a valid geometry without any self-intersections and holes from the input coordinates.
     * This does ALTER the geometry and will return a valid geometry instead. Depending on the size of self-intersections,
     * holes and other errors, the returned geometry may differ A LOT from the original one!
     *
     * @param {GeoJSON.Position[]} coordinates
     * @return {import('geojson').Polygon}
     */
    createFixedPolygon(coordinates: GeoJSON.Position[]): GeoJSON.Polygon {
        validateSchema(coordinates, z.array(GeoJsonPositionSchema), { assert: true, name: 'coordinates' });

        // prepare "raw" coordinates first before creating a polygon feature
        const coords = this.removeDuplicates(coordinates);

        try {
            const coords = this.removeIntermediatePoints(coordinates);
            const linestringFeature = createLinestring(coords) as GeoJSON.Feature<GeoJSON.LineString>;
            const polygonFeature = lineToPolygon(linestringFeature) as GeoJSON.Feature<GeoJSON.Polygon>;
            const unkinkedFeatureCollection = unkinkPolygon(
                polygonFeature
            ) as GeoJSON.FeatureCollection<GeoJSON.Polygon>;

            // convert to list of polygon geometries
            const polygons = unkinkedFeatureCollection.features.map((feature) => feature.geometry);

            return this.getLargestPolygon(polygons);
        } catch (err) {
            /*
            Use "envelope" on edge cases that cannot be fixed with above logic. Resulting geometry will be
            completely changed but area enclosed by original airspace will be enclosed also. In case of single, dual point
            invalid polygons, this will at least return a valid geometry though it will differ the most from the original one.
             */
            try {
                const pointFeatures: Feature<Point>[] = [];
                for (const coord of coords) {
                    pointFeatures.push(createPoint(coord));
                }
                return envelope(createFeatureCollection(pointFeatures)).geometry;
            } catch (err) {
                throw new Error(err.message);
            }
        }
    }

    isValidPolygon(polygonGeometry: GeoJSON.Polygon): boolean {
        validateSchema(polygonGeometry, GeoJsonPolygonSchema, { assert: true, name: 'polygonGeometry' });

        const jstsGeometry = this._geojsonReader.read(polygonGeometry);
        const isValidValidator = new IsValidOp(jstsGeometry);

        return isValidValidator.isValid();
    }

    isSimple(polygonGeometry: GeoJSON.Polygon): boolean {
        validateSchema(polygonGeometry, GeoJsonPolygonSchema, { assert: true, name: 'polygonGeometry' });

        const jstsGeometry = this._geojsonReader.read(polygonGeometry);
        const isSimpleValidator = new IsSimpleOp(jstsGeometry);

        return isSimpleValidator.isSimple();
    }

    getSelfIntersections(polygonGeometry: GeoJSON.Polygon): object | undefined {
        validateSchema(polygonGeometry, GeoJsonPolygonSchema, { assert: true, name: 'polygonGeometry' });

        const jstsGeometry = this._geojsonReader.read(polygonGeometry);
        // if the geometry is already a simple linear ring, do not
        // try to find self intersection points.
        if (jstsGeometry) {
            const validator = new IsSimpleOp(jstsGeometry);
            if (validator.isSimpleLinearGeometry(jstsGeometry)) {
                return undefined;
            }

            let res = {};
            const graph = new GeometryGraph(0, jstsGeometry);
            const cat = new ConsistentAreaTester(graph);
            const r = cat.isNodeConsistentArea();
            if (r === false) {
                res = cat.getInvalidPoint();
            }

            return res;
        }

        return undefined;
    }

    /**
     * Removes high proximity coordinates, i.e. removes coordinate if another coordinate is within 200 meters. This will
     * NOT remove the first and last coordinate as they MUST to be the same.
     */
    removeDuplicates(coordinates: GeoJSON.Position[]): GeoJSON.Position[] {
        validateSchema(coordinates, z.array(GeoJsonPositionSchema), { assert: true, name: 'coordinates' });

        if (coordinates.length < 2) return coordinates;

        const processed = [coordinates[0]]; // Always include the first coordinate
        for (let i = 1; i < coordinates.length - 1; i++) {
            const coord = coordinates[i];
            const exists = processed.find((value) => {
                return calcDistance(value, coord, { units: 'kilometers' }) < 0.2; // 200 meters
            });

            if (exists === undefined) {
                processed.push(coord);
            }
        }
        processed.push(coordinates[coordinates.length - 1]); // Always include the last coordinate

        return processed;
    }

    /**
     * Takes a list of coordinates and moves along all points and checks whether the traversed
     * path would form an overlapping line. This function will NOT remove duplicates!
     *
     * @param {GeoJSON.Position[]} coordinates
     * @param {Object} [config] - Configuration object.
     * @param {number} [config.greedyVariance] - The variance included in the bearing delta calculation. Currently it is set to 0 by default
     * which means that the bearing delta must be exactly 180 degrees which means that the intermediate point is exactly on the line.
     * If you set this to 1, then the bearing delta can be between 179 and 181 degrees which means that the point is also considered
     * to be on line even if it is slightly off.
     * @return {GeoJSON.Position[]}
     */
    removeIntermediatePoints(
        coordinates: GeoJSON.Position[],
        config?: { greedyVariance?: number }
    ): GeoJSON.Position[] {
        validateSchema(coordinates, z.array(GeoJsonPositionSchema), { assert: true, name: 'coordinates' });
        validateSchema(config, RemoveIntermediatePointsConfigSchema, { assert: true, name: 'config' });

        const defaultConfig = { greedyVariance: 0 };
        const { greedyVariance } = { ...defaultConfig, ...config };

        function isIntermediateCoordinate(config: {
            coord: number[];
            coordIdx: number;
            coordinateList: number[][];
            greedyVariance: number;
        }) {
            const { coord, coordIdx, coordinateList, greedyVariance } = config;
            // remove the currently processed coordinate from the list
            const filteredList = coordinateList.filter((_: any, idx: number) => idx !== coordIdx);
            for (let i = 0; i < filteredList.length; i++) {
                const coordA = coordinateList[i];
                const coordB = coordinateList[i + 1];
                // calculate the bearing between the "coord" and the "coordA"
                const bearingA = calcBearing(coord, coordA);
                const bearingB = calcBearing(coord, coordB);
                const bearingDelta = Math.abs(bearingA - bearingB);
                if (
                    bearingDelta <= 180 + greedyVariance &&
                    bearingDelta >= 180 - greedyVariance &&
                    coordIdx > i &&
                    coordIdx > i + 1
                ) {
                    return true;
                }
            }

            return false;
        }

        const fixedPoints: GeoJSON.Position[] = [];
        for (let i = 0; i < coordinates.length; i++) {
            const currentCoord = coordinates[i];
            if (i === 0) {
                // always add the first coordinate
                fixedPoints.push(currentCoord);
                continue;
            }
            if (
                isIntermediateCoordinate({
                    coord: currentCoord,
                    coordIdx: i,
                    coordinateList: coordinates,
                    greedyVariance: greedyVariance,
                }) === false
            ) {
                fixedPoints.push(currentCoord);
            }
        }

        return fixedPoints;
    }
}
