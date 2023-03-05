const checkTypes = require('check-types');

class TokenizerError extends Error {
    /**
     * @param {{lineNumber: number, errorMessage: string, [geometry]: Object}} config
     * @returns {void}
     * @private
     */
    constructor({ lineNumber, errorMessage, geometry }) {
        if (lineNumber != null) checkTypes.assert.integer(lineNumber);
        checkTypes.assert.nonEmptyString(errorMessage);

        if (lineNumber == null) {
            super(errorMessage);
        } else {
            super(`Error found at line ${lineNumber}: ${errorMessage}`);
        }

        this.lineNumber = lineNumber;
        this.errorMessage = errorMessage;
        this.geometry = geometry;
    }
}

module.exports = TokenizerError;
