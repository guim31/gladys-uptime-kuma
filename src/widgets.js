// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `uptime_kuma`.
//
// The use case: a glance at the wall tablet tells whether every self-hosted
// service is up, and which one is not. So the widget shows the number of
// services down and up, the certificate that expires first, and one row per
// monitor — the problems first — with a dot, the state and the response time.
//
// Every monitor by default (group monitors left out: they repeat their
// members), or the ones chosen in the widget settings (devices added to
// Gladys, groups included when chosen). The figures are sent as values, not
// bound to device features: the widget works before the devices are added
// and spans both instances.
//
// Budget (8 components, 6 tiles, 2 texts, 1 status, 4 buttons): three tiles,
// one status list of ten rows at most, one text for an instance that does
// not answer, and a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY, statusKey } from './hub.js';
import { STATUS } from './kuma/metrics.js';
import { ERROR_TEXT, STATUS_TEXT, labelled, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address of your Uptime Kuma in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Uptime Kuma dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Uptime Kuma in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Uptime Kuma en la configuración de la integración.',
  },
  empty: {
    en: 'No monitor yet: add one in Uptime Kuma.',
    fr: 'Aucune sonde pour le moment : ajoutez-en une dans Uptime Kuma.',
    de: 'Noch kein Monitor: Füge einen in Uptime Kuma hinzu.',
    es: 'Todavía no hay ningún monitor: añada uno en Uptime Kuma.',
  },
  down: { en: 'Down', fr: 'Hors service', de: 'Ausgefallen', es: 'Caídos' },
  up: { en: 'Up', fr: 'En service', de: 'In Betrieb', es: 'En servicio' },
  certificate: { en: 'Certificate', fr: 'Certificat', de: 'Zertifikat', es: 'Certificado' },
  days: { en: 'days', fr: 'j', de: 'Tage', es: 'días' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Uptime Kuma read again.',
    fr: 'Uptime Kuma relu.',
    de: 'Uptime Kuma neu gelesen.',
    es: 'Uptime Kuma leído de nuevo.',
  },
};

// Row order: what needs attention first.
const SEVERITY = ['down', 'unreachable', 'pending', 'maintenance', 'paused', 'unknown', 'up'];

const ROW_STYLE = {
  up: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
  down: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  unreachable: { icon: 'alert-triangle', color: WIDGET_COLORS.DANGER },
  pending: { icon: 'clock', color: WIDGET_COLORS.WARNING },
  maintenance: { icon: 'tool', color: WIDGET_COLORS.INFO },
  paused: { icon: 'pause-circle', color: WIDGET_COLORS.NEUTRAL },
  unknown: { icon: 'help-circle', color: WIDGET_COLORS.NEUTRAL },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The monitors the widget shows: the chosen devices, or every counted monitor. */
export function selectRows(hub, settings) {
  const chosen = [settings?.monitors ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return hub.counted().map(({ record, monitor }) => ({
      record,
      monitor,
      name: monitor.name,
      state: record.error ? 'unreachable' : statusKey(monitor),
    }));
  }
  const rows = [];
  for (const externalId of new Set(chosen)) {
    const found = hub.find(externalId);
    if (!found) {
      continue; // its instance left the configuration
    }
    const device = (hub.gladys.devices ?? []).find((d) => d.external_id === externalId);
    rows.push({
      record: found.record,
      monitor: found.monitor,
      name: found.monitor?.name ?? device?.name ?? '?',
      state: found.record.error ? 'unreachable' : statusKey(found.monitor),
    });
  }
  return rows;
}

function rowValue(row, language) {
  if (
    row.state === 'up' &&
    row.monitor?.responseTime !== null &&
    row.monitor?.responseTime !== undefined
  ) {
    return `${row.monitor.responseTime} ms`;
  }
  if (row.state === 'unreachable') {
    return t(TEXT.unreachable, language);
  }
  return t(STATUS_TEXT[row.state], language);
}

export function sortRows(rows) {
  return [...rows].sort(
    (a, b) => SEVERITY.indexOf(a.state) - SEVERITY.indexOf(b.state) || a.name.localeCompare(b.name),
  );
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.records.size === 0) {
    return message(TEXT.pick, language);
  }
  const rows = sortRows(selectRows(hub, settings));
  const failing = [...hub.records.values()].filter((record) => record.error);
  if (rows.length === 0 && failing.length === 0) {
    return message(TEXT.empty, language);
  }

  const components = [];
  const down = rows.filter((row) => row.state === 'down').length;
  const up = rows.filter((row) => row.state === 'up').length;
  components.push(
    {
      type: 'value',
      value: down,
      label: t(TEXT.down, language),
      icon: 'x-circle',
      color: down > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: up,
      label: t(TEXT.up, language),
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    },
  );
  const certificates = rows
    .filter((row) => row.state !== 'unreachable' && typeof row.monitor?.certDays === 'number')
    .map((row) => row.monitor.certDays);
  if (certificates.length > 0) {
    const soonest = Math.min(...certificates);
    components.push({
      type: 'value',
      value: soonest,
      unit: t(TEXT.days, language),
      label: t(TEXT.certificate, language),
      icon: 'lock',
      color: soonest <= hub.config.certWarningDays ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }

  if (failing.length > 0) {
    components.push({
      type: 'text',
      variant: 'body',
      text: failing
        .map((record) =>
          labelled(hub.instanceName(record), t(ERROR_TEXT[record.error.kind], language), language),
        )
        .join('\n'),
    });
  }

  if (rows.length > 0) {
    const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS - 1) : rows;
    const items = shown.map((row) => ({
      label: fit(row.name, 40),
      value: fit(rowValue(row, language), 40),
      ...ROW_STYLE[row.state],
    }));
    if (rows.length > shown.length) {
      items.push({
        label: t(TEXT.more, language),
        value: `+${rows.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: t(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  // A service down or pending moves fast: refresh sooner.
  const moving = rows.some((row) => row.monitor && row.monitor.status !== STATUS.UP);
  return { ttl_seconds: moving || failing.length > 0 ? 30 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollAll();
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
