# 20 ежедневных постов @ter_cars: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Подготовить до 20 вариантов на каждый следующий день и позволить публиковать каждый оставленный вариант только после отдельного одобрения, максимум 20 в сутки.

**Architecture:** Генератор читает количество и времена из `config.json`, а пульт синхронизирует эту конфигурацию и публикует только одобренные карточки. GitHub Actions перед генерацией собирает свежие сигналы из публичных Telegram превью, Пикабу и RSS «За рулём»; снимок подаётся модели, но не коммитится. Обновляем дневной лимит и расписание с 05.11.2026, сохраняем тихое окно и подгоняем минимальный интервал под 45-минутные слоты и задержку 1–6 минут.

**Tech Stack:** Node.js ES modules, встроенный `node:test`, JSON.

**Spec:** `docs/superpowers/specs/2026-11-04-ter-cars-20-posts.md`

## Global Constraints

- Никакой пост не публикуется без отдельного нажатия «ОК».
- С 05.11.2026 — 20 черновиков и максимум 20 публикаций за день.
- Слоты: 06:00, 06:50, 07:40, 08:30, 09:20, 10:40, 11:30, 12:20, 13:10, 14:00, 14:50, 15:40, 16:30, 17:20, 18:10, 19:00, 19:50, 20:40, 21:30, 22:20 МСК.
- Слоты не попадают в `09:50-10:20`, промежутки не меньше 50 минут; `minGapMin` равен 45 минутам, `jitterMin` остаётся `[1, 6]`.
- Исторические записи с 27.10 по 04.11 сохраняют прежние нормы.
- Не менять код, сайт или учётные данные Барна.

## Review Focus

- 20 слотов должны быть ровно 20 и отсортированы; проверка конфигурации ловит ошибку количества или порядка.
- Ни один слот или его случайный сдвиг 1–6 минут не должен попадать в тихое окно.
- Ближайшие фактические выходы с jitter должны соблюдать минимум 45 минут.
- Исторические лимиты 2 и 4 должны остаться прежними.
- Одобренное состояние остаётся индивидуальным для каждого поста; настройка сама не меняет статусы.

---

### Task 1: Pin down the daily schedule contract

**Files:**
- Modify: `scripts/rules.test.mjs`
- Read: `config.json`

- [ ] Add a test asserting that the 05.11.2026 config has `perDay=20`, exactly 20 ordered slots, all outside quiet hours, and adjacent slot gaps of at least 50 minutes (45-minute minimum plus at most 5-minute jitter difference).
- [ ] Run `node --test scripts/rules.test.mjs`; confirm the new assertion fails against the current 4-slot configuration.

### Task 2: Set the 20-post configuration and explain approval semantics

**Files:**
- Modify: `config.json`
- Modify: `PROMPT.md`
- Modify: `scripts/rules.test.mjs`

- [ ] Keep historical `perDay` and `slots` rows; append 20 from 2026-11-05 and lower global `minGapMin` to 45.
- [x] Add a clear prompt instruction: produce exactly 20 candidates, and they remain drafts until each is separately approved; skipped/unapproved candidates must never be treated as approved. The validator requires the exact count and configured slot order from 05.11 onward, while preserving any historical manually adjusted times.
- [x] Update the schedule-contract test and historical expectations: 2 through 02.11, 4 on 03–04.11, 20 from 05.11.
- [x] Run `node --test scripts/*.test.mjs` and `node scripts/check-posts.mjs`; confirm all existing historical drafts still validate.

### Task 3: Connect the generator through GitHub Actions

**Files:**
- Add: `.github/workflows/generate-drafts.yml`
- Add: `scripts/generate-drafts.mjs` and its tests

- [x] Schedule GitHub Copilot CLI daily at 15:00 Moscow time using the short-lived Actions token, with all Copilot tools denied.
- [x] Validate model JSON and commit only the new draft file; never approve or publish posts.
- [x] Run the workflow manually for 2026-11-05; confirm it succeeds and creates exactly 20 valid drafts.
- [x] Verify the generated draft commit and JSON file exist on `main`; the approval site is expected to read the repository's current drafts through its existing integration.

### Task 4: Review and publish the change through GitHub

**Files:**
- Review: `config.json`, `PROMPT.md`, `scripts/rules.test.mjs`, this spec and plan.

- [ ] Review the diff for exact count, times, date boundary, quiet window, and individual approval language.
- [x] Commit the change and push it to `main` in `mashater7/ter-cars`, following the repository's direct-main workflow.
- [x] Verify GitHub `main` contains the commit and the remote config has 20 slots from 05.11.
- [x] Verify GitHub Actions created and committed 20 valid drafts, without publishing any post.

### Task 5: Collect fresh research before generating drafts

**Files:**
- Add: `scripts/collect-research.mjs` and tests
- Modify: `.github/workflows/generate-drafts.yml`, `scripts/generate-drafts.mjs` and tests
- Modify: this spec and plan

- [x] Fetch public Telegram previews, Pikabu automotive hot page (respecting robots and crawl delay), and Za Rulem RSS; keep only relevant entries from the past 72 hours.
- [x] Fail closed when fewer than five fresh entries or fewer than two source categories are available; never fall back silently to old research.
- [x] Pass the live snapshot to the generator and reject news items whose source URL was not collected in this run.
- [x] Add a `research_only` workflow-dispatch option for checking the cloud collection without generating drafts.
- [x] Run parser tests and full project tests; validate the collector against live public pages locally.
- [x] Push and run the research-only workflow in GitHub Actions to verify runner access to the live sources; run `41902055681` succeeded and collected 45 signals from four sources.
