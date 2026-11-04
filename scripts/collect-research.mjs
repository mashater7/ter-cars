// Fetches recent public automotive discussion and news signals for one daily draft run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const NOW = new Date();
const MAX_AGE_HOURS = 72;
const USER_AGENT = 'ter-cars-research/1.0 (+https://github.com/mashater7/ter-cars)';
const RELEVANT = /авто|автомобил|машин|водител|дорог|пдд|дилер|шины|шиномонтаж|двигател|ремонт|сервис|запчаст|аккумулятор|бензин|топлив|страхов|осаго|кредит|кроссовер|седан|внедорожник|lada|ваз|нива|haval|chery|geely|kia|hyundai|toyota|volvo|moskvich|москвич|китайц/iu;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const decodeEntities = text => String(text || '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|hellip|mdash|ndash|laquo|raquo|ldquo|rdquo|rsquo|lsquo|copy);/giu, (entity, code) => {
  if (code[0] === '#') {
    const value = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
  }
  return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', rsquo: '’', lsquo: '‘', copy: '©' })[code.toLowerCase()] || entity;
});

export const cleanHtml = html => decodeEntities(String(html || '')
  .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
  .replace(/<\s*br\s*\/?>/giu, ' ')
  .replace(/<\/(p|div|li|h[1-6])\s*>/giu, ' ')
  .replace(/<[^>]+>/gu, ' '))
  .replace(/[\u00a0\s]+/gu, ' ').replace(/\s+([,.;:!?])/gu, '$1').trim();

function decodeBody(buffer, contentType = '') {
  const charset = /charset\s*=\s*["']?([^;"'\s]+)/iu.exec(contentType)?.[1] || 'utf-8';
  try { return new TextDecoder(charset, { fatal: false }).decode(buffer); }
  catch { return new TextDecoder('utf-8', { fatal: false }).decode(buffer); }
}

export async function fetchPage(url, { timeoutMs = 15000, maxBytes = 2_000_000 } = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`ответ больше ${maxBytes} байт`);
  return { text: decodeBody(bytes, response.headers.get('content-type') || ''), url: response.url, fetchedAt: new Date().toISOString() };
}

function robotsRules(text) {
  const groups = [];
  let group = null, hasRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#', 1)[0].trim();
    if (!line) continue;
    const agent = /^user-agent\s*:\s*(.+)$/iu.exec(line);
    if (agent) {
      if (!group || hasRules) { group = { agents: [], rules: [], crawlDelay: 0 }; groups.push(group); hasRules = false; }
      group.agents.push(agent[1].trim().toLowerCase());
      continue;
    }
    if (!group) continue;
    const rule = /^(allow|disallow)\s*:\s*(.*)$/iu.exec(line);
    if (rule) { group.rules.push({ allow: rule[1].toLowerCase() === 'allow', path: rule[2].trim() }); hasRules = true; continue; }
    const delay = /^crawl-delay\s*:\s*(\d+(?:\.\d+)?)/iu.exec(line);
    if (delay) { group.crawlDelay = Math.max(group.crawlDelay, Number(delay[1])); hasRules = true; }
  }
  return groups;
}

export function robotsDecision(text, targetUrl) {
  const target = new URL(targetUrl);
  const groups = robotsRules(text).filter(g => g.agents.includes('*'));
  const rules = groups.flatMap(g => g.rules).filter(r => r.path);
  const matches = rules.filter(r => {
    const pattern = r.path.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*').replace(/\\\$$/u, '$');
    return new RegExp(`^${pattern}`, 'u').test(target.pathname + target.search);
  }).sort((a, b) => b.path.replace(/\*|\$/gu, '').length - a.path.replace(/\*|\$/gu, '').length);
  const delay = Math.max(0, ...groups.map(g => g.crawlDelay));
  return { allowed: matches.length === 0 || matches[0].allow, crawlDelaySeconds: delay, matchingRule: matches[0] || null };
}

async function fetchRobots(url) {
  const origin = new URL(url).origin;
  const robots = await fetchPage(`${origin}/robots.txt`, { timeoutMs: 12000, maxBytes: 256_000 });
  return robots.text;
}

