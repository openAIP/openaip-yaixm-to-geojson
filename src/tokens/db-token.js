const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "DB" airspace arc endpoints definition.
 */
class DbToken extends BaseLineToken {
    static type = 'DB';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is DB line e.g. "DB 52:22:39 N 013:08:15 E , 52:24:33 N 013:11:02 E"
        return /^DB\s+.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new DbToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { BLANK_TOKEN, COMMENT_TOKEN, DP_TOKEN, VD_TOKEN, VX_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [BLANK_TOKEN, COMMENT_TOKEN, DP_TOKEN, VD_TOKEN, VX_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = DbToken;
