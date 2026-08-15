# What's in my Fridge?

Web-App, um auf einen Blick zu sehen, was an Lebensmitteln im Haus ist, Rezepte
mit dem Vorrat abzugleichen und sich per LLM Rezeptvorschläge aus vorhandenen
Zutaten geben zu lassen.

## Tech-Stack

- React + TypeScript + Vite
- Tailwind CSS
- Supabase (Postgres, Auth, Storage, Realtime)
- Supabase Edge Function als Proxy zum LLM (Anthropic API)
- Barcode-Scan über `html5-qrcode`
- Produktdaten via Open Food Facts API
- PWA (`vite-plugin-pwa`) für Installation auf dem iOS-Homescreen

## Setup

### 1. Supabase-Projekt anlegen

1. Erstelle ein Projekt auf [supabase.com](https://supabase.com).
2. Installiere die Supabase CLI (`brew install supabase/tap/supabase` oder
   siehe [Doku](https://supabase.com/docs/guides/cli)).
3. Verknüpfe das lokale Projekt mit deinem Supabase-Projekt:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

### 2. Datenbank-Migration anlegen

```bash
supabase db push
```

Das legt die Tabellen `food_items`, `recipes`, `recipe_ingredients`,
`shopping_list_items`, `meal_plan_items`, `recipe_cook_log`, `staple_items`,
`consumption_log` und `inventory_log` an (siehe `supabase/migrations/`).

### 3. Edge Functions deployen

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

### 4. Umgebungsvariablen

```bash
cp .env.example .env
```

Trage in `.env` die `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` aus den
Supabase-Projekteinstellungen (Project Settings → API) ein. Der LLM-API-Key
wird **nicht** in `.env` gesetzt, sondern als Supabase Secret (siehe Schritt 3),
damit er nie im Client landet.

### 5. Dev-Server starten

```bash
npm install
npm run dev
```

Die App ist danach unter `http://localhost:5173` erreichbar.

### 6. Als App auf dem iPhone installieren (PWA)

Die App muss über **HTTPS** erreichbar sein. Da sie nur für dich/deine
Familie gedacht ist, läuft das lokal über **Tailscale** statt über ein
öffentliches Deployment — Mac und iPhone müssen im selben Tailnet sein
(Tailscale-App auf beiden installiert und eingeloggt).

Trage in `.env` den Tailscale-Hostnamen deines Rechners als
`VITE_ALLOWED_HOST` ein (z. B. `dein-rechner.dein-tailnet.ts.net`), damit
Vite Requests mit diesem Host-Header akzeptiert.

**Bei Bedarf starten** (auf dem Mac, in einem Terminal-Tab offen lassen, im
Projektordner):

```bash
npm run preview -- --port 4173 --strictPort --host 127.0.0.1
```

Richte einmalig `tailscale serve` als Proxy auf Port 4173 ein (siehe
[Tailscale-Doku](https://tailscale.com/kb/1242/tailscale-serve)) — die
Konfiguration bleibt danach dauerhaft bestehen. Sobald der Preview-Server
läuft, ist die App erreichbar unter deinem Tailscale-Hostnamen, z. B.:

```
https://dein-rechner.dein-tailnet.ts.net/
```

**Stoppen:** Terminal-Tab mit `Ctrl+C` schließen bzw. beenden.

Auf dem iPhone dann in **Safari**:

1. Obige URL öffnen.
2. Teilen-Button → **„Zum Home-Bildschirm"**.
3. Die App erscheint als eigenes Icon und startet im Vollbild ohne
   Safari-Oberfläche.

Kein App-Store-Account, keine Review, keine jährliche Gebühr nötig, und
nichts ist öffentlich im Internet erreichbar — nur Geräte in deinem
Tailnet.

### 7. Mehrere Nutzer:innen (Familie)

Weitere Geräte bekommen Zugriff, indem sie in dasselbe Tailscale-Tailnet
eingeladen werden (Tailscale-Adminkonsole → „Invite users/devices"). Ein
eigener Login in der App ist nicht nötig, da die Daten für alle Geräte im
Tailnet geteilt sind (offene RLS-Policies, kein Auth-Gate — siehe
`supabase/migrations/0001_init.sql`).

Damit alle offenen Tabs live in Sync bleiben (z. B. Partner:in fügt ein
Produkt hinzu, es taucht sofort auf dem anderen Handy auf, ohne manuelles
Neuladen), sind alle geteilten Tabellen an die Supabase-Realtime-Publication
angehängt (`supabase/migrations/0009_enable_realtime.sql` und die jeweilige
Migration der neueren Tabellen), und die Seiten abonnieren `postgres_changes`
darauf (`src/lib/useRealtimeRefresh.ts`).

## Projektstruktur

```
src/
  components/   # wiederverwendbare UI-Bausteine (z. B. BottomNav)
  pages/        # Seiten/Routen (Inventar, Rezepte, Assistent, ...)
  lib/          # Supabase-Client und sonstige Hilfsfunktionen
  types/        # geteilte TypeScript-Typen
supabase/
  migrations/   # SQL-Migrationen für die Datenbank
  functions/    # Edge Functions (LLM-Proxy)
scripts/
  seed-demo-data.mjs        # füllt die DB mit Beispieldaten zum Ausprobieren
  backfill-nutrition.mjs    # schätzt Nährwerte für ältere Rezepte nach
```

## Demo-Daten

Um die App direkt mit Beispieldaten auszuprobieren (Vorrat, Rezepte,
Einkaufsliste, Wochenplan und 30 Tage Verlauf für die Statistiken):

```bash
node --env-file=.env scripts/seed-demo-data.mjs
```

**Achtung:** Das Script leert vorher alle betroffenen Tabellen — nicht gegen
eine Datenbank mit echten Daten laufen lassen, die du behalten willst.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
