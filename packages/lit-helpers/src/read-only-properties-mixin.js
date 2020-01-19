/**
 * @param {any} baseElement
 */
export const ReadOnlyPropertiesMixin = baseElement => {
  /**
   * @type {Map<string, symbol>}
   * @private
   */
  const _readOnlyPropertyNamesMap = new Map();

  return class extends baseElement {
    /**
     * @inheritdoc
     * @param  {string} name    [description]
     * @param  {import('lit-element').PropertyDeclaration & { readOnly: Boolean }} options augmented property declaration with optional `readOnly` boolean.
     */
    static createProperty(name, options) {
      let finalOptions = options;

      if (options.readOnly) {
        const privateName = Symbol(name);

        _readOnlyPropertyNamesMap.set(name, privateName);

        Object.defineProperty(this.prototype, name, {
          get() {
            return this[privateName];
          },

          set(value) {
            // allow for class field initialization
            if (this._readOnlyPropertyInitializedMap.get(name)) return;
            this[privateName] = value;
            this._readOnlyPropertyInitializedMap.set(name, true);
          },
        });

        finalOptions = { ...options, noAccessor: true };
      }

      super.createProperty(name, finalOptions);
    }

    /**
     * @type {Map<string, boolean>}
     * @private
     */
    _readOnlyPropertyInitializedMap = new Map();

    constructor() {
      super();
      this.setPropEntry = this.setPropEntry.bind(this);
    }

    /**
     * Set read-only properties
     * @param  {Object<string, unknown>}  props
     * @return {Promise<this>}
     * @private
     */
    async set(props) {
      await Promise.all(Object.entries(props).map(this.setPropEntry));
      return this;
    }

    /**
     * @param {[string, unknown]} entry
     * @return {Promise<unknown>}
     * @private
     */
    setPropEntry([name, newVal]) {
      // typescript... https://github.com/microsoft/TypeScript/issues/1863
      /** @type {any} */
      const privateName = _readOnlyPropertyNamesMap.get(name);
      const oldVal = this[privateName];
      this[privateName] = newVal;
      return this.requestUpdate(name, oldVal);
    }
  };
};
