// Проверка черновиков @ter_cars: node scripts/check-posts.mjs [ГГГГ-ММ-ДД]
// Без даты — все дни в drafts/. Код выхода 1, если есть ошибки. TER_ROOT — другая папка репо (для тестов).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkDay } from './rules.mjs';

export const ROOT = process.env.TER_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
}
// дни по порядку дат; file — имя файла, чтобы поймать дату внутри, не совпадающую с именем
export function loadDays(root = ROOT) {
  const dir = join(root, 'drafts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    .map(f => ({ ...JSON.parse(readFileSync(join(dir, f), 'utf8')), file: f }));
}
export function checkAll(days, config, only = '') {
  return days.filter(d => !only || d.date === only).map(d => {
    const history = days.filter(x => x !== d).flatMap(x => (x.posts || []).map(p => ({ ...p, date: x.date })));
    const r = checkDay(d, { config, history });
    if (d.file && d.file !== d.date + '.json') r.errors.unshift(`${d.file}: внутри дата ${d.date}`);
    return { date: d.date, ...r };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2] || '';
  const res = checkAll(loadDays(), loadConfig(), only);
  if (only && !res.length) { console.log(`Нет файла drafts/${only}.json`); process.exit(1); }
  let bad = 0;
  for (const r of res) {
    for (const e of r.errors) { console.log('ОШИБКА ' + e); bad++; }
    for (const w of r.warnings) console.log('совет  ' + w);
  }
  console.log(bad ? `Ошибок: ${bad}. Исправь тексты и запусти снова.` : `drafts в порядке (дней: ${res.length})`);
  process.exit(bad ? 1 : 0);
}
