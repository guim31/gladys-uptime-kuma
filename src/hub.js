// -----------------------------------------------------------------------------
// The Uptime Kuma hub: one record per configured instance, read on a timer of
// the container (the interval chosen in the configuration); the monitors'
// states published to Gladys when they change, the scene events fired on
// transitions, and the views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core scheduler,
// and the scene events must fire for every monitor, added to Gladys or not —
// "a service goes down" is what spares the user one scene per device.
//
// Transitions are kept in /data (src/store.js): a service that went down
// while the integration or Gladys restarted is still announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, buildDevice, featureValues, monitorIds, parseDeviceId } from './devices.js';
import { ERROR_KINDS, KumaClient } from './kuma/client.js';
import { STATUS, nameKey } from './kuma/metrics.js';
import { hostOf } from './config.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'uptime-kuma-hub' });

export const WIDGET_KEY = 'uptime_kuma';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  DOWN: 'service_down',
  UP: 'service_up',
  CERTIFICATE: 'certificate_expiring',
  UNREACHABLE: 'instance_unreachable',
});

// The settled state of a monitor, the one transitions are computed on:
// "pending" (a failed check being retried) is not a state of its own.
export const SETTLED = Object.freeze({ UP: 'up', DOWN: 'down', MAINTENANCE: 'maintenance' });

export const HUB_TIMINGS = {
  // An instance that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before an instance counts as unreachable (scene event).
  downAfterFailures: 2,
  // A response time changes at every check: published at most this often per
  // monitor, so a hundred monitors stay far below the 300 states per minute
  // Gladys accepts.
  responseTimeEveryMs: 60_000,
  // A scene action reads Uptime Kuma again when the last read is older.
  freshMs: 15_000,
  // A monitor absent from /metrics (paused, deleted) is forgotten after a week.
  forgetAfterMs: 7 * 24 * 3600_000,
};

const MAX_STATES_PER_REQUEST = 100;
const MAX_TRANSPORTS_PER_REQUEST = 100;

const signature = (instance, config) =>
  JSON.stringify([instance.url, instance.apiKey, config.allowSelfSigned]);

/** The settled state of a monitor status, null when it does not settle anything. */
export function settledOf(status) {
  if (status === STATUS.UP) {
    return SETTLED.UP;
  }
  if (status === STATUS.DOWN) {
    return SETTLED.DOWN;
  }
  if (status === STATUS.MAINTENANCE) {
    return SETTLED.MAINTENANCE;
  }
  return null;
}

/** The state of a monitor in words, as a key of STATUS_TEXT. */
export function statusKey(monitor) {
  if (!monitor) {
    return 'paused';
  }
  switch (monitor.status) {
    case STATUS.UP:
      return 'up';
    case STATUS.DOWN:
      return 'down';
    case STATUS.PENDING:
      return 'pending';
    case STATUS.MAINTENANCE:
      return 'maintenance';
    default:
      return 'unknown';
  }
}

