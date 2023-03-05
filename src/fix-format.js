const fs = require('node:fs');
const checkTypes = require('check-types');
const Tokenizer = require('./tokenizer');
const AnToken = require('./tokens/an-token');
const AcToken = require('./tokens/ac-token');
const AiToken = require('./tokens/ai-token');
const DaToken = require('./tokens/da-token');
const DcToken = require('./tokens/dc-token');
const DpToken = require('./tokens/dp-token');
const DyToken = require('./tokens/dy-token');
const VdToken = require('./tokens/vd-token');
const VwToken = require('./tokens/vw-token');
const VxToken = require('./tokens/vx-token');
const BlankToken = require('./tokens/blank-token');
const CommentToken = require('./tokens/comment-token');
const SkippedToken = require('./tokens/skipped-token');
const EofToken = require('./tokens/eof-token');
const { randomUUID } = require('node:crypto');

/**
 * Reads OpenAIR file from given input filepath and fixes formatting. The fixed OpenAIR string is written to
 * the configured output filepath. Both the standard and extended OpenAIR format is supported.
 */
class FixFormat {
    /**
     * @param {Object} [config]
     * @param {Object} [config.extendFormat] - If true, an additional "AI" token with a unique identifier is injected into each airspace block so that the file is compatible with the extended OpenAIR format. Defaults to "false".
     * @param {Object} [config.fixTokenOrder] - If true, will re-order found tokens and put them into the expected order. Note that this will remove all inline comments from the airspace definition blocks! Defaults to "false".
     */
    constructor(config) {
        const defaultOptions = { extendFormat: false, fixTokenOrder: false };
        const { extendFormat, fixTokenOrder } = Object.assign(defaultOptions, config);

        checkTypes.assert.boolean(extendFormat);
        checkTypes.assert.boolean(fixTokenOrder);

        this.extendFormat = extendFormat;
        this.fixTokenOrder = fixTokenOrder;
    }

    /**
     * @param {{inFile: string, outFile: string}} config
     * @return {void}
     */
    async fix({ inFile, outFile }) {
        checkTypes.assert.nonEmptyString(inFile);
        checkTypes.assert.nonEmptyString(outFile);

        try {
            console.log(`Read OpenAIR file '${inFile}'`);

            await this.enforceFileExists(inFile);
            // read OpenAIR string from specified file and fix format
            const fixedOpenair = await this.fixFormat({ inFile });
            // write fixed OpenAIR string to specified file
            await fs.writeFileSync(outFile, fixedOpenair.join('\n'));

            console.log(`Successfully fixed OpenAIR from file '${inFile}'. Fixed file: '${outFile}'`);
        } catch (e) {
            console.log(`Failed to fix OpenAIR: ${e.message}`);
        }
    }

    /**
     * Reads the contents of the given file and fixes the format. Returns a list of fixed lines.
     *
     * @param {string} inFile
     * @return {Promise<string[]>}
     */
    async fixFormat({ inFile }) {
        checkTypes.assert.nonEmptyString(inFile);

        const formatted = [];
        const blockTokens = [];
        let readBlock = false;

        const tokenizer = new Tokenizer({ extendFormat: this.extendFormat });
        const tokens = tokenizer.tokenize(inFile);

        for (let idx = 0; idx < tokens.length; idx++) {
            const token = tokens[idx];
            const nextToken = tokens[idx + 1];
            const nextBlockToken = this.getNextBlockToken(tokens, idx);

            // end of file
            if (token.getType() === EofToken.type) {
                break;
            }

            // remove subsequent blank lines, only keep a single blank line
            if (token.getType() === BlankToken.type && nextToken.getType() === BlankToken.type) {
                continue;
            }

            if (readBlock) {
                if (this.isBlockToken(tokens, idx)) {
                    // If tokens should be re-ordered, inline comments are removed. Keeping
                    // comments and ordering them with the specific token is currently not supported.
                    if (this.fixTokenOrder && token.getType() === CommentToken.type) {
                        continue;
                    }
                    blockTokens.push(token);
                }
                // format block and add to formatted list
                else if (
                    nextBlockToken.getType() === AcToken.type ||
                    nextToken.getType() === EofToken.type ||
                    nextBlockToken.getType() === EofToken.type
                ) {
                    readBlock = false;
                    blockTokens.push(token);
                    formatted.push(...this.fixBlock(blockTokens));
                    // if next token is not a blank token, add one
                    if (nextToken.getType() !== BlankToken.type) {
                        formatted.push('');
                    }
                    blockTokens.length = 0;
                } else {
                    throw new Error('Unhandled state.');
                }
            } else {
                // read "in-between-blocks" comments and blanks
                if (
                    token.getType() === BlankToken.type ||
                    token.getType() === CommentToken.type ||
                    token.getType() === SkippedToken.type
                ) {
                    // add non aspc block tokens directly to formatted list
                    formatted.push(token.getTokenized().line);
                }
                // start reading new airspace definition block
                else if (token.getType() === AcToken.type) {
                    readBlock = true;
                    blockTokens.push(token);
                } else {
                    throw new Error('Unhandled state.');
                }
            }
        }

        return formatted;
    }

