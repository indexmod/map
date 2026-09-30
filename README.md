# Map

Отдельная карта Indexmod на `map.indexmod.press`, основанная на проекте `moscow`.

## Как работает

- Вставьте ссылку на статью `indexmod.press` в открытой странице: появится точка с названием статьи.
- Перетащите цветной кружок мышью или пальцем. Положение сохраняется автоматически.
- Нажмите на название, чтобы открыть статью.
- Координаты относительны размеру экрана; на телефоне подписи выбирают свободное место рядом с кружками.
- Новая ссылка сразу создаёт пульсирующую точку. Анализ идёт в фоне; точка плавно перемещается к рассчитанной позиции и продолжает слегка двигаться и пульсировать.
- Карта держит не более 20 ссылок: 21-я удаляет самую раннюю. Добавление новой ссылки пересчитывает позиции всей группы. Ручные сдвиги сохраняются как смещение от вычисленной позиции.
- Первое открытие этой версии карты очищает старые 20 точек. Их сохранённая копия лежит вне репозитория у автора развёртывания.

## Публикация

Это Cloudflare Worker. Конфигурация `wrangler.toml` задаёт имя `map` и Custom Domain `map.indexmod.press`. GitHub Actions при публикации создаёт или находит отдельное KV-пространство `MAP_DB`, подставляет его ID в конфигурацию и запускает `wrangler deploy`. При наличии зоны `indexmod.press` в аккаунте Cloudflare Wrangler также привязывает домен.

Для запуска workflow нужен GitHub Actions secret `CLOUDFLARE_API_TOKEN`.
Данные `moscow` не используются.

Локально: установите Wrangler (`npm install --no-save --no-package-lock wrangler@4.131.2`), укажите `CLOUDFLARE_API_TOKEN`, выполните `node scripts/prepare-kv.mjs`, затем `npx wrangler deploy`. Скрипт меняет локальный `wrangler.toml` после создания KV; ID можно сохранить в репозитории отдельным коммитом.

## Семантический анализ карты

Требуется Node.js 22+. Отчётный CLI не записывает `map_state`.
На опубликованной карте результат записывается в `map_state` после
фонового анализа вставленной ссылки.
До ответа модели исходная позиция сохраняется.

```sh
cd /Users/andrei/Documents/Codex/2026-09-30/referenced-chatgpt-conversation-this-is-an/work/map
npm ci
npm test
# Актуальные опубликованные ссылки и исходники:
npm run test:published
# Воспроизводимый снимок 30 сентября 2026, без сети:
npm run test:published -- --snapshot test/fixtures/published-2026-09-30.json
# Сохранить новую выборку:
npm run test:published -- --save-snapshot reports/snapshot.json
```

Отчёт: `reports/published.json`. По умолчанию `dry-run`: фильтрация, очистка,
схема, хэши, кэш и отчёт работают, но результат не выдается за анализ модели:
все семантические поля null, confidence 0. Реальные оценки появятся в `hf`.
Ошибки отдельных статей включаются в отчёт; CLI завершится с кодом 1.
Ссылки нормализуются без query/hash и дедуплицируются.

### Критерии и координаты

Редактируемый источник инструкции: `prompts/map-semantic.md`.
JSON Schema: `schemas/analysis.schema.json`; исполняемая схема и проверка:
`src/schema.js`. После изменения схемы обновляйте оба представления и
`analyzerVersion` в `src/analyze.js`; тест проверяет совпадение схем.

Читается только поле `raw` API `https://indexmod.press/_get/<slug>`.
Допуск — единственный top-level scalar `updated` в начальном frontmatter,
валидная дата 2026-09-01…30, в кавычках или без. `created`, `update`, текст
«Updated» и метаданные JSON не заменяют frontmatter. Поддерживается формат
скалярных дат Indexmod, не произвольные YAML aliases/многострочные значения.

Оценки независимы. При любом null или сумме 0 координаты неизвестны (`null`).
Иначе `x=(commercial+experimental)/sum`, `y=(underground+experimental)/sum`:
institutional — верхний левый угол, commercial — верхний правый,
underground — нижний левый, experimental — нижний правый.
Это соглашение движка карты; новые подписи к осям не добавлены.

