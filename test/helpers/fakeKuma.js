// -----------------------------------------------------------------------------
// An in-memory Uptime Kuma: its monitors, rendered as /metrics exactly like
// server/prometheus.js does (1.x without monitor_id, 2.x with it and the tag
// labels, "null" for empty fields, the "https://" default URL, no series for a
// paused monitor), behind the API key check of server/auth.js. The rendering
// is checked against the real answers of test/fixtures/kuma/ in
// test/metrics.test.js.
// -----------------------------------------------------------------------------

export const API_KEY = 'uk1_testkey0000000000000000000000000';

const escape = (value) =>
  String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

let nextId = 1;

/**
 * A monitor of the fake, with the defaults of an HTTP monitor that is up.
 * @param {object} fields
 */
export function monitor(fields = {}) {
  const id = fields.id ?? nextId++;
  return {
    id,
    name: `Monitor ${id}`,
    type: 'http',
    url: `http://web.home.arpa/${id}`,
    hostname: null,
    port: null,
    status: 1,
    ping: 12,
    cert: null, // { days, valid }
    tags: {},
    active: true,
    ...fields,
  };
}

export class FakeKuma {
  /**
   * @param {object} [options]
   * @param {1|2} [options.major]
   * @param {string|null} [options.apiKey] null: authentication disabled
   * @param {object[]} [options.monitors]
   */
  constructor({ major = 2, apiKey = API_KEY, monitors } = {}) {
    this.major = major;
    this.version = major === 1 ? '1.23.17' : '2.5.6';
    this.apiKey = apiKey;
    this.monitors = monitors ?? [
      monitor({
        id: 1,
        name: 'Nextcloud',
        url: 'https://cloud.example.com/',
        ping: 85,
        cert: { days: 60, valid: true },
      }),
      monitor({ id: 2, name: 'Jellyfin', url: 'http://192.0.2.20:8096/health', ping: 4 }),
      monitor({
        id: 3,
        name: 'NAS SSH',
        type: 'port',
        url: 'https://',
        hostname: '192.0.2.30',
        port: '22',
        ping: 1,
      }),
    ];
    /** Every request received: { url, headers } */
    this.requests = [];
    /** 'down': connection refused, 'html': an HTML page, a number: that HTTP status */
    this.failure = null;
  }

  get(id) {
    return this.monitors.find((m) => m.id === id);
  }

  set(id, changes) {
    Object.assign(this.get(id), changes);
  }

  labels(m) {
    const labels = [];
    if (this.major >= 2) {
      for (const [tag, value] of Object.entries(m.tags)) {
        labels.push([tag, value]);
      }
      labels.push(['monitor_id', m.id]);
    }
    labels.push(
      ['monitor_name', m.name],
      ['monitor_type', m.type],
      ['monitor_url', m.url ?? 'null'],
      ['monitor_hostname', m.hostname ?? 'null'],
      ['monitor_port', m.port ?? 'null'],
    );
    return labels;
  }

  render() {
    const lines = [
      '# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.',
      '# TYPE process_cpu_user_seconds_total counter',
      'process_cpu_user_seconds_total 2.31',
      '',
    ];
    const series = (name, m, value, extra = []) => {
      const labels = [...this.labels(m), ...extra]
        .map(([key, val]) => `${key}="${escape(val)}"`)
        .join(',');
      lines.push(`${name}{${labels}} ${value}`);
    };
    const active = this.monitors.filter((m) => m.active);
    lines.push(
      '# HELP monitor_cert_days_remaining The number of days remaining until the certificate expires',
    );
    lines.push('# TYPE monitor_cert_days_remaining gauge');
    for (const m of active.filter((x) => x.cert)) {
      series('monitor_cert_days_remaining', m, m.cert.days);
    }
    lines.push('', '# HELP monitor_cert_is_valid Is the certificate still valid? (1 = Yes, 0= No)');
    lines.push('# TYPE monitor_cert_is_valid gauge');
    for (const m of active.filter((x) => x.cert)) {
      series('monitor_cert_is_valid', m, m.cert.valid ? 1 : 0);
    }
    if (this.major >= 2) {
      lines.push(
        '',
        '# HELP monitor_uptime_ratio Uptime ratio',
        '# TYPE monitor_uptime_ratio gauge',
      );
      for (const m of active) {
        for (const window of ['1d', '30d', '365d']) {
          series('monitor_uptime_ratio', m, m.status === 1 ? 1 : 0.5, [['window', window]]);
        }
      }
    }
    lines.push(
      '',
      '# HELP monitor_response_time Monitor Response Time (ms)',
      '# TYPE monitor_response_time gauge',
    );
    for (const m of active) {
      series('monitor_response_time', m, typeof m.ping === 'number' ? m.ping : -1);
    }
    lines.push(
      '',
      '# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)',
      '# TYPE monitor_status gauge',
    );
    for (const m of active) {
      series('monitor_status', m, m.status);
    }
    lines.push(
      '',
      '# HELP app_version The service version by package.json',
      '# TYPE app_version gauge',
    );
    const [maj, minor, patch] = this.version.split('.');
    lines.push(
      `app_version{version="${this.version}",major="${maj}",minor="${minor}",patch="${patch}"} 1`,
    );
    return `${lines.join('\n')}\n`;
  }

  async handle(url, { headers = {} } = {}) {
    this.requests.push({ url, headers });
    if (this.failure === 'down') {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.failure === 'html') {
      return { status: 200, headers: {}, body: '<!DOCTYPE html><html><body>Hello</body></html>' };
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, headers: { location: 'https://kuma.example.com/' }, body: '' };
    }
    if (!new URL(url).pathname.endsWith('/metrics')) {
      return { status: 404, headers: {}, body: '' };
    }
    if (this.apiKey !== null) {
      const expected = `Basic ${Buffer.from(`:${this.apiKey}`).toString('base64')}`;
      if (headers.authorization !== expected) {
        return { status: 401, headers: { 'www-authenticate': 'Basic' }, body: '' };
      }
    }
    return { status: 200, headers: { 'content-type': 'text/plain' }, body: this.render() };
  }
}

/** A network of fake instances, keyed by base URL; anything else is unreachable. */
export function createNetwork(instances = {}) {
  const byBase = new Map(Object.entries(instances));
  return {
    instances: byBase,
    async request(url, options) {
      const base = url.replace(/\/metrics$/, '');
      const instance = byBase.get(base);
      if (!instance) {
        const error = new Error('connect EHOSTUNREACH');
        error.code = 'EHOSTUNREACH';
        throw error;
      }
      return instance.handle(url, options);
    },
  };
}