export class KumaHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/kuma/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} instance records, by slot */
    this.records = new Map();
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { monitors: {}, certificates: {}, aliases: {} };
    this.pollTimer = null;
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = {
      monitors: object(saved.monitors),
      certificates: object(saved.certificates),
      aliases: object(saved.aliases),
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    const wanted = new Map(config.instances.map((instance) => [instance.slot, instance]));
    for (const [slot, record] of this.records) {
      const instance = wanted.get(slot);
      if (!instance || record.signature !== signature(instance, config)) {
        this.dropRecord(record);
        this.records.delete(slot);
      }
    }
    this.forgetSlots(new Set(wanted.keys()));
    for (const instance of config.instances) {
      const record = this.records.get(instance.slot);
      if (record) {
        record.instance = instance; // a new name only
      } else {
        this.records.set(instance.slot, this.newRecord(instance, config));
      }
    }
    if (languageChanged) {
      this.discovered = null;
    }
    await this.pollAll({ publish: true });
    this.schedulePoll();
  }

  newRecord(instance, config) {
    return {
      instance,
      signature: signature(instance, config),
      client: new KumaClient({
        url: instance.url,
        apiKey: instance.apiKey,
        insecure: config.allowSelfSigned,
        request: this.request,
      }),
      version: null,
      /** @type {Map<string, object>} monitors of the last read, by device key */
      monitors: new Map(),
      readAt: 0,
      error: null,
      failures: 0,
      down: false,
      polling: null,
      retryTimer: null,
      dropped: false,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
      } catch (err) {
        logger.error('Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Identities ----------------------------------------------------------------

  isCreated(slot, key) {
    const externalId = monitorIds(this.gladys, slot, key).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /**
   * The device key of a monitor. Uptime Kuma 1.x has no monitor id: its
   * devices are keyed on the name. After an upgrade to 2.x, a monitor whose
   * 1.x device the user created keeps that device (and its history, scenes,
   * dashboards) instead of being proposed again under its new id.
   */
  deviceKey(slot, monitor) {
    if (monitor.id === null) {
      return monitor.key;
    }
    const aliasId = `${slot}:${monitor.key}`;
    const alias = this.saved.aliases[aliasId];
    if (alias) {
      return alias;
    }
    const legacy = nameKey(monitor.name);
    if (this.isCreated(slot, legacy) && !this.isCreated(slot, monitor.key)) {
      logger.info(`Monitor "${monitor.name}" keeps its Uptime Kuma 1.x device`);
      this.saved.aliases[aliasId] = legacy;
      this.store.save(this.saved);
      return legacy;
    }
    return monitor.key;
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    const devices = [];
    for (const record of [...this.records.values()].sort(
      (a, b) => a.instance.slot - b.instance.slot,
    )) {
      for (const [key, monitor] of record.monitors) {
        devices.push(
          buildDevice(this.gladys, record.instance.slot, key, monitor, this.config.language),
        );
      }
    }
    return devices;
  }

  /** Publish the Discovery list when it changed (a monitor added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale monitor.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
    } catch (err) {
      logger.warn(`Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the instances, publish the list again. */
  async rediscover() {
    await this.pollAll();
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const found = this.find(device.external_id);
    if (!found?.monitor) {
      return;
    }
    await this.publishMonitorStates(found.record, found.key, found.monitor, { force: true });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the instances -------------------------------------------------------

  async pollAll({ publish = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record)));
    await this.afterChanges(changes.some(Boolean), { publish });
  }

  /** Gladys asks for a refresh (onPoll): read that instance now. */
  async pollDevice(device) {
    const found = this.find(device.external_id);
    if (found) {
      await this.afterChanges(await this.poll(found.record));
    }
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    const stale = [...this.records.values()].filter(
      (record) => this.now() - record.readAt >= this.timings.freshMs,
    );
    if (stale.length > 0) {
      const changes = await Promise.all(stale.map((record) => this.poll(record)));
      await this.afterChanges(changes.some(Boolean));
    }
  }

  /**
   * Read one instance and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    try {
      return await this.applySuccess(record, await record.client.metrics());
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  label(record) {
    return `Uptime Kuma ${record.instance.slot} (${this.instanceName(record)})`;
  }

  instanceName(record) {
    return record.instance.name ?? hostOf(record.instance.url);
  }

  /** A monitor in a list: with its instance when two are configured (names may repeat). */
  displayName(record, name) {
    return this.records.size > 1 ? `${name} (${this.instanceName(record)})` : name;
  }

  async applySuccess(record, { version, monitors }) {
    if (record.dropped) {
      return false;
    }
    const { slot } = record.instance;
    let widgetChanged = record.error !== null || record.readAt === 0;
    if (record.error) {
      logger.info(`${this.label(record)} answers again`);
    }
    if (version && version !== record.version) {
      logger.info(`${this.label(record)}: Uptime Kuma ${version}, ${monitors.length} monitor(s)`);
    }
    record.version = version;
    record.failures = 0;
    record.down = false;
    record.error = null;
    record.readAt = this.now();

    const next = new Map();
    for (const monitor of monitors) {
      const key = this.deviceKey(slot, monitor);
      if (next.has(key)) {
        continue; // an alias already taken by another monitor: keep the first
      }
      next.set(key, monitor);
      const previous = record.monitors.get(key);
      if (statusKey(previous) !== statusKey(monitor) || previous.name !== monitor.name) {
        widgetChanged = true;
      }
      await this.transition(record, key, monitor);
    }
    for (const key of record.monitors.keys()) {
      if (!next.has(key)) {
        widgetChanged = true; // paused or deleted
      }
    }
    record.monitors = next;
    this.forgetStale();
    this.store.save(this.saved);

    for (const [key, monitor] of next) {
      await this.publishMonitorStates(record, key, monitor);
    }
    return widgetChanged;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    }
    // Only silence counts as unreachable: a refused key is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.fireEvent(TRIGGERS.UNREACHABLE, {
        instance: this.instanceName(record),
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .catch((err) => logger.error('Retry failed', err));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  /** Compare a monitor with its last settled state; fire the scene events. */
  async transition(record, key, monitor) {
    const id = `${record.instance.slot}:${key}`;
    const now = this.now();
    const previous = this.saved.monitors[id];
    const settled = settledOf(monitor.status);
    if (settled === null) {
      // Pending or unknown: nothing settles, the last state stands.
      if (previous) {
        previous.seenAt = now;
      }
    } else if (!previous || previous.status === settled) {
      this.saved.monitors[id] = { status: settled, since: previous?.since ?? now, seenAt: now };
    } else {
      this.saved.monitors[id] = { status: settled, since: now, seenAt: now };
      if (settled === SETTLED.DOWN) {
        logger.info(`${monitor.name} is down`);
        await this.fireMonitor(TRIGGERS.DOWN, record, key, monitor);
      } else if (settled === SETTLED.UP && previous.status === SETTLED.DOWN) {
        const minutes = Math.max(0, Math.round((now - previous.since) / 60_000));
        logger.info(`${monitor.name} is up again after ${minutes} min`);
        await this.fireMonitor(TRIGGERS.UP, record, key, monitor, {
          downtime_minutes: minutes,
          response_time: monitor.responseTime ?? 0,
        });
      }
    }

    // The certificate: announced once when it crosses the threshold, again
    // only after a renewal took it back above.
    if (monitor.certDays !== null) {
      const soon = monitor.certDays <= this.config.certWarningDays;
      if (soon && !this.saved.certificates[id]) {
        this.saved.certificates[id] = true;
        logger.info(`${monitor.name}: certificate expires in ${monitor.certDays} day(s)`);
        await this.fireMonitor(TRIGGERS.CERTIFICATE, record, key, monitor, {
          days_remaining: monitor.certDays,
        });
      } else if (!soon && this.saved.certificates[id]) {
        delete this.saved.certificates[id];
      }
    }
  }

  /**
   * Forget what was kept of the slots left empty: another Uptime Kuma typed
   * there later must not inherit their states (an address changed in a slot
   * keeps them: it is usually the same Uptime Kuma).
   */
  forgetSlots(kept) {
    let changed = false;
    for (const table of Object.values(this.saved)) {
      for (const id of Object.keys(table)) {
        if (!kept.has(Number(id.split(':')[0]))) {
          delete table[id];
          changed = true;
        }
      }
    }
    if (changed) {
      this.store.save(this.saved);
    }
  }

  forgetStale() {
    const limit = this.now() - this.timings.forgetAfterMs;
    for (const [id, entry] of Object.entries(this.saved.monitors)) {
      if (!(entry?.seenAt >= limit)) {
        delete this.saved.monitors[id];
        delete this.saved.certificates[id];
      }
    }
  }

  fireMonitor(key, record, deviceKey, monitor, extra = {}) {
    return this.fireEvent(key, {
      device: monitorIds(this.gladys, record.instance.slot, deviceKey).device,
      monitor: monitor.name,
      type: monitor.type,
      url: monitor.target,
      instance: this.instanceName(record),
      ...extra,
    });
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of one monitor, when the user added its device. */
  async publishMonitorStates(record, key, monitor, { force = false } = {}) {
    const { slot } = record.instance;
    if (!this.isCreated(slot, key)) {
      return; // Gladys drops the states of a device not added
    }
    const now = this.now();
    const states = [];
    for (const { key: feature, externalId, value } of featureValues(
      this.gladys,
      slot,
      key,
      monitor,
    )) {
      if (value === null || (!force && this.published.get(externalId) === value)) {
        continue;
      }
      if (
        !force &&
        feature === FEATURE_KEYS.RESPONSE_TIME &&
        this.published.has(externalId) &&
        now - (this.publishedAt.get(externalId) ?? 0) < this.timings.responseTimeEveryMs
      ) {
        continue;
      }
      states.push({ device_feature_external_id: externalId, state: value });
    }
    await this.sendStates(states);
  }

  async sendStates(states) {
    for (let at = 0; at < states.length; at += MAX_STATES_PER_REQUEST) {
      const batch = states.slice(at, at + MAX_STATES_PER_REQUEST);
      try {
        await this.gladys.publishStates(batch);
        const now = this.now();
        for (const state of batch) {
          this.published.set(state.device_feature_external_id, state.state);
          this.publishedAt.set(state.device_feature_external_id, now);
        }
      } catch (err) {
        logger.warn(`States refused: ${err.message}`);
      }
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable" with their instance. */
  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.readAt === 0) {
        continue;
      }
      const transport =
        record.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      for (const key of record.monitors.keys()) {
        if (!this.isCreated(record.instance.slot, key)) {
          continue;
        }
        const externalId = monitorIds(this.gladys, record.instance.slot, key).device;
        if (this.transports.get(externalId) !== transport) {
          entries.push({ external_id: externalId, transport });
        }
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
      } catch (err) {
        logger.warn(`Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name: connected when every instance answers. */
  connectionStatus() {
    const { instances, invalidSlots } = this.config;
    if (instances.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noInstance,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noInstance)) {
      const parts = failing.map((record) =>
        labelled(
          this.instanceName(record),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    // Connected while one instance of two still answers.
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
    } catch (err) {
      logger.warn(`Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) --------------------------------------------

  /**
   * The monitor of a device external id.
   * @returns {{ record: object, key: string, monitor: object|null }|null}
   *   `monitor` null: the monitor is paused, deleted, or not read yet
   */
  find(externalId) {
    const parsed = parseDeviceId(this.gladys, externalId);
    const record = parsed ? this.records.get(parsed.slot) : null;
    if (!record) {
      return null;
    }
    return { record, key: parsed.key, monitor: record.monitors.get(parsed.key) ?? null };
  }

  /** Every monitor read, instance by instance. */
  entries() {
    const list = [];
    for (const record of this.records.values()) {
      for (const [key, monitor] of record.monitors) {
        list.push({
          record,
          key,
          monitor,
          externalId: monitorIds(this.gladys, record.instance.slot, key).device,
        });
      }
    }
    return list;
  }

  /** The monitors that count in the totals: groups repeat their members, they do not. */
  counted() {
    return this.entries().filter(({ monitor }) => monitor.type !== 'group');
  }

  /** "Test the connection": read every instance now, one line each. */
  async testConnection() {
    await this.pollAll({ publish: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = this.instanceName(record);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const monitors = [...record.monitors.values()].filter((m) => m.type !== 'group');
        const parts = [text.ok];
        if (record.version) {
          parts.push(`Uptime Kuma ${record.version}`);
        }
        parts.push(text.monitors(monitors.length));
        const down = monitors.filter((monitor) => monitor.status === STATUS.DOWN).length;
        if (down > 0) {
          parts.push(text.down(down));
        }
        return labelled(name, parts.join(', '), language);
      });
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** Throws the reason no instance can answer a scene action, if any. */
  assertReadable() {
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noInstance, this.config?.language));
    }
  }
}
