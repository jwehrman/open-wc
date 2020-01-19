import { expect, html, fixture, defineCE, unsafeStatic } from '@open-wc/testing';
import { LitElement } from 'lit-element';
import { ReadOnlyPropertiesMixin } from '../src/read-only-properties-mixin.js';

describe('ReadOnlyPropertiesMixin', () => {
  let element;
  beforeEach(async () => {
    const tagName = defineCE(
      class extends ReadOnlyPropertiesMixin(LitElement) {
        static get properties() {
          return {
            publicString: { type: String },
            readOnlyString: { type: String, readOnly: true },
          };
        }

        constructor() {
          super();
          this.readOnlyString = 'readOnlyString';
        }
      },
    );
    const tag = unsafeStatic(tagName);
    element = await fixture(html`<${tag}></${tag}>`);
  });

  it('defines a read only property', async () => {
    const initial = element.readOnlyString;
    element.readOnlyString = Date.now().toString(36);
    expect(element.readOnlyString).to.equal(initial);
  });

  it('exposes `set()` to "privately" set properties', async () => {
    const privately = Date.now().toString(36);
    await element.set({ readOnlyString: privately });
    expect(element.readOnlyString).to.equal(privately);
  });
});
