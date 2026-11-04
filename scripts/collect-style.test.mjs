import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectStyle, styleSummary, readStyleSamples } from './collect-style.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Synthetic wording only; no private examples are stored in this test.
const pair = { id: 'fixture', rubric: 'личное', original: 'SYNTHETIC BEFORE', edited: 'SYNTHETIC AFTER', editedAt: '2026-11-04T12:00:00.000Z' };
const endpoint = 'https://example.com/api/ter/style-samples';

test('collector authenticates with a header and returns only validated changed pairs', async () => {
  const result = await collectStyle({ endpoint, key: 'test-key', fetcher: async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.headers['x-ter-style-key'], 'test-key');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ items: [{ ...pair, unwanted: 'private state' }] }) };
  } });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.items, [pair]);
});

test('missing endpoint or key skips collection without requesting anything', async () => {
  for (const options of [{ endpoint }, { key: 'test-key' }, {}]) {
    const result = await collectStyle({ ...options, fetcher: () => assert.fail('must not fetch') });
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.items, []);
  }
});

test('timeouts, HTTP errors, malformed JSON and invalid pairs are optional failures', async () => {
  const fetchers = [
    async () => { throw new DOMException('SECRET RESPONSE', 'TimeoutError'); },
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: true, json: async () => { throw new Error('SECRET RESPONSE'); } }),
    async () => ({ ok: true, json: async () => ({ items: [{ ...pair, edited: pair.original }] }) }),
    async () => ({ ok: true, json: async () => ({ items: [{ ...pair, editedAt: 'bad' }] }) }),
    async () => ({ ok: true, json: async () => ({ items: 'bad' }) }),
  ];
  for (const fetcher of fetchers) {
    const result = await collectStyle({ endpoint, key: 'test-key', fetcher });
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.items, []);
    assert.doesNotMatch(JSON.stringify(result), /SECRET RESPONSE/);
  }
});

test('bounded timeout covers stalled response body too', async () => {
  const result = await collectStyle({ endpoint, key: 'test-key', timeoutMs: 10, fetcher: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'timeout');
});

test('summary exposes only counts and clearly states skipped analysis', async () => {
  const success = await collectStyle({ endpoint, key: 'test-key', fetcher: async () => ({ ok: true, json: async () => ({ items: [pair] }) }) });
  assert.match(styleSummary(success), /1/);
  for (const result of [success, { status: 'unavailable', items: [], reason: pair.original }, { status: 'ok', items: [] }]) {
    assert.doesNotMatch(styleSummary(result), /SYNTHETIC|fixture|личное|2026-11-04/);
  }
  assert.match(styleSummary({ status: 'unavailable', items: [] }), /анализ правок пропущен/i);
  assert.match(styleSummary({ status: 'ok', items: [] }), /анализ правок пропущен/i);
});

test('generator reads optional validated snapshots and ignores absent or damaged files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ter-style-test-'));
  try {
    const path = join(dir, 'style.json');
    assert.deepEqual(readStyleSamples(), []);
    assert.deepEqual(readStyleSamples(path), []);
    writeFileSync(path, 'invalid');
    assert.deepEqual(readStyleSamples(path), []);
    writeFileSync(path, JSON.stringify({ status: 'ok', items: [pair] }));
    assert.deepEqual(readStyleSamples(path), [pair]);
    writeFileSync(path, JSON.stringify({ status: 'ok', items: [{ ...pair, edited: '' }] }));
    assert.deepEqual(readStyleSamples(path), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
