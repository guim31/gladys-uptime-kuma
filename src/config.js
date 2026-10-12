// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to two Uptime Kuma instances (a typical setup: one at home, one on a
// rented server watching the home from outside), each in its own slot. The
// slot number is part of every device identity: changing the address of a
// slot (an IP for a name, HTTP for HTTPS) keeps the devices and their history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2];

// Refresh intervals offered in the configuration, in seconds. Uptime Kuma
// answers at most 60 API requests per minute, shared by every API client.
export const POLL_INTERVALS = ['15', '30', '60', '120', '300'];

// "Certificate expires soon": days left at which the scene trigger fires.
export const CERT_WARNING_DAYS = ['7', '14', '21', '30'];

export const DEFAULT_CONFIG = {
  instance_1_url: '',
  instance_1_api_key: '',
  instance_1_name: '',
  instance_2_url: '',
  instance_2_api_key: '',
  instance_2_name: '',
  allow_self_signed: false,
  poll_interval: '30',
  cert_warning_days: '14',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

// Pages of the Uptime Kuma interface: a URL copied from the browser points at
// one of them, the API lives at the root.
const INTERFACE_PATH =
  /\/(dashboard|settings|status|manage-status-page|add|list|maintenance|metrics|edit|clone)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:3001`), or the URL copied from the browser
 * (`https://kuma.example.com/dashboard/3`). HTTP by default. A path is kept
 * (Uptime Kuma behind a reverse proxy sub-path), the interface pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseInstanceUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const instances = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(`instance_${slot}_url`);
    if (!typed) {
      continue;
    }
    const url = parseInstanceUrl(typed);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    instances.push({
      slot,
      url,
      // A pasted key often carries a trailing space or new line.
      apiKey: text(`instance_${slot}_api_key`),
      name: text(`instance_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  return {
    instances,
    invalidSlots: invalid,
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    certWarningDays: Number(pick('cert_warning_days', CERT_WARNING_DAYS)),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
