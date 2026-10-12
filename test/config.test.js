import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hostOf, normalizeConfig, parseInstanceUrl } from '../src/config.js';

test('instance addresses: bare host, port, HTTPS, URL copied from the browser', () => {
  assert.equal(parseInstanceUrl('192.0.2.10:3001'), 'http://192.0.2.10:3001');
  assert.equal(parseInstanceUrl(' http://192.0.2.10:3001/dashboard '), 'http://192.0.2.10:3001');
  assert.equal(parseInstanceUrl('http://192.0.2.10:3001/dashboard/12'), 'http://192.0.2.10:3001');
  assert.equal(parseInstanceUrl('https://kuma.example.com/'), 'https://kuma.example.com');
  assert.equal(parseInstanceUrl('https://kuma.example.com/metrics'), 'https://kuma.example.com');
  assert.equal(
    parseInstanceUrl('https://kuma.example.com/status/home'),
    'https://kuma.example.com',
  );
  assert.equal(
    parseInstanceUrl('HTTPS://198.51.100.20:8443/settings/api-keys'),
    'https://198.51.100.20:8443',
  );
  assert.equal(parseInstanceUrl('[2001:db8::1]:3001'), 'http://[2001:db8::1]:3001');
  assert.equal(hostOf('https://kuma.example.com:8443'), 'kuma.example.com:8443');
});

test('a reverse proxy sub-path is kept', () => {
  assert.equal(
    parseInstanceUrl('https://example.com/uptime/dashboard'),
    'https://example.com/uptime',
  );
  assert.equal(parseInstanceUrl('https://example.com/uptime/'), 'https://example.com/uptime');
});

test('unusable addresses are refused', () => {
  for (const raw of [
    '',
    '   ',
    'ftp://192.0.2.10',
    'http://',
    'http://user:pass@192.0.2.10',
    'http://:key@192.0.2.10',
    42,
    null,
  ]) {
    assert.equal(parseInstanceUrl(raw), null, String(raw));
  }
});

test('defaults: no instance, 30 seconds, a 14-day certificate warning, French', () => {
  assert.deepEqual(normalizeConfig(), {
    instances: [],
    invalidSlots: [],
    allowSelfSigned: false,
    pollIntervalMs: 30_000,
    certWarningDays: 14,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig());
  assert.deepEqual(normalizeConfig(null), normalizeConfig());
});

test('instances by slot, with name and trimmed key, invalid slots reported', () => {
  const config = normalizeConfig({
    instance_1_url: '192.0.2.10:3001',
    instance_1_api_key: ' uk1_abc \n',
    instance_1_name: '  Home  ',
    instance_2_url: 'not a url at all',
    allow_self_signed: true,
    poll_interval: '300',
    cert_warning_days: '30',
    language: 'de',
  });
  assert.deepEqual(config.instances, [
    { slot: 1, url: 'http://192.0.2.10:3001', apiKey: 'uk1_abc', name: 'Home' },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.certWarningDays, 30);
  assert.equal(config.language, 'de');
});

test('unknown choices fall back to the defaults, numbers are accepted as strings', () => {
  const config = normalizeConfig({
    instance_2_url: 'https://198.51.100.20',
    poll_interval: 60,
    cert_warning_days: '3',
    language: 'it',
    allow_self_signed: 'yes',
  });
  assert.deepEqual(config.instances, [
    { slot: 2, url: 'https://198.51.100.20', apiKey: '', name: null },
  ]);
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.certWarningDays, 14);
  assert.equal(config.language, 'fr');
  assert.equal(config.allowSelfSigned, false);
});

test('a long instance name is cut to 40 characters', () => {
  const config = normalizeConfig({ instance_1_url: '192.0.2.10', instance_1_name: 'x'.repeat(80) });
  assert.equal(config.instances[0].name.length, 40);
});
