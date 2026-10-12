// -----------------------------------------------------------------------------
// The hub, end to end: the SDK's fake Gladys on one side, in-memory Uptime
// Kuma instances on the other, a manual clock. Devices, states, transitions
// and their scene events, persistence across restarts, identities, failures,
// reconfiguration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { monitorIds } from '../src/devices.js';
import { nameKey } from '../src/kuma/metrics.js';
import {
  API_KEY,
  FakeKuma,
  URL_1,
  URL_2,
  createClock,
  createDevices,
  createWorld,
  deviceId,
  featureId,
  monitor,
} from './helpers/world.js';

async function world(t, options = {}) {
  const clock = options.clock ?? createClock();
  const kuma = options.kuma ?? new FakeKuma();
  const instances = options.instances ?? { [URL_1]: kuma };
  const result = await createWorld({ ...options, clock, instances });
  t.after(() => result.app.stop());
  return { ...result, kuma };
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

async function step(w, ms = 30_000) {
  w.clock.advance(ms);
  await w.hub.pollAll();
}

test('one device per monitor, proposed in the Discovery tab, nothing polled by Gladys', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [
      ['Nextcloud', deviceId(w.gladys, 1)],
      ['Jellyfin', deviceId(w.gladys, 2)],
      ['NAS SSH', deviceId(w.gladys, 3)],
    ],
  );
  const [nextcloud, , nas] = devices;
  assert.equal(nextcloud.should_poll, false);
  assert.equal(nextcloud.poll_frequency, undefined);
  assert.equal(nextcloud.model, 'Uptime Kuma');
  assert.deepEqual(
    nextcloud.features.map((f) => f.external_id),
    ['up', 'response_time', 'certificate_days'].map((key) => featureId(w.gladys, 1, key)),
  );
  assert.deepEqual(nas.params, [
    { name: 'MONITOR_TYPE', value: 'port' },
    { name: 'MONITOR_TARGET', value: '192.0.2.30:22' },
  ]);
  assert.equal(nas.features.length, 2, 'no certificate on a TCP monitor');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.states.length, 0, 'nothing sent for devices not added');
});

test('a group monitor has no response time; an https:// monitor has a certificate before its first check', async (t) => {
  const kuma = new FakeKuma({
    monitors: [
      monitor({ id: 1, name: 'Home lab', type: 'group', url: 'https://', status: 2 }),
      monitor({ id: 2, name: 'Blog', url: 'https://blog.example.com/' }),
    ],
  });
  const w = await world(t, { kuma });
  const [group, blog] = w.fake.discoveredDevices;
  assert.deepEqual(
    group.features.map((f) => f.external_id.split(':').pop()),
    ['up'],
  );
  assert.deepEqual(
    blog.features.map((f) => f.external_id.split(':').pop()),
    ['up', 'response_time', 'certificate_days'],
  );
});

test('the states of an added device, then only the changes', async (t) => {
  const w = await world(t);
  await createDevices(w);
  assert.equal(w.fake.lastState(featureId(w.gladys, 1, 'up')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 1, 'response_time')), 85);
  assert.equal(w.fake.lastState(featureId(w.gladys, 1, 'certificate_days')), 60);
  assert.equal(w.fake.lastState(featureId(w.gladys, 3, 'up')), 1);
  assert.deepEqual(
    w.fake.transports.map((entry) => entry.transport),
    ['local', 'local', 'local'],
  );
  assert.equal(w.fake.widgetRefreshes.at(-1), WIDGET_KEY);

  const sent = w.fake.states.length;
  await step(w);
  assert.equal(w.fake.states.length, sent, 'nothing changed, nothing sent');

  w.kuma.set(2, { status: 0, ping: null });
  await step(w);
  assert.deepEqual(
    w.fake.states.slice(sent).map((s) => [s.device_feature_external_id, s.state]),
    [[featureId(w.gladys, 2, 'up'), 0]],
    'down: the response time keeps its last value',
  );
});

test('a response time is sent at most once a minute per monitor', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const id = featureId(w.gladys, 1, 'response_time');
  const sentFor = () => w.fake.states.filter((s) => s.device_feature_external_id === id).length;
  const before = sentFor();
  w.kuma.set(1, { ping: 90 });
  await step(w, 30_000);
  assert.equal(sentFor(), before, '30 s after the last one: not yet');
  w.kuma.set(1, { ping: 95 });
  await step(w, 30_000);
  assert.equal(sentFor(), before + 1);
  assert.equal(w.fake.lastState(id), 95);
});

