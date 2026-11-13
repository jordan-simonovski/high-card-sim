# Story structure and mechanics

Read with `docs/characters.md`. The script lives in `content/scenes/*.yaml`; game logic is the SQL in
`content/queries/*.sql`. `npm run lint:content` must pass (it also runs in the build).

## Flow

```
prologue ─► registry ─► mesh (hub) ─┬─► date_logs ────┐
                         ▲          ├─► date_metrics ─┤ each returns to @mesh
                         └──────────┴─► date_traces ──┘
                mesh, once all_dated ─► shell ─► monitoring ─► finale ─► one of 8 endings
```

| scene | bg | what happens |
|---|---|---|
| `prologue` | bedroom_night → ingest_void | 3am page, the isekai, character creation ("span attributes"), the `hesitated` branch. Already written; ends by jumping to `@registry`. |
| `registry` | registry | The DBA greets you with a default value (`NULL`), hotfixes it. Panics that `player.gender` is free text, not an enum (`gender_blank` branch for an empty gender). Grows. The stranger is revealed as the Collector. The DBA explains: the page resolves when you're known whole; the three pillars each hold a piece of you. |
| `mesh` | mesh_plaza | Hub. First visit (`first_mesh_visit`): Baggage cameo. Branch `all_dated` → `@shell`. Otherwise choices to each date not yet taken (`not_dated_logs` etc.). |
| `date_logs` | archive_cafe | Logs overshares. "Tell me more" vs "TL;DR?" choices. Affection is conversation volume. |
| `date_metrics` | dashboard_gym | Metrics, terse. `affection_delta` choices, one possible argument. A `show: metrics_view_of_you` moment: "this is all of you I get to keep". |
| `date_traces` | sampling_cafe | Traces doesn't show up (`traces_saw_you` false) until you choose to mark the moment important (`sampling.priority: "1"`). Then a gentle date where marked moments are the ones they keep. |
| `shell` | registry | The DBA gives you the Query Shell (`action: open_console`): read-only SQL over your own events. Hints that each pillar sees only part of you; "somewhere, you're whole". |
| `monitoring` | noc_room | The ex. `show: monitoring_dashboard`. Can't answer new questions. Choice `relapse` (get back together) or let them go kindly. |
| `finale` | finale_sky | `chose_relapse` → relapse ending. Else `show: relationship_status`, then choose: Logs / Metrics / Traces / all three (only if `queried_base_table`). Each pillar branches on its affection query to a good or bad ending. |

## Endings (all in `finale.yaml`)

| node | `ending:` title | gate |
|---|---|---|
| `end_polycule` | Stop Sampling Yourself | choice condition `queried_base_table` (true ending; `cg: polycule`) |
| `end_logs` | Verbose, Forever | chose Logs and `logs_affection_high` (`cg: logs_end`) |
| `end_retention` | 30-Day Retention | chose Logs, affection low: she rotated you out |
| `end_metrics` | A Dimension Just For You | chose Metrics and `metrics_affection_high` (`cg: metrics_end`) |
| `end_rolled_up` | Rolled Up | chose Metrics, affection low: you're a count now |
| `end_traces` | A Whole Trace | chose Traces and `traces_affection_high` (`cg: traces_end`) |
| `end_sampled_out` | Head-Sampled Out | chose Traces, affection low: sampled out of the relationship |
| `end_relapse` | Monitoring Relapse | `chose_relapse` |

## Affection is SQL over the pillar views

| pillar | query | what counts |
|---|---|---|
| Logs | `logs_affection_high`: `count() >= 18 FROM logs WHERE character='logs'` | every Logs line shown, plus every reply the player picks at a Logs node (choice text is logged as dialogue) |
| Metrics | `metrics_affection_high`: `sum(affection) >= 3 FROM metrics_agg WHERE character='metrics'` | `affection_delta` on choices at Metrics nodes |
| Traces | `traces_affection_high`: `count() >= 3 FROM traces WHERE character='traces'` | choices at Traces nodes with `sampling.priority: "1"` (plus the rare 1% random sample) |

The true ending is gated on the player querying the base `events` table in the Query Shell
(`queried_base_table`): the pillars are lossy views; the whole of you is the wide event.
