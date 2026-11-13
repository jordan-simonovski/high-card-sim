# Story v2: the incident, the turning points, and staying

A treatment for expanding the game from a vertical slice into a full, cohesive story. It keeps
everything that works now (the prologue, the Registry, the three dates, the shell, Monitoring,
the Collector's OnlySpans gag) and gives it a spine: the page that summoned you is a real incident
in this world, and fixing it is how you fall in love.

## The spine in one paragraph

You're paged at 3 a.m. and fall into the Observability Realm, a world that runs on its own
telemetry. The page doesn't stop, because the Realm is quietly sampling itself to death: citizens
flicker out of existence, sectors of the Mesh go dark, and every dashboard says green. The DBA
tells you the page resolves when the incident does, and that's when the portal home will open.
You spend the first half getting to know the three pillars, each of whom sees only part of the
world, and part of you. In the second half the incident escalates, and you work it with them. Each
pillar leads one phase of the investigation, and each phase is that pillar's turning point. The
root cause is found the only way it can be: in the wide events, where nobody sampled, summed or
truncated anything. The incident resolves, the page closes, the portal opens, and you decide
whether to go home.

## Acts

### Act 1: The page (prologue, Registry, Mesh)

As now, with the incident seeded early:
- The page that wakes you: CRITICAL, checkout p99, everything green.
- In the Registry, the DBA's hotfix and free-text panic, and the Collector's reveal (and OnlySpans).
  New: the lights flicker mid-scene, and a filing clerk in the background blinks out and back.
  The DBA: "That keeps happening. It's in nobody's dashboard. The page that brought you is
  probably about this." Sets the stakes and the deal: resolve the incident, and the page closes
  and the portal opens.
- The Mesh hub: Baggage's gossip now includes the flickers ("half my tags are pointing at people
  who aren't there anymore").

### Act 2: Three dates (as now, plus a seed for each turning point)

Each date keeps its current shape and adds one small beat that the incident pays off later:
- **Logs:** she admits nobody reads her except at 3 a.m., looking for ERROR. She mentions, in
  passing and buried in a tangent, that she's been writing a WARN line over and over lately and
  nobody's noticed. (The clue, hidden in plain sight, in her voice.)
- **Metrics:** he explains he dropped his labels to save memory and that it's fine; it's
  efficient. He also mentions an error-rate counter that keeps climbing and that he "can't break
  down". (The clue: the dimension he dropped is the one that matters.)
- **Traces:** they only ever catch the start of things. They mention a request that keeps dying
  somewhere in the middle, and that they've never once seen it finish. (The clue: the failing
  path is exactly what head sampling drops.)

### Interlude: the shell, and the ex (as now)

The DBA gives you the Query Shell and its views (Logs stream, Trace waterfall, Metrics charts).
Monitoring shows up with their saved queries, which can't see the incident at all ("Status: OK.
Status: OK.") and you can relapse or let them go. Moving the shell before Monitoring makes the
point: Monitoring only answers known questions, and you're about to need new ones.

### Act 3: The incident (new, the heart of the game)

A Sev-1 is declared: the Mesh goes dark sector by sector, and citizens are being sampled out of
existence. The pillars come to you. Three phases, each one led by a pillar and played in the shell
over the Realm's own telemetry (generated into the events table when the incident starts, so every
view shows it):

1. **Logs: read everything.** In the Logs view, among thousands of her lines, the WARN she
   mentioned on your date: `cardinality limit exceeded, dropping series`. You find it by reading
   her the way nobody does (filter by WARN, or just scroll her). Turning point: "You didn't grep
   me. You read me." If you skimmed her on the date (TL;DR path), she's surprised you found it,
   and it lands softer.
2. **Metrics: add the dimension back.** In the Metrics view the error spike can't be broken down.
   You ask him to bring back one label he dropped. He's afraid of what it'll cost him: remembering
   detail means remembering what he'll lose. You stay with him while he does it. The breakdown
   shows one value of one attribute carrying almost every error. Turning point: he chooses to
   remember something precisely, for you.
3. **Traces: keep the moment that matters.** In the Trace view the failing request never appears,
   because head sampling drops it. You mark it important (tail sampling), and for the first time
   Traces is present for the whole thing: the request, its path, the span where it dies, and you
   in the root span. Turning point: "I saw all of it. You were in every span."
