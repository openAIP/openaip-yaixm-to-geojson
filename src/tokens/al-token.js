const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "AL" airspace lower ceiling definitions.
 */
class AlToken extends BaseLineToken {
    static type = 'AL';
    /**
     * Sets the order weight. The lower the number, the higher the token ranks when ordered.
     *
     * @type {number}
     */
    static orderWeight = 7;

    canHandle(line) {
        checkTypes.assert.string(line);

        // is AL line e.g. "AL GND"
        return /^AL\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new AlToken({
            tokenTypes: this.tokenTypes,
        });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, AH_TOKEN, DP_TOKEN, VW_TOKEN, VX_TOKEN, SKIPPED_TOKEN, VD_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, AH_TOKEN, DP_TOKEN, VW_TOKEN, VX_TOKEN, SKIPPED_TOKEN, VD_TOKEN];
    }
}

module.exports = AlToken;
