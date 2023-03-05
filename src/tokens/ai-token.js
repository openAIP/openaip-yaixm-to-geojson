const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "AI" unique airspace identifier string.
 */
class AiToken extends BaseLineToken {
    static type = 'AI';
    /**
     * Sets the order weight. The lower the number, the higher the token ranks when ordered.
     *
     * @type {number}
     */
    static orderWeight = 3;

    canHandle(line) {
        checkTypes.assert.string(line);

        // is AI line e.g. "AI f012e054-e9a4-43dd-87be-eb88b3088439"
        return /^AI\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new AiToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, AN_TOKEN, AY_TOKEN, AF_TOKEN, AG_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN } =
            this.tokenTypes;

        return [COMMENT_TOKEN, AN_TOKEN, AY_TOKEN, AF_TOKEN, AG_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = AiToken;
