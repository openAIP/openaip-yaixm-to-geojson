const checkTypes = require('check-types');
const fs = require('node:fs');
const { AirspaceConverter } = require('./airspace-converter');

const DEFAULT_CONFIG = require('./default-config');

/**
 * Converts a YAIXM file to GeoJSON file.
 */
class YaixmConverter {
    /**
     * @param {Object} [config]
     * @param {Object} [config.validateGeometries] - Validate geometries. Defaults to true.
     * @param {Object} [config.fixGeometries] - Fix geometries that are not valid. Defaults to false.
     * @param {number} [config.geometryDetail] - Defines the steps that are used to calculate arcs and circles. Defaults to 100. Higher values
     * @param {boolean} [config.strictSchemaValidation] - If true, the created GEOJSON is validated against the underlying schema to enforce compatibility.
     * If false, simply warns on console about schema mismatch. Defaults to false.
     */
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };

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
        if (checkTypes.boolean(this.config.strictSchemaValidation) === false) {
            throw new Error(
                `Missing or invalid config parameter 'strictSchemaValidation': ${this.config.strictSchemaValidation}`
            );
        }

        /** @type {Object} */
        this.geojson = null;
    }

    /**
     * @param {string} inputFilepath
     * @param {Object} config
     * @param {string} config.type - Type of YAIXM content. Currently only "airspace" is supported.
     * @param {string} [config.serviceFilePath] - If given, tries to read services from file if type is "airspace". If successful, this will map radio services to airspaces. If not given, services are not read.
     * @return {Promise<void>}
     */
    async convertFromFile(inputFilepath, config) {
        this.reset();

        const { type, serviceFilePath } = config;

        if (checkTypes.nonEmptyString(inputFilepath) === false) {
            throw new Error("Missing or invalid parameter 'inputFilePath'");
        }
        if (checkTypes.nonEmptyString(type) === false) {
            throw new Error("Missing or invalid config parameter 'type'");
        }
        if (serviceFilePath != null && checkTypes.nonEmptyString(serviceFilePath) === false) {
            throw new Error(`Missing or invalid config parameter 'serviceFilePath': ${serviceFilePath}`);
        }

        const existsAirspaceFile = await fs.existsSync(inputFilepath);
        if (existsAirspaceFile === false) {
            throw new Error(`File '${inputFilepath}' does not exist`);
        }
        if (serviceFilePath != null) {
            const existsServiceFile = await fs.existsSync(serviceFilePath);
            if (existsServiceFile === false) {
                throw new Error(`File '${serviceFilePath}' does not exist`);
            }
        }

        // read file content from inputFilePath to Buffer and hand over to convertFromBuffer function
        const buffer = await fs.readFileSync(inputFilepath);

        const convertConfig = { type };
        if (serviceFilePath != null) {
            convertConfig.serviceFileBuffer = await fs.readFileSync(serviceFilePath);
        }

        return this.convertFromBuffer(buffer, convertConfig);
    }

    /**
     * @param {Buffer} buffer
     * @param {Object} config
     * @param {string} config.type - Type of YAIXM content. Currently only "airspace" is supported.
     * @param {Buffer} [config.serviceFileBuffer] - Buffer of a "service.yaml" file. If given, tries to read services from file if type is "airspace".
     * If successful, this will map radio services to airspaces. If not given, services are not read.
     * @return {Promise<void>}
     */
    async convertFromBuffer(buffer, config) {
        this.reset();

        const { type, serviceFileBuffer } = config;

        if (checkTypes.instance(buffer, Buffer) === false) {
            throw new Error("Missing or invalid parameter 'buffer'");
        }
        if (checkTypes.nonEmptyString(type) === false) {
            throw new Error("Missing or invalid config parameter 'type'");
        }
        if (serviceFileBuffer != null && checkTypes.instance(serviceFileBuffer, Buffer) === false) {
            throw new Error(`Missing or invalid config parameter 'serviceFileBuffer': ${serviceFileBuffer}`);
        }

        const converter = this.getConverter(type);
        this.geojson = await converter.convert(buffer, { serviceFileBuffer });
    }

    /**
     * @return {Object}
     */
    toGeojson() {
        return this.geojson;
    }

    /**
     * @param {string} outputFilepath
     * @return {Promise<void>}
     */
    async toGeojsonFile(outputFilepath) {
        if (checkTypes.nonEmptyString(outputFilepath) === false) {
            throw new Error("Missing or invalid parameter 'outputFilepath'");
        }
        if (this.geojson == null) {
            throw new Error('No GeoJSON data to write to file');
        }

        try {
            // write geojson to file at outputFilepath
            const buffer = Buffer.from(JSON.stringify(this.geojson, null, 2), 'utf-8');
            await fs.writeFileSync(outputFilepath, buffer);
        } catch (e) {
            throw new Error(`Error writing file '${outputFilepath}': ${e.message}`);
        }
    }

    /**
     * Returns the specific converter for the given type.
     *
     *
     * @param {string} type
     * @return {Object}
     * @private
     */
    getConverter(type) {
        switch (type) {
            case 'airspace':
                return new AirspaceConverter(this.config);
            default:
                throw new Error(`Unknown type '${type}'`);
        }
    }

    /**
     * @return {void}
     * @private
     */
    reset() {
        this.geojson = null;
    }
}

module.exports = { YaixmConverter };
