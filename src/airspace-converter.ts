import { Parser as CoordinateParser } from '@openaip/coordinate-parser';
import {
    bearing as calcBearing,
    lineArc as createArc,
    circle as createCircle,
    featureCollection as createFeatureCollection,
    lineString as createLineString,
    point as createPoint,
    lineToPolygon,
    rewind,
} from '@turf/turf';
import ajvErrors from 'ajv-errors';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnyValidateFunction } from 'ajv/dist/core.js';
import { Polygon, type Feature, type FeatureCollection } from 'geojson';
import YAML from 'yaml';
import { z } from 'zod';
import { cleanObject } from './clean-object.js';
import DEFAULT_CONFIG from './default-config.js';
import { GeojsonPolygonValidator } from './geojson-polygon-validator.js';
import GEOJSON_SCHEMA from './schemas/geojson-schema.json' with { type: 'json' };
import type { CoordLike, GeoJsonAirspaceFeature, GeoJsonAirspaceFeatureProperties } from './types.js';
import { validateSchema } from './validate-schema.js';

const AjvErrors = ajvErrors.default;

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
// boundary type is an array of line, arc or circle objects
type YaixmAirspaceBoundaries = YaixmAirspaceBoundaryLine | YaixmAirspaceBoundaryArc | YaixmAirspaceBoundaryCircle;
type YaixmAirspaceBoundary = YaixmAirspaceBoundaries[];

type YaixmAirspace = {
    name: string;
    id: string;
    type: string;
    localtype: string;
    // "rules" -> can have combination [TMZ, TRA, NOTAM, RMZ, ...]
    rules: string[];
    class: string;
    geometry: {
        seq: number;
        // identifier - name of the airspace formatted as "name-part1-part2"
        id: string;
        upper: string;
        lower: string;
        // sequences can overwrite case "class"
        class: string;
        // sequences can overwrite base "rules" -> can have combination [TMZ, TRA, NOTAM, RMZ, ...]
        rules: string[];
        boundary: YaixmAirspaceBoundary;
    }[];
};

export class AirspaceConverter {
    private _validateGeometries: boolean;
    private _fixGeometries: boolean;
    private _geometryDetail: number;
    private _strictSchemaValidation: boolean;
    private _schemaValidator: AnyValidateFunction;
    // used in error messages to better identify the airspace that caused the error
    private _identifier: string | undefined;
    private _sequenceNumber: number | undefined;
    // keep track of all calculated coordinates for the currently processed airspace boundary
    private _boundaryCoordinates: number[][] = [];

