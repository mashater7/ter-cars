// Проверка постов @ter_cars: одни и те же функции запускают облачная задача (scripts/check-posts.mjs),
// пульт на сервере (tools/ter.mjs) и страница одобрения (index.html). Без файлов и сети.
export const ACCOUNT = 'ter_cars';
export const RUBRICS = ['провокация', 'ремонт', 'история', 'юмор', 'жизнь', 'новости'];
export const TARGET_SHARE = { 'провокация': 25, 'ремонт': 20, 'история': 20, 'юмор': 13, 'жизнь': 12, 'новости': 10 };
export const STOCK_HOSTS = ['images.unsplash.com', 'images.pexels.com', 'upload.wikimedia.org'];
export const MAX_LEN = 500;

// Завидово Барн в постах машин — никогда. \b в JS не понимает кириллицу, поэтому границы слова вручную
const BARN = [/zavidovobarn/iu, /завидово/iu, /(^|[^а-яё])барн([^а-яё]|$)/iu];
const LINK = /https?:\/\/|www\.|(^|[^a-z0-9@-])[a-z0-9-]+\.(ru|com|net|org|io|me|su|by|kz|рф)([^a-z0-9]|$)/iu;

export const normalize = t => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function shingles(t) {
  const w = normalize(t).split(' ').filter(Boolean);
  const s = new Set();
  for (let i = 0; i + 4 <= w.length; i++) s.add(w.slice(i, i + 4).join(' '));
  return s;
}
// доля общих кусков по 4 слова от меньшего текста: 1 — один текст целиком внутри другого
export function similarity(a, b) {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

export function toMin(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export function perDayFor(date, config) {
  let n = 0;
  for (const r of config.perDay) if (date >= r.from) n = r.n;
  return n;
}
export function inQuiet(min, config) {
  return config.quiet.some(r => { const [a, b] = r.split('-').map(toMin); return min >= a && min < b; });
}

// post — { id, time, rubric, text, photo, source }; history — другие посты [{ id, text }]
export function checkPost(post, { config, history = [] }) {
  const errors = [], warnings = [];
  const t = String(post.text || '').trim();
  if (!t) errors.push('Текст пустой');
  if (t.length > MAX_LEN) errors.push(`Длиннее ${MAX_LEN} знаков (сейчас ${t.length})`);
  if (LINK.test(t)) errors.push('В посте не должно быть ссылок');
  if ((t.match(/#/g) || []).length > 1) errors.push('Больше одного #');
  if (BARN.some(r => r.test(t))) errors.push('Упоминание Завидово Барна: в @ter_cars нельзя');
  for (const f of config.forbidden) if (new RegExp(f.re, 'iu').test(t)) errors.push(f.why);
  if (!RUBRICS.includes(post.rubric)) errors.push(`Неизвестная рубрика «${post.rubric}»`);
  const min = toMin(post.time);
  if (min == null) errors.push(`Время «${post.time}» не в формате ЧЧ:ММ`);
  else if (inQuiet(min, config)) errors.push(`Время ${post.time} в окне тишины ${config.quiet.join(', ')} (поиск Барна)`);
  const ph = post.photo || { kind: 'none' };
  if (!['none', 'own', 'stock'].includes(ph.kind)) errors.push(`Неизвестный тип фото «${ph.kind}»`);
  if (ph.kind === 'stock') {
    let host = '';
    try { host = new URL(ph.url).hostname; } catch {}
    if (!STOCK_HOSTS.includes(host)) errors.push('Сток-фото только с Unsplash, Pexels или Wikimedia');
    else if (host === 'upload.wikimedia.org' && !(ph.credit && t.includes(ph.credit))) errors.push('Фото с Wikimedia: подпись из credit должна быть в тексте поста');
  }
  for (const h of history) {
    if (h.id === post.id) continue;
    if (normalize(h.text) === normalize(t)) { errors.push(`Повтор поста ${h.id}`); break; }
    if (similarity(h.text, t) > 0.6) { errors.push(`Слишком похож на пост ${h.id}`); break; }
  }
  if (t.length > 300) warnings.push(`Длинновато: ${t.length} знаков, лучше до 300`);
  if (t && !/\?[^\p{L}\p{N}]*$/u.test(t)) warnings.push('В конце нет вопроса');
  if (post.rubric === 'новости' && !post.source) warnings.push('У новости нет источника для проверки');
  return { errors, warnings };
}

export function shareWarnings(posts) {
  if (posts.length < 6) return [];
  const out = [];
  for (const r of RUBRICS) {
    const pct = Math.round(100 * posts.filter(p => p.rubric === r).length / posts.length);
    if (Math.abs(pct - TARGET_SHARE[r]) > 10) out.push(`Рубрика «${r}»: ${pct} % за 7 дней, цель ${TARGET_SHARE[r]} %`);
  }
  return out;
}

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// day — { date, posts }; history — посты других дней [{ id, date, text, rubric }]
export function checkDay(day, { config, history = [] }) {
  const errors = [], warnings = [];
  const date = String(day.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { errors: ['Нет даты дня (ГГГГ-ММ-ДД)'], warnings };
  const posts = day.posts || [];
  const max = perDayFor(date, config);
  if (posts.length > max) errors.push(`${date}: ${posts.length} постов, можно не больше ${max}`);
  posts.forEach((p, i) => { if (p.id !== `t-${date}-${i + 1}`) errors.push(`${date}: у поста ${i + 1} id должен быть t-${date}-${i + 1}`); });
  const times = posts.map(p => toMin(p.time)).filter(x => x != null).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] < config.minGapMin) { errors.push(`${date}: между постами меньше ${config.minGapMin} мин`); break; }
  }
  for (const p of posts) {
    const r = checkPost(p, { config, history: [...history, ...posts] });
    r.errors.forEach(e => errors.push(`${p.id}: ${e}`));
    r.warnings.forEach(w => warnings.push(`${p.id}: ${w}`));
  }
  const from = addDays(date, -6);
  warnings.push(...shareWarnings([...history.filter(h => h.date >= from && h.date < date), ...posts]));
  return { errors, warnings };
}
