import * as fs from 'node:fs';
import type { FeatureCollection, Polygon } from 'geojson';
import { z } from 'zod';
import { AirspaceConverter } from './airspace-converter.js';
import DEFAULT_CONFIG from './default-config.js';
import { validateSchema } from './validate-schema.js';

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
    geometryDetail?: number;
    // If true, the created GEOJSON is validated against the underlying schema to enforce compatibility.
    strictSchemaValidation?: boolean;
};

type Configuration = {
    validateGeometries: boolean;
    fixGeometries: boolean;
    geometryDetail: number;
    strictSchemaValidation: boolean;
};

export const ConvertFromFileConfigSchema = z
    .object({
        type: z.string(),
        serviceFilePath: z.string().optional(),
    })
    .strict()
    .describe('ConvertFromFileConfigSchema');

export type ConvertFromFileConfig = {
    // Type of YAIXM content. Currently only "airspace" is supported.
    type: string;
    // If given, tries to read services from file if type is "airspace". If successful, this will map radio services to airspaces.
    // If not given, services are not read.
    serviceFilePath?: string;
};

export const ConvertFromBufferConfigSchema = z
    .object({
        type: z.string(),
        serviceFileBuffer: z.instanceof(Buffer).optional(),
    })
    .strict()
    .describe('ConvertFromBufferConfigSchema');

export type ConvertFromBufferConfig = {
    // Type of YAIXM content. Currently only "airspace" is supported.
    type: string;
    // Buffer of a "service.yaml" file. If given, tries to read services from file if type is "airspace".
    // If successful, this will map radio services to airspaces. If not given, services are not read.
    serviceFileBuffer?: Buffer;
};

/**
 * Converts a YAIXM file to GeoJSON file.
 */
export class YaixmConverter {
    private _config: Configuration;
    private _geojson: FeatureCollection<Polygon, any> | undefined; // IMPROVE add actual return properties

    constructor(config: Config) {
        validateSchema(config, ConfigSchema, { assert: true, name: 'Config' });

        this._config = { ...DEFAULT_CONFIG, ...config };
    }

    async convertFromFile(inputFilepath: string, config: ConvertFromFileConfig): Promise<void> {
        validateSchema(config, ConvertFromFileConfigSchema, { assert: true, name: 'ConvertFromFileConfig' });

        const { type, serviceFilePath } = config;

        // reset internal state
        this.reset();

        const existsAirspaceFile = fs.existsSync(inputFilepath);
        if (existsAirspaceFile === false) {
            throw new Error(`File '${inputFilepath}' does not exist`);
        }
        if (serviceFilePath != null) {
            const existsServiceFile = fs.existsSync(serviceFilePath);
            if (existsServiceFile === false) {
                throw new Error(`File '${serviceFilePath}' does not exist`);
            }
        }
        // read file content from inputFilePath to Buffer and hand over to convertFromBuffer function
        const buffer = fs.readFileSync(inputFilepath);
        const convertFromBufferConfig: ConvertFromBufferConfig = { type };
        if (serviceFilePath != null) {
            convertFromBufferConfig.serviceFileBuffer = fs.readFileSync(serviceFilePath);
        }

        return this.convertFromBuffer(buffer, convertFromBufferConfig);
    }

    toGeojson(): GeoJSON.Polygon | undefined {
        return this._geojson;
    }

    /**
     * @param {string} outputFilepath
     * @return {Promise<void>}
     */
    async toGeojsonFile(outputFilepath: string): Promise<void> {
        validateSchema(outputFilepath, z.string(), { assert: true, name: 'outputFilepath' });

        // handle edge case if no geojson data is available
        if (this._geojson == null) {
            throw new Error('No GeoJSON data to write to file');
        }
        try {
            // write geojson to file at outputFilepath
            const buffer = Buffer.from(JSON.stringify(this._geojson, null, 2), 'utf-8');
            fs.writeFileSync(outputFilepath, buffer);
        } catch (err: unknown) {
            if (err instanceof Error) {
                throw new Error(`Error writing file '${outputFilepath}': ${err.message}`);
            }
            throw new Error(`Error writing file '${outputFilepath}': ${String(err)}`);
        }
    }

    private async convertFromBuffer(buffer: Buffer, config: ConvertFromBufferConfig): Promise<void> {
        validateSchema(buffer, z.instanceof(Buffer), { assert: true, name: 'buffer' });
        validateSchema(config, ConvertFromBufferConfigSchema, { assert: true, name: 'ConvertFromBufferConfig' });

        const { type, serviceFileBuffer } = config;

        // reset internal state
        this.reset();

        const converter = this.getConverter(type);
        this._geojson = await converter.convert(buffer, { serviceFileBuffer });
    }

    /**
     * Returns the specific converter for the given type.
     */
    private getConverter(type: string): AirspaceConverter {
        switch (type) {
            case 'airspace':
                return new AirspaceConverter(this._config);
            default:
                throw new Error(`Unknown type '${type}'`);
        }
    }

    private reset(): void {
        this._geojson = undefined;
    }
}
