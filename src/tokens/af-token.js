const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "AF" unique airspace identifier string.
 */
class AfToken extends BaseLineToken {
    static type = 'AF';
    /**
     * Sets the order weight. The lower the number, the higher the token ranks when ordered.
     * @type {number}
     */
    static orderWeight = 4;

    canHandle(line) {
        checkTypes.assert.string(line);

        // is AF line e.g. "AF f012e054-e9a4-43dd-87be-eb88b3088439"
        return /^AF\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new AfToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        // no extended format option handling, AG token only in extended format
        const { COMMENT_TOKEN, AG_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, AG_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = AfToken;