    /**
     * Check that token at the given idx is inside an airspace definition block.
     *
     * @param {Object[]} tokens
     * @param {number} idx
     * @return {boolean}
     * @private
     */
    isBlockToken(tokens, idx) {
        const nextBlockToken = this.getNextBlockToken(tokens, idx);

        // if next block token is NOT an AC token, the token is considered to be inside an airspace definition block
        return nextBlockToken.getType() !== AcToken.type && nextBlockToken.getType() !== EofToken.type;
    }

    /**
     * Returns the next block token, i.e. token that is NOT a skipped, blank or comment token.
     *
     * @param {Object[]} tokens
     * @param {number} idx
     * @private
     */
    getNextBlockToken(tokens, idx) {
        let next = idx + 1;

        while (next < tokens.length) {
            const token = tokens[next];
            if (
                token.getType() !== BlankToken.type &&
                token.getType() !== CommentToken.type &&
                token.getType() !== SkippedToken.type
            ) {
                return token;
            }
            next++;
        }
    }

    /**
     * Takes a list of tokens that form an airspace definition block and fixes it.
     *
     * @param {Object[]} blockTokens
     * @return {string[]}
     * @private
     */
    fixBlock(blockTokens) {
        const metaTokens = [];
        const geomTokens = [];
        let readingMeta = true;

        let firstDp = null;
        for (let idx = 0; idx < blockTokens.length; idx++) {
            const token = blockTokens[idx];

            // remove blank lines from airspace definition block
            if (token.getType() === BlankToken.type) {
                continue;
            }

            // read the "meta" part above the geometry definition
            if (readingMeta && this.isGeometryToken(token)) {
                readingMeta = false;
            }
            if (readingMeta) {
                metaTokens.push(token);
            } else {
                geomTokens.push(token);
            }

            // make sure that the start DP matches the last DP in block's geometry definition
            if (token.getType() === DpToken.type) {
                if (firstDp) {
                    if (idx === blockTokens.length - 1 && firstDp.getTokenized().line !== token.getTokenized().line) {
                        geomTokens.push(firstDp);
                    }
                } else {
                    firstDp = token;
                }
            }
        }

        // re-order "meta"-tokens
        metaTokens.sort((a, b) => {
            const aWeight = a.getOrderWeight();
            const bWeight = b.getOrderWeight();

            if (aWeight > bWeight) return 1;
            if (aWeight < bWeight) return -1;

            return 0;
        });

        // inject an AI token if not present
        const hasAiToken = metaTokens.find((value) => value.getType() === AiToken.type) != null;
        const fixedTokens = metaTokens.concat(geomTokens);
        const fixedBlockLines = [];
        for (const token of fixedTokens) {
            // add the AI token if specified to "extended" format and if there is no AI token yet
            if (this.extendFormat && token.getType() === AnToken.type && hasAiToken === false) {
                // generate AI tage with random UUID v4
                fixedBlockLines.push(`AI ${randomUUID()}`);
            }
            fixedBlockLines.push(token.getTokenized().line);
        }

        return fixedBlockLines;
    }

    /**
     * Checks if input token is part of a geometry definition.
     *
     * @param token
     * @return {boolean}
     */
    isGeometryToken(token) {
        const tokenType = token.getType();

        return [
            DaToken.type,
            DcToken.type,
            DpToken.type,
            DyToken.type,
            VdToken.type,
            VwToken.type,
            VxToken.type,
        ].includes(tokenType);
    }

    /**
     * Enforce file exists.
     *
     * @param filepath
     *
     * @return {Promise<void>}
     * @private
     */
    async enforceFileExists(filepath) {
        if ((await fs.existsSync(filepath)) === false) {
            throw new Error(`Specified file '${filepath}' does not exist.`);
        }
    }
}

module.exports = FixFormat;
