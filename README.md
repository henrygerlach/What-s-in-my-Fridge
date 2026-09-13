# What's in my Fridge?

A household food-inventory PWA that turns a photo of a supermarket receipt into structured pantry stock, then tells you which of your recipes you can cook tonight — and exactly which ingredient is missing from the ones you can't.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres_%7C_Realtime_%7C_Edge_Functions-3ECF8E?logo=supabase&logoColor=white)
![Anthropic](https://img.shields.io/badge/Anthropic-Claude-D97757?logo=anthropic&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-tests-6E9F18?logo=vitest&logoColor=white)
[![CI](https://github.com/henrygerlach/What-s-in-my-Fridge/actions/workflows/ci.yml/badge.svg)](https://github.com/henrygerlach/What-s-in-my-Fridge/actions/workflows/ci.yml)

> Built with [Claude Code](https://claude.com/claude-code): the app was substantially written by it, directed and reviewed by me. The design decisions below are mine.

![Photographing a receipt and getting structured, unit-aware inventory rows back](docs/screenshots/add-item.gif)

<details>
<summary><b>See it running</b> — inventory, recipes, meal plan, shopping list, suggestions</summary>

![AI suggestions](docs/screenshots/suggest-recipe.gif)
![Inventory](docs/screenshots/inventory.gif)
![Recipes](docs/screenshots/recipes.gif)
![Meal plan](docs/screenshots/meal-plan.gif)
![Shopping list](docs/screenshots/shopping-list.gif)

</details>

## Why I built it

Food got bought twice and thrown away once, because nobody could remember what was in the freezer. The tracking apps I tried all wanted manual entry of every item, which is exactly the work nobody does after a shop — so the inventory goes stale within a week and the app gets deleted.

So the entry point had to be a camera, not a form. Point it at the receipt or at the open fridge and the contents land as structured, unit-aware rows. Everything else in the app — recipe matching, the meal plan, the shopping list — only works because that first step is cheap enough to actually do. It runs on my household's phones. It is not a tutorial project.

## Features

**Getting stock in**
- **Four ways to add it** — type it (category and storage location autosuggested), scan a barcode, photograph the receipt, or photograph the inside of the fridge and let the model enumerate what it sees.
- **Waste and consumption stats** — 30 days of history from an append-only inventory log.

**Recipes**
- **Availability matching** — every recipe shows how many of its ingredients you actually have. This has to be quantity-aware and word-boundary-aware: German fuses compound words, so a naive substring check would report that "Milch" in the fridge covers a recipe wanting "Kokosmilch" — a wrong answer that silently corrupts every match in the app. Matching is also unit-aware: "1 Dose" of tomatoes and a recipe wanting "400 g" are only comparable once an item has a recorded grams-per-unit factor, and when it doesn't, the code returns "unknown" rather than inventing a number.
- **Constrained suggestions** — free-text prompt in ("high-protein breakfast"), recipes out that are limited to what is genuinely in stock, savable as real recipes in one tap.
- **Live portion scaling** — changing the portion count rescales quantities and sends the prose instructions to the model to be rewritten ("beat 2 eggs" → "beat 4 eggs"). That rewrite always starts from the original instructions, never a previously scaled version, and is never written back — a model compounding drift into your saved recipe on every scale would be a data-loss bug.

**Planning and shopping**
- **Meal plan** — spread recipes across the week and push every missing ingredient for all seven days onto the shopping list in one action.
- **Shopping list round-trip** — bought items move straight into inventory with storage location and category filled in.

**Household and platform**
- **Realtime household sync** — consume something on one phone and it disappears on the other, no refresh.
- **Offline-capable PWA** — installs to the iOS home screen; app shell precached, data calls deliberately not, so the app never shows stale inventory as if it were current.

## Architecture

```
                 ┌────────────────────────────┐
                 │   React PWA (iOS home       │
                 │   screen)                   │
                 │                             │
                 │  Pages and components ◄─────┼── Service worker
                 └──────┬───────────┬──────────┘   (Workbox precache,
                         │           │              offline app shell)
             supabase-js │           │ invoke
                         │           │
                         ▼           ▼
              ┌────────────────┐  ┌──────────────────┐
              │    Supabase    │  │  Edge Functions   │
              │                │  │      (Deno)       │
              │ Postgres       │  └─────────┬─────────┘
              │ 9 tables · RLS │            │ ANTHROPIC_API_KEY,
              │      │         │            │ server-side only
              │      ▼         │            ▼
              │  Realtime ─────┼──►  ┌──────────────┐
              │      │         │     │ Anthropic API│
              │      ▼         │     └──────────────┘
              │   Storage      │
              │ (recipe photos)│
              └────────────────┘

  Pages and components also call Open Food Facts directly for barcode lookup.
```

- **Pages and components** — all UI and the client-side matching/unit logic; talks to Postgres directly over `supabase-js` for normal reads and writes, so most of the app needs no server code at all.
- **Service worker** — precaches the app shell so the PWA installs and opens offline. Data calls are deliberately excluded from the cache; showing a stale receipt scan as current inventory would be worse than showing nothing.
- **Postgres (9 tables, RLS)** — the single source of truth. Row-level security is open rather than per-user: there is no login, and the app is only ever reachable over a private Tailscale tailnet, so the network is the access boundary and household members intentionally share one dataset.
- **Realtime** — pushes `postgres_changes` to every open client so two phones stay in sync without polling.
- **Storage** — holds recipe photos only; not on the write path for inventory.
- **Edge Functions (Deno)** — the only place `ANTHROPIC_API_KEY` exists. Each function owns one prompt and returns a typed, validated object, never raw model prose, and a parsed result is never trusted straight into the database — vision parses land as editable rows the user confirms, and classification failures fall back to a default category rather than blocking the save.
- **Anthropic API** — called only from Edge Functions; the client never holds a model key.
- **Open Food Facts** — called directly from the client for barcode lookups, since no secret is involved.

## Setup

Prerequisites: Node 22, a [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env    # add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev             # http://localhost:5173
```

The tests need no configuration:

```bash
npm test                # 683 tests, ~98% statement coverage
npm run lint            # oxlint
npm run build           # tsc -b && vite build
```

<details>
<summary><b>Full setup</b> — database, Edge Functions, demo data, installing on an iPhone</summary>

### 1. Create a Supabase project and link it

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 2. Push the schema

```bash
supabase db push
```

Creates `food_items`, `recipes`, `recipe_ingredients`, `shopping_list_items`, `meal_plan_items`, `recipe_cook_log`, `staple_items`, `consumption_log` and `inventory_log`. See [`supabase/migrations/`](supabase/migrations/).

### 3. Deploy the Edge Functions

```bash
supabase functions deploy suggest-recipes
supabase functions deploy classify-item
supabase functions deploy classify-items
supabase functions deploy guess-recipe-tags
supabase functions deploy scale-recipe
supabase functions deploy parse-receipt
supabase functions deploy parse-recipe-screenshot
supabase functions deploy parse-fridge-photo
supabase functions deploy estimate-nutrition

supabase secrets set ANTHROPIC_API_KEY=your-anthropic-api-key
```

The model key is set as a Supabase secret, **not** in `.env` — it must never reach the client.

### 4. Demo data

```bash
node scripts/seed-demo-data.mjs
```

Populates a pantry, recipes, a shopping list, a week's meal plan and 30 days of history for the stats.

### 5. Install on an iPhone

The app must be served over HTTPS to install as a PWA. Set `VITE_ALLOWED_HOST` in `.env` to your machine's Tailscale hostname, then:

```bash
npm run preview -- --port 4173 --strictPort --host 127.0.0.1
```

Configure [`tailscale serve`](https://tailscale.com/kb/1242/tailscale-serve) to proxy port 4173 once. On the iPhone, open the resulting `https://` URL in Safari → Share → "Add to Home Screen".

</details>

## Testing

Vitest, 53 test files, 683 tests, run in CI alongside `oxlint` and `tsc -b`.

| | Coverage |
|---|---|
| Statements | 98.08% |
| Branches | 89.65% |
| Functions | 97.92% |
| Lines | 99.17% |

Enforced with coverage thresholds (90/85/90/90) so the build fails if it slips. Supabase is never mocked as a set of stubbed return values — [`src/test/fakeSupabase.ts`](src/test/fakeSupabase.ts) is a small in-memory database, because the logic worth testing in `src/lib` is the merging, filtering and ordering *around* a query, and stubbing the query away would test nothing. The nine Edge Functions run through [`src/test/denoHarness.ts`](src/test/denoHarness.ts), which loads the real function code and stubs the Anthropic response; nothing in the suite makes a real network call.
