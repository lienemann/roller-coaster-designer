// SPDX-License-Identifier: AGPL-3.0-only

// Core never throws raw strings. Every error it emits is a WebFvdError whose
// `code` is a translation key the app layer looks up in the errors namespace
// (spec §12.3). `context` carries structured data the translation template
// interpolates ({{got}}, {{path}}, …).
//
// Keeping errors structured means the core package stays locale-agnostic —
// translation is an app-layer concern and a Node consumer of the core package
// can decide its own formatting.

export type WebFvdErrorContext = Readonly<Record<string, string | number | boolean>>;

export class WebFvdError extends Error {
  public readonly code: string;
  public readonly context: WebFvdErrorContext;

  constructor(code: string, context: WebFvdErrorContext = {}, message?: string) {
    super(message ?? code);
    this.name = 'WebFvdError';
    this.code = code;
    this.context = context;
    // Keep the prototype chain correct across TS downlevelling.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Catalogue of error codes the core emits. Kept in a const object so the app
// can import it and assert coverage of the errors namespace at test time
// (every code must have an EN and DE translation). Add new codes here first,
// then add translations alongside — never in the other order.
export const WEBFVD_ERROR_CODES = {
  schema: {
    invalid: 'schema.invalid',
    versionUnsupported: 'schema.versionUnsupported',
  },
  io: {
    fileRejected: 'io.fileRejected',
    saveCancelled: 'io.saveCancelled',
    fvdMalformed: 'io.fvdMalformed',
  },
} as const;