test('a hundred monitors read every 15 seconds stay under 300 states per minute', async (t) => {
  const monitors = Array.from({ length: 100 }, (_, i) =>
    monitor({ id: i + 1, name: `Service ${i + 1}`, ping: 10 }),
  );
  const kuma = new FakeKuma({ monitors });
  const w = await world(t, { kuma });
  await createDevices(w);
  const start = w.fake.states.length;
  for (let round = 1; round <= 8; round += 1) {
    for (const m of monitors) {
      m.ping = 10 + round; // every response time moves at every check
    }
    await step(w, 15_000);
  }
  const perMinute = (w.fake.states.length - start) / 2;
  assert.ok(perMinute <= 150, `${perMinute} states per minute`);
});

test('"a service goes down" and "a service is back up", with the length of the outage', async (t) => {
  const w = await world(t);
  w.kuma.set(2, { status: 0, ping: null });
  await step(w);
  assert.deepEqual(events(w, TRIGGERS.DOWN), [
    {
      key: TRIGGERS.DOWN,
      data: {
        device: deviceId(w.gladys, 2),
        monitor: 'Jellyfin',
        type: 'http',
        url: 'http://192.0.2.20:8096/health',
        instance: 'Home',
      },
    },
  ]);
  await step(w, 60_000);
  assert.equal(events(w, TRIGGERS.DOWN).length, 1, 'once per transition');

  w.kuma.set(2, { status: 1, ping: 7 });
  await step(w, 6 * 60_000);
  assert.deepEqual(events(w, TRIGGERS.UP).at(-1).data, {
    device: deviceId(w.gladys, 2),
    monitor: 'Jellyfin',
    type: 'http',
    url: 'http://192.0.2.20:8096/health',
    instance: 'Home',
    downtime_minutes: 7,
    response_time: 7,
  });
});

test('pending is not a state: no event while Uptime Kuma retries', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.kuma.set(2, { status: 2, ping: null });
  await step(w);
  assert.equal(w.fake.sceneEvents.length, 0);
  assert.equal(w.fake.lastState(featureId(w.gladys, 2, 'up')), 1, 'the last value stays');
  w.kuma.set(2, { status: 1 });
  await step(w);
  assert.equal(w.fake.sceneEvents.length, 0, 'pending then up: nothing happened');
  w.kuma.set(2, { status: 2 });
  await step(w);
  w.kuma.set(2, { status: 0 });
  await step(w);
  assert.equal(events(w, TRIGGERS.DOWN).length, 1, 'pending then down: down');
});

test('maintenance: no event when it starts, "down" if the service is down when it ends', async (t) => {
  const w = await world(t);
  w.kuma.set(1, { status: 3 });
  await step(w);
  w.kuma.set(1, { status: 1 });
  await step(w);
  assert.equal(w.fake.sceneEvents.length, 0);
  w.kuma.set(1, { status: 3 });
  await step(w);
  w.kuma.set(1, { status: 0 });
  await step(w);
  assert.equal(events(w, TRIGGERS.DOWN).length, 1);
});

test('a monitor already down at the first read announces nothing', async (t) => {
  const kuma = new FakeKuma();
  kuma.set(2, { status: 0 });
  const w = await world(t, { kuma });
  await step(w);
  assert.equal(w.fake.sceneEvents.length, 0);
});

