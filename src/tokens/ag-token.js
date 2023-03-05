const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "AG" ground station call-sign for given AF frequency.
 */
class AgToken extends BaseLineToken {
    static type = 'AG';
    /**
     * Sets the order weight. The lower the number, the higher the token ranks when ordered.
     *
     * @type {number}
     */
    static orderWeight = 5;

    canHandle(line) {
        checkTypes.assert.string(line);

        // is AG line e.g. "AG f012e054-e9a4-43dd-87be-eb88b3088439"
        return /^AG\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new AgToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        // no extended format option handling, AG token only in extended format
        const { COMMENT_TOKEN, AF_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, AF_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = AgToken;
