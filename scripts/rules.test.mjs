// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPost, normalize } from './rules.mjs';

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const good = { id: 't-2026-10-28-1', time: '08:00', rubric: 'ремонт', photo: { kind: 'none' },
  text: 'Поменял масло в коробке на 90 тысячах. Слил чёрное, с запахом гари. А вы когда меняли масло в автомате?' };
const errs = (patch, history = []) => checkPost({ ...good, ...patch }, { config, history }).errors;
const warns = patch => checkPost({ ...good, ...patch }, { config }).warnings;

test('хороший пост проходит без ошибок и советов', () => {
  assert.deepEqual(checkPost(good, { config }), { errors: [], warnings: [] });
});

test('пустой и длиннее 500 — ошибка', () => {
  assert.match(errs({ text: '   ' }).join(), /пустой/);
  assert.match(errs({ text: 'а'.repeat(501) + '?' }).join(), /Длиннее 500 знаков \(сейчас 502\)/);
});

test('ссылки нельзя, цифры с точкой можно', () => {
  assert.match(errs({ text: 'Подробности на drom.ru. Согласны?' }).join(), /ссылок/);
  assert.match(errs({ text: 'Смотрите https://x.com сами?' }).join(), /ссылок/);
  assert.deepEqual(errs({ text: 'Расход 7.5 литров по трассе. А у вас сколько?' }), []);
});

