'use strict';

/** Error with a contract code (NEEDS_ADMIN, UNSUPPORTED, NOT_FOUND, FAILED, …) and a Russian message. */
class HostError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    if (detail) this.detail = String(detail).slice(0, 2000);
  }
}

const UNSUPPORTED_MSG = 'Доступно только в Windows';

function unsupported(msg) { return new HostError('UNSUPPORTED', msg || UNSUPPORTED_MSG); }

module.exports = { HostError, unsupported, UNSUPPORTED_MSG };
