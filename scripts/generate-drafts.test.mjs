import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, moscowDate, parseModelJson } from './generate-drafts.mjs';

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
  const prompt = buildPrompt('2026-11-05');
  assert.match(prompt, /"n": 20/);
  assert.match(prompt, /"06:00"/);
  assert.match(prompt, /05\.11\.2026/);
  assert.match(prompt, /Интернет-поиск в этой задаче недоступен/);
});