    constructor(config: Config) {
        validateSchema(config, ConfigSchema, { assert: true, name: 'Name' });

        const { fixGeometries, geometryDetail, strictSchemaValidation, validateGeometries } = {
            ...DEFAULT_CONFIG,
            ...config,
        };

        this._fixGeometries = fixGeometries;
        this._geometryDetail = geometryDetail;
        this._strictSchemaValidation = strictSchemaValidation;
        this._validateGeometries = validateGeometries;

        const ajvParser = new Ajv2020({
            verbose: true,
            allErrors: true,
            code: { esm: true },
            // use no keywords at all
            keywords: [],
            // nullable: true,
            // jsonPointers: true,
        });
        // set all used formats
        ajvParser.addFormat('date-time', 'date');
        // add unknown keywords that would otherwise result in an exception
        ajvParser.addVocabulary(['example']);
        AjvErrors(ajvParser);
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
    async convert(
        buffer: Buffer,
        options: ConvertOptions
    ): Promise<FeatureCollection<GeoJSON.Polygon, GeoJsonAirspaceFeatureProperties>> {
        validateSchema(buffer, z.instanceof(Buffer), { assert: true, name: 'Buffer' });
        validateSchema(options, ConvertOptionsSchema, { assert: true, name: 'ConvertOptions' });

        // reset internal state
        this.reset();

        const { serviceFileBuffer } = options;

        const yaixm = YAML.parse(buffer.toString('utf-8'));
        // build options for createAirspaceFeatures
        const createOptions: { services: YaixmService[] } = {
            services: [],
        };
        if (serviceFileBuffer != null) {
            // if services are given, use them as options and try to read them from file
            const service = await YAML.parse(serviceFileBuffer.toString());
            // parser will return frequency as floats which will remove the trailing zeros- we have convert
            // to "frequency formatted" string e.g. "123.000"
            for (const serviceItem of service.service) {
                // convert to string format
                const frequency = serviceItem.frequency.toString();
                // make sure we have the correct format which means padding with zeros if necessary
                const frequencyParts = frequency.split('.');
                const frequencyDecimal = frequencyParts[1] || '000';
                const frequencyFormatted = `${frequencyParts[0]}.${frequencyDecimal.padEnd(3, '0')}`;
                serviceItem.frequency = frequencyFormatted;
                createOptions.services.push(serviceItem as YaixmService);
            }
        }
        const geojsonFeatures: GeoJsonAirspaceFeature[] = [];
        for (const airspace of yaixm.airspace) {
            // each YAIXM airspace definition block may convert to multiple airspaces
            const airspaceFeatures: GeoJsonAirspaceFeature[] = await this.createAirspaceFeatures(
                airspace,
                createOptions
            );
            geojsonFeatures.push(...airspaceFeatures);
        }

        const geojson = createFeatureCollection(geojsonFeatures);
        const valid = this._schemaValidator(geojson);
        if (valid === false) {
            if (this._strictSchemaValidation) {
                throw new Error(
                    `GeoJSON does not adhere to underlying schema. ${JSON.stringify(this._schemaValidator.errors)}`
                );
            } else {
                console.log('WARN: GeoJSON does not adhere to underlying schema.');
            }
        }

        return geojson;
    }

    private buildAirspaceName(name: string, seq?: number): string {
        if (seq == null) {
            return name;
        }

        return `${name} ${seq}`;
    }

    private async createAirspaceFeatures(
        airspaceJson: YaixmAirspace,
        options: { services?: YaixmService[] }
    ): Promise<GeoJsonAirspaceFeature[]> {
        const { services } = options;
        const features: GeoJsonAirspaceFeature[] = [];
        const { name, id, type, localtype: localType, class: baseClass, geometry, rules: baseRules } = airspaceJson;
        const geojsonValidator = new GeojsonPolygonValidator();

        // set identifier for error messages
        this._identifier = name as string;

        // for each airspace geometry defined in YAIXM block, create a GeoJSON feature
        for (const geometryDefinition of geometry) {
            const { seq, upper, lower, boundary, class: sequenceClass, rules: sequenceRules } = geometryDefinition;
            // set sequence number for error messages, use "0" if no sequence number is defined
            this._sequenceNumber = seq || 0;

            const airspaceName = this.buildAirspaceName(name, seq);
            const airspaceClass = sequenceClass || baseClass;
            const airspaceRules = sequenceRules || baseRules;
            // map to only type/class combination
            const {
                type: mappedType,
                class: mappedClass,
                metaProps,
            } = this.mapClassAndType(type, localType, airspaceClass, airspaceRules);
            const upperCeiling = this.createCeiling(upper);
            const lowerCeiling = this.createCeiling(lower);
            let geometry = this.createPolygonGeometry(boundary);

            if (this._fixGeometries) {
                geometry = this.fixGeometry(geometry);
            }
            if (this._validateGeometries) {
                geojsonValidator.validate(geometry);
            }

            const featureProperties: Partial<GeoJsonAirspaceFeatureProperties> = {
                ...{
                    name: airspaceName,
                    type: mappedType,
                    class: mappedClass,
                    upperCeiling,
                    lowerCeiling,
                    activatedByNotam: airspaceRules?.includes('NOTAM') === true,
                    // set default value, will be overwritten by "metaProps" if applicable
                    activity: 'NONE',
                    remarks: airspaceRules == undefined ? undefined : airspaceRules.join(', '),
                },
                // merges updated field value for fields, e.g. "activity"
                ...metaProps,
            };
            // add frequency property if services are available and mapping property "id" is set
            if (id != null && services != null) {
                const groundService = await this.createGroundServiceProperty(id, services);
                if (groundService != null) {
                    featureProperties.groundService = groundService;
                }
            }
            const feature: GeoJsonAirspaceFeature = {
                type: 'Feature',
                // set "base" airspace properties that is common to all airspaces defined in YAIXM  block. Each YAIXM block can define
                // multiple airspaces, all with the same base properties.
                properties: featureProperties as GeoJsonAirspaceFeatureProperties,
                geometry,
            };

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
        services: YaixmService[]
    ): Promise<Omit<YaixmService, 'controls'> | null> {
        try {
            // read services file
            for (const service of services) {
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
            let errorMessage = 'Unknown error occured';
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            console.log(`WARN: Failed to map ground station services. ${errorMessage}`);

            return null;
        }
    }

    private mapClassAndType(
        type: string,
        localType: string,
        airspaceClass: string,
        airspaceRules: string[]
    ): { type: string; class: string; metaProps?: { activity: string } } {
        const message = `Failed to map class/type combination for airspace '${this._identifier}'.`;
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

        // rules can contain a type value that overwrites the main defined airspace type
        const ruleTypes = ['TMZ', 'TRA', 'RMZ'];
        if (airspaceRules != null && airspaceRules.some((rule) => ruleTypes.includes(rule))) {
            const ruleType = airspaceRules.find((rule) => ruleTypes.includes(rule));
            if (ruleType != null) {
                type = ruleType;
            }
        }
        if (type != null && airspaceClass != null) {
            let mappedType: string;
            let mappedClass: string;

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
                case 'TMZ':
                    mappedType = 'TMZ';
                    break;
                case 'RMZ':
                    mappedType = 'RMZ';
                    break;
                case 'TRA':
                    mappedType = 'TRA';
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
                case 'TRA|GLIDER':
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
                case 'RMZ|RMZ':
                case 'OTHER|RMZ':
                    return {
                        type: 'RMZ',
                        class: 'UNCLASSIFIED',
                    };
                case 'TMZ|TMZ':
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
            const value = parseFloat((altitudeParts as string[])[1]);
            const unit = (altitudeParts as string[])[3].toUpperCase();
            let referenceDatum = (altitudeParts as string[])[4] || 'MSL';
            // always use instead of SFC
            referenceDatum = referenceDatum === 'SFC' ? 'GND' : referenceDatum.toUpperCase();

            return { value, unit, referenceDatum };
        } else if (isValidFlightLevelDefinition) {
            // check flight level altitude definition
            const altitudeParts = REGEX_CEILING_FLIGHT_LEVEL.exec(ceilingDefinition);
            // get altitude parts
            const value = parseInt((altitudeParts as string[])[1]);

            return { value, unit: 'FL', referenceDatum: 'STD' };
        }

        throw new Error(
            `Invalid ceiling definition '${ceilingDefinition}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
        );
    }

    /**
     * Creates a GeoJSON Polygon geometry from a YAIXM airspace boundary (geometry) definition.
     */
    private createPolygonGeometry(boundary: YaixmAirspaceBoundary): GeoJSON.Polygon {
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
        let polygonFeature = lineToPolygon(lineString, {
            autoComplete: true,
            mutate: true,
            orderCoords: true,
        });
        // make sure the polygon follows the right-hand rule
        polygonFeature = rewind(polygonFeature, { reverse: false }) as Feature<Polygon>;

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
        const coords: CoordLike[] = [];
        for (const coordinate of coordinates) {
            // validate coordinate string
            if (REGEX_COORDINATES.test(coordinate) === false) {
                throw new Error(
                    `Invalid coordinate '${coordinate}' in line boundary definition '${JSON.stringify(
                        boundaryDefinition
                    )}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'`
                );
            }
            const coord: CoordLike = this.transformCoordinates(coordinate);
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
            steps: this._geometryDetail,
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
            steps: this._geometryDetail,
            units: 'kilometers',
        });
        const [coordinates] = geometry.coordinates;

        return coordinates;
    }

    /**
     * Transforms a parsed coordinate string into a [lon,lat] coordinate pair.
     */
    private transformCoordinates(coordinateString: string): CoordLike {
        try {
            // convert to coordinates pair that parser can understand
            const formatLatitude = function (coord: string): string {
                // split coordinate into parts
                coord = coord.trim();
                // handle latitudes
                const deg = coord.substring(0, 2);
                const min = coord.substring(2, 4);
                const sec = coord.substring(4, 6);
                const ordinalDir = coord.substring(6, 7);

                return `${deg}:${min}:${sec} ${ordinalDir}`;
            };
            const formatLongitude = function (coord: string): string {
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
            const lat = formatLatitude(coordLat);
            const lon = formatLongitude(coordLon);
            const parserCoordinate = `${lat},${lon}`;
            const parser = new CoordinateParser();
            const parsedCoordinate = parser.parse(parserCoordinate.trim());

            return [parsedCoordinate.longitude, parsedCoordinate.latitude];
        } catch (err) {
            let errorMessage = 'Unknown error occured';
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            throw new Error(
                `Failed to transform coordinates '${coordinateString}' for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'. ${errorMessage}`
            );
        }
    }

    private fixGeometry(geometry: GeoJSON.Polygon): GeoJSON.Polygon {
        let fixedGeometry = geometry;
        const geojsonValidator = new GeojsonPolygonValidator();

        const isValid = geojsonValidator.isValid(geometry);
        // IMPORTANT only run if required since process will slightly change the original airspace by creating a buffer
        //  which will lead to an increase of polygon coordinates
        if (isValid === false) {
            try {
                fixedGeometry = geojsonValidator.makeValid(geometry);
            } catch (err) {
                let errorMessage = 'Unknown error occured';
                if (err instanceof Error) {
                    errorMessage = err.message;
                }
                throw new Error(
                    `Failed to create fixed geometry for airspace '${this._identifier}' in sequence number '${this._sequenceNumber}'. ${errorMessage}`
                );
            }
        }

        return fixedGeometry;
    }

    private reset() {
        this._identifier = undefined;
        this._sequenceNumber = undefined;
        this._boundaryCoordinates = [];
    }
}
