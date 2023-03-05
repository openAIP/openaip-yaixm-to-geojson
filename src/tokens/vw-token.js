const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Tokenizes "V W=" airway width in nautical miles.
 */
class VwToken extends BaseLineToken {
    static type = 'VW';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is W line e.g. "V W=2.5"
        return /^V\s+W=.*$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new VwToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, DY_TOKEN, BLANK_TOKEN, EOF_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, DY_TOKEN, BLANK_TOKEN, EOF_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = VwToken;