function isFresh(dateString, maxAgeHours = MAX_AGE_HOURS, now = NOW) {
  const ms = Date.parse(dateString || '');
  if (!Number.isFinite(ms)) return false;
  const age = now.getTime() - ms;
  return age >= -6 * 3600_000 && age <= maxAgeHours * 3600_000;
}

function item(url, title, text, publishedAt, source, engagement = {}, now = NOW) {
  const cleanTitle = cleanHtml(title).slice(0, 300);
  const excerpt = cleanHtml(text).slice(0, 900);
  if (!cleanTitle || !excerpt || !RELEVANT.test(`${cleanTitle} ${excerpt}`) || !isFresh(publishedAt, MAX_AGE_HOURS, now)) return null;
  return { source, title: cleanTitle, excerpt, url, publishedAt: new Date(publishedAt).toISOString(), engagement };
}

export function parseTelegramPage(html, channel, fetchedAt = NOW.toISOString()) {
  const now = new Date(fetchedAt);
  const records = [];
  const blocks = String(html).match(/<div class="tgme_widget_message_wrap\b[\s\S]*?(?=<div class="tgme_widget_message_wrap\b|$)/giu) || [];
  for (const block of blocks) {
    const id = /data-post="([^"#]+)"/iu.exec(block)?.[1];
    const text = /<div class="tgme_widget_message_text\b[^>]*>([\s\S]*?)<\/div>/iu.exec(block)?.[1];
    const date = /<time\s+datetime="([^"]+)"/iu.exec(block)?.[1];
    if (!id || !text || !date) continue;
    const views = /class="tgme_widget_message_views[^"]*"[^>]*>([\d.,KМк\s]+)/iu.exec(block)?.[1] || '';
    const post = item(`https://t.me/${id}`, cleanHtml(text).slice(0, 140), text, date, channel, { views: views.trim() }, now);
    if (post) records.push(post);
  }
  return records.slice(-20);
}

export function parsePikabuPage(html, fetchedAt = NOW.toISOString()) {
  const now = new Date(fetchedAt);
  const records = [];
  const articles = String(html).match(/<article\b[^>]*class="[^"]*\bstory\b[^"]*"[^>]*>[\s\S]*?<\/article>/giu) || [];
  for (const article of articles) {
    const timestamp = /data-timestamp="(\d+)"/iu.exec(article)?.[1];
    const titleAnchor = /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*story__title-link[^"]*"[^>]*>([\s\S]*?)<\/a>/iu.exec(article)
      || /<a\b[^>]*class="[^"]*story__title-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/iu.exec(article);
    if (!timestamp || !titleAnchor) continue;
    const seconds = Number(timestamp);
    const publishedAt = new Date(seconds * 1000).toISOString();
    const title = cleanHtml(titleAnchor[2]);
    const content = /<div class="story__content-inner[^"]*"[^>]*>([\s\S]*?)<\/div>/iu.exec(article)?.[1] || '';
    const excerpt = cleanHtml(content).slice(0, 900) || title;
    const comments = /data-comments="(\d+)"/iu.exec(article)?.[1] || '';
    const post = item(new URL(titleAnchor[1], 'https://pikabu.ru').href, title, excerpt, publishedAt, 'Пикабу · Авто', { comments: Number(comments) }, now);
    if (post) records.push(post);
  }
  return records.slice(0, 20);
}

function xmlValue(block, name) {
  const tag = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'iu').exec(block)?.[1];
  if (tag != null) return tag.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, '$1');
  if (name === 'link') return new RegExp(`<link\\b[^>]*href="([^"]+)"`, 'iu').exec(block)?.[1] || '';
  return '';
}

export function parseRss(xml, source, fetchedAt = NOW.toISOString()) {
  const now = new Date(fetchedAt);
  const records = [];
  const entries = String(xml).match(/<(item|entry)\b[^>]*>[\s\S]*?<\/\1>/giu) || [];
  for (const entry of entries) {
    const title = xmlValue(entry, 'title');
    const description = xmlValue(entry, 'description') || xmlValue(entry, 'summary') || xmlValue(entry, 'content:encoded');
    const url = xmlValue(entry, 'link') || xmlValue(entry, 'guid');
    const date = xmlValue(entry, 'pubDate') || xmlValue(entry, 'published') || xmlValue(entry, 'updated') || xmlValue(entry, 'dc:date');
    const post = item(url, title, description || title, date, source, {}, now);
    if (post) records.push(post);
  }
  return records.slice(0, 20);
}

