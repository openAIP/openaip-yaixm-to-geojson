const checkTypes = require('check-types');

/**
 * @typedef TokenConfig
 * @type Object
 * @property {TokenTypes} tokenTypes - List of all known token types. Required to do "isAllowedNextToken" type checks.
 */

class BaseLineToken {
    /**
     * @param {TokenConfig} config
     */
    constructor(config) {
        const { tokenTypes } = config;

        checkTypes.assert.nonEmptyObject(tokenTypes);

        this.tokenTypes = tokenTypes;
        this.tokenized = null;
    }

    static type = '';
    /**
     * Sets the order weight. The lower the number, the higher the token ranks when ordered.
     *
     * @type {number}
     */
    static orderWeight = 0;

    /**
     * @return {string}
     */
    getType() {
        return this.constructor.type;
    }

    /**
     * @return {number}
     */
    getOrderWeight() {
        return this.constructor.orderWeight;
    }

    /**
     * Most tokens are considered to be not ignored tokens. Blank, comment and other
     * specific tokens that are not handled are considered to be "ignored" tokens.
     *
     * @return {boolean}
     */
    isIgnoredToken() {
        return false;
    }

    /**
     * Returns true if the token can handle the string. False if not.
     *
     * @param {string} line
     * @return {boolean}
     */
    canHandle(line) {
        throw new Error('NOT_IMPLEMENTED');
    }

    /**
     * Factory methods that returns a new token of the corresponding type that contains the tokenized
     * representation of the parsed OpenAIR line.
     *
     * @param {string} line
     * @param {number} lineNumber
     * @return {BaseLineToken}
     */
    tokenize(line, lineNumber) {
        throw new Error('NOT_IMPLEMENTED');
    }

    /**
     * Returns the tokenized line.
     *
     * @return {{line: string, lineNumber: number, [metadata]: Object}}
     */
    getTokenized() {
        return this.tokenized;
    }

    /**
     * @param {Token[]} token
     * @returns {boolean}
     */
    isAllowedNextToken(token) {
        return this.getAllowedNextTokens().includes(token.constructor.type);
    }

    /**
     * @return {string[]}
     */
    getAllowedNextTokens() {
        return [];
    }
}

module.exports = BaseLineToken;
