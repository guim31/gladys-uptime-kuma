// -----------------------------------------------------------------------------
// Reading /metrics: the real answers of Uptime Kuma 1.23.17 and 2.5.6 (Docker
// images louislam/uptime-kuma:1 and :2, see test/fixtures/kuma/README.md),
// the fixture of pythonkuma, and the odd cases of the exposition format.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STATUS, idKey, nameKey, parseMetrics, parsePrometheus } from '../src/kuma/metrics.js';
import { FakeKuma, monitor } from './helpers/fakeKuma.js';

const fixture = (name) => readFile(new URL(`./fixtures/kuma/${name}`, import.meta.url), 'utf8');

const V1 = await fixture('v1-1.23.17.txt');
const V2 = await fixture('v2-2.5.6.txt');
const PYTHONKUMA = await fixture('pythonkuma-metrics.txt');

const byName = (monitors) => Object.fromEntries(monitors.map((m) => [m.name, m]));

test('Uptime Kuma 1.23.17: monitors keyed by name, "null" and "https://" cleaned', () => {
  const { isKuma, version, major, monitors } = parseMetrics(V1);
  assert.equal(isKuma, true);
  assert.equal(version, '1.23.17');
  assert.equal(major, 1);
  assert.equal(monitors.length, 6);
  const all = byName(monitors);
  assert.deepEqual(all['Web server'], {
    id: null,
    key: nameKey('Web server'),
    name: 'Web server',
    type: 'http',
    url: 'http://web.home.arpa:8080/',
    hostname: null,
    port: null,
    target: 'http://web.home.arpa:8080/',
    status: STATUS.UP,
    responseTime: 7,
    certDays: null,
    certValid: null,
    uptime24h: null,
  });
  assert.equal(all['Self-signed site'].certDays, 10);
  assert.equal(all['Self-signed site'].certValid, false);
  // A TCP monitor: the URL field keeps its default, the host and port matter.
  assert.equal(all['Closed port'].url, null);
  assert.equal(all['Closed port'].target, 'web.home.arpa:9');
  assert.equal(all['Closed port'].status, STATUS.DOWN);
  assert.equal(all['Closed port'].responseTime, null, '-1: nothing measured');
  assert.equal(all['Home lab'].type, 'group');
  assert.equal(all['Home lab'].status, STATUS.PENDING);
  assert.equal(all['Keyword "ok"'].type, 'keyword', 'escaped quotes');
});

test('Uptime Kuma 2.5.6: monitors keyed by id, tags and windows ignored', () => {
  const { version, major, monitors } = parseMetrics(V2);
  assert.equal(version, '2.5.6');
  assert.equal(major, 2);
  assert.deepEqual(
    monitors.map((m) => [m.id, m.key, m.name]),
    [
      [2, idKey(2), 'Self-signed site'],
      [1, idKey(1), 'Web server'],
      [3, idKey(3), 'Kuma TCP'],
      [4, idKey(4), 'Closed port'],
      [5, idKey(5), 'Keyword "ok"'],
      [6, idKey(6), 'Home lab'],
    ],
  );
  const all = byName(monitors);
  // The tagged series and the untagged ones are the same monitor.
  assert.equal(all['Web server'].status, STATUS.UP);
  assert.equal(all['Web server'].responseTime, 5);
  assert.equal(all['Web server'].uptime24h, 1);
  assert.equal(all['Self-signed site'].certDays, 9);
  assert.equal(all['Closed port'].uptime24h, 0);
});

test('the pythonkuma fixture (Uptime Kuma 2.1.0): tags, unknown types, query strings', () => {
  const { version, monitors } = parseMetrics(PYTHONKUMA);
  assert.equal(version, '2.1.0');
  const all = byName(monitors);
  assert.equal(all.Jellyfin.id, 3);
  assert.equal(all.Jellyfin.certDays, 46);
  assert.equal(
    all.Nextcloud.url,
    'https://cloud.example.com/ocs/v2.php/apps/serverinfo/api/v1/info?format=json',
  );
  assert.equal(all.Proxy.type, 'laserping', 'a type this integration does not know is kept');
  assert.equal(all.Proxy.url, null);
});

