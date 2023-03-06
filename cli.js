#!/usr/bin/env node

const { YaixmConverter } = require('./src/yaixm-converter');
const program = require('commander');

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
    const type = program.type || 'airspace';
    const validateGeometry = program.validate || false;
    const fixGeometry = program.fixGeometry || false;
    const strictSchemaValidation = program.strictSchemaValidation || false;
    const converter = new YaixmConverter({
        validateGeometries: validateGeometry,
        fixGeometries: fixGeometry,
        strictSchemaValidation,
    });
    try {
        await converter.convertFromFile(program.inputFilepath, { type });
        await converter.toGeojsonFile(program.outputFilepath);
    } catch (e) {
        console.log(e.message);
    }
})();