test('a transition during a restart is announced once, with the outage counted from before', async (t) => {
  const clock = createClock();
  const kuma = new FakeKuma();
  const first = await world(t, { kuma, clock });
  kuma.set(2, { status: 0 });
  await step(first);
  assert.equal(events(first, TRIGGERS.DOWN).length, 1);
  await first.app.stop();

  // Back up while the integration was stopped.
  clock.advance(20 * 60_000);
  kuma.set(2, { status: 1 });
  const second = await world(t, { kuma, clock, dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.sceneEvents.map((e) => [e.key, e.data.downtime_minutes]),
    [[TRIGGERS.UP, 20]],
  );
  await second.app.stop();

  const third = await world(t, { kuma, clock, dataDir: first.dataDir });
  assert.equal(third.fake.sceneEvents.length, 0, 'not twice');
});

test('"certificate expires soon": once at the threshold, again after a renewal', async (t) => {
  const kuma = new FakeKuma();
  const w = await world(t, {
    kuma,
    config: { instance_1_url: URL_1, instance_1_api_key: API_KEY, cert_warning_days: '21' },
  });
  assert.equal(events(w, TRIGGERS.CERTIFICATE).length, 0, '60 days left');
  kuma.set(1, { cert: { days: 21, valid: true } });
  await step(w);
  assert.deepEqual(events(w, TRIGGERS.CERTIFICATE), [
    {
      key: TRIGGERS.CERTIFICATE,
      data: {
        device: deviceId(w.gladys, 1),
        monitor: 'Nextcloud',
        type: 'http',
        url: 'https://cloud.example.com/',
        instance: '192.0.2.10:3001',
        days_remaining: 21,
      },
    },
  ]);
  kuma.set(1, { cert: { days: 20, valid: true } });
  await step(w);
  assert.equal(events(w, TRIGGERS.CERTIFICATE).length, 1, 'once');

  kuma.set(1, { cert: { days: 89, valid: true } }); // renewed
  await step(w);
  kuma.set(1, { cert: { days: 3, valid: true } });
  await step(w);
  assert.equal(events(w, TRIGGERS.CERTIFICATE).length, 2);
});

test('a certificate already announced is not announced again after a restart', async (t) => {
  const kuma = new FakeKuma();
  kuma.set(1, { cert: { days: 5, valid: true } });
  const first = await world(t, { kuma });
  assert.equal(events(first, TRIGGERS.CERTIFICATE).length, 1, 'already under the threshold');
  await first.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'uptime-kuma-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.certificates), ['1:m1']);
  assert.ok(!JSON.stringify(saved).includes(API_KEY), 'no secret under /data');
  const second = await world(t, { kuma, dataDir: first.dataDir });
  assert.equal(events(second, TRIGGERS.CERTIFICATE).length, 0);
});

test('Uptime Kuma no longer answers: one event after two reads, badges, status, no service event', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.kuma.failure = 'down';
  await step(w);
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 0, 'a blip');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.fr, 'Home : ne répond pas');
  await step(w);
  assert.deepEqual(events(w, TRIGGERS.UNREACHABLE), [
    { key: TRIGGERS.UNREACHABLE, data: { instance: 'Home', error: 'does not answer' } },
  ]);
  await step(w);
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 1, 'once');
  assert.deepEqual(
    w.fake.transports.slice(-3).map((entry) => entry.transport),
    ['unreachable', 'unreachable', 'unreachable'],
  );
  assert.equal(events(w, TRIGGERS.DOWN).length, 0, 'the services are unknown, not down');

  w.kuma.failure = null;
  await step(w);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('a refused key is a configuration problem: status, no event', async (t) => {
  const w = await world(t, { kuma: new FakeKuma({ apiKey: 'uk9_other' }) });
  await step(w);
  await step(w);
  assert.equal(w.fake.sceneEvents.length, 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /^Home: API key refused/);
  assert.equal(w.fake.discoveredDevices.length, 0);
});

test('a paused monitor leaves the Discovery tab, its device stays, no event', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.kuma.set(2, { active: false });
  await step(w);
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['Nextcloud', 'NAS SSH'],
  );
  assert.equal(w.fake.sceneEvents.length, 0);
  assert.equal(w.hub.find(deviceId(w.gladys, 2)).monitor, null);
  w.kuma.set(2, { active: true });
  await step(w);
  assert.equal(w.fake.discoveredDevices.length, 3);
});

