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

> Built with [Claude Code](https://claude.com/claude-code): the app was substantially written by it, directed and reviewed by me. Prompts and workflow aside, the design decisions and trade-offs below are mine.

![Photographing a receipt and getting structured, unit-aware inventory rows back](docs/screenshots/add-item.gif)

**Live demo:** none, deliberately. The app has no login and one shared household dataset, so it is served over a private [Tailscale](https://tailscale.com/kb/1242/tailscale-serve) tailnet rather than the public internet — see [the auth decision](#4-an-auth-decision-stated-plainly). The GIFs below are real recordings of the running app, and `scripts/seed-demo-data.mjs` populates a full realistic dataset if you want to run it yourself in one command.

> The interface is in German, because the people who use it every day are. The code, comments and docs are in English.

---

## Why I built it

Food got bought twice and thrown away once, because nobody could remember what was in the freezer. The tracking apps I tried all wanted manual entry of every item, which is exactly the work nobody does after a shop — so the inventory goes stale within a week and the app gets deleted.

So the entry point had to be a camera, not a form. Point it at the receipt or at the open fridge and the contents land as structured, unit-aware rows. Everything else in the app — recipe matching, the meal plan, the shopping list — only works because that first step is cheap enough to actually do.

It runs on my household's phones. It is not a tutorial project.

---

## The 60-second version

| | |
|---|---|
| **The problem** | Food gets bought twice and thrown away once, because nobody knows what's in the freezer. |
| **The hard part** | Not the CRUD. It's deciding whether "1 Dose" of tomatoes covers a recipe asking for "400 g" — and whether "Milch" in the fridge satisfies a recipe wanting "Kokosmilch". (It doesn't.) |
| **The AI part** | 9 Claude-backed Edge Functions doing vision parsing, classification and structured extraction — never a chat box, always a typed result that flows into the database. |
| **The scale** | ~5,200 lines of TypeScript frontend, ~1,000 lines of Edge Functions, 21 SQL migrations, 683 tests across 53 files. |
| **The proof** | It runs on the household's phones over a private tailnet, syncing live between them — not a screenshot of a prototype. |

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript (strict), Vite 8, React Router 7 |
| Styling | Tailwind CSS 4 with a custom design-token layer |
| Backend | Supabase — Postgres, Realtime, Storage, Edge Functions (Deno) |
| AI | Anthropic API (Claude), proxied server-side through Edge Functions |
| PWA | `vite-plugin-pwa` with an `injectManifest` Workbox service worker |
| Testing | Vitest, run in GitHub Actions alongside `oxlint` and `tsc` |
| Extras | `html5-qrcode` for barcodes, Open Food Facts for product data, `heic2any` for iPhone photos |

---

## Features

**Getting stock in**
- **Four ways to add it** — type it (category and storage location autosuggested), scan a barcode, photograph the receipt, or photograph the inside of the fridge and let the model enumerate what it sees.
- **Waste and consumption stats** — 30 days of history from an append-only inventory log.

**Recipes**
- **Availability matching** — every recipe shows how many of its ingredients you actually have, quantity-aware, sorted most-cookable first.
- **Constrained suggestions** — free-text prompt in ("high-protein breakfast"), recipes out that are limited to what is genuinely in stock, savable as real recipes in one tap.
- **Live portion scaling** — change the portion count and both the quantities *and* the prose instructions are recalculated.

**Planning and shopping**
- **Meal plan** — spread recipes across the week and push every missing ingredient for all seven days onto the shopping list in one action.
- **Shopping list round-trip** — bought items move straight into inventory with storage location and category filled in.

**Household and platform**
- **Realtime household sync** — consume something on one phone and it disappears on the other, no refresh.
- **Offline-capable PWA** — installs to the iOS home screen; app shell precached, data calls deliberately not.

<details>
<summary><b>See each of them running</b> — inventory, recipes, meal plan, shopping list, suggestions</summary>

### Ask for a recipe you can actually make

![AI suggestions](docs/screenshots/suggest-recipe.gif)

### Inventory

Everything in the house across fridge, pantry and freezer, grouped by category, with search and filters. At the top: what you could cook right now, matched to the current time of day.

![Inventory](docs/screenshots/inventory.gif)

### Recipes

A traffic-light readout of how many ingredients you have for each recipe.

![Recipes](docs/screenshots/recipes.gif)

### Meal plan

![Meal plan](docs/screenshots/meal-plan.gif)

### Shopping list

![Shopping list](docs/screenshots/shopping-list.gif)

</details>

---

## How it works

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
  Realtime pushes postgres_changes back to Pages and components for live sync.
```

The client never holds a model API key. Every LLM call is a typed request to a task-specific Edge Function, which owns the prompt, the key, and the job of turning a language model's output back into a validated object.

**The nine Edge Functions:** `parse-receipt` · `parse-fridge-photo` · `parse-recipe-screenshot` · `classify-item` · `classify-items` · `guess-recipe-tags` · `scale-recipe` · `estimate-nutrition` · `suggest-recipes`

### Four decisions worth reading the code for

#### 1. "Milch" must not match "Kokosmilch"

German fuses compound words. A naive `includes()` check happily reports that you have coconut milk because there's milk in the fridge — a wrong answer that silently corrupts every recipe availability count in the app.

Matching is therefore done on word boundaries, with a light singularisation pass so "Tomaten" still matches "Tomate". Small function, unglamorous, and the whole feature set is worthless without it. It is also the most heavily tested code in the repo, for exactly that reason.

→ [`src/lib/matching.ts`](src/lib/matching.ts) · [tests](src/lib/matching.test.ts)

#### 2. Comparing a tin to a weight

A recipe wants `400 g` of tomatoes. The pantry has `1 Dose`. Are you covered?

There's no universal answer — a tin of tomatoes and a tin of coconut milk don't weigh the same — so items can optionally record their own grams-per-unit factor, and grams becomes the pivot unit for comparison. When neither side can be converted, the code returns `null` and the caller falls back to a presence check rather than inventing a number.

Knowing when *not* to compute an answer was the actual design work here.

→ [`src/lib/stock.ts`](src/lib/stock.ts) · [tests](src/lib/stock.test.ts)

#### 3. Scaling a recipe must not damage the recipe

Cooking for four when the recipe serves two rescales the ingredient quantities — and sends the prose instructions to the model to be rewritten, so "beat 2 eggs" becomes "beat 4 eggs".

That rewrite is strictly a view-level transformation. It always scales from the original instructions rather than a previously scaled version, and is never written back. A model rewriting your saved recipes in place, compounding drift each time, is a data-loss bug waiting to happen.

→ [`src/pages/RecipeDetail.tsx`](src/pages/RecipeDetail.tsx)

#### 4. An auth decision, stated plainly

There is no login, and the row-level security policies are open. That is a deliberate trade, not an oversight: the app is never exposed to the public internet. It's served over [Tailscale](https://tailscale.com/kb/1242/tailscale-serve) to a private tailnet, so the network *is* the access boundary, and household members share one dataset by design.

It's the right call for this deployment and the wrong call for a public one. If this ever needed multi-tenancy, the change is scoped: per-user policies on the existing tables, and an auth gate in front of the router.

→ [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)

### Working with a model that returns prose

Three things go wrong often enough to be handled at the boundary rather than per call site:

- The model wraps JSON in a markdown fence despite being told not to — stripped in [`_shared/extractJson.ts`](supabase/functions/_shared/extractJson.ts) ([tests](supabase/functions/_shared/extractJson.test.ts)).
- The response's first content block isn't necessarily the text block — [`_shared/anthropic.ts`](supabase/functions/_shared/anthropic.ts) looks for it by type rather than assuming `content[0]`.
- A parsed result is never trusted straight into the database. Vision parses land as editable rows the user confirms; classification failures fall back to a default category rather than blocking the save.

### Other things worth a look

| Capability | Where |
|---|---|
| Schema ownership — 21 forward migrations, incl. renames, column drops, a realtime publication | [`supabase/migrations/`](supabase/migrations/) |
| Realtime collaboration between two phones in one household | [`src/lib/useRealtimeRefresh.ts`](src/lib/useRealtimeRefresh.ts) |
| Optimistic UI with real undo, including restoring rows after a cascade delete | [`src/lib/ToastContext.tsx`](src/lib/ToastContext.tsx) |
| Design tokens — three type roles, a cold-chain colour ramp, one signature component | [`src/index.css`](src/index.css), [`src/components/AvailabilityMeter.tsx`](src/components/AvailabilityMeter.tsx) |

---

## Run it yourself

```bash
npm install
cp .env.example .env    # add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev             # http://localhost:5173
```

The tests need no configuration at all:

```bash
npm test                # 683 tests, ~98% statement coverage
npm run lint            # oxlint
npm run build           # tsc -b && vite build
```

All three run on every push via [GitHub Actions](.github/workflows/ci.yml). For anything beyond the tests you'll need a Supabase project.

<details>
<summary><b>Full setup</b> — database, Edge Functions, demo data, installing on an iPhone</summary>

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com), install the [Supabase CLI](https://supabase.com/docs/guides/cli), then link this repo to it:

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### 2. Push the schema

```bash
supabase db push
```

This creates `food_items`, `recipes`, `recipe_ingredients`, `shopping_list_items`, `meal_plan_items`, `recipe_cook_log`, `staple_items`, `consumption_log` and `inventory_log`. See [`supabase/migrations/`](supabase/migrations/).

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

### 4. Environment variables

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Project Settings → API. The app fails fast with a named error if either is missing.

### 5. Demo data

To try the app with a populated pantry, recipes, a shopping list, a week's meal plan and 30 days of history for the statistics:

```bash
node scripts/seed-demo-data.mjs
```

### 6. Install on an iPhone

The app must be served over **HTTPS** to install as a PWA. Since this is a household app, that runs over Tailscale rather than a public deployment — Mac and iPhone both need to be on the same tailnet.

Set `VITE_ALLOWED_HOST` in `.env` to your machine's Tailscale hostname (e.g. `your-machine.your-tailnet.ts.net`) so Vite accepts requests with that Host header, then:

```bash
npm run preview -- --port 4173 --strictPort --host 127.0.0.1
```

Configure [`tailscale serve`](https://tailscale.com/kb/1242/tailscale-serve) to proxy port 4173 once; the configuration persists. The app is then reachable at `https://your-machine.your-tailnet.ts.net/`.

On the iPhone, open that URL in **Safari** → Share → **"Add to Home Screen"**. It launches fullscreen with its own icon. No App Store account, no review, no annual fee, and nothing publicly reachable on the internet.

### 7. Adding household members

Invite their devices to the same tailnet (Tailscale admin console → *Invite users/devices*). No in-app login is needed, because all devices on the tailnet share one dataset — see [decision 4](#4-an-auth-decision-stated-plainly).

Every shared table is attached to the Supabase realtime publication ([`0009_enable_realtime.sql`](supabase/migrations/0009_enable_realtime.sql)) and the pages subscribe to `postgres_changes` ([`useRealtimeRefresh.ts`](src/lib/useRealtimeRefresh.ts)), so open tabs stay in sync without a manual reload.

</details>

---

## Project structure

```
src/
  components/   # shared UI, incl. the availability meter and bottom nav
  pages/        # routes: inventory, recipes, meal plan, shopping list, stats
  lib/          # Supabase client, unit algebra, matching, realtime, toasts
                #   + *.test.ts alongside the modules they cover
  types/        # shared TypeScript types
  index.css     # design tokens and component classes
supabase/
  migrations/   # 21 forward SQL migrations
  functions/    # 9 Edge Functions — the LLM layer
scripts/
  seed-demo-data.mjs       # populate the DB with a realistic dataset
  backfill-nutrition.mjs   # estimate nutrition for older recipes
.github/
  workflows/ci.yml         # lint, test, typecheck + build on every push
```

---

## Status

**Finished and in daily use**, not abandoned and not actively expanded. It does the job it was built for, for the household it was built for, so changes now are occasional fixes and small refinements rather than a roadmap.

Known limits, stated up front rather than buried:

- **Single tenant by design.** No login, open RLS policies, one shared dataset. Safe only behind the private tailnet it is deployed on — see [decision 4](#4-an-auth-decision-stated-plainly).
- **German-only UI.** No i18n layer; the strings are inline.
- **LLM calls cost money and can fail.** Every vision parse lands as editable rows a human confirms before anything is written, so a bad parse costs a correction, not corrupted inventory.

---

## Testing

Vitest, 53 test files, 683 tests, run in CI alongside `oxlint` and `tsc -b`.

| | Coverage |
|---|---|
| Statements | 98.08% |
| Branches | 89.65% |
| Functions | 97.92% |
| Lines | 99.17% |

Enforced with `vitest` coverage thresholds (90/85/90/90) so the build fails if it slips. Supabase is never mocked as a set of stubbed return values — [`src/test/fakeSupabase.ts`](src/test/fakeSupabase.ts) is a small in-memory database, because the logic worth testing in `src/lib` is the merging, filtering and ordering *around* a query, and stubbing the query away would test nothing. The nine Edge Functions run through [`src/test/denoHarness.ts`](src/test/denoHarness.ts), which loads the real function code and stubs the Anthropic response; nothing in the suite makes a real network call.

---

MIT licensed — see [LICENSE](LICENSE).
