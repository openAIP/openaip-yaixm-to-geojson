const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "AY" airspace type definitions.
 */
class AyToken extends BaseLineToken {
    static type = 'AY';
    /**
     * Sets the order weight. The lower the number, the higher the token ranks when ordered.
     *
     * @type {number}
     */
    static orderWeight = 1;

    canHandle(line) {
        checkTypes.assert.string(line);

        // is AI line e.g. "AI f012e054-e9a4-43dd-87be-eb88b3088439"
        return /^AY\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new AyToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        // no extended format option handling, AY token only in extended format
        const { COMMENT_TOKEN, AI_TOKEN, AN_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, AI_TOKEN, AN_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = AyToken;