test('Uptime Kuma 1.x: devices keyed by name, kept after the upgrade to 2.x', async (t) => {
  const v1 = new FakeKuma({ major: 1 });
  const first = await world(t, { kuma: v1 });
  const legacyId = monitorIds(first.gladys, 1, nameKey('Jellyfin')).device;
  assert.equal(first.fake.discoveredDevices[1].external_id, legacyId);
  await createDevices(first, (d) => d.name === 'Jellyfin');
  const created = first.fake.devices;
  await first.app.stop();

  // Upgraded: the same monitors, now with their ids.
  const v2 = new FakeKuma({ major: 2 });
  const second = await world(t, { kuma: v2, devices: created, dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.discoveredDevices.map((d) => d.external_id),
    [deviceId(second.gladys, 1), legacyId, deviceId(second.gladys, 3)],
  );
  v2.set(2, { status: 0 });
  await step(second);
  assert.equal(events(second, TRIGGERS.DOWN)[0].data.device, legacyId);
  assert.equal(second.fake.lastState(`${legacyId}:up`), 0);

  // Renamed on 2.x: the device follows the id, not the name.
  v2.set(2, { name: 'Jellyfin (salon)' });
  await step(second);
  assert.equal(second.fake.discoveredDevices[1].external_id, legacyId);
});

test('two instances: devices of both, a status naming the one that fails', async (t) => {
  const home = new FakeKuma();
  const outside = new FakeKuma({
    apiKey: 'uk2_outside',
    monitors: [monitor({ id: 1, name: 'Home from outside', url: 'https://home.example.com/' })],
  });
  const w = await world(t, {
    instances: { [URL_1]: home, [URL_2]: outside },
    config: {
      instance_1_url: URL_1,
      instance_1_api_key: API_KEY,
      instance_1_name: 'Home',
      instance_2_url: URL_2,
      instance_2_api_key: 'uk2_outside',
      language: 'en',
    },
  });
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.external_id),
    [1, 2, 3].map((id) => deviceId(w.gladys, id)).concat(deviceId(w.gladys, 1, 2)),
  );
  outside.failure = 'down';
  await step(w);
  assert.deepEqual(w.fake.connectionStatus, {
    connected: true,
    message: {
      en: '198.51.100.20: does not answer',
      fr: '198.51.100.20 : ne répond pas',
      de: '198.51.100.20: antwortet nicht',
      es: '198.51.100.20: no responde',
    },
  });
});

test('reconfigure: names in the new language, a removed instance leaves', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'Up');
  await w.fake.configUpdated({
    instance_1_url: URL_1,
    instance_1_api_key: API_KEY,
    language: 'de',
  });
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'In Betrieb');
  await w.fake.configUpdated({ language: 'de' });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(
    w.fake.connectionStatus.message.de,
    'Gib die Adresse deines Uptime Kuma in der Konfiguration ein.',
  );
});

test('a new key makes a new client; a new name keeps it', async (t) => {
  const w = await world(t);
  const client = w.hub.records.get(1).client;
  await w.fake.configUpdated({
    instance_1_url: URL_1,
    instance_1_api_key: API_KEY,
    instance_1_name: 'Maison',
  });
  assert.equal(w.hub.records.get(1).client, client);
  await w.fake.configUpdated({ instance_1_url: URL_1, instance_1_api_key: 'uk1_new' });
  assert.notEqual(w.hub.records.get(1).client, client);
  assert.equal(w.fake.connectionStatus.connected, false);
});

test('an address that cannot be read is reported', async (t) => {
  const w = await world(t, { config: { instance_1_url: 'ftp://nope' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(
    w.fake.connectionStatus.message.en,
    'Address not understood, e.g. http://192.168.1.2:3001',
  );
});

test('"Search" in the Discovery tab and a poll from Gladys read Uptime Kuma again', async (t) => {
  const w = await world(t);
  const before = w.kuma.requests.length;
  await w.fake.scanRequest();
  assert.equal(w.kuma.requests.length, before + 1);
  const [device] = w.fake.discoveredDevices;
  assert.equal((await w.fake.poll(device)).success, true);
  assert.equal(w.kuma.requests.length, before + 2);
});

test('"Test the connection" reports each instance', async (t) => {
  const w = await world(t);
  w.kuma.set(3, { status: 0 });
  const ack = await w.fake.action('test_connection', {});
  assert.deepEqual(ack.data.message, {
    en: 'Home: OK, Uptime Kuma 2.5.6, 3 monitor(s), 1 down',
    fr: 'Home : OK, Uptime Kuma 2.5.6, 3 sonde(s), 1 hors service',
    de: 'Home: OK, Uptime Kuma 2.5.6, 3 Monitor(e), 1 ausgefallen',
    es: 'Home: OK, Uptime Kuma 2.5.6, 3 monitor(es), 1 caído(s)',
  });
  w.kuma.failure = 'down';
  const failed = await w.fake.action('test_connection', {});
  assert.equal(failed.data.message.fr, 'Home : ne répond pas');
  const empty = await world(t, { config: {} });
  const none = await empty.fake.action('test_connection', {});
  assert.equal(none.data.message.en, 'Enter the address of your Uptime Kuma in the configuration.');
});

test('Gladys restarted: everything is sent again', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const sent = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await w.app.ready;
  assert.equal(w.fake.states.length - sent, 7, 'every state again');
  assert.equal(w.fake.discoveredDevices.length, 3);
});
