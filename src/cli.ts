#!/usr/bin/env node
import { program } from 'commander';
import { YaixmConverter } from './yaixm-converter.js';

program
    .option('-f, --input-filepath <inFilepath>', 'The input file path to the YAIXM file')
    .option('-o, --output-filepath <outFilepath>', 'The output filename of the generated GeoJSON file')
    .option(
        '-T, --type <type>',
        'The type to read from YAIXM file. Currently only "airspace" is supported. (default: "airspace")'
    )
    .option('-V, --validate', 'If specified, converter will validate geometries.')
    .option('-F, --fix-geometry', 'If specified, converter will try to fix geometries.')
    .option(
        '-S, --strict-schema-validation',
        'If specified, converter will strictly validate the created GeoJSON against the underlying schema. If the GeoJSON does not match the JSON schema, the converter will throw an error.'
    )
    .parse(process.argv);

(async () => {
    const options = program.opts();
    const type = options.type || 'airspace';
    const validateGeometry = options.validate || false;
    const fixGeometry = options.fixGeometry || false;
    const strictSchemaValidation = options.strictSchemaValidation || false;
    const converter = new YaixmConverter({
        validateGeometries: validateGeometry,
        fixGeometries: fixGeometry,
        strictSchemaValidation,
    });
    try {
        await converter.convertFromFile(options.inputFilePath, { type });
        await converter.toGeojsonFile(options.outputFilepath);
    } catch (err) {
        let errorMessage = 'Unknown error occured';
        if (err instanceof Error) {
            errorMessage = err.message;
        }
        console.log(errorMessage);
        process.exit(1);
    }
})();
