// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, monitor states
// in scene outputs, scene action errors. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './kuma/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noInstance: {
    en: 'Enter the address of your Uptime Kuma in the configuration.',
    fr: "Saisissez l'adresse de votre Uptime Kuma dans la configuration.",
    de: 'Gib die Adresse deines Uptime Kuma in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Uptime Kuma en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:3001',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:3001',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:3001',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:3001',
  },
};

// One short explanation per error kind (src/kuma/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused (or more than 60 API requests per minute)',
    fr: "clé d'API refusée (ou plus de 60 requêtes d'API par minute)",
    de: 'API-Schlüssel abgelehnt (oder mehr als 60 API-Anfragen pro Minute)',
    es: 'clave de API rechazada (o más de 60 peticiones de API por minuto)',
  },
  [ERROR_KINDS.KEY_MISSING]: {
    en: 'an API key is needed: create one in Settings → API Keys',
    fr: "une clé d'API est nécessaire : créez-la dans Paramètres → Clés API",
    de: 'ein API-Schlüssel ist nötig: Erstelle ihn unter Einstellungen → API-Schlüssel',
    es: 'se necesita una clave de API: créela en Ajustes → Claves API',
  },
  [ERROR_KINDS.NOT_KUMA]: {
    en: 'no Uptime Kuma at this address',
    fr: 'aucun Uptime Kuma à cette adresse',
    de: 'kein Uptime Kuma unter dieser Adresse',
    es: 'no hay ningún Uptime Kuma en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a monitor, in words (widget rows, scene outputs).
export const STATUS_TEXT = {
  up: { en: 'Up', fr: 'En service', de: 'In Betrieb', es: 'En servicio' },
  down: { en: 'Down', fr: 'Hors service', de: 'Ausgefallen', es: 'Caído' },
  pending: { en: 'Pending', fr: 'En attente', de: 'Ausstehend', es: 'Pendiente' },
  maintenance: {
    en: 'Maintenance',
    fr: 'Maintenance',
    de: 'Wartung',
    es: 'Mantenimiento',
  },
  paused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

// The "Test the connection" report, one line per instance.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    monitors: (count) => `${count} monitor(s)`,
    down: (count) => `${count} down`,
  },
  fr: {
    ok: 'OK',
    monitors: (count) => `${count} sonde(s)`,
    down: (count) => `${count} hors service`,
  },
  de: {
    ok: 'OK',
    monitors: (count) => `${count} Monitor(e)`,
    down: (count) => `${count} ausgefallen`,
  },
  es: {
    ok: 'OK',
    monitors: (count) => `${count} monitor(es)`,
    down: (count) => `${count} caído(s)`,
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  noInstance: {
    en: 'No Uptime Kuma is configured.',
    fr: "Aucun Uptime Kuma n'est configuré.",
    de: 'Kein Uptime Kuma ist konfiguriert.',
    es: 'No hay ningún Uptime Kuma configurado.',
  },
  unknownMonitor: {
    en: 'This device is not an Uptime Kuma monitor.',
    fr: "Cet appareil n'est pas une sonde Uptime Kuma.",
    de: 'Dieses Gerät ist kein Uptime-Kuma-Monitor.',
    es: 'Este dispositivo no es un monitor de Uptime Kuma.',
  },
  unreachable: {
    en: 'Uptime Kuma does not answer.',
    fr: 'Uptime Kuma ne répond pas.',
    de: 'Uptime Kuma antwortet nicht.',
    es: 'Uptime Kuma no responde.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
