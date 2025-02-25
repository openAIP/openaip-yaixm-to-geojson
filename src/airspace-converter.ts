import rewind from '@mapbox/geojson-rewind';
import { Parser as CoordinateParser } from '@openaip/coordinate-parser';
import {
    bearing as calcBearing,
    lineArc as createArc,
    circle as createCircle,
    featureCollection as createFeatureCollection,
    lineString as createLineString,
    point as createPoint,
    distance,
    envelope,
    area as getArea,
    lineToPolygon,
    unkinkPolygon,
} from '@turf/turf';
import addFormats from 'ajv-formats';
import ajvKeywords from 'ajv-keywords';
import Ajv from 'ajv/dist/2020';
import type { AnyValidateFunction } from 'ajv/dist/core.js';
import type { FeatureCollection, GeoJsonObject, MultiPolygon, Polygon } from 'geojson';
import jsts from 'jsts';
import YAML from 'yaml';
import { z } from 'zod';
import GEOJSON_SCHEMA from '../schemas/geojson-schema.json';
import { cleanObject } from './clean-object.js';
import DEFAULT_CONFIG from './default-config.js';
import { validateSchema } from './validate-schema.js';

const ALLOWED_TYPES = ['CTA', 'TMA', 'CTR', 'ATZ', 'OTHER', 'D', 'P', 'R', 'D_OTHER'];
const ALLOWED_LOCALTYPES = ['MATZ', 'GLIDER', 'GVS', 'HIRTA', 'LASER', 'DZ', 'NOATZ', 'UL', 'ILS', 'RMZ', 'TMZ'];
const ALLOWED_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'UNCLASSIFIED'];
const REGEX_CEILING_SURFACE = /^(SFC)$/;
const REGEX_CEILING_FEET = /^(\d+(\.\d+)?)\s*(ft|FT)?\s*(SFC)?$/;
const REGEX_CEILING_FLIGHT_LEVEL = /^FL\s*(\d{2,})?$/;
const REGEX_COORDINATES = /^[0-9]{6}[NS]\s+[0-9]{7}[EW]$/;
const REGEX_ARC_DIR = /^(cw|ccw)$/;
const REGEX_ARC_RADIUS = /^(\d+(\.\d+)?)\s*(NM|nm)?$/;

export const ConfigSchema = z
    .object({
        validateGeometries: z.boolean().optional(),
        fixGeometries: z.boolean().optional(),
        geometryDetail: z.number().optional(),
        strictSchemaValidation: z.boolean().optional(),
    })
    .strict()
    .optional()
    .describe('ConfigSchema');

export type Config = {
    // Validate geometries. Defaults to true.
    validateGeometries?: boolean;
    //  Fix geometries that are not valid. Defaults to false.
    fixGeometries?: boolean;
    // Defines the steps that are used to calculate arcs and circles. Defaults to 100. Higher values
    // mean smoother circles but a higher number of polygon points.
    geometryDetail?: number;
    // If true, the created GEOJSON is validated against the underlying schema to enforce compatibility.
    // If false, simply warns on console about schema mismatch. Defaults to false.
    strictSchemaValidation?: boolean;
};

type Configuration = {
    validateGeometries: boolean;
    fixGeometries: boolean;
    geometryDetail: number;
    strictSchemaValidation: boolean;
};

export const ConvertOptionsSchema = z
    .object({
        serviceFileBuffer: z.instanceof(Buffer).optional(),
    })
    .strict()
    .describe('ConvertOptionsSchema');

export type ConvertOptions = {
    // Buffer of a "service.yaml" file. If given, tries to read services from file if type is "airspace".
    // If not given, services are not read.
    serviceFileBuffer?: Buffer;
};

type YaixmService = { callsign: string; controls: string; frequency: string };

type YaixmAirspaceBoundaryLine = {
    line: string[];
};

type YaixmAirspaceBoundaryArc = {
    arc: {
        dir: string;
        radius: string;
        centre: string;
        to: string;
    };
};

type YaixmAirspaceBoundaryCircle = {
    circle: {
        radius: string;
        centre: string;
    };
};

