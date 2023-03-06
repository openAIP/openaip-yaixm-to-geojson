const checkTypes = require('check-types');
const fs = require('node:fs');
const { AirspaceConverter } = require('./airspace-converter');

const DEFAULT_CONFIG = require('./default-config');

/**
 * Converts YAIXM files to GeoJSON file.
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
     * @return {Promise<void>}
     */
    async convertFromFile(inputFilepath, config) {
        this.reset();

        const { type } = config;

        if (checkTypes.nonEmptyString(inputFilepath) === false) {
            throw new Error("Missing or invalid parameter 'inputFilePath'");
        }
        if (checkTypes.nonEmptyString(type) === false) {
            throw new Error("Missing or invalid config parameter 'type'");
        }

        const exists = await fs.existsSync(inputFilepath);
        if (exists === false) {
            throw new Error(`File '${inputFilepath}' does not exist`);
        }
        // read file content from inputFilePath to Buffer and hand over to convertFromBuffer function
        const buffer = await fs.readFileSync(inputFilepath);

        return this.convertFromBuffer(buffer, { type });
    }

    /**
     * @param {Buffer} buffer
     * @param {Object} config
     * @param {string} config.type - Type of YAIXM content. Currently only "airspace" is supported.
     * @return {Promise<void>}
     */
    async convertFromBuffer(buffer, config) {
        this.reset();

        const { type } = config;

        if (checkTypes.instance(buffer, Buffer) === false) {
            throw new Error("Missing or invalid parameter 'buffer'");
        }
        if (checkTypes.nonEmptyString(type) === false) {
            throw new Error("Missing or invalid config parameter 'type'");
        }

        const converter = this.getConverter(type, this.config);
        this.geojson = converter.convert(buffer);
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
     * @param {Object} [config]
     * @return {Object}
     * @private
     */
    getConverter(type, config) {
        switch (type) {
            case 'airspace':
                return new AirspaceConverter(config);
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
