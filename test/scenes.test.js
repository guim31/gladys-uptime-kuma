// -----------------------------------------------------------------------------
// Scene actions: "State of a service" and "Count the services down", their
// outputs, their fresh read, their errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LISTED_NAMES } from '../src/scenes.js';
import {
  API_KEY,
  FakeKuma,
  URL_1,
  createClock,
  createDevices,
  createWorld,
  deviceId,
  monitor,
} from './helpers/world.js';

async function world(t, options = {}) {
  const kuma = options.kuma ?? new FakeKuma();
  const clock = createClock();
  const result = await createWorld({ clock, instances: { [URL_1]: kuma }, ...options });
  t.after(() => result.app.stop());
  return { ...result, kuma };
}

const FRENCH = { instance_1_url: URL_1, instance_1_api_key: API_KEY, language: 'fr' };

test('"State of a service": up, the state in words, the response time, the certificate', async (t) => {
  const w = await world(t, { config: FRENCH });
  await createDevices(w);
  const ack = await w.fake.sceneAction('get_monitor_status', { device: deviceId(w.gladys, 1) });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    up: true,
    status: 'En service',
    name: 'Nextcloud',
    response_time: 85,
    certificate_days: 60,
  });
  w.kuma.set(2, { status: 0, ping: null });
  w.clock.advance(20_000);
  const down = await w.fake.sceneAction('get_monitor_status', { device: deviceId(w.gladys, 2) });
  assert.deepEqual(down.data.outputs, { up: false, status: 'Hors service', name: 'Jellyfin' });
});

test('a recent read is reused, an older one is read again', async (t) => {
  const w = await world(t);
  const device = deviceId(w.gladys, 1);
  const before = w.kuma.requests.length;
  await w.fake.sceneAction('get_monitor_status', { device });
  assert.equal(w.kuma.requests.length, before, 'read less than 15 s ago');
  w.clock.advance(15_000);
  await w.fake.sceneAction('get_monitor_status', { device });
  assert.equal(w.kuma.requests.length, before + 1);
});

test('a paused monitor is "Paused", not up', async (t) => {
  const w = await world(t);
  w.kuma.set(3, { active: false });
  w.clock.advance(20_000);
  const ack = await w.fake.sceneAction('get_monitor_status', { device: deviceId(w.gladys, 3) });
  assert.deepEqual(ack.data.outputs, { up: false, status: 'Paused' });
});

test('errors: a device of another kind, nothing configured, Uptime Kuma silent', async (t) => {
  const w = await world(t, { config: FRENCH });
  const wrong = await w.fake.sceneAction('get_monitor_status', { device: 'ext:other:lamp' });
  assert.equal(wrong.success, false);
  assert.equal(wrong.error, "Cet appareil n'est pas une sonde Uptime Kuma.");

  w.kuma.failure = 'down';
  w.clock.advance(20_000);
  const silent = await w.fake.sceneAction('get_monitor_status', { device: deviceId(w.gladys, 1) });
  assert.equal(silent.error, '192.0.2.10:3001 : ne répond pas');
  const count = await w.fake.sceneAction('count_down_services', {});
  assert.equal(count.error, 'Uptime Kuma ne répond pas.');

  const none = await world(t, { config: { language: 'es' } });
  const ack = await none.fake.sceneAction('count_down_services', {});
  assert.equal(ack.error, 'No hay ningún Uptime Kuma configurado.');
});

test('"Count the services down": counts without groups, names sorted', async (t) => {
  const kuma = new FakeKuma({
    monitors: [
      monitor({ id: 1, name: 'Nextcloud', status: 0 }),
      monitor({ id: 2, name: 'Jellyfin', status: 0 }),
      monitor({ id: 3, name: 'Home Assistant' }),
      monitor({ id: 4, name: 'Lab', type: 'group', url: 'https://', status: 0 }),
      monitor({ id: 5, name: 'Backup', status: 2 }),
    ],
  });
  const w = await world(t, { kuma });
  const ack = await w.fake.sceneAction('count_down_services', {});
  assert.deepEqual(ack.data.outputs, { down: 2, up: 1, total: 4, names: 'Jellyfin, Nextcloud' });
});

test('"Count the services down": nothing down, many down', async (t) => {
  const w = await world(t);
  assert.deepEqual((await w.fake.sceneAction('count_down_services', {})).data.outputs, {
    down: 0,
    up: 3,
    total: 3,
    names: '',
  });
  const many = Array.from({ length: MAX_LISTED_NAMES + 3 }, (_, i) =>
    monitor({ id: i + 1, name: `S${String(i).padStart(2, '0')}`, status: 0 }),
  );
  const crowded = await world(t, { kuma: new FakeKuma({ monitors: many }) });
  const { outputs } = (await crowded.fake.sceneAction('count_down_services', {})).data;
  assert.equal(outputs.down, MAX_LISTED_NAMES + 3);
  assert.match(outputs.names, /^S00, S01, .*S19, \+3$/);
});
