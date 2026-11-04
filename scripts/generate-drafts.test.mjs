import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPrompt, containsPrivateStyle, generateDrafts, moscowDate, parseModelJson, validateNewsSources } from './generate-drafts.mjs';

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
    let calls = 0, capturedCommand, capturedPrompt, capturedArgs;
    assert.throws(() => generateDrafts('2099-11-05', { runner: (command, args, options) => {
      calls++;
      capturedCommand = command;
      capturedPrompt = options.input;
      capturedArgs = args;
      return { status: 0, stdout: JSON.stringify({ date: '2099-11-05', posts: [{ id: 'LEAK', rubric: 'LEAK', text: 'Draft', time: 'bad', photo: { kind: 'none' } }] }) };
    } }), error => !error.message.includes('LEAK'));
    assert.equal(calls, 1);
    assert.equal(capturedCommand, 'copilot');
    assert.match(capturedPrompt, /SYNTHETIC AFTER/);
    assert.equal(capturedArgs.includes('-p'), false);
    assert.equal(capturedArgs.some(arg => arg.includes('SYNTHETIC AFTER')), false);
    assert.throws(() => generateDrafts('2099-11-05', { runner: () => ({ status: 1, stderr: 'LEAK', stdout: 'LEAK' }) }), error => !error.message.includes('LEAK'));
  } finally {
    for (const [key, value] of [['TER_RESEARCH_FILE', previous.research], ['TER_STYLE_FILE', previous.style]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('otherwise valid model echoes are rejected before writing any persisted field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ter-echo-test-'));
  try {
    mkdirSync(join(dir, 'drafts'));
    cpSync(new URL('../config.json', import.meta.url), join(dir, 'config.json'));
    cpSync(new URL('../PROMPT.md', import.meta.url), join(dir, 'PROMPT.md'));
    cpSync(new URL('../plan', import.meta.url), join(dir, 'plan'), { recursive: true });
    const original = 'Оставила синий термос в машине у старого моста. У вас бывало?';
    const edited = 'Забыла зелёный зонтик на парковке около театра. Знакомо?';
    const day = { date: '2026-10-28', posts: [
      { id: 't-2026-10-28-1', time: '08:00', rubric: 'жизнь', text: original, photo: { kind: 'none' } },
      { id: 't-2026-10-28-2', time: '10:30', rubric: 'ремонт', text: 'Скрип тормозов после дождя пропал к вечеру. Кто сталкивался?', photo: { kind: 'none' } },
    ] };
    writeFileSync(join(dir, 'research.json'), JSON.stringify({ ...research, collectedAt: new Date().toISOString() }));
    writeFileSync(join(dir, 'style.json'), JSON.stringify({ status: 'ok', items: [{ id: 'fixture', rubric: 'жизнь', original, edited, editedAt: '2026-11-04T12:00:00Z' }] }));
    for (const field of ['text', 'why', 'custom']) {
      const response = structuredClone(day);
      if (field !== 'text') { response.posts[0].text = 'Планирую поездку по незнакомой трассе зимой. Какие советы?'; response.posts[0][field] = edited.toUpperCase(); }
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        'import {generateDrafts} from ' + JSON.stringify(new URL('./generate-drafts.mjs', import.meta.url).href) + '; try { generateDrafts("2026-10-28", {runner: () => ({status:0, stdout:process.env.TEST_RESPONSE})}); } catch(e) { console.error(e.message); process.exitCode=1; }'],
        { encoding: 'utf8', env: { ...process.env, TER_ROOT: dir, TER_RESEARCH_FILE: join(dir, 'research.json'), TER_STYLE_FILE: join(dir, 'style.json'), TEST_RESPONSE: JSON.stringify(response) } });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /приватных примеров/);
      assert.ok(!result.stderr.includes(original) && !result.stderr.includes(edited));
      assert.equal(existsSync(join(dir, 'drafts', '2026-10-28.json')), false);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('privacy guard catches normalized fragments and permits independent wording', () => {
  const samples = [{ original: 'Один два три четыре пять шесть семь восемь девять.', edited: 'Отдельная короткая правка' }];
  assert.equal(containsPrivateStyle({posts:[{why:'ТРИ, ЧЕТЫРЕ; ПЯТЬ шесть семь восемь!'}]}, samples), true);
  assert.equal(containsPrivateStyle({posts:[{photo:{hint:'Отдельная короткая правка'}}]}, samples), true);
  assert.equal(containsPrivateStyle({posts:[{text:'Самостоятельная новая формулировка про шины.'}]}, samples), false);
});
