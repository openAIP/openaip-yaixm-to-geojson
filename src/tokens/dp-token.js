const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "DP" airspace polygon coordinate definition.
 */
class DpToken extends BaseLineToken {
    static type = 'DP';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is DP line e.g. "DP 54:25:00 N 010:40:00 E"
        return /^DP\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new DpToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, DP_TOKEN, BLANK_TOKEN, EOF_TOKEN, VD_TOKEN, VX_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, DP_TOKEN, BLANK_TOKEN, EOF_TOKEN, VD_TOKEN, VX_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = DpToken;