Возраст применяется после semanticPosition: относительно центра (0.5,0.5),
масштаб от 0.35 для 1900 и старше до 1 для 2026. Границы фиксированы, поэтому
добавление статьи не перемещает другие объекты. Их можно передать в ageTransform.
Неизвестный год оставляет масштаб 1. Старый ненулевой вектор сохраняет направление
и не обнуляется. Равные оценки могут дать центр независимо от возраста.
Отчёт содержит savedPosition, semanticPosition, ageScale, targetPosition.

Кэш хранит только валидированный семантический профиль; координаты считаются
заново. Ключ включает promptHash, analyzerVersion, contentHash (весь raw), mode,
model и endpoint. CLI-кэш: `.cache/analysis`. Новый текст промпта автоматически
меняет хэш. Worker включает prompt-файл в сборку: после редактирования нужен
новый деплой Worker.

### Hugging Face (опционально)

```sh
# HF_TOKEN задайте через окружение; не сохраняйте в Git.
export HF_MODEL=Qwen/Qwen3-4B-Instruct-2507:nscale
export HF_ENDPOINT=https://router.huggingface.co/v1/chat/completions
npm run test:published -- --mode hf
```

Используется chat completions с temperature 0, structured JSON Schema и
проверкой evidence: каждая цитата обязана встречаться в очищенной статье.
Это проверяет наличие цитат, но не гарантирует правильность интерпретации.
Доступность конкретной модели зависит от HF provider/account; при отсутствии
поддержки отчёт покажет ошибку, без подмены модели или фиктивных оценок.
Конфигурация следует [HF Inference Providers](https://huggingface.co/docs/inference-providers/index).

### Модель на опубликованной карте

По умолчанию используется Cloudflare Workers AI через binding `AI` и
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, чтобы фоновые запросы не зависели от
исчерпанных кредитов Hugging Face. Cloudflare предоставляет бесплатную суточную
квоту, после которой запросы могут возвращать ошибку; см.
[тарифы Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/).
Для возвращения к Qwen можно указать `MAP_AI_PROVIDER = "hf"` в
`wrangler.toml`; тогда нужен секрет `HF_TOKEN` и доступные кредиты HF.

Кнопок и запроса токена в интерфейсе нет. После вставки ссылки анализ запускается автоматически. Если модель временно недоступна, точка показывает ошибку; при следующем открытии карта пробует анализ снова. Кэш анализов хранится отдельно от списка точек в KV. Публичный endpoint ограничен 30 запросами на IP в час.

### Тест в Worker

```sh
cp .dev.vars.example .dev.vars
# Задайте свой ANALYZER_TEST_TOKEN в .dev.vars; HF_TOKEN нужен только для hf.
npm run dev:test
curl -X POST http://localhost:8787/api/test-published \
  -H "Authorization: Bearer $ANALYZER_TEST_TOKEN"
```

В shell для curl задайте тот же ANALYZER_TEST_TOKEN, что и в `.dev.vars`.
Worker читает текущую опубликованную карту и статьи, возвращает JSON.
`?mode=hf` включает модель явно. `?offset=20&limit=20` — пагинация;
не больше 20 точек на запрос. Ответ содержит nextOffset.

Для отдельного облачного стенда (не выполнено в рамках этой работы):

```sh
npx wrangler secret put ANALYZER_TEST_TOKEN --config wrangler.test.toml
# Только если нужен hf:
npx wrangler secret put HF_TOKEN --config wrangler.test.toml
npx wrangler deploy --config wrangler.test.toml
```

После деплоя используйте выданный workers.dev URL с тем же POST и Bearer token.
По умолчанию Worker работает без постоянного кэша. Для его подключения создайте
отдельный KV `ANALYSIS_CACHE` и впишите id в закомментированный блок
`wrangler.test.toml`. Не используйте production MAP_DB для этого стенда.

### Найденные опубликованные точки

Снимок и полный исходный Markdown: `test/fixtures/published-2026-09-30.json`.
17 из 20 прошли фильтр. Полный список с датами — `docs/published-links.md`.
