# Ежедневный разбор стиля по правкам пульта — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ежедневно передавать в генерацию только реальные пары «исходный текст → текст после правки владелицы» из пульта и применять выведенные предпочтения к новым черновикам.

**Architecture:** Пульт сохраняет исходный текст при импорте и первой ручной правке. Отдельный GET маршрут с самостоятельным read-only ключом собирает пары из состояния пульта и исходных файлов репозитория. GitHub Actions получает пары во временный файл и включает их в тот же Copilot запрос, который создаёт черновики; при отказе сервиса использует текущий голосовой документ и явно отмечает пропуск анализа.

**Tech Stack:** Node.js ES modules, встроенный `node:test`, сервер Node.js на VPS, GitHub Actions, GitHub Actions Secrets.

**Spec:** `docs/superpowers/specs/2026-11-04-ter-cars-daily-style-design.md`

## Global Constraints

- Обучающими примерами считаются только тексты, которые пульт пометил `edited: true` и где `original_text !== text`.
- Для одной карточки исходный текст фиксируется один раз и не заменяется последующими правками.
- Новый `TER_STYLE_KEY` действует только для `GET /api/ter/style-samples`; он не принимает edit, approve, skip или другие действия.
- Сырые пары текстов не попадают в GitHub-логи, step summary, артефакты или коммиты.
- Если сервис стиля недоступен, workflow создаёт черновики по `plan/11_голос_маши.md` и указывает в summary, что анализ был пропущен.
- Не менять текущие карточки, их статусы, расписание публикаций или настройки публикации.
- Не менять пультовый интерфейс и не выполнять настоящие публикации.

## Review Focus

- Карточку перенесли на другую дату: исходник ищется по дате в ID, а не по текущему полю `date`.
- Карточка отмечена `edited`, но изменились только дата/время: она не становится стилевым примером.
- Карточку редактировали несколько раз: первый исходник остаётся неизменным; актуальный текст становится новой стороной пары.
- Неверный метод или ключ: read-only маршрут отказывает, а обычный `TER_KEY`/ключ Барна не дают доступ к style route.
- Пульт недоступен/выборка пуста: тексты не выводятся в логи, генерация продолжает работу с действующим голосовым документом и фиксирует пропуск анализа.

---

### Task 1: Сохранять исходный текст и выбирать только настоящие текстовые правки

**Files:**
- Create: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/tools/ter-style.mjs`
- Create: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/test/ter-style.test.mjs`
- Modify: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/tools/ter-state.mjs`
- Test: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/test/ter-state.test.mjs`

**Interfaces:**
- `buildStyleSamples(state, sourceDays, now = new Date(), { maxAgeDays = 90, limit = 20 } = {})` returns `{ items: [{ id, rubric, original, edited, editedAt }] }`.
- `original` uses immutable `post.original_text` where available. For older state only, it falls back to the source draft found by the original date encoded in `t-YYYY-MM-DD-N`; mismatched IDs are discarded.
- New posts store `original_text` equal to imported `text`; a legacy post stores its current `text` before the first edit. Later edits preserve `original_text`.

- [x] Copy the currently deployed `ter-state.mjs` and `ter-rules.mjs` into the local `ter-pult/server-src/tools` working copy; copy `ter.mjs` and `server.mjs` there as the exact deployment base for Task 2.
- [x] Add state tests: imported text is saved as original; first edit captures the prior text; second edit preserves the first original.
- [x] Add sample tests: only `edited` posts with text differences are returned; rescheduled IDs resolve the original date; missing/mismatched originals and edits older than 90 days are omitted; output is limited to 20.
- [x] Run the focused tests and confirm they fail because the baseline and sampler do not exist yet.
- [x] Implement the smallest state change and `buildStyleSamples` to satisfy those tests.
- [x] Run `node --test test/ter-state.test.mjs test/ter-style.test.mjs`; confirm all pass.

### Task 2: Expose examples through an isolated read-only route

