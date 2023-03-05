const CommentToken = require('./tokens/comment-token');
const SkippedToken = require('./tokens/skipped-token');
const BlankToken = require('./tokens/blank-token');
const AcToken = require('./tokens/ac-token');
const AnToken = require('./tokens/an-token');
const AhToken = require('./tokens/ah-token');
const AlToken = require('./tokens/al-token');
const DpToken = require('./tokens/dp-token');
const VdToken = require('./tokens/vd-token');
const VxToken = require('./tokens/vx-token');
const VwToken = require('./tokens/vw-token');
const DcToken = require('./tokens/dc-token');
const DbToken = require('./tokens/db-token');
const DaToken = require('./tokens/da-token');
const DyToken = require('./tokens/dy-token');
const EofToken = require('./tokens/eof-token');
const AiToken = require('./tokens/ai-token');
const AyToken = require('./tokens/ay-token');
const AfToken = require('./tokens/af-token');
const AgToken = require('./tokens/ag-token');
const LineByLine = require('n-readlines');
const fs = require('node:fs');
const TokenizerError = require('./exceptions/tokenizer-error');

/**
 * List of token types required for "isAllowedNextToken" type checks. Mainly to avoid directly requiring tokens in a token
 * and creating circular dependencies.
 *
 * @typedef TokenTypes
 * @type {Object}
 * @property {string} COMMENT_TOKEN
 * @property {string} BLANK_TOKEN
 * @property {string} AC_TOKEN
 * @property {string} AN_TOKEN
 * @property {string} AH_TOKEN
 * @property {string} AL_TOKEN
 * @property {string} DP_TOKEN
 * @property {string} VD_TOKEN
 * @property {string} VX_TOKEN
 * @property {string} DC_TOKEN
 * @property {string} DB_TOKEN
 * @property {string} DA_TOKEN
 * @property {string} EOF_TOKEN
 * @property {string} SKIPPED_TOKEN
 * @property {string} AI_TOKEN
 * @property {string} AY_TOKEN
 * @property {string} AF_TOKEN
 * @property {string} AG_TOKEN
 */
const TOKEN_TYPES = {
    COMMENT_TOKEN: CommentToken.type,
    BLANK_TOKEN: BlankToken.type,
    AC_TOKEN: AcToken.type,
    AN_TOKEN: AnToken.type,
    AH_TOKEN: AhToken.type,
    AL_TOKEN: AlToken.type,
    DP_TOKEN: DpToken.type,
    VD_TOKEN: VdToken.type,
    VX_TOKEN: VxToken.type,
    VW_TOKEN: VwToken.type,
    DC_TOKEN: DcToken.type,
    DB_TOKEN: DbToken.type,
    DA_TOKEN: DaToken.type,
    DY_TOKEN: DyToken.type,
    EOF_TOKEN: EofToken.type,
    SKIPPED_TOKEN: SkippedToken.type,
    // extended format tokens
    AI_TOKEN: AiToken.type,
    AY_TOKEN: AyToken.type,
    AF_TOKEN: AfToken.type,
    AG_TOKEN: AgToken.type,
};

/**
 * @typedef Token
 * @type Object
 * @property {function} isIgnoredToken
 * @property {function} tokenize
 * @property {function} getTokenized
 * @property {function} getType
 * @property {function} canHandle
 * @property {function} isAllowedNextToken
 */

/**
 * Reads the contents of a give file and tokenizes it. Each line will result in a single token.
 * Each token holds a tokenized representation of the read line. The tokenizer will return a list of all read
 * and created tokens. The tokenizer will throw a syntax error on the first error that is encountered.
 *
 * Both the standard and extended OpenAIR format is supported.
 */
class Tokenizer {
    /**
     * @param {Object} [config]
     * @param {Object} [config.extendFormat] - If true, an additional "AI" token with a unique identifier is injected into each airspace block so that the file is compatible with the extended OpenAIR format. Defaults to "false".
     */
    constructor(config) {
        const defaultConfig = { extendFormat: false };

        const { extendFormat } = Object.assign(defaultConfig, config);

        /** @type {Token[]} */
        this.tokenizers = [
            new CommentToken({ tokenTypes: TOKEN_TYPES }),
            new SkippedToken({ tokenTypes: TOKEN_TYPES }),
            new BlankToken({ tokenTypes: TOKEN_TYPES }),
            new AcToken({ tokenTypes: TOKEN_TYPES }),
            new AnToken({ tokenTypes: TOKEN_TYPES }),
            new AhToken({ tokenTypes: TOKEN_TYPES }),
            new AlToken({ tokenTypes: TOKEN_TYPES }),
            new DpToken({ tokenTypes: TOKEN_TYPES }),
            new VdToken({ tokenTypes: TOKEN_TYPES }),
            new VxToken({ tokenTypes: TOKEN_TYPES }),
            new VwToken({ tokenTypes: TOKEN_TYPES }),
            new DcToken({ tokenTypes: TOKEN_TYPES }),
            new DbToken({ tokenTypes: TOKEN_TYPES }),
            new DaToken({ tokenTypes: TOKEN_TYPES }),
            new DyToken({ tokenTypes: TOKEN_TYPES }),
            new AiToken({ tokenTypes: TOKEN_TYPES }),
            new AyToken({ tokenTypes: TOKEN_TYPES }),
            new AfToken({ tokenTypes: TOKEN_TYPES }),
            new AgToken({ tokenTypes: TOKEN_TYPES }),
        ];

        this.extendFormat = extendFormat;
        /** @type {Token[]} */
        this.tokens = [];
        // previous processed token, used to validate correct token order
        /** @type {Token} */
        this.prevToken = null;
        this.currentLineString = null;
        this.currentLineNumber = 0;
    }

    /**
     * Tokenizes the openAIR file at given path and returns the list of created tokens.
     *
     * @param filepath
     * @return {Token[]}
     */
    tokenize(filepath) {
        this.reset();

        const liner = new LineByLine(filepath);
        let line;

        while ((line = liner.next())) {
            this.currentLineNumber++;
            // call trim to also remove newlines
            this.currentLineString = line.toString().trim();

            // find the tokenizer that can handle the current line
            const lineTokenizer = this.tokenizers.find((value) => value.canHandle(this.currentLineString));
            if (lineTokenizer == null) {
                // fail hard if unable to find a tokenizer for a specific line
                throw new TokenizerError({
                    lineNumber: this.currentLineNumber,
                    errorMessage: `Failed to read line ${this.currentLineNumber}. Unknown syntax.`,
                });
            }

            let token;
            try {
                token = lineTokenizer.tokenize(this.currentLineString, this.currentLineNumber);
            } catch (e) {
                throw new TokenizerError({
                    lineNumber: this.currentLineNumber,
                    errorMessage: e.message,
                });
            }
            this.tokens.push(token);
        }
        // finalize by adding EOF token
        this.tokens.push(new EofToken({ tokenTypes: TOKEN_TYPES, lastLineNumber: this.currentLineNumber }));

        return this.tokens;
    }

    /**
     * Enforces that the file at given filepath exists.
     *
     * @param {string} filepath
     * @return {Promise<void>}
     * @private
     */
    async enforceFileExists(filepath) {
        const exists = await fs.existsSync(filepath);
        if (!exists) {
            throw new Error(`Failed to read file ${filepath}`);
        }
    }

    /**
     * Resets the state.
     *
     * @returns {void}
     */
    reset() {
        this.tokens = [];
        this.prevToken = null;
        this.currentLine = null;
        this.currentLineNumber = 0;
    }
}

module.exports = Tokenizer;
