const BaseLineToken = require('./base-line-token');
const checkTypes = require('check-types');

/**
 * Handles the D token which is part of an arc definition and declares turn-direction, e.g. clockwise or counter-clockwise.
 * Since the the DB token will get the center point AND start and end coordinates, this token can be omitted.
 */
class VdToken extends BaseLineToken {
    static type = 'VD';

    canHandle(line) {
        checkTypes.assert.string(line);

        // is VD line e.g. "V D=-"
        return /^V\s+D=[+-]$/.test(line);
    }

    tokenize(line, lineNumber) {
        checkTypes.assert.string(line);
        checkTypes.assert.integer(lineNumber);

        const token = new VdToken({ tokenTypes: this.tokenTypes });
        token.tokenized = { line, lineNumber, metadata: { line } };

        return token;
    }

    getAllowedNextTokens() {
        const { COMMENT_TOKEN, VX_TOKEN, DB_TOKEN, SKIPPED_TOKEN } = this.tokenTypes;

        return [COMMENT_TOKEN, VX_TOKEN, DB_TOKEN, SKIPPED_TOKEN];
    }
}

module.exports = VdToken;
