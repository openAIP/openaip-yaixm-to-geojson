const checkTypes = require('check-types');
const YAML = require('yaml');
const {
    featureCollection: createFeatureCollection,
    point: createPoint,
    lineArc: createArc,
    bearing: calcBearing,
    lineString: createLineString,
    lineToPolygon,
    unkinkPolygon,
    area: getArea,
    envelope,
    distance,
    circle: createCircle,
} = require('@turf/turf');
const Coordinates = require('coordinate-parser');
const rewind = require('@mapbox/geojson-rewind');
const jsts = require('jsts');
const cleanDeep = require('clean-deep');

const DEFAULT_CONFIG = require('./default-config');
const REGEX_CEILING_SURFACE = /^(SFC)$/;
const REGEX_CEILING_FEET = /^(\d+(\.\d+)?)\s*(FT|ft)?\s*(SFC)?$/;
const REGEX_CEILING_FLIGHT_LEVEL = /^FL\s*(\d{2,})?$/;
const REGEX_COORDINATES = /^[0-9]{6}[NS]\s+[0-9]{7}[EW]$/;
const REGEX_ARC_DIR = /^(cw|ccw)$/;
const REGEX_ARC_RADIUS = /^(\d+(\.\d+)?)\s*(NM|nm)?$/;

class AirspaceConverter {
    /**
     * @param {Object} [config]
     * @param {Object} [config.validateGeometries] - Validate geometries. Defaults to true.
     * @param {Object} [config.fixGeometries] - Fix geometries that are not valid. Defaults to false.
     * @param {number} [config.geometryDetail] - Defines the steps that are used to calculate arcs and circles. Defaults to 100. Higher values mean smoother circles but a higher number of polygon points.
     */
    constructor(config) {
        this.config = Object.assign(DEFAULT_CONFIG, config);

        if (checkTypes.boolean(this.config.validateGeometries) === false) {
            throw new Error(
                `Missing or invalid config parameter 'validateGeometries': ${this.config.validateGeometries}`
            );
        }
        if (checkTypes.boolean(this.config.fixGeometries) === false) {
            throw new Error(`Missing or invalid config parameter 'fixGeometries': ${this.config.fixGeometries}`);
        }
        if (checkTypes.integer(this.config.geometryDetail) === false) {
            throw new Error(`Missing or invalid config parameter 'geometryDetail': ${this.config.geometryDetail}`);
        }

        // used in error messages to better identify the airspace that caused the error
        this.ident = null;
        this.seqno = null;
        // keep track of all calculated coordinates for the currently processed airspace boundary
        this.boundaryCoordinates = [];
    }

    /**
     * Converts a buffer containing YAIXM airspace data to GeoJSON.
     *
     * @param {Buffer} buffer
     * @return {Object}
     */
    convert(buffer) {
        this.reset();

        if (checkTypes.instance(buffer, Buffer) === false) {
            throw new Error("Missing or invalid parameter 'buffer'");
        }

        const geojsonFeatures = [];
        const yaixm = YAML.parse(buffer.toString('utf-8'));
        for (const airspace of yaixm.airspace) {
            geojsonFeatures.push(...this.createAirspaceFeatures(airspace));
        }

        return createFeatureCollection(geojsonFeatures);
    }

    /**
     * @return {Object}
     * @private
     */
    createAirspaceFeatures(airspaceJson) {
        const features = [];
        const { name, type, localtype: localType, class: airspaceClass, geometry, rules } = airspaceJson;

        // for each airspace geometry defined in YAIXM block, create a GeoJSON feature
        for (const geometryDefinition of geometry) {
            const { seqno, upper, lower, boundary } = geometryDefinition;
            // set identifier for error messages
            this.ident = name;
            // set sequence number for error messages, use "0" if no sequence number is defined
            this.seqno = seqno || 0;

            const upperCeiling = this.createCeiling(upper);
            const lowerCeiling = this.createCeiling(lower);
            let geometry = this.createPolygonGeometry(boundary);

            if (this.config.fixGeometries) {
                geometry = this.fixGeometry(geometry);
            }
            if (this.config.validateGeometries) {
                const { isValid, selfIntersect } = this.validateGeometry(geometry);
                if (isValid === false) {
                    let message = `Invalid geometry for airspace '${this.ident}' in sequence number '${this.seqno}'`;
                    if (selfIntersect != null) {
                        message += `: Self intersection at ${JSON.stringify(selfIntersect)}`;
                    }
                    throw new Error(message);
                }
            }

            features.push(
                cleanDeep({
                    type: 'Feature',
                    // set "base" airspace properties that is common to all airspaces defined in YAIXM  block. Each YAIXM block can define
                    // multiple airspaces, all with the same base properties.
                    properties: {
                        name,
                        localType: localType,
                        type: type,
                        class: airspaceClass,
                        rules,
                        upperCeiling,
                        lowerCeiling,
                    },
                    geometry,
                })
            );
            // IMPORTANT reset internal state for next airspace
            this.reset();
        }

        return features;
    }

