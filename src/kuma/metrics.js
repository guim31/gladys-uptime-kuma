// -----------------------------------------------------------------------------
// Uptime Kuma `/metrics`: the Prometheus text exposition format, and the
// monitors read from it.
//
// What Uptime Kuma publishes there (server/prometheus.js, checked on 1.23.17
// and 2.5.6), one series per monitor and metric:
//   monitor_status            1 up, 0 down, 2 pending, 3 maintenance
//   monitor_response_time     last check, in ms; -1 when the check measured none
//   monitor_cert_days_remaining / monitor_cert_is_valid   HTTPS monitors only
//   monitor_uptime_ratio, monitor_response_time_seconds   2.x only, per window
// labelled monitor_name, monitor_type, monitor_url, monitor_hostname and
// monitor_port; 2.x adds monitor_id and one label per tag (known at start).
// Empty fields are written as the string "null", and non-HTTP monitors carry
// the URL field's default, "https://". A paused monitor has no series at all.
// `app_version{version,major,minor,patch}` names the Uptime Kuma release.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const STATUS = Object.freeze({ DOWN: 0, UP: 1, PENDING: 2, MAINTENANCE: 3 });

const METRIC_LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{)?/;

/**
 * Parse the label set of a sample, from just after `{`.
 * @returns {{ labels: Record<string,string>, end: number }} `end` = index after `}`
 */
function parseLabels(line, start) {
  const labels = {};
  let at = start;
  for (;;) {
    while (line[at] === ' ' || line[at] === ',') {
      at += 1;
    }
    if (line[at] === '}') {
      return { labels, end: at + 1 };
    }
    const name = line.slice(at).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (!name || line[at + name[0].length] !== '=' || line[at + name[0].length + 1] !== '"') {
      throw new Error('label');
    }
    at += name[0].length + 2;
    let value = '';
    for (;;) {
      const char = line[at];
      if (char === undefined) {
        throw new Error('label value');
      }
      if (char === '\\') {
        const next = line[at + 1];
        value += next === 'n' ? '\n' : next;
        at += 2;
      } else if (char === '"') {
        at += 1;
        break;
      } else {
        value += char;
        at += 1;
      }
    }
    labels[name[0]] = value;
  }
}

/**
 * Parse a Prometheus text exposition into samples. Comments and malformed
 * lines are skipped: one odd line never hides the monitors.
 * @param {string} text
 * @returns {{ samples: Array<{ name: string, labels: Record<string,string>, value: number }>, help: Set<string> }}
 */
export function parsePrometheus(text) {
  const samples = [];
  const help = new Set();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('#')) {
      const declared = line.match(/^# (?:HELP|TYPE) ([a-zA-Z_:][a-zA-Z0-9_:]*)/);
      if (declared) {
        help.add(declared[1]);
      }
      continue;
    }
    const head = line.match(METRIC_LINE);
    if (!head) {
      continue;
    }
    let labels = {};
    let rest = head[0].length;
    if (head[2]) {
      try {
        ({ labels, end: rest } = parseLabels(line, rest));
      } catch {
        continue;
      }
    }
    const [valueText] = line.slice(rest).trim().split(/\s+/);
    const value = Number(valueText);
    if (valueText === undefined || valueText === '' || Number.isNaN(value)) {
      continue;
    }
    samples.push({ name: head[1], labels, value });
  }
  return { samples, help };
}

// The label "null" or the URL field's default stand for "no value".
const clean = (value) =>
  value === undefined || value === '' || value === 'null' || value === 'undefined' ? null : value;
const cleanUrl = (value) => {
  const url = clean(value);
  return url === null || /^https?:\/\/$/i.test(url) ? null : url;
};

const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/** The identity of a monitor of Uptime Kuma 1.x, which has no id: its name. */
export const nameKey = (name) => `n${hash(name)}`;
export const idKey = (id) => `m${id}`;

/**
 * What the integration shows of a monitor: its URL, else host and port.
 * @param {{ url: string|null, hostname: string|null, port: string|null }} monitor
 */
export function targetOf({ url, hostname, port }) {
  if (url) {
    return url;
  }
  if (hostname) {
    return port ? `${hostname}:${port}` : hostname;
  }
  return '';
}

/**
 * Read the monitors of an Uptime Kuma `/metrics` page.
 * @param {string} text
 * @returns {{ isKuma: boolean, version: string|null, major: number|null, monitors: object[] }}
 */
export function parseMetrics(text) {
  const { samples, help } = parsePrometheus(text);
  let version = null;
  const byLabels = new Map();
  for (const sample of samples) {
    if (sample.name === 'app_version') {
      version = clean(sample.labels.version) ?? version;
      continue;
    }
    if (!sample.name.startsWith('monitor_') || !sample.labels.monitor_name) {
      continue;
    }
    // 2.x: the id; 1.x: the label set (two monitors may share a name).
    const { labels } = sample;
    const id = /^\d+$/.test(labels.monitor_id ?? '') ? Number(labels.monitor_id) : null;
    const group =
      id !== null
        ? `id:${id}`
        : JSON.stringify([
            labels.monitor_name,
            labels.monitor_type,
            labels.monitor_url,
            labels.monitor_hostname,
            labels.monitor_port,
          ]);
    let monitor = byLabels.get(group);
    if (!monitor) {
      monitor = {
        id,
        name: sample.labels.monitor_name,
        type: clean(sample.labels.monitor_type) ?? 'unknown',
        url: cleanUrl(sample.labels.monitor_url),
        hostname: clean(sample.labels.monitor_hostname),
        port: clean(sample.labels.monitor_port),
        status: null,
        responseTime: null,
        certDays: null,
        certValid: null,
        uptime24h: null,
      };
      byLabels.set(group, monitor);
    }
    const window = sample.labels.window;
    switch (sample.name) {
      case 'monitor_status':
        monitor.status = Object.values(STATUS).includes(sample.value) ? sample.value : null;
        break;
      case 'monitor_response_time':
        monitor.responseTime = sample.value >= 0 ? Math.round(sample.value) : null;
        break;
      case 'monitor_cert_days_remaining':
        monitor.certDays = Math.round(sample.value);
        break;
      case 'monitor_cert_is_valid':
        monitor.certValid = sample.value === 1;
        break;
      case 'monitor_uptime_ratio':
        if (window === '1d') {
          monitor.uptime24h = sample.value;
        }
        break;
      default:
    }
  }

  // Keys: the id on 2.x; the name on 1.x, two monitors of the same name
  // told apart by what they watch.
  const monitors = [...byLabels.values()];
  const counts = new Map();
  for (const monitor of monitors) {
    counts.set(monitor.name, (counts.get(monitor.name) ?? 0) + 1);
  }
  for (const monitor of monitors) {
    if (monitor.id !== null) {
      monitor.key = idKey(monitor.id);
    } else if (counts.get(monitor.name) === 1) {
      monitor.key = nameKey(monitor.name);
    } else {
      monitor.key = `n${hash([monitor.name, monitor.type, targetOf(monitor)].join('\n'))}`;
    }
    monitor.target = targetOf(monitor);
  }

  const major = version ? Number(version.split('.')[0]) || null : null;
  const isKuma = version !== null || help.has('monitor_status') || monitors.length > 0;
  return { isKuma, version, major, monitors };
}
