// Разовый перенос постов недели 1 из старой очереди API в drafts/.
// node scripts/import-queue.mjs <queue.csv> <03_контент_план.csv> <с какой даты ГГГГ-ММ-ДД>
// Уже существующие drafts/<дата>.json не перезаписывает.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './check-posts.mjs';

export function parseCsv(text, sep = ';') {
  const rows = [];
  let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0]);
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const RUBRIC = [[/^провокац/i, 'провокация'], [/^ремонт/i, 'ремонт'], [/^истори/i, 'история'], [/^юмор/i, 'юмор'], [/^новост/i, 'новости']];
// неизвестная рубрика → '' (проверка покажет ошибку, и её поправят руками)
export const rubricOf = s => (RUBRIC.find(([re]) => re.test(String(s).trim())) || [null, ''])[1];

export function queueToDays(queue, plan, from, generatedAt) {
  const byDay = new Map();
  for (const q of queue) {
    const [date, time] = q.datetime_msk.trim().split(' ');
    if (date < from) continue;
    const ru = date.split('-').reverse().join('.');
    const p = plan.find(x => x['Дата'] === ru && x['Время МСК'] === time) || {};
    const src = (p['Источник / проверка (не ссылкой в посте)'] || '').trim();
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push({
      time, rubric: rubricOf(p['Рубрика'] || ''), text: q.text.replace(/\r\n/g, '\n').trim(), why: (p['Тема'] || '').trim(),
      photo: { kind: 'none', hint: (p['Визуал: что снять / какое фото'] || '').trim() },
      source: src === '—' ? '' : src, plan_ref: p['№'] ? '№' + p['№'] : '',
    });
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, posts]) => ({
    date, generated_at: generatedAt,
    posts: posts.sort((a, b) => a.time.localeCompare(b.time)).map((p, i) => ({ id: `t-${date}-${i + 1}`, ...p })),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [queueFile, planFile, from] = process.argv.slice(2);
  if (!queueFile || !planFile || !/^\d{4}-\d{2}-\d{2}$/.test(from || '')) {
    console.log('node scripts/import-queue.mjs <queue.csv> <03_контент_план.csv> <ГГГГ-ММ-ДД>'); process.exit(1);
  }
  const days = queueToDays(parseCsv(readFileSync(queueFile, 'utf8')), parseCsv(readFileSync(planFile, 'utf8')), from, new Date().toISOString());
  mkdirSync(join(ROOT, 'drafts'), { recursive: true });
  for (const d of days) {
    const f = join(ROOT, 'drafts', d.date + '.json');
    if (existsSync(f)) { console.log(`${d.date}: уже есть, не трогаю`); continue; }
    writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
    console.log(`${d.date}: постов ${d.posts.length}`);
  }
}
