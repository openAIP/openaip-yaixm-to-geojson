const FixFormat = require('../src/fix-format');
const fs = require('node:fs');

describe('test fixing blank lines in OpenAIR file', () => {
    test('fix blank lines in single airspace definition', async () => {
        const fixFormat = new FixFormat();
        const fixedOpenair = await fixFormat.fixFormat({
            inFile: './tests/fixtures/fix-blank-lines-single-airspace.txt',
        });

        // read from expected file and remove last "blank line" in file (automatically added by IDE)
        const expected = await fs
            .readFileSync('./tests/fixtures/expected-fix-blank-lines-single-airspace.txt', 'utf-8')
            .split('\n');

        // make sure to also take "last blank line added by IDE" into account
        expect(removeBlanksAtEof(fixedOpenair).join('\n')).toEqual(removeBlanksAtEof(expected).join('\n'));
    });
    test('fix blank lines in multiple airspace definitions', async () => {
        const fixFormat = new FixFormat();
        const fixedOpenair = await fixFormat.fixFormat({
            inFile: './tests/fixtures/fix-blank-lines-multiple-airspaces.txt',
        });

        const expected = await fs
            .readFileSync('./tests/fixtures/expected-fix-blank-lines-multiple-airspaces.txt', 'utf-8')
            .split('\n');

        // make sure to also take "last blank line added by IDE" into account
        expect(removeBlanksAtEof(fixedOpenair).join('\n')).toEqual(removeBlanksAtEof(expected).join('\n'));
    });
});

describe('test fixing start/end DP definitions in OpenAIR airspace definition blocks', () => {
    test('fix start/end DP definitions in single OpenAIR airspace definition block', async () => {
        const fixFormat = new FixFormat();
        const fixedOpenair = await fixFormat.fixFormat({
            inFile: './tests/fixtures/fix-start-end-single-airspace.txt',
        });

        // read from expected file and remove last "blank line" in file (automatically added by IDE)
        const expected = await fs
            .readFileSync('./tests/fixtures/expected-fix-start-end-single-airspace.txt', 'utf-8')
            .split('\n');

        // make sure to also take "last blank line added by IDE" into account
        expect(removeBlanksAtEof(fixedOpenair).join('\n')).toEqual(removeBlanksAtEof(expected).join('\n'));
    });
    test('fix start/end DP definitions in multiple OpenAIR airspace definition blocks', async () => {
        const fixFormat = new FixFormat();
        const fixedOpenair = await fixFormat.fixFormat({
            inFile: './tests/fixtures/fix-start-end-multiple-airspaces.txt',
        });

        const expected = await fs
            .readFileSync('./tests/fixtures/expected-fix-start-end-multiple-airspaces.txt', 'utf-8')
            .split('\n');

        // make sure to also take "last blank line added by IDE" into account
        expect(removeBlanksAtEof(fixedOpenair).join('\n')).toEqual(removeBlanksAtEof(expected).join('\n'));
    });
});

describe('test extended format fixing', () => {
    test('re-arrange extended tokens', async () => {
        const fixFormat = new FixFormat({ extendFormat: true, fixTokenOrder: true });
        const fixedOpenair = await fixFormat.fixFormat({
            inFile: './tests/fixtures/fix-extended-format-tags.txt',
        });

        // read from expected file and remove last "blank line" in file (automatically added by IDE)
        const expected = await fs
            .readFileSync('./tests/fixtures/expected-fix-extended-format-tags.txt', 'utf-8')
            .split('\n');

        // make sure to also take "last blank line added by IDE" into account
        expect(removeBlanksAtEof(fixedOpenair).join('\n')).toEqual(removeBlanksAtEof(expected).join('\n'));
    });
});

/**
 * Takes a list of string and removes all blank lines at the end of the list.
 *
 * @param {string[]} lines
 * @return {string[]}
 */
function removeBlanksAtEof(lines) {
    let lastLine = lines[lines.length - 1];
    if (lastLine.trim() === '') {
        lines.pop();
        lastLine = lines[lines.length - 1];
    }

    return lines;
}
