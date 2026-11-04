import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, moscowDate, parseModelJson, validateNewsSources } from './generate-drafts.mjs';

const research = {
  collectedAt: '2026-11-04T12:00:00.000Z', freshnessHours: 72,
  items: Array.from({ length: 5 }, (_, i) => ({
    source: 'fixture', title: `Авто тема ${i}`, excerpt: 'Обсуждение автомобилистов',
    url: `https://example.com/${i}`, publishedAt: `2026-11-04T${String(12 - i).padStart(2, '0')}:00:00.000Z`,
  })),
};

test('парсер принимает JSON в чистом виде и в markdown-блоке', () => {
  const expected = { date: '2026-11-05', posts: [{ text: 'Фраза с } внутри. Что скажете?' }] };
  assert.deepEqual(parseModelJson(JSON.stringify(expected)), expected);
  assert.deepEqual(parseModelJson('```json\n' + JSON.stringify(expected) + '\n```'), expected);
});

test('парсер отклоняет пустой и незавершённый ответ модели', () => {
  assert.throws(() => parseModelJson('не JSON'), /не содержит JSON/);
  assert.throws(() => parseModelJson('{"date":"2026-11-05"'), /незавершённый JSON/);
});

test('дата для ежедневного запуска вычисляется в московском часовом поясе', () => {
  assert.equal(moscowDate(new Date('2026-11-04T21:30:00.000Z')), '2026-11-05');
});

test('запрос модели содержит конфиг 20 постов и план на нужную дату', () => {
  const prompt = buildPrompt('2026-11-05', research);
  assert.match(prompt, /"n": 20/);
  assert.match(prompt, /"06:00"/);
  assert.match(prompt, /05\.11\.2026/);
  assert.match(prompt, /Свежие публичные автообсуждения и новости, собранные сейчас/);
  assert.match(prompt, /https:\/\/example.com\/0/);
});

test('проверка новостных постов запрещает ссылки вне live-снимка', () => {
  assert.deepEqual(validateNewsSources({ posts: [
    { id: 'ok', rubric: 'новости', source: 'https://example.com/0' },
    { id: 'bad', rubric: 'новости', source: 'https://example.com/old' },
    { id: 'evergreen', rubric: 'личное', source: '' },
  ] }, research), ['bad: источник новости отсутствует в сегодняшнем live-сборе']);
});