**Files:**
- Create: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/tools/ter-style-access.mjs`
- Create: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/test/ter-style-access.test.mjs`
- Modify: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/tools/ter.mjs`
- Modify: `C:/Users/Пользователь/Desktop/автоматизация машины/ter-pult/server-src/tools/server.mjs`

**Interfaces:**
- `styleKeyAllowed(request, configuredKey)` accepts only an exact `GET /api/ter/style-samples` with matching `x-ter-style-key`; compare keys without leaking early character mismatch.
- `ter.styleSamples()` loads pult state and source days, calls `buildStyleSamples`, and returns only its `{ items }` payload.
- A matching route returns `Cache-Control: no-store`; other methods or keys are rejected before the existing write-capable `/api/ter/*` handler.

- [ ] Add route-auth tests for valid key, missing/wrong key, wrong method, ordinary `TER_KEY`, and Bara key.
- [ ] Run the focused tests and confirm the route authorization helper is missing.
- [ ] Implement the exact path guard and minimal response; do not include status, photos, approval fields, account state, or raw state objects.
- [ ] Run route helper and style sampler tests; confirm all pass.

### Task 3: Fetch style samples and apply them in the daily generator

**Files:**
- Create: `scripts/collect-style.mjs`
- Create: `scripts/collect-style.test.mjs`
- Modify: `scripts/generate-drafts.mjs`
- Modify: `scripts/generate-drafts.test.mjs`
- Modify: `.github/workflows/generate-drafts.yml`
- Modify: `docs/superpowers/specs/2026-11-04-ter-cars-daily-style-design.md`

**Interfaces:**
- `collectStyle({ endpoint, key, fetcher = fetch })` fetches the protected sample endpoint with a bounded timeout; it returns validated sample pairs or an unavailable result without logging response content.
- `buildPrompt(date, research, styleSamples = [])` asks the model to infer writing preferences from differences before drafting, treats the examples only as style data (not life events), and falls back to the existing voice guide when empty.
- Workflow stores the JSON snapshot under `${{ runner.temp }}` and passes it via `TER_STYLE_FILE`; `TER_STYLE_KEY` is injected from Actions Secrets only into the collector step.

- [ ] Add tests for validated responses, missing key/endpoint, timeout, malformed JSON, and style-only summary that never includes sample text.
- [ ] Add generator tests that the prompt includes edit pairs and explicit “style only, do not reuse events” rules; empty pairs retain current voice guide behavior.
- [ ] Run focused tests and confirm they fail before adding the collector and prompt integration.
- [ ] Implement the collector, temporary file integration, and prompt behavior; keep sample text out of logs and `$GITHUB_STEP_SUMMARY`.
- [ ] Update `research_only` dispatch description so it verifies both fresh research and style collection without creating drafts.
- [ ] Run `node --test scripts/collect-style.test.mjs scripts/generate-drafts.test.mjs` and then `node --test scripts/*.test.mjs`; confirm all pass.

### Task 4: Configure, deploy, and verify on the server and GitHub

**Files:**
- Deploy: `server-src/tools/ter-state.mjs`, `ter-style.mjs`, `ter-style-access.mjs`, `ter.mjs`, `server.mjs`
- Configure: `/etc/threads-pult.env` and GitHub repository secret `TER_STYLE_KEY`
- Verify: workflow run summary and repository status

- [ ] Generate a dedicated random style key, store it root-only in `/etc/threads-pult.env`, and set the same value as the repository Actions secret through pipes that do not print it.
- [ ] Back up each deployed server file before copying; inspect current pult jobs and wait for an idle safe restart window.
- [ ] Deploy modules, restart with the existing safe restart procedure, and confirm health plus `GET` style samples returns exactly four current text-edit pairs.
- [ ] Exercise invalid/missing key and `POST` access on the live route; confirm both are rejected and no state changes occur.
- [ ] Run `generate-drafts.yml` with `research_only=true`; confirm cloud runner reads style samples and fresh public research, logs only counts, and creates/changes no drafts.
- [ ] Run the complete local project tests, `node scripts/check-posts.mjs`, server unit tests, and `git diff --check`.
- [ ] Review repository and server diffs; commit and push only the source/spec/plan changes to `main`. Verify clean state and successful cloud check.