type YaixmAirspaceBoundary = YaixmAirspaceBoundaryLine | YaixmAirspaceBoundaryArc | YaixmAirspaceBoundaryCircle;

type YaixmAirspace = {
    name: string;
    id: string;
    type: string;
    localtype: string;
    class: string;
    geometry: {
        seq: number;
        upper: string;
        lower: string;
        boundary: YaixmAirspaceBoundary;
    }[];
    rules: string[];
};

export class AirspaceConverter {
    private _config: Configuration;
    private _schemaValidator: AnyValidateFunction;
    // used in error messages to better identify the airspace that caused the error
    private _identifier: string | undefined;
    private _sequenceNumber: number | undefined;
    // keep track of all calculated coordinates for the currently processed airspace boundary
    private _boundaryCoordinates: number[][] = [];

    constructor(config: Config) {
        validateSchema(config, ConfigSchema, { assert: true, name: 'Name' });

        this._config = { ...DEFAULT_CONFIG, ...config };

        const ajvParser = new Ajv({
            // nullable: true,
            verbose: true,
            allErrors: true,
            // jsonPointers: true,
        });
        // set all used formats
        addFormats(ajvParser, ['date-time', 'date']);
        // set all used keywords
        ajvKeywords(ajvParser, []);
        // add unknown keywords that would otherwise result in an exception
        ajvParser.addVocabulary(['example']);
        require('ajv-errors')(ajvParser);
        // add schema
        ajvParser.validateSchema(GEOJSON_SCHEMA);
        ajvParser.addSchema(GEOJSON_SCHEMA);
        this._schemaValidator = ajvParser.getSchema(
            'https://adhoc-schemas.openaip.net/schemas/parsed-yaixm-airspace.json'
        ) as AnyValidateFunction;
    }

    /**
     * Converts a buffer containing YAIXM airspace data to GeoJSON.
     */
    async convert(buffer: Buffer, options: ConvertOptions): Promise<FeatureCollection<Polygon, any>> {
        // IMPROVE set actual properties for returned type
        validateSchema(buffer, z.instanceof(Buffer), { assert: true, name: 'Buffer' });
        validateSchema(options, ConvertOptionsSchema, { assert: true, name: 'ConvertOptions' });

        // reset internal state
        this.reset();

        const { serviceFileBuffer } = options;

        const yaixm = YAML.parse(buffer.toString('utf-8'));
        // build options for createAirspaceFeatures
        const createOptions: Partial<{ services: any }> = {};
        if (serviceFileBuffer != null) {
            // if services are given, use them as options and try to read them from file
            createOptions.services = await YAML.parse(serviceFileBuffer.toString());
        }
        const geojsonFeatures = [];
        for (const airspace of yaixm.airspace) {
            geojsonFeatures.push(...(await this.createAirspaceFeatures(airspace, createOptions)));
        }

        const geojson = createFeatureCollection(geojsonFeatures);
        const valid = this._schemaValidator(geojson);
        if (valid === false) {
            if (this._config.strictSchemaValidation) {
                throw new Error(
                    `GeoJSON does not adhere to underlying schema. ${JSON.stringify(this._schemaValidator.errors)}`
                );
            } else {
                console.log('WARN: GeoJSON does not adhere to underlying schema.');
            }
        }

        return geojson;
    }