4. **The wide event: the root cause.** The three clues only make sense together. You query the
   base `events` table, and GROUP BY the attribute Metrics added back: it's `subscriber_id`. The
   Collector's OnlySpans premium tier ("every span, unsampled, uncut") stamped a subscriber ID on
   every span in the Realm, and the cardinality explosion is what's sampling people out of
   existence. The fix isn't a villain's defeat: the Collector, mortified, agrees to a sampling
   policy and some boundaries, and the DBA gets to write a constraint they're proud of.

Each phase is a light puzzle: a pillar asks what you found, with choices informed by what the
views show. Wrong answers get a hint in that pillar's voice; nobody gets stuck. How well each
turning point lands depends on your affection with that pillar so far.

### Act 4: The portal (new endings)

The incident resolves. The page finally stops. A portal home opens in the Registry, and the DBA,
a little sad, says you can go back to your on-call rotation now. You choose:

- **Stay, for one pillar.** The good endings (and their illustrations): you never go home. "Put
  me on the rota here. Permanently." Each needs that pillar's affection high and their turning
  point landed.
- **Stay, for all three.** The true ending: the polycule. Needs all three turning points landed.
  The three stop splitting themselves up and live in one wide event, sharing a trace ID. "Stop
  sampling yourself."
- **Go home.** The bittersweet ending: you wake up at 3:12 a.m., the page resolved, the phone
  quiet. One notification, from a trace ID you recognise.
- **Bad endings stay:** 30-Day Retention, Rolled Up, Head-Sampled Out (choosing a pillar whose
  turning point didn't land, so they let you go home), and Monitoring Relapse.

## Length

About double the current script: roughly 8 new scenes (incident declaration, three phases, root
cause, resolution, the portal, the go-home ending) and the small seeding beats in existing scenes.
Most new mechanics reuse what's built: SQL-gated branches, the shell views, choice vibes, the
manga flourishes, and the music cues (the incident gets its own track and sounds).

## What needs building

- The incident telemetry: a deterministic generator that inserts the Realm's events (requests,
  spans with parent IDs, log lines, an error spike carried by one `subscriber_id`) when Act 3
  starts, so the Logs, Trace and Metrics views all show it.
- Queries for each phase's gate, and for each turning point landing (affection plus phase result).
- New scenes, music (`incident`) and a few sounds (alarm, flicker, resolve).
- The portal choice and two new endings (go home, and the reworked stay endings).

## v3 changes (arcs with a cost, and a root cause that holds up)

- **Why it broke.** The wide table is columnar and doesn't mind a high-cardinality column. Metrics
  keeps one series per label combination, and the Collector was passing `subscriber_id` to him as
  a label. He hit his limit and dropped series; the batch processor timed out waiting on him and
  shed its queue: spans, then citizens. The fix keeps `subscriber_id` on the wide event and bans
  `_id` labels. "High cardinality was never the problem."
- **Wide event deltas.** The root-cause step is a view, not a typed query: a heatmap of span durations,
  box the slow band, and each attribute is compared inside the box against the rest. Unlocked by
  the DBA when the wide event becomes the lead.
- **Logs.** She logged your queries: filtering to ERROR first costs her turning point
  (`grepped_error`), and can be mended in the quiet hour. Her guilt: she wrote the clue for a week
  without knowing what it meant. Her ending is three words, not a scroll.
- **Metrics.** One lost series has a shape (three a minute, two years) and, via Logs, a name. In
  the incident he watches free and pro traffic go flat, and his drop rule is the mechanism.
  Staying or pushing moves his counter.
- **Traces.** The date has a budget of two kept moments out of four, chosen blind; the finale reads
  back exactly what was kept. In the incident they are the one being sampled out, and they get to
  choose what to keep for the first time.
- **Each holds what another lost.** Logs has Metrics' names, Metrics has counted every time Traces
  turned up, Traces gives Logs a "because".
- **The quiet hour** (`quiet.yaml`): one private scene with one pillar before the portal.
- **The player.** "Fine" in the prologue; Logs asks for the long version; going home ends with
  you sending it.
