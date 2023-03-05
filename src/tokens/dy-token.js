const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "DY" airway segment coordinate definition.
 */
class DyToken extends BaseLineToken {
    static type = 'DY';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is DP line e.g. "DY 54:25:00 N 010:40:00 E"
        return /^DY\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new DyToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, DY_TOKEN, BLANK_TOKEN, EOF_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, DY_TOKEN, BLANK_TOKEN, EOF_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = DyToken;
