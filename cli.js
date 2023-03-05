#!/usr/bin/env node

const { YaixmConverter } = require('./src/yaixm-converter');
const program = require('commander');

program
    .option('-f, --input-filepath <inFilepath>', 'The input file path to the YAIXM file')
    .option('-o, --output-filepath <outFilepath>', 'The output filename of the generated GeoJSON file')
    .option(
        '-T, --type',
        'The type to read from YAIXM file. Currently only "airspace" is supported. (default: "airspace")'
    )
    .parse(process.argv);

(async () => {
    const type = program.type || 'airspace';
    const converter = new YaixmConverter();
    try {
        await converter.convert({ inputFilepath: program.inputFilepath, outputFilepath: program.outputFilepath, type });
    } catch (e) {
        console.log(e.message);
    }
})();
