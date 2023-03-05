const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "DA" airspace arc definition token.
 */
class DaToken extends BaseLineToken {
    static type = 'DA';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is DA line e.g. "DA 0.25,-57,123" as well as "DA 0.25,57.56,270.5"
        return /^DA\s+([+-]?\d*(\.\d+)?),\s*([+-]?\d*(\.\d+)?),\s*([+-]?\d*(\.\d+)?)$/.test(line);
    }

    tokenize(line, lineNumber) {
        const token = new DaToken({ tokenTypes: this.tokenTypes });

        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { BLANK_TOKEN, COMMENT_TOKEN, DP_TOKEN, VD_TOKEN, VX_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [BLANK_TOKEN, COMMENT_TOKEN, DP_TOKEN, VD_TOKEN, VX_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = DaToken;