test('two 1.x monitors of the same name stay two monitors, with distinct keys', () => {
  const kuma = new FakeKuma({
    major: 1,
    monitors: [
      monitor({ id: 1, name: 'Router', url: 'http://192.0.2.1/' }),
      monitor({ id: 2, name: 'Router', type: 'ping', url: 'https://', hostname: '192.0.2.1' }),
      monitor({ id: 3, name: 'NAS' }),
    ],
  });
  const { monitors } = parseMetrics(kuma.render());
  assert.equal(monitors.length, 3);
  assert.equal(new Set(monitors.map((m) => m.key)).size, 3);
  assert.equal(byName(monitors).NAS.key, nameKey('NAS'), 'a unique name keys on the name alone');
});

test('the fake Uptime Kuma writes its series like the real ones', () => {
  const series = (text, name) =>
    text
      .split('\n')
      .filter((line) => line.startsWith(`${name}{`))
      .sort();
  const realMonitors = (major) =>
    [
      monitor({ id: 1, name: 'Web server', url: 'http://web.home.arpa:8080/', status: 1 }),
      monitor({ id: 2, name: 'Self-signed site', url: 'https://web.home.arpa:8443/', status: 1 }),
      monitor({
        id: 3,
        name: 'Kuma TCP',
        type: 'port',
        url: 'https://',
        hostname: 'web.home.arpa',
        port: '8080',
      }),
      monitor({
        id: 4,
        name: 'Closed port',
        type: 'port',
        url: 'https://',
        hostname: 'web.home.arpa',
        port: '9',
        status: 0,
      }),
      monitor({ id: 5, name: 'Keyword "ok"', type: 'keyword', url: 'http://web.home.arpa:8080/' }),
      monitor({ id: 6, name: 'Home lab', type: 'group', url: 'https://', status: 2 }),
    ].map((m) => (major === 2 && m.id === 1 ? { ...m, tags: { Home: 'lab' } } : m));
  for (const [major, real] of [
    [1, V1],
    [2, V2],
  ]) {
    const fake = new FakeKuma({ major, monitors: realMonitors(major) }).render();
    assert.deepEqual(series(fake, 'monitor_status'), series(real, 'monitor_status'), `${major}.x`);
  }
});

test('the exposition format: escapes, comments, timestamps, broken lines', () => {
  const { samples, help } = parsePrometheus(
    [
      '# HELP monitor_status Monitor Status',
      '# TYPE monitor_status gauge',
      'monitor_status{monitor_name="a \\"b\\" \\\\ c\\nd",monitor_type="http"} 1 1700000000000',
      'monitor_status{monitor_name="broken} 1',
      'monitor_response_time{monitor_name="x"} NaN',
      'nodejs_version_info{version="v20.1.0",major="20"} 1',
      'process_open_fds 23',
      '   ',
      'not a metric line',
    ].join('\n'),
  );
  assert.ok(help.has('monitor_status'));
  assert.deepEqual(samples, [
    {
      name: 'monitor_status',
      labels: { monitor_name: 'a "b" \\ c\nd', monitor_type: 'http' },
      value: 1,
    },
    { name: 'nodejs_version_info', labels: { version: 'v20.1.0', major: '20' }, value: 1 },
    { name: 'process_open_fds', labels: {}, value: 23 },
  ]);
});

test('an empty Uptime Kuma is still an Uptime Kuma; an HTML page is not', () => {
  const empty = parseMetrics(
    '# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)\n# TYPE monitor_status gauge\n',
  );
  assert.equal(empty.isKuma, true);
  assert.deepEqual(empty.monitors, []);
  assert.equal(parseMetrics('<!DOCTYPE html><html></html>').isKuma, false);
  assert.equal(parseMetrics('').isKuma, false);
});

test('an unknown status value is no status', () => {
  const kuma = new FakeKuma({ monitors: [monitor({ id: 1, status: 7 })] });
  assert.equal(parseMetrics(kuma.render()).monitors[0].status, null);
});

test('credentials typed in a monitor URL are dropped', () => {
  const kuma = new FakeKuma({
    monitors: [monitor({ id: 1, url: 'https://admin:s3cret@nas.example.com:5001/?q=1' })],
  });
  const [read] = parseMetrics(kuma.render()).monitors;
  assert.equal(read.url, 'https://nas.example.com:5001/?q=1');
  assert.equal(read.target, 'https://nas.example.com:5001/?q=1');
});