    /**
     * @param {string} type
     * @param {string} localType
     * @param {string} airspaceClass
     *
     * @return {{type: string, class: string}}
     */
    mapClassAndType(type, localType, airspaceClass) {
        if (type != null && airspaceClass != null) {
            return { type, class: airspaceClass };
        } else if (type != null && localType != null) {
        }

        throw new Error(
            `Failed to map class/type combination for airspace '${this.ident}' in sequence number '${this.seqno}'`
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
    createCeiling(ceilingDefinition) {
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
                `Invalid ceiling definition '${ceilingDefinition}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
            );
        }

        if (isValidSurfaceDefinition) {
            const altitudeParts = REGEX_CEILING_SURFACE.exec(ceilingDefinition);
            let referenceDatum = altitudeParts[0];

            return { value: 0, unit: 'FT', referenceDatum };
        } else if (isValidFeetDefinition) {
            // check for "default" altitude definition, e.g. 16500ft MSL or similar
            const altitudeParts = REGEX_CEILING_FEET.exec(ceilingDefinition);
            // get altitude parts
            let value = parseFloat(altitudeParts[1]);
            let unit = altitudeParts[3];
            const referenceDatum = altitudeParts[4] || 'MSL';

            return { value, unit, referenceDatum };
        } else if (isValidFlightLevelDefinition) {
            // check flight level altitude definition
            const altitudeParts = REGEX_CEILING_FLIGHT_LEVEL.exec(ceilingDefinition);
            // get altitude parts
            let value = parseInt(altitudeParts[1]);
            const unit = 'FL';
            const referenceDatum = 'STD';

            return { value, unit, referenceDatum };
        }
    }

    /**
     * Creates a GeoJSON Polygon geometry from a YAIXM airspace boundary (geometry) definition.
     *
     * @param {Array} boundary
     * @return {Object}
     * @private
     */
    createPolygonGeometry(boundary) {
        // Each object on the boundary array resolves into a GeoJSON LineString geometry. Resolve each boundary object into a
        // list of coordinates pairs and then create a GeoJSON Polygon geometry from them.
        // Also make sure the resulting Polygon geometry is valid.
        for (const boundaryDefinition of boundary) {
            const boundaryType = Array.from(Object.keys(boundaryDefinition))[0];

            switch (boundaryType) {
                case 'line': {
                    const coordinates = this.createCoordinatesFromLine(boundaryDefinition);
                    this.boundaryCoordinates.push(...coordinates);
                    break;
                }
                case 'arc': {
                    const coordinates = this.createCoordinatesFromArc(boundaryDefinition);
                    this.boundaryCoordinates.push(...coordinates);
                    break;
                }
                case 'circle': {
                    const coordinates = this.createCoordinatesFromCircle(boundaryDefinition);
                    this.boundaryCoordinates.push(...coordinates);
                    break;
                }
                default:
                    throw new Error(
                        `Unsupported boundary type '${boundaryType}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
                    );
            }
        }

        const lineString = createLineString(this.boundaryCoordinates);
        // create polygon geometry from LineString geometry using turfjs
        // add first coordinate pair to end of list to close the polygon if first and last item do not match
        let polygonFeature = lineToPolygon(lineString, { autoComplete: true, mutate: true, orderCoords: true });
        // make sure the polygon follows the right-hand rule
        polygonFeature = rewind(polygonFeature, false);

