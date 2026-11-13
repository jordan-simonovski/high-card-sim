# Story structure and mechanics

Read with `docs/characters.md`. The script lives in `content/scenes/*.yaml`; game logic is the SQL in
`content/queries/*.sql`. `npm run lint:content` must pass (it also runs in the build).

## Flow

```
prologue ─► registry ─► mesh (hub) ─┬─► date_logs ────┐
                         ▲          ├─► date_metrics ─┤ each returns to @mesh
                         └──────────┴─► date_traces ──┘
                mesh, once all_dated ─► shell ─► monitoring ─► incident ─► phase_logs ─► phase_metrics
                ─► phase_traces ─► root_cause ─► resolution ─► finale (the portal) ─► one of 9 endings
```

| scene | bg | what happens |
|---|---|---|
| `prologue` | bedroom_night → ingest_void | 3am page, the isekai, character creation ("span attributes"), the `hesitated` branch. Already written; ends by jumping to `@registry`. |
| `registry` | registry | The DBA greets you with a default value (`NULL`), hotfixes it. Panics that `player.name` is free text, not an enum. Grows. The stranger is revealed as the Collector. Seed: the lights flicker and a clerk blinks out; the deal is set (resolve the incident, the page closes, the portal home opens). |
| `mesh` | mesh_plaza | Hub. First visit (`first_mesh_visit`): Baggage cameo (and the flickers: "half my tags point at people who aren't there anymore"). Branch `all_dated` → `@shell`. Otherwise choices to each date not yet taken (`not_dated_logs` etc.). |
| `date_logs` | archive_cafe | Logs overshares. "Tell me more" vs "TL;DR?" choices. Affection is conversation volume. Seed (Tell-me-more path only): a WARN she keeps writing, buried in a tangent. |
| `date_metrics` | dashboard_gym | Metrics, terse. `affection_delta` choices, one possible argument. A `show: metrics_view_of_you` moment. Seed: dropped labels, and an error counter he can't break down. |
| `date_traces` | sampling_cafe | Traces doesn't show up (`traces_saw_you` false) until you choose to mark the moment important (`sampling.priority: "1"`). Seed: a request they've never once seen finish. |
| `shell` | registry | The DBA gives you the Query Shell (`action: open_console`): read-only SQL over your own events. Hints that each pillar sees only part of you, and that the table they all come from has all of you. |
| `monitoring` | noc_room | The ex. `show: monitoring_dashboard`. Can't answer new questions. Choice `relapse` (get back together) or let them go kindly. Both go to `@incident`. |
| `incident` | noc_room | Sev-1. `action: incident_start` (generates the Realm's telemetry into `events`), sfx `alarm`, music `incident`. Everyone gathers. |
| `phase_logs` | archive_cafe | `open_console:logs`, then "what did you find?". Answer: `WARN cardinality limit exceeded, dropping series`. Turning point by `logs_affection_high`. |
| `phase_metrics` | dashboard_gym | Metrics adds `tier` back while you stay with him. `open_console:metrics`; answer: `onlyspans`. Turning point by `metrics_affection_high`. |
| `phase_traces` | sampling_cafe | `open_console:trace` (nothing there), `action: keep_trace`, `open_console:trace` again; answer: `collector.batch_processor`. Line gated on `trace_kept`; turning point by `traces_affection_high`; `show: incident_errors`. |
| `root_cause` | registry | `open_console` on the base table, `show: root_cause`. OnlySpans stamped a unique `subscriber_id` on every span. The Collector is mortified. |
| `resolution` | registry | Sampling policy, boundaries for the Collector, the DBA's constraint. `action: resolve_incident` (music `resolution`, sfx `resolve`). |
| `finale` | finale_sky | The portal. `chose_relapse` → relapse ending. Else `show: relationship_status`, then: stay for Logs / Metrics / Traces (each branches on its affection query to a good ending, or they send you home: a bad ending), stay for all three (only if `all_turned`), or go home. |

Each phase is "look, then answer": wrong answers get a hint in the pillar's voice and a re-ask
whose options always move forward (the answer, look again, or "tell me"). No incident choice
carries `affection_delta` or `sampling.priority`, so the finale gates still read the dates.

## Endings (all in `finale.yaml`)

| node | `ending:` title | gate |
|---|---|---|
| `end_polycule` | Stop Sampling Yourself | choice condition `all_turned` (true ending; `cg: polycule`) |
| `end_logs` | Verbose, Forever | chose Logs and `logs_affection_high` (`cg: logs_end`) |
| `end_retention` | 30-Day Retention | chose Logs, affection low: she rotated you out |
| `end_metrics` | A Dimension Just For You | chose Metrics and `metrics_affection_high` (`cg: metrics_end`) |
| `end_rolled_up` | Rolled Up | chose Metrics, affection low: you're a count now |
| `end_traces` | A Whole Trace | chose Traces and `traces_affection_high` (`cg: traces_end`) |
| `end_sampled_out` | Head-Sampled Out | chose Traces, affection low: sampled out of the relationship |
| `end_home` | Resolved at 03:12 | chose to go home (bittersweet) |
| `end_relapse` | Monitoring Relapse | `chose_relapse` |

## Affection is SQL over the pillar views

| pillar | query | what counts |
|---|---|---|
| Logs | `logs_affection_high`: `count() >= 18 FROM logs WHERE character='logs'` | every Logs line shown, plus every reply the player picks at a Logs node (choice text is logged as dialogue) |
| Metrics | `metrics_affection_high`: `sum(affection) >= 3 FROM metrics_agg WHERE character='metrics'` | `affection_delta` on choices at Metrics nodes |
| Traces | `traces_affection_high`: `count() >= 3 FROM traces WHERE character='traces'` | choices at Traces nodes with `sampling.priority: "1"` (plus the rare 1% random sample) |

The true ending is gated on `all_turned`: all three affection queries high (Logs counted up to the
start of the incident). The pillars are lossy views; the whole of you is the wide event.
