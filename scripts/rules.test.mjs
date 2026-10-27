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
