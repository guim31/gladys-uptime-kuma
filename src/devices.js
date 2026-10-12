// -----------------------------------------------------------------------------
// One Gladys device per Uptime Kuma monitor, proposed in the Discovery tab:
// the user adds the ones to follow, nothing is created on their behalf.
//
// Identity: the configuration slot of the instance (1 or 2) and the monitor
// id (Uptime Kuma 2.x), or a hash of its name on 1.x, whose /metrics carries
// no id. A device created under 1.x keeps its identity after the upgrade to
// 2.x (see the aliases of src/hub.js).
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - up: input/binary, 1 up, 0 down — the green "On" / red "Off" badge, a
//     Yes/No condition in scenes. Nothing is published while a monitor is
//     pending (a retry is under way) or in maintenance: the last value stays.
//   - response time: duration/integer in milliseconds, the last check.
//     Not on group and manual monitors, which measure nothing.
//   - days until the certificate expires: duration/integer in days, on the
//     monitors that check an HTTPS certificate (negative once expired).
//
// Published with should_poll: false: the integration reads Uptime Kuma on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { STATUS } from './kuma/metrics.js';

export const DEVICE_TYPE = 'monitor';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  UP: 'up',
  RESPONSE_TIME: 'response_time',
  CERT_DAYS: 'certificate_days',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.UP]: 'Up',
    [FEATURE_KEYS.RESPONSE_TIME]: 'Response time',
    [FEATURE_KEYS.CERT_DAYS]: 'Days until certificate expiry',
  },
  fr: {
    [FEATURE_KEYS.UP]: 'En service',
    [FEATURE_KEYS.RESPONSE_TIME]: 'Temps de réponse',
    [FEATURE_KEYS.CERT_DAYS]: 'Jours avant expiration du certificat',
  },
  de: {
    [FEATURE_KEYS.UP]: 'In Betrieb',
    [FEATURE_KEYS.RESPONSE_TIME]: 'Antwortzeit',
    [FEATURE_KEYS.CERT_DAYS]: 'Tage bis zum Zertifikatsablauf',
  },
  es: {
    [FEATURE_KEYS.UP]: 'En servicio',
    [FEATURE_KEYS.RESPONSE_TIME]: 'Tiempo de respuesta',
    [FEATURE_KEYS.CERT_DAYS]: 'Días hasta que caduque el certificado',
  },
};

// Display bounds (the core never applies them on write). Uptime Kuma times a
// check out after 48 s by default; the slowest answer it can report stays far
// below a minute.
export const MAX_RESPONSE_TIME_MS = 60_000;
export const CERT_DAYS_MIN = -365;
export const CERT_DAYS_MAX = 3650;

// Monitor types that measure no response time.
const NO_RESPONSE_TIME = new Set(['group', 'manual']);
// Monitor types that check the certificate of an https:// URL.
const HTTP_TYPES = new Set(['http', 'keyword', 'json-query', 'real-browser']);

export const MODEL = 'Uptime Kuma';
export const PARAMS = Object.freeze({ TYPE: 'MONITOR_TYPE', TARGET: 'MONITOR_TARGET' });

/** Platform id of a monitor: instance slot and monitor key. */
export const platformId = (slot, key) => `${slot}-${key}`;

/** External ids of a monitor's device and features. */
export const monitorIds = (gladys, slot, key) =>
  gladys.externalIds(DEVICE_TYPE, platformId(slot, key));

/**
 * The slot and key of a device external id, null when it is not one of ours.
 * @returns {{ slot: number, key: string }|null}
 */
export function parseDeviceId(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const match = externalId.slice(prefix.length).match(/^(\d+)-([a-z0-9]+)$/);
  return match ? { slot: Number(match[1]), key: match[2] } : null;
}

export const hasResponseTime = (monitor) => !NO_RESPONSE_TIME.has(monitor.type);
export const hasCertificate = (monitor) =>
  monitor.certDays !== null ||
  (HTTP_TYPES.has(monitor.type) && /^https:\/\//i.test(monitor.url ?? ''));

/**
 * The discovery payload of a monitor.
 * @param {object} gladys SDK client
 * @param {number} slot instance slot
 * @param {string} key device key of the monitor (src/hub.js resolves aliases)
 * @param {object} monitor see src/kuma/metrics.js
 * @param {string} language feature names language
 */
export function buildDevice(gladys, slot, key, monitor, language = 'en') {
  const ids = monitorIds(gladys, slot, key);
  const names = NAMES[language] ?? NAMES.en;
  const features = [
    {
      name: names[FEATURE_KEYS.UP],
      external_id: ids.feature(FEATURE_KEYS.UP),
      category: DEVICE_FEATURE_CATEGORIES.INPUT,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 1,
    },
  ];
  if (hasResponseTime(monitor)) {
    features.push({
      name: names[FEATURE_KEYS.RESPONSE_TIME],
      external_id: ids.feature(FEATURE_KEYS.RESPONSE_TIME),
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.MILLISECONDS,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: MAX_RESPONSE_TIME_MS,
    });
  }
  if (hasCertificate(monitor)) {
    features.push({
      name: names[FEATURE_KEYS.CERT_DAYS],
      external_id: ids.feature(FEATURE_KEYS.CERT_DAYS),
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.DAYS,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: CERT_DAYS_MIN,
      max: CERT_DAYS_MAX,
    });
  }
  const params = [{ name: PARAMS.TYPE, value: monitor.type }];
  if (monitor.target) {
    params.push({ name: PARAMS.TARGET, value: monitor.target.slice(0, 255) });
  }
  return {
    name: monitor.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features,
  };
}

/**
 * The value of every feature of a monitor (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|null }>}
 */
export function featureValues(gladys, slot, key, monitor) {
  const ids = monitorIds(gladys, slot, key);
  const values = [
    {
      key: FEATURE_KEYS.UP,
      value: monitor.status === STATUS.UP ? 1 : monitor.status === STATUS.DOWN ? 0 : null,
    },
  ];
  if (hasResponseTime(monitor)) {
    values.push({
      key: FEATURE_KEYS.RESPONSE_TIME,
      // A failed check measures nothing (-1 in /metrics): keep the last value.
      value: monitor.status === STATUS.UP ? monitor.responseTime : null,
    });
  }
  if (hasCertificate(monitor)) {
    values.push({ key: FEATURE_KEYS.CERT_DAYS, value: monitor.certDays });
  }
  return values.map((entry) => ({ ...entry, externalId: ids.feature(entry.key) }));
}
