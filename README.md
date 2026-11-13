# High Cardinality

*or: I Acked a Page at 3 A.M. and Woke Up in an Observability Stack Where the Three Pillars Want to Date Me (but One of Them Only Shows Up to 1% of Our Dates)*

A queer-friendly isekai dating sim about observability, running entirely in the browser. ClickHouse
(chdb-wasm) is the game's brain: affection, route unlocks and endings are SQL over views of your own
events. **Stop sampling yourself.**

## Run it

```bash
npm install          # also copies the chdb engine into public/chdb-<hash>/
npm run dev          # http://localhost:5173 (cross-origin isolated)
npm test             # unit tests (node:test): scene engine, pronouns, validator, resume, saves
npm run e2e          # Playwright: smoke, polish, PWA and two full playthroughs, Chromium + Firefox
npm run lint:content # content lint (also runs in the build)
```

Runs in Chrome, Edge and Firefox, on desktop and Android, and installs as a PWA that plays
offline after the first visit. Safari and iOS lack WebAssembly Memory64 and get an in-world
unsupported screen.

The engine is chdb's single-threaded build, compiled while it streams. The threaded build hangs
Firefox on about a third of boots (see `docs/m0-report.md`), and dropping its worker pool plus
JS-side buffering roughly halves memory, which matters on phones. Tables use the Memory engine,
the one engine the single-threaded build can run; the IndexedDB event log is the durable copy.

## How it works

- **Event log = save file.** Every action appends one wide event to IndexedDB. On load the log is
  replayed into chDB. Export/import is the log as JSONEachRow.
- **chDB is the read side.** `src/db.ts` is the only module that touches it. Player strings are bound
  as query parameters through one audited helper (`src/sql.ts`). The Query Shell is the only raw SQL
  path and runs on a `readonly = 1` connection with time and row limits.
- **The three pillars are views** over one `events` table (`sql/schema.sql`): Metrics is a summing
  materialized view keyed by `(character, scene)`, Traces keeps 1% plus anything marked
  `sampling.priority = 1`, Logs keeps only `ts, character, dialogue_text`. The shell's Logs, Trace
  and Metrics views (`src/viz.ts`) draw them; every view query is logged like a typed one, and
  `EXPLAIN QUERY TREE` tells us which tables a query read.
- **The incident is generated, not saved.** `src/incident.ts` writes the Realm's spans and log lines
  into chDB from a seed (the session ID) when Act 3 starts. The event log keeps only the markers
  (`incident_started`, `trace_kept`), and a replay regenerates the same incident from them. The
  true ending needs all three turning points to land (`content/queries/all_turned.sql`).
- **The scene engine is deterministic TypeScript** (`src/engine/`), free of DOM and chDB, tested
  with a fake query layer.

## Writing content

- Scenes: `content/scenes/*.yaml`. Conditions and `show:` tables: `content/queries/*.sql`.
- Characters and their pronouns: `content/characters.yaml`. Art registry: `content/assets.yaml`.
- Design canon: `docs/characters.md` (voices, arcs, visual design) and `docs/story.md` (flow,
  endings, affection mechanics).
- Pronouns are span attributes: never write he/she/him/her… in content. Use `{they}`, `{them}`,
  `{their}`, `{theirs}`, `{themself}`, `{They}`, `{name}`, `{gender}`, verb agreement `[is|are]`,
  and NPC forms like `{logs.she}` / `[logs:is|are]`. The lint fails the build on hardcoded pronouns,
  unknown tokens, dead ends, unreachable nodes, missing queries and more.

## Art pipeline

`tools/art/gen.py` runs on a GPU pod (Runpod, one RTX-class card): Animagine XL 4.0 (SDXL anime,
OpenRAIL++), Compel for long prompts, face-only inpainting for the six expressions (body and framing
identical across moods), `isnet-anime` matting with one shared matte per character, and a 1.5×
img2img pass for full-screen backgrounds and CGs. Prompts come from `docs/characters.md`. Finished
art lives in `public/art/` as WebP.

## Deploy

Vercel, static. `vercel.json` sets caching (the engine directory is content-hashed and immutable)
and COOP/COEP. Music, sound effects and babble come from ElevenLabs via `tools/audio/generate.mjs`;
icons and the social card from `tools/brand/render.mjs`.
