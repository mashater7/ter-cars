import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHtml, collectResearch, parsePikabuPage, parseRss, parseTelegramPage, robotsDecision } from './collect-research.mjs';

const NOW = new Date('2026-11-04T18:00:00.000Z');

test('очищает HTML, сущности и лишние пробелы', () => {
  assert.equal(cleanHtml('<b>Машина</b>&nbsp; и <i>ремонт</i> &mdash; сегодня'), 'Машина и ремонт — сегодня');
});

test('robots: разрешает публичную ленту Пикабу, но применяет запрет и crawl-delay', () => {
  const robots = `User-agent: *\nDisallow: /tag/*st=*\nCrawl-delay: 3\n`;
  assert.deepEqual(robotsDecision(robots, 'https://pikabu.ru/tag/%D0%90%D0%B2%D1%82%D0%BE/hot'), {
    allowed: true, crawlDelaySeconds: 3, matchingRule: null,
  });
  assert.equal(robotsDecision(robots, 'https://pikabu.ru/tag/Авто/hot?st=popular').allowed, false);
});

test('Telegram parser keeps recent public automotive posts with canonical links', () => {
  const html = `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="autopotoknews/5"><div class="tgme_widget_message_text js-message_text"><b>Авто и бензин</b>: что происходит?</div><a class="tgme_widget_message_date"><time datetime="2026-11-04T17:00:00Z"></time></a></div></div>`;
  const posts = parseTelegramPage(html, 'Telegram · Автопоток', NOW.toISOString());
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://t.me/autopotoknews/5');
  assert.equal(posts[0].title, 'Авто и бензин: что происходит?');
});

test('Pikabu parser uses only fresh relevant article cards and retains comment count', () => {
  const epoch = Math.floor(Date.parse('2026-11-04T17:00:00Z') / 1000);
  const html = `<article class="story" data-story-id="123" data-timestamp="${epoch}" data-comments="12"><h2 class="story__title"><a href="https://pikabu.ru/story/avto_123" class="story__title-link">Машина и зимняя резина</a></h2><div class="story__content-inner story__content-inner_slice-by-block">Как выбрать шины?</div></article>`;
  const posts = parsePikabuPage(html, NOW.toISOString());
  assert.equal(posts.length, 1);
  assert.equal(posts[0].engagement.comments, 12);
  assert.match(posts[0].excerpt, /Как выбрать шины/);
});

test('RSS parser rejects stale entries and keeps direct source URLs', () => {
  const xml = `<rss><channel><item><title>Ремонт машины перед зимой</title><link>https://zr.ru/news/car/123/</link><description>Что проверить водителю перед морозами</description><pubDate>Wed, 04 Nov 2026 17:00:00 GMT</pubDate></item><item><title>Автомобильная новость старая</title><link>https://zr.ru/news/car/old/</link><pubDate>Mon, 20 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const posts = parseRss(xml, 'За рулём', NOW.toISOString());
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://zr.ru/news/car/123/');
});

test('сборщик ждёт разнообразные источники и возвращает только свежие сигналы', async () => {
  const epoch = Math.floor(Date.parse('2026-11-04T17:30:00Z') / 1000);
  const telegram = id => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="autopotoknews/${id}"><div class="tgme_widget_message_text js-message_text">Автомобильная тема ${id}: свежий спор водителей</div><time datetime="2026-11-04T17:30:00Z"></time></div></div>`;
  const pikabu = Array.from({ length: 4 }, (_, i) => `<article class="story" data-story-id="${i}" data-timestamp="${epoch}" data-comments="${i + 1}"><a href="https://pikabu.ru/story/avto_${i}" class="story__title-link">Авто: тема ${i}</a><div class="story__content-inner">Что думают водители о машине?</div></article>`).join('');
  const rss = Array.from({ length: 4 }, (_, i) => `<item><title>Машина: новая тема ${i}</title><link>https://zr.ru/news/${i}/</link><description>Автомобильная новость и мнение водителей.</description><pubDate>Wed, 04 Nov 2026 17:30:00 GMT</pubDate></item>`).join('');
  const payloads = new Map([
    ['https://t.me/s/drom', telegram('drom')],
    ['https://t.me/s/autopotoknews', telegram('apn')],
    ['https://pikabu.ru/robots.txt', 'User-agent: *\nCrawl-delay: 3\n'],
    ['https://pikabu.ru/tag/%D0%90%D0%B2%D1%82%D0%BE/hot', pikabu],
    ['https://www.zr.ru/rss-news/', `<rss><channel>${rss}</channel></rss>`],
  ]);
  const result = await collectResearch({
    now: NOW,
    fetcher: async url => ({ text: payloads.get(url) || '', url, fetchedAt: NOW.toISOString() }),
    sleeper: async () => {},
  });
  assert.ok(result.items.length >= 5);
  assert.ok(result.sources.filter(s => s.items.length).length >= 2);
  assert.ok(result.items.every(p => p.publishedAt.startsWith('2026-11-04')));
});
