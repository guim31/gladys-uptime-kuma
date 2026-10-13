// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Uptime Kuma instances on
// a fake network, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs: the tests read the
// instances with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { monitorIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_KEY, FakeKuma, createNetwork, monitor } from './fakeKuma.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = 'http://192.0.2.10:3001';
export const URL_2 = 'https://198.51.100.20';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 12, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, FakeKuma>} [options.instances] by base URL
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] the hub's own reading timer (mock them first)
 */
export async function createWorld({
  clock = createClock(),
  instances,
  config = {
    instance_1_url: URL_1,
    instance_1_api_key: API_KEY,
    instance_1_name: 'Home',
    language: 'en',
  },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-uptime-kuma-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(instances ?? { [URL_1]: new FakeKuma() });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, clock, dataDir };
}

/** External id of the device of a monitor (2.x key by default). */
export const deviceId = (gladys, id, slot = 1) => monitorIds(gladys, slot, `m${id}`).device;
export const featureId = (gladys, id, feature, slot = 1) =>
  monitorIds(gladys, slot, `m${id}`).feature(feature);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_KEY, FakeKuma, monitor };
