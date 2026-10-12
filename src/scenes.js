// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is this service up?" is already a scene condition on the device feature.
// These two actions are about what a condition cannot do: put the state in a
// message ("Nextcloud: down"), and count the services down across every
// monitor, added to Gladys or not ("3 services down: …"). Both read Uptime
// Kuma again when the last read is older than 15 seconds.
// -----------------------------------------------------------------------------

import { statusKey } from './hub.js';
import { STATUS } from './kuma/metrics.js';
import { ACTION_TEXT, ERROR_TEXT, STATUS_TEXT, labelled, pick } from './texts.js';

// Names listed in the `names` output, at most (the rest is counted).
export const MAX_LISTED_NAMES = 20;

export const SCENE_ACTIONS = {
  async get_monitor_status(hub, { fields = {} }) {
    hub.assertReadable();
    const language = hub.config.language;
    const found = hub.find(fields.device);
    if (!found) {
      throw new Error(pick(ACTION_TEXT.unknownMonitor, language));
    }
    await hub.refreshIfStale();
    const { record, monitor } = hub.find(fields.device);
    if (record.error) {
      throw new Error(
        labelled(hub.instanceName(record), pick(ERROR_TEXT[record.error.kind], language), language),
      );
    }
    const outputs = {
      up: monitor?.status === STATUS.UP,
      status: pick(STATUS_TEXT[statusKey(monitor)], language),
    };
    if (monitor) {
      outputs.name = monitor.name;
      if (monitor.status === STATUS.UP && monitor.responseTime !== null) {
        outputs.response_time = monitor.responseTime;
      }
      if (monitor.certDays !== null) {
        outputs.certificate_days = monitor.certDays;
      }
    }
    return outputs;
  },

  async count_down_services(hub) {
    hub.assertReadable();
    await hub.refreshIfStale();
    const readable = [...hub.records.values()].filter((record) => !record.error);
    if (readable.length === 0) {
      throw new Error(pick(ACTION_TEXT.unreachable, hub.config.language));
    }
    const monitors = hub
      .counted()
      .filter(({ record }) => !record.error)
      .map(({ monitor }) => monitor);
    const down = monitors
      .filter((monitor) => monitor.status === STATUS.DOWN)
      .map((monitor) => monitor.name)
      .sort((a, b) => a.localeCompare(b));
    const listed = down.slice(0, MAX_LISTED_NAMES);
    return {
      down: down.length,
      up: monitors.filter((monitor) => monitor.status === STATUS.UP).length,
      total: monitors.length,
      names:
        down.length > listed.length
          ? `${listed.join(', ')}, +${down.length - listed.length}`
          : listed.join(', '),
    };
  },
};
