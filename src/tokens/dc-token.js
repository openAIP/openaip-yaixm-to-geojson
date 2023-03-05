const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "DC" airspace circle radius definition.
 */
class DcToken extends BaseLineToken {
    static type = 'DC';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is DC line e.g. "DC 1.10"
        return /^DC\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new DcToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { BLANK_TOKEN, COMMENT_TOKEN, EOF_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [BLANK_TOKEN, COMMENT_TOKEN, EOF_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = DcToken;
