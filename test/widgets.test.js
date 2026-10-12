// -----------------------------------------------------------------------------
// The `uptime_kuma` dashboard widget: content within the core budget (checked
// with the SDK's validator), every monitor or the chosen ones, problems first,
// the instance that does not answer, the Refresh button.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS, MAX_ROWS } from '../src/widgets.js';
import {
  API_KEY,
  FakeKuma,
  URL_1,
  createDevices,
  createWorld,
  deviceId,
  monitor,
} from './helpers/world.js';

async function world(t, options = {}) {
  const kuma = options.kuma ?? new FakeKuma();
  const result = await createWorld({ instances: { [URL_1]: kuma }, ...options });
  t.after(() => result.app.stop());
  return { ...result, kuma };
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (tree, type) => tree.components.filter((component) => component.type === type);
const rows = (tree) =>
  ofType(tree, 'status')[0].items.map(({ label, value, color }) => [label, value, color]);

test('every monitor: counts, the next certificate, one row each, a Refresh button', async (t) => {
  const w = await world(t);
  const tree = await content(w);
  assert.deepEqual(
    ofType(tree, 'value').map(({ label, value, unit, color }) => [label, value, unit, color]),
    [
      ['Down', 0, undefined, 'neutral'],
      ['Up', 3, undefined, 'success'],
      ['Certificate', 60, 'days', 'neutral'],
    ],
  );
  assert.deepEqual(rows(tree), [
    ['Jellyfin', '4 ms', 'success'],
    ['NAS SSH', '1 ms', 'success'],
    ['Nextcloud', '85 ms', 'success'],
  ]);
  const [button] = ofType(tree, 'button');
  assert.deepEqual(button.action, { key: ACTIONS.REFRESH });
  assert.notEqual(button.style, 'primary', 'primary is invisible in dark mode');
  assert.equal(tree.ttl_seconds, 60);
});

test('problems first, in the language of the user; a certificate near its end in orange', async (t) => {
  const w = await world(t);
  w.kuma.set(3, { status: 0, ping: null });
  w.kuma.set(2, { status: 3 });
  w.kuma.set(1, { cert: { days: 4, valid: true } });
  await w.hub.pollAll();
  const tree = await content(w, {}, 'fr');
  assert.deepEqual(rows(tree), [
    ['NAS SSH', 'Hors service', 'danger'],
    ['Jellyfin', 'Maintenance', 'info'],
    ['Nextcloud', '85 ms', 'success'],
  ]);
  const [down, up, certificate] = ofType(tree, 'value');
  assert.deepEqual([down.label, down.value, down.color], ['Hors service', 1, 'danger']);
  assert.equal(up.value, 1);
  assert.deepEqual([certificate.value, certificate.unit, certificate.color], [4, 'j', 'warning']);
  assert.equal(tree.ttl_seconds, 30, 'something moves: refreshed sooner');
});

test('groups are left out of "every monitor", kept when chosen', async (t) => {
  const kuma = new FakeKuma({
    monitors: [
      monitor({ id: 1, name: 'Web' }),
      monitor({ id: 2, name: 'Home lab', type: 'group', url: 'https://', status: 2 }),
    ],
  });
  const w = await world(t, { kuma });
  assert.deepEqual(rows(await content(w)), [['Web', '12 ms', 'success']]);
  await createDevices(w);
  const chosen = await content(w, { monitors: [deviceId(w.gladys, 2)] });
  assert.deepEqual(rows(chosen), [['Home lab', 'Pending', 'warning']]);
});

test('the chosen monitors only; a paused one keeps its name', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.kuma.set(2, { active: false });
  await w.hub.pollAll();
  const tree = await content(w, { monitors: [deviceId(w.gladys, 2), deviceId(w.gladys, 3)] });
  assert.deepEqual(rows(tree), [
    ['Jellyfin', 'Paused', 'neutral'],
    ['NAS SSH', '1 ms', 'success'],
  ]);
  assert.equal(ofType(tree, 'value').length, 2, 'no certificate among the chosen');
  // One device chosen: the setting may arrive as a string.
  assert.equal(rows(await content(w, { monitors: deviceId(w.gladys, 3) })).length, 1);
});

test('more than ten monitors: nine rows and the count of the others', async (t) => {
  const monitors = Array.from({ length: 14 }, (_, i) =>
    monitor({ id: i + 1, name: `Service ${String(i + 1).padStart(2, '0')}` }),
  );
  monitors[12].status = 0;
  const w = await world(t, { kuma: new FakeKuma({ monitors }) });
  const items = rows(await content(w));
  assert.equal(items.length, MAX_ROWS);
  assert.deepEqual(items[0], ['Service 13', 'Down', 'danger']);
  assert.deepEqual(items.at(-1), ['Others', '+5', 'neutral']);
});

test('an instance that does not answer: a text, its monitors unreachable', async (t) => {
  const w = await world(t);
  w.kuma.failure = 'down';
  await w.hub.pollAll();
  const tree = await content(w, {}, 'de');
  assert.deepEqual(
    ofType(tree, 'text').map((c) => c.text),
    ['Home: antwortet nicht'],
  );
  assert.ok(
    rows(tree).every(([, value, color]) => value === 'Nicht erreichbar' && color === 'danger'),
  );
  assert.equal(ofType(tree, 'value').length, 2, 'no certificate from a silent instance');
});

test('nothing configured, no monitor yet: a sentence', async (t) => {
  const none = await world(t, { config: {} });
  assert.deepEqual(
    ofType(await content(none, {}, 'es'), 'text')[0].text,
    'Introduzca la dirección de su Uptime Kuma en la configuración de la integración.',
  );
  const empty = await world(t, { kuma: new FakeKuma({ monitors: [] }) });
  assert.equal(
    ofType(await content(empty), 'text')[0].text,
    'No monitor yet: add one in Uptime Kuma.',
  );
});

test('Refresh reads Uptime Kuma again', async (t) => {
  const w = await world(t, {
    config: { instance_1_url: URL_1, instance_1_api_key: API_KEY, language: 'fr' },
  });
  const before = w.kuma.requests.length;
  const ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH, {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(w.kuma.requests.length, before + 1);
  assert.equal(ack.data.message.fr, 'Uptime Kuma relu.');
  const unknown = await w.fake.widgetAction(WIDGET_KEY, 'nope', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('two instances: each row names its instance, monitor names may repeat', async (t) => {
  const outside = new FakeKuma({
    apiKey: 'uk2_outside',
    monitors: [monitor({ id: 1, name: 'Nextcloud', status: 0 })],
  });
  const w = await world(t, {
    instances: { [URL_1]: new FakeKuma(), 'https://198.51.100.20': outside },
    config: {
      instance_1_url: URL_1,
      instance_1_api_key: API_KEY,
      instance_1_name: 'Home',
      instance_2_url: 'https://198.51.100.20',
      instance_2_api_key: 'uk2_outside',
      instance_2_name: 'Outside',
    },
  });
  assert.deepEqual(rows(await content(w)).slice(0, 2), [
    ['Nextcloud (Outside)', 'Down', 'danger'],
    ['Jellyfin (Home)', '4 ms', 'success'],
  ]);
  const ack = await w.fake.sceneAction('count_down_services', {});
  assert.equal(ack.data.outputs.names, 'Nextcloud (Outside)');
});
