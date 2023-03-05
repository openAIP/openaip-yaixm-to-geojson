const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "AN" airspace name definitions.
 */
class AnToken extends BaseLineToken {
    static type = 'AN';
    /**
     * Sets the order weight. The lower the number, the higher the token ranks when ordered.
     *
     * @type {number}
     */
    static orderWeight = 2;

    canHandle(line) {
        checkTypes.assert.string(line);

        // is AN line e.g. "AN ED-R10B Todendorf-Putlos MON-SAT+"
        return /^AN\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new AnToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, AL_TOKEN, AH_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = AnToken;
