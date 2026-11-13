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
npm run e2e          # Playwright: smoke + two full playthroughs in Chromium with real chDB
npm run lint:content # content lint (also runs in the build)
```

Chromium-based browsers only for now: Safari and iOS lack WebAssembly Memory64, and Firefox hangs
on about a third of engine boots (see `docs/m0-report.md`). Both get an in-world unsupported screen.

## How it works

- **Event log = save file.** Every action appends one wide event to IndexedDB. On load the log is
  replayed into chDB. Export/import is the log as JSONEachRow.
- **chDB is the read side.** `src/db.ts` is the only module that touches it. Player strings are bound
  as query parameters through one audited helper (`src/sql.ts`). The Query Shell is the only raw SQL
  path and runs on a `readonly = 1` connection with time and row limits.
- **The three pillars are views** over one `events` table (`sql/schema.sql`): Metrics is a summing
  materialized view keyed by `(character, scene)`, Traces keeps 1% plus anything marked
  `sampling.priority = 1`, Logs keeps only `ts, character, dialogue_text`. The true ending unlocks
  when you query the base table (`EXPLAIN QUERY TREE` tells us which tables a query read).
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

Vercel, static. `vercel.json` sets COOP/COEP (required for the threaded engine) and caching:
the engine directory is content-hashed and immutable.
