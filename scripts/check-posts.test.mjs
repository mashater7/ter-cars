// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDays, checkAll, loadConfig } from './check-posts.mjs';

const CLI = fileURLToPath(new URL('./check-posts.mjs', import.meta.url));
const CONFIG = fileURLToPath(new URL('../config.json', import.meta.url));
const day = (date, text) => ({ date, posts: [{ id: `t-${date}-1`, time: '08:00', rubric: 'ремонт', photo: { kind: 'none' }, text }] });

function repo(days) {
  const dir = mkdtempSync(join(tmpdir(), 'ter-'));
  mkdirSync(join(dir, 'drafts'));
  copyFileSync(CONFIG, join(dir, 'config.json'));
  for (const d of days) writeFileSync(join(dir, 'drafts', d.date + '.json'), JSON.stringify(d));
  return dir;
}
const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, TER_ROOT: dir }, encoding: 'utf8' });

test('loadDays читает только файлы ГГГГ-ММ-ДД.json по порядку', () => {
  const dir = repo([day('2026-10-29', 'Второй пост про тормоза. А у вас скрипят?'), day('2026-10-28', 'Первый пост про масло. А вы меняли?')]);
  writeFileSync(join(dir, 'drafts', 'черновик.json'), '{}');
  assert.deepEqual(loadDays(dir).map(d => d.date), ['2026-10-28', '2026-10-29']);
});

test('checkAll ловит повтор между днями', () => {
  const t = 'Поменял колодки сам за час. Сэкономил три тысячи. А вы колодки меняете сами?';
  const res = checkAll([day('2026-10-28', t), day('2026-10-29', t)], loadConfig(repo([])));
  assert.match(res[0].errors.join(), /Повтор поста t-2026-10-29-1/);
});

test('checkAll: имя файла должно совпадать с датой внутри', () => {
  const dir = repo([]);
  writeFileSync(join(dir, 'drafts', '2026-10-30.json'), JSON.stringify(day('2026-10-31', 'Пост про шины. Когда переобуваетесь?')));
  assert.match(checkAll(loadDays(dir), loadConfig(dir))[0].errors.join(), /2026-10-30\.json: внутри дата 2026-10-31/);
});

test('CLI: хорошие черновики — код 0, плохие — код 1 и список ошибок', () => {
  const ok = cli(repo([day('2026-10-28', 'Поменял масло в коробке. А вы когда меняли?')]));
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /drafts в порядке \(дней: 1\)/);
  const bad = cli(repo([day('2026-10-28', 'Смотрите drom.ru?')]));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /ОШИБКА t-2026-10-28-1: В посте не должно быть ссылок/);
});

test('CLI с датой проверяет только этот день; нет файла — код 1', () => {
  const dir = repo([day('2026-10-28', 'Смотрите drom.ru?'), day('2026-10-29', 'Поменял масло в коробке. А вы когда меняли?')]);
  assert.equal(cli(dir, '2026-10-29').status, 0);
  const none = cli(dir, '2026-11-01');
  assert.equal(none.status, 1);
  assert.match(none.stdout, /Нет файла drafts\/2026-11-01\.json/);
});