    /**
     * @param {Object} airspaceJson
     * @param {Object} options
     * @param {Object[]} [options.services] - Services to map to airspaces.
     * @return {Object}
     * @private
     */
    private async createAirspaceFeatures(
        airspaceJson: YaixmAirspace,
        options: { services: YaixmService[] }
    ): Promise<FeatureCollection<Polygon, any>> {
        // IMPROVE set actual properties for returned type
        const { services } = options;
        const features = [];
        const { name, id, type, localtype: localType, class: airspaceClass, geometry, rules } = airspaceJson;
        // set identifier for error messages
        this._identifier = name;
        // map to only type/class combination
        const {
            type: mappedType,
            class: mappedClass,
            metaProps,
        } = this.mapClassAndType(type, localType, airspaceClass);

        // for each airspace geometry defined in YAIXM block, create a GeoJSON feature
        for (const geometryDefinition of geometry) {
            const { seq, upper, lower, boundary } = geometryDefinition;
            // set sequence number for error messages, use "0" if no sequence number is defined
            this._sequenceNumber = seq || 0;

            const upperCeiling = this.createCeiling(upper);
            const lowerCeiling = this.createCeiling(lower);
            let geometry = this.createPolygonGeometry(boundary);

            if (this._config.fixGeometries) {
                geometry = this.fixGeometry(geometry);
            }
            if (this._config.validateGeometries) {
                const { isValid, selfIntersect } = this.validateGeometry(geometry);
                if (isValid === false) {
                    let message = `Invalid geometry for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`;
                    if (selfIntersect != null) {
                        message += `: Self intersection at ${JSON.stringify(selfIntersect)}`;
                    }
                    throw new Error(message);
                }
            }
            const feature = {
                type: 'Feature',
                // set "base" airspace properties that is common to all airspaces defined in YAIXM  block. Each YAIXM block can define
                // multiple airspaces, all with the same base properties.
                properties: {
                    ...{
                        name,
                        type: mappedType,
                        class: mappedClass,
                        upperCeiling,
                        lowerCeiling,
                        activatedByNotam: rules?.includes('NOTAM') === true,
                        // set default value, will be overwritten by "metaProps" if applicable
                        activity: 'NONE',
                        remarks: rules == null ? null : rules.join(', '),
                    },
                    // merges updated field value for fields, e.g. "activity"
                    ...metaProps,
                },
                geometry,
            };
            // add frequency property if services are available and mapping property "id" is set
            if (id != null && services != null) {
                feature.properties.groundService = await this.createGroundServiceProperty(id, services);
            }

            features.push(cleanObject(feature));
            // IMPORTANT reset internal state for next airspace
            this.reset();
        }

        return features;
    }

    /**
     * Maps ground service frequency & callsign to airspace if possible. Will return null if no mapping is found.
     */
    private async createGroundServiceProperty(
        id: string,
        services: { id: string; service: YaixmService[] }
    ): Promise<Omit<YaixmService, 'controls'> | null> {
        try {
            // read services file
            for (const service of services.service) {
                const { callsign, controls, frequency } = service;
                // airspace "id" is mapped to "controls"" in services file
                if (controls?.includes(id)) {
                    return {
                        callsign,
                        frequency: frequency.toString(),
                    };
                }
            }

            return null;
        } catch (err) {
            // only warn if error
            const errorMessage = (err as Error)?.message || 'Unknown error';
            console.log(`WARN: Failed to map ground station services. ${errorMessage}`);

            return null;
        }
    }

