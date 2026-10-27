// node --test scripts/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, rubricOf, queueToDays } from './import-queue.mjs';

test('parseCsv: BOM, кавычки, перенос строки и "" внутри ячейки', () => {
  const rows = parseCsv('﻿id;text\r\np1;"строка 1\r\nстрока ""2"""\r\np2;просто\r\n');
  assert.deepEqual(rows, [{ id: 'p1', text: 'строка 1\r\nстрока "2"' }, { id: 'p2', text: 'просто' }]);
});

test('rubricOf: названия рубрик из 03_контент_план.csv', () => {
  assert.equal(rubricOf('Провокация'), 'провокация');
  assert.equal(rubricOf('Ремонт/обслуживание'), 'ремонт');
  assert.equal(rubricOf('История/маркетинг'), 'история');
  assert.equal(rubricOf('Новости'), 'новости');
  assert.equal(rubricOf('Юмор/мем'), 'юмор');
  assert.equal(rubricOf('что-то новое'), '');
});

test('queueToDays: с даты from, рубрика и подсказка из плана, id по времени', () => {
  const queue = [
    { id: 'p2', datetime_msk: '2026-10-29 10:30', text: 'Второй?\r\nабзац', image_url: '', status: 'skip' },
    { id: 'p1', datetime_msk: '2026-10-29 08:00', text: 'Первый?', image_url: '', status: 'skip' },
    { id: 'p0', datetime_msk: '2026-10-28 08:00', text: 'Старый?', image_url: '', status: 'skip' },
  ];
  const plan = [
    { '№': '9', 'Дата': '29.10.2026', 'Время МСК': '08:00', 'Рубрика': 'Провокация', 'Тема': 'Веста или Октавия', 'Визуал: что снять / какое фото': 'Без медиа', 'Источник / проверка (не ссылкой в посте)': '—' },
    { '№': '10', 'Дата': '29.10.2026', 'Время МСК': '10:30', 'Рубрика': 'Ремонт/обслуживание', 'Тема': 'Аккумулятор', 'Визуал: что снять / какое фото': 'Фото клемм', 'Источник / проверка (не ссылкой в посте)': 'ГОСТ' },
  ];
  assert.deepEqual(queueToDays(queue, plan, '2026-10-29', '2026-10-27T12:00:00.000Z'), [{
    date: '2026-10-29', generated_at: '2026-10-27T12:00:00.000Z', posts: [
      { id: 't-2026-10-29-1', time: '08:00', rubric: 'провокация', text: 'Первый?', why: 'Веста или Октавия', photo: { kind: 'none', hint: 'Без медиа' }, source: '', plan_ref: '№9' },
      { id: 't-2026-10-29-2', time: '10:30', rubric: 'ремонт', text: 'Второй?\nабзац', why: 'Аккумулятор', photo: { kind: 'none', hint: 'Фото клемм' }, source: 'ГОСТ', plan_ref: '№10' },
    ] }]);
});
