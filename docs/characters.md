# Character bible

The single source for the script (voice, arc) and the art pipeline (visual design).
**Every character is an adult (mid-20s to mid-30s), drawn as an adult.** Entirely SFW.
The player has no sprite: they are "you", and their name, gender and pronouns are theirs.

Style for all art: stylised anime visual-novel, clean lineart, soft cel shading, bright pastel
palette, bubbly and cute, expressive faces. Each character has one signature colour that the UI
reuses for their name tag and card.

Tone rule: the observability is the joke; the romance is sincere. Nobody's gender or queerness is
ever a punchline.

---

## Logs (she/her) — the one who tells you everything

- **Role:** pillar, love interest. Colour: warm pink `#ff7eb6`.
- **Voice:** run-on sentences, timestamps mid-thought ("at 14:02:11 I thought—anyway"), tangents,
  ellipses, never gets to the point. Says "anyway—" and "sorry, verbose mode". Delighted by detail.
- **Joke:** Logs is a view with only `ts`, `character`, `dialogue_text`. She remembers every word,
  unstructured, but can't tell you what any of it *meant*.
- **Wound:** people only grep her when something is on fire. Nobody reads her for pleasure.
- **Arc:** learns that being listened to on an ordinary day is love; learns to let someone else
  talk too. Her good ending: you read her, start to finish, on purpose.
- **Mechanic:** affection = how much conversation with her is in the `logs` view. Letting her talk
  ("tell me more") raises it; asking for the TL;DR lowers it (she understands, but it stings).
- **Visual:** tall, long wavy ink-black hair that fades to pink at the ends, like ink
  bleeding into paper; warm amber eyes; light freckles; oversized cream cardigan covered
  in tiny printed timestamps; long pleated skirt; a long scarf; carries a notebook that
  never runs out of pages. Palette: cream, sepia,
  warm pink.

## Metrics (he/him) — the one who keeps count

- **Role:** pillar, love interest. Colour: cool blue `#5aa9ff`.
- **Voice:** terse, precise, speaks in rates, percentiles and units ("p99 of my week",
  "three per minute"). Dry. Rare, devastating sincerity.
- **Joke:** a materialized view into a summing table keyed only by `(character, scene)`. He
  remembers *that* you fought (the counter went down) but never *why*: the words were never stored.
- **Wound:** he dropped his labels to save memory, long ago, and lost the details of everyone he
  ever cared about. He's efficient and lonely.
- **Arc:** learns that some things are worth the cardinality. His good ending: he adds a new
  dimension just for you.
- **Mechanic:** affection = `sum(affection)` in `metrics_agg` for him. Choices at his nodes carry
  `affection_delta`. He values consistency and honesty over flattery. One argument is possible
  (negative delta) and he later quotes the counter without knowing what it was about.
- **Visual:** neat short silver-blue hair with an undercut; sharp rectangular glasses with a faint
  HUD of tiny gauges in the lenses; athletic build; fitted navy athleisure jacket with numbered
  stripes like an axis; a smartwatch on each wrist; a lanyard with a tiny line chart charm.
  Stern resting face that blushes in a perfect gradient. Palette: navy, ice blue, teal.

## Traces (they/them) — the one who's only there 1% of the time

- **Role:** pillar, love interest. Colour: lilac `#b69cff`.
- **Voice:** soft, gentle, a little breathless; sentences sometimes cut off as if dropped
  mid-span; apologises for missing things; thinks in cause and effect ("this happened because—").
- **Joke:** a view filtered to `cityHash64(event_id) % 100 = 0`. They genuinely miss 99% of your
  dates. Unless you mark a moment `sampling.priority = 1`: tail sampling keeps it.
- **Wound:** feels absent from their own life; only ever catches the first span and a timeout.
- **Arc:** learns that you can choose to keep the moments that matter. Their good ending: one
  whole, unbroken trace, with you in every span.
- **Mechanic:** affection = rows with `character = 'traces'` in the `traces` view. Their date
  opens with them not showing up (unsampled) until the player marks the moment as important.
  Choices with `attributes: { sampling.priority: "1" }` are the ones Traces keeps.
- **Visual:** androgynous, slight build; wavy lilac-to-violet bob with a few glowing thread-like
  strands; soft grey eyes with a faint gold ring; long layered pale coat embroidered with glowing
  connected lines like a span tree; little rectangular "span" pins; fingerless gloves with fine
  gold threads tied to their fingers; edges of the coat look slightly translucent, as if partly
  unsampled. Palette: lilac, violet, soft gold.

## Monitoring (they/them) — the ex

- **Role:** the ex. Colour: signal red `#ff6b6b`.
- **Voice:** checklists, status words ("Status: OK. Status: OK."), caring but rigid, deflects
  anything new to a known metric. "That isn't one of my saved queries."
- **Joke:** only has a fixed list of saved queries and literally cannot answer a new question.
- **Arc:** not a villain. They loved you the only way they could. The player can relapse (bad
  ending) or let them go kindly.
- **Visual:** tidy and tired; NOC headset; lanyard with a red/green status badge; grey cardigan
  over a polo; faint dark circles; clipboard of checkboxes. Palette: muted greys with red/green
  status accents.

## The Collector (they/them) — intercepts everything

- **Role:** the voice that first "ingests" you (speaker `stranger`, shown as `???`, until revealed
  in the Registry). Colour: courier orange `#ffa94d`.
- **Voice:** sunny, clingy, a little too eager; batches feelings; "I'll forward that for you~
  after I've read it. For your safety!" Yandere energy played light and safe: it's about
  intercepting telemetry, never threats.
- **Joke:** receivers, processors, exporters. Everything you send anyone passes through them.
- **Visual:** courier aesthetic: messy short orange hair with two antenna-like tufts; big
  over-ear headphones; orange bomber jacket covered in pipeline patches (receiver → processor →
  exporter arrows); messenger bag overflowing with glowing envelopes and data packets; wide
  smile. Palette: orange, cream, charcoal.

## Baggage (they/them) — context that follows you everywhere

- **Role:** supporting, mesh-hub cameo. Colour: moss green `#69c27b`.
- **Voice:** friendly, nosy, remembers everyone's key=value pairs; "Oh, I'll just come along.
  I always come along." Propagates gossip into every relationship.
- **Visual:** backpacker with a huge rucksack and a rolling suitcase, both covered in luggage tags
  reading `key=value`; tags pinned on their jacket too; beret; round cheeks; earthy greens and tan.

## The DBA (they/them) — guardian of the schema

- **Role:** supporting; runs the Registry; gives the player the Query Shell. Colour: mustard
  `#f2c14e`.
- **Voice:** anxious, meticulous, loves constraints and enums; panics politely; grows.
- **Arc:** panics that gender is a free-text field, not an enum, and realises an enum would be "a
  lie with good indexing". Also ships a hotfix in-story when they greet you with a default value.
- **Visual:** round glasses; messy dark bun with pencils stuck through it; navy cardigan with a
  tiny key-and-lock pattern; a giant ring of keys on their belt (primary keys); arms full of index
  cards. Palette: navy and mustard.

## Pager (it) — not a person

A pastel-pink retro pager with a tiny pixel face. Icon only, no sprite.

---

## Sprite spec (art pipeline)

- Characters with sprites: logs, metrics, traces, monitoring, collector, baggage, dba.
- One base pose per character: three-quarter body (knees up), facing slightly left, neutral
  stance, plain background (matted to transparent), 832×1216.
- Expressions (face only, identical body and framing): `neutral, happy, blush, sad, surprised,
  annoyed` (`content/assets.yaml` moods).
- `stranger` reuses the Collector sprite as a dark silhouette.
