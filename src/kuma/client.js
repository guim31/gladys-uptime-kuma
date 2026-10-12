// -----------------------------------------------------------------------------
// Uptime Kuma client: one GET of `/metrics`, the stable, documented read API
// of Uptime Kuma 1.x and 2.x (the one Home Assistant uses through pythonkuma).
//
// Authentication (server/auth.js `apiAuth`): HTTP Basic, empty user name, an
// API key as password (Settings → API Keys). Once a key exists, the user
// password no longer opens /metrics; with "Disable authentication" ticked in
// Uptime Kuma, no key is needed. The API answers at most 60 requests per
// minute, shared by every API client, and a request beyond that is refused
// with the same 401 as a wrong key.
//
// Read only, on purpose: pausing or resuming a monitor goes through the
// Socket.IO API of the web interface, which needs the administrator's user
// name and password (and the 2FA code) — not something to store in Gladys.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { parseMetrics } from './metrics.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // API key refused (or the 60 requests per minute exceeded)
  KEY_MISSING: 'key_missing', // Uptime Kuma asks for a key and none is configured
  NOT_KUMA: 'not_kuma', // something answers, not an Uptime Kuma
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class KumaError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, location }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'KumaError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export class KumaClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.apiKey] API key, '' for none
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, apiKey = '', insecure = false, request = httpRequest, timeoutMs = 10_000 }) {
    this.url = url;
    this.apiKey = apiKey;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Read the monitors.
   * @returns {Promise<{ version: string|null, major: number|null, monitors: object[] }>}
   * @throws {KumaError}
   */
  async metrics() {
    const headers = { accept: 'text/plain' };
    if (this.apiKey) {
      headers.authorization = `Basic ${Buffer.from(`:${this.apiKey}`).toString('base64')}`;
    }
    let response;
    try {
      response = await this.request(`${this.url}/metrics`, {
        headers,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new KumaError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      throw new KumaError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }

    const { status } = response;
    if (status === 401 || status === 403) {
      throw this.apiKey
        ? new KumaError(ERROR_KINDS.AUTH, `API key refused (HTTP ${status})`, { status })
        : new KumaError(ERROR_KINDS.KEY_MISSING, `An API key is needed (HTTP ${status})`, {
            status,
          });
    }
    if (status >= 300 && status < 400) {
      throw new KumaError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, {
        status,
        location: response.headers?.location,
      });
    }
    if (status === 404) {
      throw new KumaError(ERROR_KINDS.NOT_KUMA, 'No /metrics at this address (HTTP 404)', {
        status,
      });
    }
    if (status !== 200) {
      throw new KumaError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    const parsed = parseMetrics(response.body);
    if (!parsed.isKuma) {
      // An HTML page: another service, or Uptime Kuma 2 still waiting for its
      // database setup.
      throw new KumaError(ERROR_KINDS.NOT_KUMA, 'The answer is not Uptime Kuma metrics');
    }
    return { version: parsed.version, major: parsed.major, monitors: parsed.monitors };
  }
}
