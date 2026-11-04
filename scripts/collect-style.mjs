// Optional private edit samples: never log response bodies or exception messages.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

function validatedItems(payload) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length > 50) throw new Error('invalid');
  return payload.items.map(item => {
    if (!item || !['id', 'rubric', 'original', 'edited', 'editedAt'].every(field => typeof item[field] === 'string' && item[field].trim())
      || item.original === item.edited || !Number.isFinite(Date.parse(item.editedAt))
      || item.original.length > 10000 || item.edited.length > 10000) throw new Error('invalid');
    return Object.fromEntries(['id', 'rubric', 'original', 'edited', 'editedAt'].map(field => [field, item[field]]));
  });
}

export async function collectStyle({ endpoint, key, fetcher = fetch, timeoutMs = 15000 } = {}) {
  const unavailable = reason => ({ status: 'unavailable', reason, items: [] });
  if (!endpoint || !key) return unavailable('not-configured');
  // Do not send the dedicated secret to an insecure URL or across redirects.
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return unavailable('invalid-endpoint');
  } catch { return unavailable('invalid-endpoint'); }
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    const request = async () => {
      const response = await fetcher(endpoint, { method: 'GET', headers: { 'x-ter-style-key': key, accept: 'application/json' }, redirect: 'error', signal: controller.signal });
      if (!response.ok) return unavailable('http');
      return { status: 'ok', items: validatedItems(await response.json()) };
    };
    return await Promise.race([request(), timeout]);
  } catch {
    return unavailable(controller.signal.aborted ? 'timeout' : 'invalid-or-unreachable');
  } finally { clearTimeout(timer); }
}

export function styleSummary(result) {
  return result?.status === 'ok' && result.items?.length
    ? `### Стиль @ter_cars\nПолучено пар правок для анализа в запросе генерации: **${result.items.length}**.`
    : '### Стиль @ter_cars\nАнализ правок пропущен; используется голос из plan/11_голос_маши.md.';
}

export function readStyleSamples(file) {
  if (!file) return [];
  try {
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    return snapshot.status === 'ok' ? validatedItems(snapshot) : [];
  } catch { return []; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await collectStyle({ endpoint: process.env.TER_STYLE_ENDPOINT, key: process.env.TER_STYLE_KEY });
  const summary = styleSummary(result);
  const output = process.argv[2] || process.env.TER_STYLE_FILE;
  let stored = false;
  if (output) {
    try {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, `${JSON.stringify(result)}\n`, { mode: 0o600 });
      stored = true;
    } catch { /* Optional collection must never block daily drafts. */ }
  }
  const message = stored ? summary : styleSummary({ status: 'unavailable', items: [] });
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`, { flag: 'a' }); }
    catch { /* Logging failure must not expose the snapshot or block drafting. */ }
  }
}