        return polygonFeature.geometry;
    }

    /**
     * Creates a GeoJSON LineString geometry from a YAIXM airspace boundary "line" definition.
     *
     * @param {Object} boundaryDefinition
     * @return {Array}
     * @private
     */
    createCoordinatesFromLine(boundaryDefinition) {
        const coordinates = boundaryDefinition?.line;
        if (Array.isArray(coordinates) === false || coordinates.length === 0) {
            throw new Error(
                `Invalid line boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this.ident
                }' in sequence number '${this.seqno}'`
            );
        }
        const coords = [];
        for (const coordinate of coordinates) {
            // validate coordinate string
            if (REGEX_COORDINATES.test(coordinate) === false) {
                throw new Error(
                    `Invalid coordinate '${coordinate}' in line boundary definition '${JSON.stringify(
                        boundaryDefinition
                    )}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
                );
            }
            const coord = this.transformCoordinates(coordinate);
            coords.push(coord);
        }

        return coords;
    }

    /**
     * Creates a GeoJSON LineString geometry from a YAIXM airspace boundary "arc" definition.
     *
     * @param {Object} boundaryDefinition
     * @return {Array}
     * @private
     */
    createCoordinatesFromArc(boundaryDefinition) {
        // eslint-disable-next-line no-unsafe-optional-chaining
        const { dir, radius, centre, to } = boundaryDefinition?.arc;
        // get last coordinates pair from boundary coordinates
        const lastCoord = this.boundaryCoordinates[this.boundaryCoordinates.length - 1];

        const isValidDir = REGEX_ARC_DIR.test(dir);
        const isValidRadius = REGEX_ARC_RADIUS.test(radius);
        const isValidCentre = REGEX_COORDINATES.test(centre);
        const isValidTo = REGEX_COORDINATES.test(to);

        if (lastCoord == null) {
            throw new Error(
                `Invalid arc boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this.ident
                }' in sequence number '${this.seqno}'. Previous coordinate pair is missing.`
            );
        }
        if (dir == null || radius == null || centre == null || to == null) {
            throw new Error(
                `Invalid arc boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this.ident
                }' in sequence number '${this.seqno}'`
            );
        }
        if (isValidDir === false) {
            throw new Error(
                `Invalid arc 'direction' '${dir}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
            );
        }
        if (isValidRadius === false) {
            throw new Error(
                `Invalid arc 'radius' '${radius}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
            );
        }
        if (isValidCentre === false) {
            throw new Error(
                `Invalid arc 'centre' '${centre}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
            );
        }
        if (isValidTo === false) {
            throw new Error(
                `Invalid arc 'to' '${to}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
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
            steps: this.config.geometryDetail,
            units: 'kilometers',
        });

        // if counter-clockwise, reverse coordinate list order
        return isClockwise ? arc.geometry.coordinates : arc.geometry.coordinates.reverse();
    }

    /**
     * Creates a GeoJSON LineString geometry from a YAIXM airspace boundary "circle" definition.
     *
     * @param {Object} boundaryDefinition
     * @return {Array}
     * @private
     */
    createCoordinatesFromCircle(boundaryDefinition) {
        // eslint-disable-next-line no-unsafe-optional-chaining
        const { radius, centre } = boundaryDefinition?.circle;

        const isValidRadius = REGEX_ARC_RADIUS.test(radius);
        const isValidCentre = REGEX_COORDINATES.test(centre);

        if (radius == null || centre == null) {
            throw new Error(
                `Invalid arc boundary definition '${JSON.stringify(boundaryDefinition)}' for airspace '${
                    this.ident
                }' in sequence number '${this.seqno}'`
            );
        }
        if (isValidRadius === false) {
            throw new Error(
                `Invalid arc 'radius' '${radius}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
            );
        }
        if (isValidCentre === false) {
            throw new Error(
                `Invalid arc 'centre' '${centre}' in arc boundary definition '${JSON.stringify(
                    boundaryDefinition
                )}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
            );
        }

        // convert radius in NM to KM
        const radiusValue = radius.split(' ')[0].trim();
        const radiusKm = parseFloat(radiusValue) * 1.852;
        // get center point
        const [centerLon, centerLat] = this.transformCoordinates(centre);
        const centerPoint = createPoint([centerLon, centerLat]);

        const { geometry } = createCircle(centerPoint, radiusKm, {
            steps: this.config.geometryDetail,
            units: 'kilometers',
        });
        const [coordinates] = geometry.coordinates;

        return coordinates;
    }

    /**
     * Transforms a parsed coordinate string into a [lon,lat] coordinate pair.
     *
     * @param {String} coordinateString
     * @return {Array}
     * @private
     */
    transformCoordinates(coordinateString) {
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
            const coord = new Coordinates(parserCoordinate);

            return [coord.getLongitude(), coord.getLatitude()];
        } catch (e) {
            throw new Error(
                `Failed to transform coordinates '${coordinateString}' for airspace '${this.ident}' in sequence number '${this.seqno}'`
            );
        }
    }

    /**
     * @param {Object} geometry
     * @return {Object}
     * @private
     */
    fixGeometry(geometry) {
        let fixedGeometry = geometry;

        const { isValid, isSimple, selfIntersect } = this.validateGeometry(geometry);
        // IMPORTANT only run if required since process will slightly change the original airspace by creating a buffer
        //  which will lead to an increase of polygon coordinates
        if (!isValid || !isSimple || selfIntersect) {
            try {
                fixedGeometry = this.createFixedPolygon(geometry.coordinates[0]);
            } catch (e) {
                throw new Error(
                    `Failed to create fixed geometry for airspace '${this.ident}' in sequence number '${this.seqno}'. ${e.message}`
                );
            }
        }

        return fixedGeometry;
    }

    /**
     * Tries to create a valid Polygon geometry without any self-intersections and holes from the input coordinates.
     * This does ALTER the geometry and will return a new and valid geometry instead. Depending on the size of self-intersections,
     * holes and other errors, the returned geometry may differ A LOT from the original one!
     *
     * @param {Array[]} coordinates
     * @return {Object}
     * @private
     */
    createFixedPolygon(coordinates) {
        // prepare "raw" coordinates first before creating a polygon feature
        coordinates = this.removeDuplicates(coordinates);

        let polygon;
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
    validateGeometry(geometry) {
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
    isValid(polygonGeometry) {
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
    isSimple(polygonGeometry) {
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
    getSelfIntersections(polygonGeometry) {
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
    removeDuplicates(coordinates) {
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
    removeOverlapPoints(coordinates) {
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

    /**
     * @return {void}
     * @private
     */
    reset() {
        this.ident = null;
        this.seqno = null;
        this.boundaryCoordinates = [];
    }
}

module.exports = { AirspaceConverter };
