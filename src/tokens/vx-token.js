const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "V X=" airspace circle center coordinate definition.
 */
class VxToken extends BaseLineToken {
    static type = 'VX';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is V line e.g. "V X=53:24:25 N 010:25:10 E"
        return /^V\s+X=.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new VxToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, DC_TOKEN, DB_TOKEN, DA_TOKEN, VD_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, DC_TOKEN, DB_TOKEN, DA_TOKEN, VD_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = VxToken;