test('больше одного # — ошибка', () => {
  assert.match(errs({ text: '#Авто #Ремонт что скажете?' }).join(), /Больше одного #/);
});

test('Завидово Барн нельзя, а Барнаул и «завидовал» можно', () => {
  assert.match(errs({ text: 'Отдыхали в zavidovobarn, а вы где?' }).join(), /Завидово Барна/);
  assert.match(errs({ text: 'Ездили в Завидово на выходных, а вы?' }).join(), /Завидово Барна/);
  assert.match(errs({ text: 'Барн — лучшее место, правда?' }).join(), /Завидово Барна/);
  assert.deepEqual(errs({ text: 'Еду в Барнаул на Ниве. Сколько у вас расход на трассе?' }), []);
  assert.deepEqual(errs({ text: 'Всегда завидовал тем, кто паркуется с первого раза. А вы?' }), []);
});

test('запреты из config.json', () => {
  assert.match(errs({ text: 'Механика лучше. Напиши да, если согласен?' }).join(), /напиши да/);
  assert.match(errs({ text: 'Лайк, если ездишь на механике?' }).join(), /лайк, если/);
  assert.match(errs({ text: 'Подписывайтесь, будет больше про ремонт?' }).join(), /подписаться/);
});

test('рубрика только из шести', () => {
  assert.match(errs({ rubric: 'тюнинг' }).join(), /Неизвестная рубрика «тюнинг»/);
});

test('советы: длинный, без вопроса, новость без источника', () => {
  assert.match(warns({ text: 'а'.repeat(301) + '?' }).join(), /Длинновато: 302/);
  assert.match(warns({ text: 'Поменял масло в коробке.' }).join(), /нет вопроса/);
  assert.match(warns({ rubric: 'новости' }).join(), /нет источника/);
  assert.deepEqual(warns({ text: 'Что бы взяли вы? 🙂' }), []);
});

test('normalize: регистр, ё, знаки', () => {
  assert.equal(normalize('Ёлка,  МАСЛО!!! 5w-30'), 'елка масло 5w 30');
});

import { checkDay, similarity, perDayFor, toMin, inQuiet } from './rules.mjs';

test('время: формат и окно тишины 09:50–10:20', () => {
  assert.equal(toMin('8:00'), null);
  assert.match(errs({ time: '8:00' }).join(), /не в формате/);
  assert.match(errs({ time: '10:00' }).join(), /окне тишины/);
  assert.equal(inQuiet(toMin('10:20'), config), false);
  assert.deepEqual(errs({ time: '10:30' }), []);
});

test('фото: сток только с трёх сайтов, Wikimedia с подписью в тексте', () => {
  assert.match(errs({ photo: { kind: 'stock', url: 'https://example.com/a.jpg' } }).join(), /Unsplash, Pexels или Wikimedia/);
  assert.deepEqual(errs({ photo: { kind: 'stock', url: 'https://images.unsplash.com/photo-1?w=1440&fm=jpg' } }), []);
  const wiki = { kind: 'stock', url: 'https://upload.wikimedia.org/x.jpg', credit: 'Фото: Иванов / Wikimedia Commons / CC BY-SA 4.0' };
  assert.match(errs({ photo: wiki }).join(), /подпись из credit/);
  assert.deepEqual(errs({ photo: wiki, text: good.text + '\n' + wiki.credit }).filter(e => !/ссылок/.test(e)), []);
  assert.match(errs({ photo: { kind: 'video' } }).join(), /Неизвестный тип фото/);
});

test('повторы: точный (без учёта регистра и знаков) и похожий больше чем на 60 %', () => {
  const old = { id: 't-2026-10-20-1', text: good.text.toUpperCase().replace(/\./g, '!!') };
  assert.match(errs({}, [old]).join(), /Повтор поста t-2026-10-20-1/);
  const similar = { id: 't-2026-10-20-2', text: good.text + ' Пишите марку и пробег.' };
  assert.ok(similarity(similar.text, good.text) > 0.6);
  assert.match(errs({}, [similar]).join(), /Слишком похож на пост t-2026-10-20-2/);
  assert.deepEqual(errs({}, [{ id: 'x', text: 'Зимняя резина: шипы или липучка в городе, где чистят дороги?' }]), []);
  assert.deepEqual(errs({}, [{ id: good.id, text: good.text }]), [], 'сам с собой не сравнивается');
});

test('perDayFor: 2 до 03.11, 4 с 03.11', () => {
  assert.equal(perDayFor('2026-11-02', config), 2);
  assert.equal(perDayFor('2026-11-03', config), 4);
});

const texts = [
  'Механика или автомат в городе с пробками? Я за автомат, колено дороже. А вы на чём ездите?',
  'Купил Гранту в кредит под 25 процентов. Переплата как ещё полмашины. Вы бы взяли так же?',
  'Папина шестёрка завелась с первого раза в минус тридцать. Помните свою первую машину?',
  'Механик позвонил: машина готова, но есть нюанс. Что вам говорили после такой фразы?',
];
const post = (date, i, time, rubric = 'провокация') => ({ id: `t-${date}-${i}`, time, rubric, text: texts[i - 1], photo: { kind: 'none' } });

test('день: не больше perDay постов', () => {
  const d = { date: '2026-10-28', posts: [post('2026-10-28', 1, '08:00'), post('2026-10-28', 2, '10:30'), post('2026-10-28', 3, '13:00')] };
  assert.match(checkDay(d, { config }).errors.join(), /3 постов, можно не больше 2/);
  const d4 = { date: '2026-11-05', posts: [post('2026-11-05', 1, '08:00'), post('2026-11-05', 2, '10:30'), post('2026-11-05', 3, '13:00'), post('2026-11-05', 4, '20:30')] };
  assert.deepEqual(checkDay(d4, { config }).errors, []);
});

test('день: интервал 90 минут и порядок id', () => {
  const gap = { date: '2026-11-05', posts: [post('2026-11-05', 1, '08:00'), post('2026-11-05', 2, '09:00')] };
  assert.match(checkDay(gap, { config }).errors.join(), /меньше 90 мин/);
  const ids = { date: '2026-11-05', posts: [{ ...post('2026-11-05', 1, '08:00'), id: 't-2026-11-05-7' }] };
  assert.match(checkDay(ids, { config }).errors.join(), /id должен быть t-2026-11-05-1/);
  assert.deepEqual(checkDay({ date: 'завтра', posts: [] }, { config }).errors, ['Нет даты дня (ГГГГ-ММ-ДД)']);
});

test('день: совет про доли рубрик за 7 дней', () => {
  const history = [1, 2, 3, 4, 5].map(i => ({ id: `h${i}`, date: '2026-11-0' + i, rubric: 'ремонт', text: `уникальный текст номер ${i} про ремонт` }));
  const d = { date: '2026-11-06', posts: [post('2026-11-06', 1, '08:00', 'ремонт')] };
  assert.match(checkDay(d, { config, history }).warnings.join(), /Рубрика «ремонт»: 100 % за 7 дней, цель 20 %/);
});

const withText = s => errs({ text: s + ' А вы?' });

test('Барн: падежи, латиница, вопросы ловятся; Барнаул и глагол «завидовать» нет', () => {
  for (const s of ['Был в Барне, а вы?', 'барна нет?', 'Барном', 'Барну', 'zavidovo barn?', 'zavidovo?', 'Завидове?', 'Завидова', 'barn'])
    assert.match(errs({ text: s }).join(), /Завидово Барн/, s);
  for (const s of ['Еду в Барнаул', 'Всегда завидовал', 'завидовать', 'завидую', 'Barnaul'])
    assert.doesNotMatch(withText(s).join(), /Завидово Барн/, s);
});

test('политика: падежи ловятся, «своя машина» нет', () => {
  for (const s of ['Путину?', 'госдума?', 'Кремлёвская?', 'Кремля', 'Зеленский', 'на сво'])
    assert.match(errs({ text: s }).join(), /Политика/, s);
  for (const s of ['своя машина', 'свой гараж'])
    assert.doesNotMatch(withText(s).join(), /Политика/, s);
});

test('реклама: erid только целым словом', () => {
  for (const s of ['erid: 2Vtzq', 'реклама'])
    assert.match(errs({ text: s }).join(), /Реклама/, s);
  for (const s of ['Meridian', 'Sheridan'])
    assert.doesNotMatch(withText(s).join(), /Реклама/, s);
});

test('ссылки: короткие, .рф, новые зоны ловятся; сокращения и числа нет', () => {
  for (const s of ['bit.ly/x', 'vk.cc/x', 'youtu.be/x', 'telegra.ph/abc', 'Mercedes-Benz.de', 'сайт.рф', 't.me/x'])
    assert.match(errs({ text: s }).join(), /ссылок/, s);
  for (const s of ['т.е.', 'и т.д.', '7.5', '1.6 или 2.0', 'Т.О.', '1.5 млн руб.', 'Lada.Vesta'])
    assert.doesNotMatch(withText(s).join(), /ссылок/, s);
});

test('вопрос в конце: подпись Wikimedia в конце не мешает', () => {
  const credit = 'Фото: A / Wikimedia Commons / CC BY-SA 4.0';
  const p = { ...good, text: 'Что скажете?\n\n' + credit, photo: { kind: 'stock', url: 'https://upload.wikimedia.org/x.jpg', credit } };
  assert.doesNotMatch(checkPost(p, { config }).warnings.join(), /нет вопроса/);
  assert.match(checkPost({ ...p, text: 'Утверждение.\n\n' + credit }, { config }).warnings.join(), /нет вопроса/);
});

test('день: невозможная дата — ошибка, не исключение', () => {
  assert.deepEqual(checkDay({ date: '2026-13-45', posts: [] }, { config }).errors, ['Неверная дата 2026-13-45']);
});
