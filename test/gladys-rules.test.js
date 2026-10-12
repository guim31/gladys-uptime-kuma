// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of Uptime Kuma 1.23.17 and 2.5.6 and the pythonkuma fixture (HTTP,
// keyword, JSON query, TCP, group and unknown monitor types, with and without
// certificate), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const FIXTURES = ['v1-1.23.17.txt', 'v2-2.5.6.txt', 'pythonkuma-metrics.txt'];
const bodies = await Promise.all(
  FIXTURES.map((name) => readFile(new URL(`./fixtures/kuma/${name}`, import.meta.url), 'utf8')),
);

// Instance 1 serves one fixture, instance 2 another: every monitor of the
// three fixtures is discovered.
async function discover(language, [first, second]) {
  const bases = { 'http://192.0.2.10:3001': first, 'https://198.51.100.20': second };
  const gladys = createFakeGladys({
    config: {
      instance_1_url: 'http://192.0.2.10:3001',
      instance_1_api_key: 'uk1_x',
      instance_2_url: 'https://198.51.100.20',
      instance_2_api_key: 'uk2_x',
      language,
    },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-uptime-kuma-rules-'))),
    timers: false,
    request: async (url) => ({
      status: 200,
      headers: {},
      body: bases[url.replace(/\/metrics$/, '')],
    }),
  });
  await gladys.connect();
  await app.ready;
  await app.stop();
  return gladys.fake.discoveredDevices;
}

const scenarios = [
  { label: '1.x and 2.x, English names', language: 'en', bodies: [bodies[0], bodies[1]] },
  { label: 'pythonkuma, French names', language: 'fr', bodies: [bodies[2], bodies[0]] },
  { label: '2.x and pythonkuma, German names', language: 'de', bodies: [bodies[1], bodies[2]] },
  { label: '1.x and pythonkuma, Spanish names', language: 'es', bodies: [bodies[0], bodies[2]] },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const devices = await discover(scenario.language, scenario.bodies);
    assert.ok(devices.length >= 10, `expected the fixture monitors, got ${devices.length}`);
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