    private mapClassAndType(
        type: string,
        localType: string,
        airspaceClass: string
    ): { type: string; class: string; metaProps?: { activity: string } } {
        let message = `Failed to map class/type combination for airspace '${this._identifier}'.`;
        // check type is allowed
        if (ALLOWED_TYPES.includes(type) === false) {
            throw new Error(`${message} The 'type' value '${type}' is not in the list of allowed types.`);
        }
        if (localType != null && ALLOWED_LOCALTYPES.includes(localType) === false) {
            throw new Error(
                `${message} The 'localtype' value '${localType}' is not in the list of allowed localtypes.`
            );
        }
        if (airspaceClass != null && ALLOWED_CLASSES.includes(airspaceClass) === false) {
            throw new Error(`${message} The 'class' value '${airspaceClass}' is not in the list of allowed classes.`);
        }

        if (type != null && airspaceClass != null) {
            let mappedType = null;
            let mappedClass = null;

            switch (type) {
                case 'CTA':
                    mappedType = 'CTA';
                    break;
                case 'TMA':
                    mappedType = 'TMA';
                    break;
                case 'CTR':
                    mappedType = 'CTR';
                    break;
                case 'ATZ':
                    mappedType = 'ATZ';
                    break;
                case 'D':
                    mappedType = 'DANGER';
                    break;
                case 'P':
                    mappedType = 'PROHIBITED';
                    break;
                case 'R':
                    mappedType = 'RESTRICTED';
                    break;
                default:
                    throw new Error(`${message} The 'type' value '${type}' has no configured mapping.`);
            }
            if (ALLOWED_CLASSES.includes(airspaceClass)) {
                mappedClass = airspaceClass;
            } else {
                throw new Error(`${message} The 'class' value '${airspaceClass}' has no configured mapping.`);
            }

            return { type: mappedType, class: mappedClass };
        } else if (type != null && localType != null) {
            const comb = `${type}|${localType}`;
            switch (comb) {
                case 'OTHER|MATZ':
                    return { type: 'MATZ', class: 'G' };
                case 'D_OTHER|GLIDER':
                    return { type: 'GLIDING_SECTOR', class: 'UNCLASSIFIED' };
                // gas venting station
                /*
                GVS - gas venting station
                HIRTA - high intensity radio transmission area
                LASER - "biu biu biu"
                ILS - ILS feather
                 */
                case 'D_OTHER|GVS':
                case 'D_OTHER|HIRTA':
                case 'D_OTHER|LASER':
                case 'OTHER|ILS':
                    return { type: 'WARNING', class: 'UNCLASSIFIED' };
                case 'D_OTHER|DZ':
                    return {
                        type: 'AERIAL_SPORTING_RECREATIONAL',
                        class: 'UNCLASSIFIED',
                        metaProps: { activity: 'PARACHUTING' },
                    };
                case 'OTHER|GLIDER':
                case 'OTHER|NOATZ':
                    return {
                        type: 'AERIAL_SPORTING_RECREATIONAL',
                        class: 'UNCLASSIFIED',
                        metaProps: { activity: 'AEROCLUB_AERIAL_WORK' },
                    };
                case 'OTHER|UL':
                    return {
                        type: 'AERIAL_SPORTING_RECREATIONAL',
                        class: 'UNCLASSIFIED',
                        metaProps: { activity: 'ULM' },
                    };
                case 'OTHER|RMZ':
                    return {
                        type: 'RMZ',
                        class: 'UNCLASSIFIED',
                    };
                case 'OTHER|TMZ':
                    return {
                        type: 'TMZ',
                        class: 'UNCLASSIFIED',
                    };
                default:
                    throw new Error(
                        `${message} The 'type' value '${type}' and 'localtype' value '${localType}' has no configured mapping.`
                    );
            }
        } else if (type != null) {
            switch (type) {
                case 'ATZ':
                case 'MATZ':
                    return { type, class: 'G' };
                case 'D':
                    return { type: 'DANGER', class: 'UNCLASSIFIED' };
                case 'P':
                    return { type: 'PROHIBITED', class: 'UNCLASSIFIED' };
                case 'R':
                    return { type: 'RESTRICTED', class: 'UNCLASSIFIED' };
                default:
                    throw new Error(`${message} The type value '${type}' has no configured mapping.`);
            }
        }

        throw new Error(
            `${message} No mapping for combination '${JSON.stringify({ type, localType, class: airspaceClass })}'`
        );
    }

