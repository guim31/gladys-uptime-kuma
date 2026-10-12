// -----------------------------------------------------------------------------
// The client: the API key in HTTP Basic (empty user name), and every error
// sorted by kind, the way the connection status and the scene events need it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, KumaClient } from '../src/kuma/client.js';
import { API_KEY, FakeKuma, createNetwork } from './helpers/fakeKuma.js';

const URL = 'http://192.0.2.10:3001';

function client(kuma, options = {}) {
  const network = createNetwork({ [URL]: kuma });
  return new KumaClient({ url: URL, apiKey: API_KEY, request: network.request, ...options });
}

const rejectsWith = (promise, kind) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    assert.ok(!err.message.includes(API_KEY), 'the key never reaches a message');
    return true;
  });

test('reads the monitors with the API key as Basic password, user name empty', async () => {
  const kuma = new FakeKuma();
  const { version, major, monitors } = await client(kuma).metrics();
  assert.equal(version, '2.5.6');
  assert.equal(major, 2);
  assert.deepEqual(
    monitors.map((m) => m.name),
    ['Nextcloud', 'Jellyfin', 'NAS SSH'],
  );
  const [request] = kuma.requests;
  assert.equal(request.url, `${URL}/metrics`);
  assert.equal(
    Buffer.from(request.headers.authorization.replace('Basic ', ''), 'base64').toString(),
    `:${API_KEY}`,
  );
});

test('no key: no Authorization header (authentication disabled in Uptime Kuma)', async () => {
  const kuma = new FakeKuma({ apiKey: null });
  await client(kuma, { apiKey: '' }).metrics();
  assert.equal(kuma.requests[0].headers.authorization, undefined);
});

test('a refused key, a missing key', async () => {
  await rejectsWith(client(new FakeKuma({ apiKey: 'uk2_other' })).metrics(), ERROR_KINDS.AUTH);
  await rejectsWith(client(new FakeKuma(), { apiKey: '' }).metrics(), ERROR_KINDS.KEY_MISSING);
});

test('silence, redirects, other services, HTTP errors', async () => {
  const kuma = new FakeKuma();
  kuma.failure = 'down';
  await rejectsWith(client(kuma).metrics(), ERROR_KINDS.UNREACHABLE);
  await rejectsWith(
    new KumaClient({ url: 'http://198.51.100.99', request: createNetwork().request }).metrics(),
    ERROR_KINDS.UNREACHABLE,
  );
  kuma.failure = 301;
  await assert.rejects(client(kuma).metrics(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.REDIRECT);
    assert.equal(err.location, 'https://kuma.example.com/');
    return true;
  });
  // Another service, or Uptime Kuma 2 waiting for its database setup.
  kuma.failure = 'html';
  await rejectsWith(client(kuma).metrics(), ERROR_KINDS.NOT_KUMA);
  kuma.failure = 404;
  await rejectsWith(client(kuma).metrics(), ERROR_KINDS.NOT_KUMA);
  kuma.failure = 500;
  await rejectsWith(client(kuma).metrics(), ERROR_KINDS.HTTP);
});

test('a certificate that does not verify is a TLS error, the rest is silence', async () => {
  const failing = (code) => async () => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
  for (const code of ['DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED']) {
    await rejectsWith(
      new KumaClient({ url: URL, request: failing(code) }).metrics(),
      ERROR_KINDS.TLS,
    );
  }
  await rejectsWith(
    new KumaClient({ url: URL, request: failing('ETIMEDOUT') }).metrics(),
    ERROR_KINDS.UNREACHABLE,
  );
});

test('the self-signed option and the timeout reach the transport', async () => {
  let seen;
  const request = async (url, options) => {
    seen = options;
    return { status: 200, headers: {}, body: new FakeKuma().render() };
  };
  await new KumaClient({ url: URL, request, insecure: true, timeoutMs: 5000 }).metrics();
  assert.equal(seen.insecure, true);
  assert.equal(seen.timeoutMs, 5000);
});
