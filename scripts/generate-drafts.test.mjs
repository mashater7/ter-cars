import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt, generateDrafts, moscowDate, parseModelJson, validateNewsSources } from './generate-drafts.mjs';

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

test('style edits are analyzed within the drafting prompt only as wording preferences', () => {
  const prompt = buildPrompt('2026-11-05', research, [{ id: 'synthetic', rubric: 'личное', original: 'SYNTHETIC BEFORE', edited: 'SYNTHETIC AFTER', editedAt: '2026-11-04T12:00:00.000Z' }]);
  assert.match(prompt, /SYNTHETIC BEFORE/);
  assert.match(prompt, /SYNTHETIC AFTER/);
  assert.match(prompt, /различия.*до\/после/);
  assert.match(prompt, /только.*стил/);
  assert.match(prompt, /Не переноси события/);
  assert.match(prompt, /Не выводи.*анализ/);
});

test('without style pairs drafting keeps the current voice guide and explicit fallback', () => {
  const prompt = buildPrompt('2026-11-05', research, []);
  assert.match(prompt, /plan\/11_голос_маши\.md/);
  assert.match(prompt, /Анализ правок пропущен/);
  assert.doesNotMatch(prompt, /SYNTHETIC/);
});

// Invalid model output must not expose private prompt examples through JSON.parse errors.
test('malformed model JSON produces a content-free parse error', () => {
  assert.throws(() => parseModelJson('{"text": LEAK}'), error => !error.message.includes('LEAK'));
});


test('generation sends edits in the same CLI prompt and never echoes rejected response data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ter-generate-test-'));
  const previous = { research: process.env.TER_RESEARCH_FILE, style: process.env.TER_STYLE_FILE };
  try {
    process.env.TER_RESEARCH_FILE = join(dir, 'research.json');
    process.env.TER_STYLE_FILE = join(dir, 'style.json');
    writeFileSync(process.env.TER_RESEARCH_FILE, JSON.stringify({ ...research, collectedAt: new Date().toISOString() }));
    writeFileSync(process.env.TER_STYLE_FILE, JSON.stringify({ status: 'ok', items: [{ id: 'fixture', rubric: 'личное', original: 'SYNTHETIC BEFORE', edited: 'SYNTHETIC AFTER', editedAt: '2026-11-04T12:00:00.000Z' }] }));
    let calls = 0, capturedCommand, capturedPrompt;
    assert.throws(() => generateDrafts('2099-11-05', { runner: (command, args) => {
      calls++;
      capturedCommand = command;
      capturedPrompt = args[args.indexOf('-p') + 1];
      return { status: 0, stdout: JSON.stringify({ date: '2099-11-05', posts: [{ id: 'LEAK', rubric: 'LEAK', text: 'Draft', time: 'bad', photo: { kind: 'none' } }] }) };
    } }), error => !error.message.includes('LEAK'));
    assert.equal(calls, 1);
    assert.equal(capturedCommand, 'copilot');
    assert.match(capturedPrompt, /SYNTHETIC AFTER/);
    assert.throws(() => generateDrafts('2099-11-05', { runner: () => ({ status: 1, stderr: 'LEAK', stdout: 'LEAK' }) }), error => !error.message.includes('LEAK'));
  } finally {
    for (const [key, value] of [['TER_RESEARCH_FILE', previous.research], ['TER_STYLE_FILE', previous.style]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