async function collectOne(source, fetcher) {
  try {
    const result = await fetcher();
    return { name: source.name, kind: source.kind, url: source.url, status: 'ok', fetchedAt: result.fetchedAt, items: result.items };
  } catch (error) {
    return { name: source.name, kind: source.kind, url: source.url, status: 'unavailable', error: String(error.message || error).slice(0, 240), items: [] };
  }
}

export async function collectResearch({ now = new Date(), fetcher = fetchPage, sleeper = wait } = {}) {
  const sources = [];
  const telegram = [
    { name: 'Telegram · Дром', kind: 'telegram', url: 'https://t.me/s/drom', run: async () => ({ items: parseTelegramPage((await fetcher('https://t.me/s/drom')).text, 'Telegram · Дром', now.toISOString()), fetchedAt: new Date().toISOString() }) },
    { name: 'Telegram · Автопоток', kind: 'telegram', url: 'https://t.me/s/autopotoknews', run: async () => ({ items: parseTelegramPage((await fetcher('https://t.me/s/autopotoknews')).text, 'Telegram · Автопоток', now.toISOString()), fetchedAt: new Date().toISOString() }) },
  ];
  for (const source of telegram) sources.push(await collectOne(source, source.run));

  const pikaSource = { name: 'Пикабу · Авто', kind: 'community', url: 'https://pikabu.ru/tag/%D0%90%D0%B2%D1%82%D0%BE/hot' };
  sources.push(await collectOne(pikaSource, async () => {
    const robots = await fetchRobots(pikaSource.url);
    const decision = robotsDecision(robots, pikaSource.url);
    if (!decision.allowed) throw new Error(`robots.txt запрещает эту страницу (${decision.matchingRule.path})`);
    if (decision.crawlDelaySeconds) await sleeper(decision.crawlDelaySeconds * 1000);
    const page = await fetcher(pikaSource.url);
    return { fetchedAt: page.fetchedAt, items: parsePikabuPage(page.text, page.fetchedAt) };
  }));

  const rssSource = { name: 'За рулём · свежие новости', kind: 'editorial', url: 'https://www.zr.ru/rss-news/' };
  sources.push(await collectOne(rssSource, async () => {
    const feed = await fetcher(rssSource.url);
    return { fetchedAt: feed.fetchedAt, items: parseRss(feed.text, rssSource.name, feed.fetchedAt) };
  }));

  const items = sources.flatMap(source => source.items).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const categories = new Set(sources.filter(source => source.items.length).map(source => source.kind));
  if (sources.filter(source => source.items.length).length < 2 || categories.size < 2 || items.length < 5) {
    const state = sources.map(source => `${source.name}: ${source.items.length} новых; ${source.error || source.status}`).join('; ');
    throw new Error(`Не удалось собрать минимум 5 свежих сигналов из 2 типов источников. ${state}`);
  }
  return { collectedAt: now.toISOString(), freshnessHours: MAX_AGE_HOURS, sources, items };
}

export function researchSummary(research) {
  const lines = [
    `### Live-сбор для @ter_cars · ${research.collectedAt}`,
    `Свежих сигналов за последние ${research.freshnessHours} ч: **${research.items.length}**.`,
    '',
    ...research.sources.map(source => `- ${source.items.length ? '✅' : '⚪'} [${source.name}](${source.url}): ${source.items.length} сигналов${source.error ? ` — ${source.error}` : ''}`),
  ];
  lines.push('', ...research.items.slice(0, 12).map(entry => `- ${entry.publishedAt.slice(0, 16).replace('T', ' ')} · ${entry.title} ([источник](${entry.url}))`));
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2] || process.env.TER_RESEARCH_FILE;
  if (!output) { console.error('Укажи путь для JSON-снимка live-исследования.'); process.exit(2); }
  try {
    const research = await collectResearch();
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(research, null, 2)}\n`, { flag: 'wx' });
    if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${researchSummary(research)}\n`, { flag: 'a' });
    console.log(`Собрано свежих сигналов: ${research.items.length}; источников: ${research.sources.filter(s => s.items.length).length}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