    /**
     * Converts a ceiling definition, e.g. "1500 ft" or "FL65" to a ceiling object, e.g.
     * "{
     *      "value": 1500,
     *      "unit": "FT",
     *      "referenceDatum": "MSL"
     *  }"
     *
     *  This function assumes that only unit "ft" or "FL" or "SFC" is used in the ceiling definition.
     *
     * @param {string} ceilingDefinition
     * @return {Object}
     */
    private createCeiling(ceilingDefinition: string): { value: number; unit: string; referenceDatum: string } {
        // check that ceiling definition is in expected format
        const isValidSurfaceDefinition = REGEX_CEILING_SURFACE.test(ceilingDefinition);
        const isValidFeetDefinition = REGEX_CEILING_FEET.test(ceilingDefinition);
        const isValidFlightLevelDefinition = REGEX_CEILING_FLIGHT_LEVEL.test(ceilingDefinition);

        if (
            isValidFeetDefinition === false &&
            isValidFlightLevelDefinition === false &&
            isValidSurfaceDefinition === false
        ) {
            throw new Error(
                `Invalid ceiling definition '${ceilingDefinition}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }

        if (isValidSurfaceDefinition) {
            // always use instead of SFC
            return { value: 0, unit: 'FT', referenceDatum: 'GND' };
        } else if (isValidFeetDefinition) {
            // check for "default" altitude definition, e.g. 16500ft MSL or similar
            const altitudeParts = REGEX_CEILING_FEET.exec(ceilingDefinition);
            // get altitude parts
            let value = parseFloat((altitudeParts as string[])[1]);
            let unit = (altitudeParts as string[])[3].toUpperCase();
            let referenceDatum = (altitudeParts as string[])[4] || 'MSL';
            // always use instead of SFC
            referenceDatum = referenceDatum === 'SFC' ? 'GND' : referenceDatum.toUpperCase();

            return { value, unit, referenceDatum };
        } else if (isValidFlightLevelDefinition) {
            // check flight level altitude definition
            const altitudeParts = REGEX_CEILING_FLIGHT_LEVEL.exec(ceilingDefinition);
            // get altitude parts
            let value = parseInt((altitudeParts as string[])[1]);

            return { value, unit: 'FL', referenceDatum: 'STD' };
        }

        throw new Error(
            `Invalid ceiling definition '${ceilingDefinition}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
        );
    }

    /**
     * Creates a GeoJSON Polygon geometry from a YAIXM airspace boundary (geometry) definition.
     */
    private createPolygonGeometry(boundary: YaixmAirspaceBoundary[]): Polygon | MultiPolygon {
        // Each object on the boundary array resolves into a GeoJSON LineString geometry. Resolve each boundary object into a
        // list of coordinates pairs and then create a GeoJSON Polygon geometry from them.
        // Also make sure the resulting Polygon geometry is valid.
        for (const boundaryDefinition of boundary) {
            const boundaryType = Array.from(Object.keys(boundaryDefinition))[0];

            switch (boundaryType) {
                case 'line': {
                    const coordinates = this.createCoordinatesFromLine(boundaryDefinition as YaixmAirspaceBoundaryLine);
                    this._boundaryCoordinates.push(...coordinates);
                    break;
                }
                case 'arc': {
                    const coordinates = this.createCoordinatesFromArc(boundaryDefinition as YaixmAirspaceBoundaryArc);
                    this._boundaryCoordinates.push(...coordinates);
                    break;
                }
                case 'circle': {
                    const coordinates = this.createCoordinatesFromCircle(
                        boundaryDefinition as YaixmAirspaceBoundaryCircle
                    );
                    this._boundaryCoordinates.push(...coordinates);
                    break;
                }
                default:
                    throw new Error(
                        `Unsupported boundary type '${boundaryType}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
                    );
            }
        }

        const lineString = createLineString(this._boundaryCoordinates);
        // create polygon geometry from LineString geometry using turfjs
        // add first coordinate pair to end of list to close the polygon if first and last item do not match
        let polygonFeature = lineToPolygon(lineString, { autoComplete: true, mutate: true, orderCoords: true });
        // make sure the polygon follows the right-hand rule
        polygonFeature = rewind(polygonFeature, false);

        return polygonFeature.geometry;
    }

    /**
     * Creates a (GeoJSON LineString) geometry which is essentially a list of coordinates pairs
     *  from a YAIXM airspace boundary "line" definition.
     */
    private createCoordinatesFromLine(boundaryDefinition: YaixmAirspaceBoundaryLine): number[][] {
        const coordinates = boundaryDefinition.line;
        if (Array.isArray(coordinates) === false || coordinates.length === 0) {
            throw new Error(
                `Invalid line boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this._identifier
                }' in sequence number '${this._sequenceNumber}'`
            );
        }
        const coords = [];
        for (const coordinate of coordinates) {
            // validate coordinate string
            if (REGEX_COORDINATES.test(coordinate) === false) {
                throw new Error(
                    `Invalid coordinate '${coordinate}' in line boundary definition '${JSON.stringify(
                        boundaryDefinition
                    )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
                );
            }
            const coord = this.transformCoordinates(coordinate);
            coords.push(coord);
        }

        return coords;
    }

    /**
     * Creates a (GeoJSON LineString) geometry which is essentially a list of coordinates pairs from a
     * YAIXM airspace boundary "arc" definition.
     *
     * @param {Object} boundaryDefinition
     * @return {Array}
     * @private
     */
    private createCoordinatesFromArc(boundaryDefinition: YaixmAirspaceBoundaryArc): number[][] {
        // eslint-disable-next-line no-unsafe-optional-chaining
        const { dir, radius, centre, to } = boundaryDefinition.arc;
        // get last coordinates pair from boundary coordinates
        const lastCoord = this._boundaryCoordinates[this._boundaryCoordinates.length - 1];

        const isValidDir = REGEX_ARC_DIR.test(dir);
        const isValidRadius = REGEX_ARC_RADIUS.test(radius);
        const isValidCentre = REGEX_COORDINATES.test(centre);
        const isValidTo = REGEX_COORDINATES.test(to);

        if (lastCoord == null) {
            throw new Error(
                `Invalid arc boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this._identifier
                }' in sequence number '${this._sequenceNumber}'. Previous coordinate pair is missing.`
            );
        }
        if (dir == null || radius == null || centre == null || to == null) {
            throw new Error(
                `Invalid arc boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this._identifier
                }' in sequence number '${this._sequenceNumber}'`
            );
        }
        if (isValidDir === false) {
            throw new Error(
                `Invalid arc 'direction' '${dir}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }
        if (isValidRadius === false) {
            throw new Error(
                `Invalid arc 'radius' '${radius}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }
        if (isValidCentre === false) {
            throw new Error(
                `Invalid arc 'centre' '${centre}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }
        if (isValidTo === false) {
            throw new Error(
                `Invalid arc 'to' '${to}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }

        // check if arc is clockwise or counter-clockwise - if counter-clockwise, switch start and end point later
        const isClockwise = dir === 'cw';
        // get last coordinate pair
        const [fromLon, fromLat] = lastCoord;
        // get start point
        let startPoint = createPoint([fromLon, fromLat]);
        // get center point
        const [centerLon, centerLat] = this.transformCoordinates(centre);
        const centerPoint = createPoint([centerLon, centerLat]);
        // get end point
        const [toLon, toLat] = this.transformCoordinates(to);
        let endPoint = createPoint([toLon, toLat]);
        // switch start and end point if arc is counter-clockwise
        if (isClockwise === false) {
            const tmp = startPoint;
            startPoint = endPoint;
            endPoint = tmp;
        }
        // convert radius in NM to KM
        const radiusValue = radius.split(' ')[0].trim();
        const radiusKm = parseFloat(radiusValue) * 1.852;
        // calculate start and end bearing
        const startBearing = calcBearing(centerPoint, startPoint);
        const endBearing = calcBearing(centerPoint, endPoint);
        // create arc linestring feature
        const arc = createArc(centerPoint, radiusKm, startBearing, endBearing, {
            steps: this._config.geometryDetail,
            units: 'kilometers',
        });

        // if counter-clockwise, reverse coordinate list order
        return isClockwise ? arc.geometry.coordinates : arc.geometry.coordinates.reverse();
    }

    /**
     *  Creates a (GeoJSON LineString) geometry which is essentially a list of coordinates pairs
     *  from a YAIXM airspace boundary "circle" definition.
     */
    private createCoordinatesFromCircle(boundaryDefinition: YaixmAirspaceBoundaryCircle): number[][] {
        const { radius, centre } = boundaryDefinition.circle;

        const isValidRadius = REGEX_ARC_RADIUS.test(radius);
        const isValidCentre = REGEX_COORDINATES.test(centre);

        if (radius == null || centre == null) {
            throw new Error(
                `Invalid arc boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this._identifier
                }' in sequence number '${this._sequenceNumber}'`
            );
        }
        if (isValidRadius === false) {
            throw new Error(
                `Invalid arc 'radius' '${radius}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }
        if (isValidCentre === false) {
            throw new Error(
                `Invalid arc 'centre' '${centre}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }

        // convert radius in NM to KM
        const radiusValue = radius.split(' ')[0].trim();
        const radiusKm = parseFloat(radiusValue) * 1.852;
        // get center point
        const [centerLon, centerLat] = this.transformCoordinates(centre);
        const centerPoint = createPoint([centerLon, centerLat]);

        const { geometry } = createCircle(centerPoint, radiusKm, {
            steps: this._config.geometryDetail,
            units: 'kilometers',
        });
        const [coordinates] = geometry.coordinates;

        return coordinates;
    }

    /**
     * Transforms a parsed coordinate string into a [lon,lat] coordinate pair.
     */
    private transformCoordinates(coordinateString: string): number[] {
        try {
            // convert to coordinates pair that parser can understand
            const formatLatitude = function (coord) {
                // split coordinate into parts
                coord = coord.trim();
                // handle latitudes
                const deg = coord.substring(0, 2);
                const min = coord.substring(2, 4);
                const sec = coord.substring(4, 6);
                const ordinalDir = coord.substring(6, 7);

                return `${deg}:${min}:${sec} ${ordinalDir}`;
            };
            const formatLongitude = function (coord) {
                // split coordinate into parts
                coord = coord.trim();
                // handle latitudes
                const deg = coord.substring(0, 3);
                const min = coord.substring(3, 5);
                const sec = coord.substring(5, 7);
                const ordinalDir = coord.substring(7, 8);

                return `${deg}:${min}:${sec} ${ordinalDir}`;
            };

            const [coordLat, coordLon] = coordinateString.split(' ');
            let lat = formatLatitude(coordLat);
            let lon = formatLongitude(coordLon);
            const parserCoordinate = `${lat},${lon}`;
            const parser = new CoordinateParser();
            const parsedCoordinate = parser.parse(parserCoordinate.trim());

            return [parsedCoordinate.longitude, parsedCoordinate.latitude];
        } catch (e) {
            throw new Error(
                `Failed to transform coordinates '${coordinateString}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
            );
        }
    }

    private fixGeometry(geometry: GeoJSON.Polygon): GeoJSON.Polygon {
        let fixedGeometry = geometry;

        const { isValid, isSimple, selfIntersect } = this.validateGeometry(geometry);
        // IMPORTANT only run if required since process will slightly change the original airspace by creating a buffer
        //  which will lead to an increase of polygon coordinates
        if (!isValid || !isSimple || selfIntersect) {
            try {
                fixedGeometry = this.createFixedPolygon(geometry.coordinates[0]);
            } catch (e) {
                throw new Error(
                    `Failed to create fixed geometry for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'. ${e.message}`
                );
            }
        }

        return fixedGeometry;
    }

    /**
     * Tries to create a valid Polygon geometry without any self-intersections and holes from the input coordinates.
     * This does ALTER the geometry and will return a new and valid geometry instead. Depending on the size of self-intersections,
     * holes and other errors, the returned geometry may differ A LOT from the original one!
     */
    private createFixedPolygon(coordinates: number[][]): GeoJSON.Polygon {
        // prepare "raw" coordinates first before creating a polygon feature
        coordinates = this.removeDuplicates(coordinates);

        // use "any" as the type of the variable changes due to different filters applied
        let polygon: any = undefined;
        try {
            coordinates = this.removeOverlapPoints(coordinates);
            const linestring = createLineString(coordinates);
            polygon = lineToPolygon(linestring);
            polygon = unkinkPolygon(polygon);
            // use the largest polygon in collection as the main polygon - assumed is that all kinks are smaller in size
            // and neglectable
            const getPolygon = function (features) {
                let polygon = null;
                let polygonArea = null;
                for (const feature of features) {
                    const area = getArea(feature);

                    if (area >= polygonArea) {
                        polygonArea = area;
                        polygon = feature;
                    }
                }

                return polygon;
            };
            polygon = getPolygon(polygon.features);

            return polygon.geometry;
        } catch (e) {
            /*
            Use "envelope" on edge cases that cannot be fixed with above logic. Resulting geometry will be
            completely changed but area enclosed by original airspace will be enclosed also. In case of single, dual point
            invalid polygons, this will at least return a valid geometry though it will differ the most from the original one.
             */
            try {
                const pointFeatures = [];
                for (const coord of coordinates) {
                    pointFeatures.push(createPoint(coord));
                }
                return envelope(createFeatureCollection(pointFeatures)).geometry;
            } catch (e) {
                throw new Error(e.message);
            }
        }
    }

    /**
     * @param {Object} geometry
     * @return {{isValid: boolean, isSimple: boolean, selfIntersect: (Object|null)}}
     * @private
     */
    private validateGeometry(geometry) {
        // validate airspace geometry
        let isValid = this.isValid(geometry);
        let isSimple = this.isSimple(geometry);
        const selfIntersect = this.getSelfIntersections(geometry);

        return { isValid, isSimple, selfIntersect };
    }

    /**
     * @param {Object} polygonGeometry
     * @return {boolean}
     * @private
     */
    private isValid(polygonGeometry) {
        const reader = new jsts.io.GeoJSONReader();
        const jstsGeometry = reader.read(polygonGeometry);
        const isValidValidator = new jsts.operation.valid.IsValidOp(jstsGeometry);

        return isValidValidator.isValid();
    }

    /**
     * @param {Object} polygonGeometry
     * @return {boolean}
     * @private
     */
    private isSimple(polygonGeometry) {
        const reader = new jsts.io.GeoJSONReader();
        const jstsGeometry = reader.read(polygonGeometry);
        const isSimpleValidator = new jsts.operation.IsSimpleOp(jstsGeometry);

        return isSimpleValidator.isSimple();
    }

    /**
     * @param {Object} polygonGeometry
     * @return {Object|null}
     * @private
     */
    private getSelfIntersections(polygonGeometry) {
        const reader = new jsts.io.GeoJSONReader();
        const jstsGeometry = reader.read(polygonGeometry);

        // if the geometry is already a simple linear ring, do not
        // try to find self intersection points.
        if (jstsGeometry) {
            const validator = new jsts.operation.IsSimpleOp(jstsGeometry);
            if (validator.isSimpleLinearGeometry(jstsGeometry)) {
                return;
            }

            let res = {};
            const graph = new jsts.geomgraph.GeometryGraph(0, jstsGeometry);
            const cat = new jsts.operation.valid.ConsistentAreaTester(graph);
            const r = cat.isNodeConsistentArea();
            if (!r) {
                res = cat.getInvalidPoint();
            }
            return res;
        }
    }

    /**
     * Removes high proximity coordinates, i.e. removes coordinate if another coordinate is within 10 meters.
     *
     * @params {Array[]} coordinates
     * @returns {Array[]}
     * @private
     */
    private removeDuplicates(coordinates) {
        const processed = [];
        for (const coord of coordinates) {
            const exists = processed.find((value) => {
                return distance(value, coord, { units: 'kilometers' }) < 0.001;
            });

            if (exists === undefined) {
                processed.push(coord);
            }
        }

        return processed;
    }

    /**
     * Takes a list of coordinates and moves along all points and checks whether the traversed
     * path would form an overlapping line.
     *
     * @param {Array[]} coordinates
     * @return {Array[]}
     */
    private removeOverlapPoints(coordinates) {
        const fixedPoints = [];
        let lastBearing = null;

        coordinates.forEach((coord, index) => {
            // get bearing to next point
            const nextPoint = coordinates[index + 1];
            let nextBearing = null;
            // calc bearing to next point if any, otherwise add last point and exit
            if (nextPoint) {
                nextBearing = parseInt(calcBearing(coord, nextPoint));
            } else {
                fixedPoints.push(coord);
                return;
            }
            // always use 360 instead of 0
            nextBearing = nextBearing === 0 ? 360 : nextBearing;
            // if next bearing is exactly the opposite direction, we found an overlapping part of the line string
            const oppBearing = parseInt(nextBearing > 360 && nextBearing < 180 ? nextBearing + 180 : nextBearing - 180);
            if (lastBearing == null || oppBearing !== lastBearing) {
                fixedPoints.push(coord);
                lastBearing = nextBearing;
            }
        });

        return fixedPoints;
    }

    private reset() {
        this._identifier = undefined;
        this._sequenceNumber = undefined;
        this._boundaryCoordinates = [];
    }
}
