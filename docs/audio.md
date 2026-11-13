# Audio plan

Everything here is instrumental: dialogue sits on top, and players read at their own pace, so every
track has to loop cleanly. Target length is 1:30 to 2:30 with no fade-out, so a 1–2 s crossfade
can loop it. Mix quietly (around -16 LUFS) so it never fights the text.

## Music (Suno)

Suno has no official API, so these are written to paste into Suno's "Custom" mode with
**Instrumental** switched on. Only tracks made on a paid Suno plan come with commercial rights.

| file | where it plays | style prompt |
|---|---|---|
| `title.mp3` | title screen | bubbly J-pop instrumental, bright synths, chiptune sparkles, bouncy bass, 128 bpm, cute and exciting, anime opening energy, loopable |
| `prologue.mp3` | the 3 a.m. page | lo-fi night ambience, soft ticking, a nervous arpeggio that sounds a little like a pager, sparse electric piano, 80 bpm, quiet tension, loopable |
| `ingest.mp3` | falling into the other world | dreamy whoosh, reversed piano, shimmering pads, glitchy sparkles, weightless, 30 seconds |
| `registry.mp3` | the DBA's archive | cosy library jazz, pizzicato strings, brushed drums, light comedic bassoon, a little flustered, 100 bpm, loopable |
| `mesh.mp3` | the hub plaza | sunny town theme, ukulele, glockenspiel, handclaps, light synth bass, cheerful, 112 bpm, loopable |
| `logs.mp3` | date with Logs | warm acoustic café, rambling piano that wanders between keys, soft strings, chatty and affectionate, 92 bpm, loopable |
| `metrics.mp3` | date with Metrics | minimal synth-pop, precise four-on-the-floor, clean arpeggiated synths in strict time, cool blue tone that warms up halfway, 118 bpm, loopable |
| `traces.mp3` | date with Traces | dreamy ambient, music box and soft pads over gentle rain, phrases that drop out mid-melody and come back, tender, 70 bpm, loopable |
| `monitoring.mp3` | the ex | quiet control-room drone, distant status beeps, slow melancholy piano, the same four chords over and over, 76 bpm, loopable |
| `finale.mp3` | the finale | swelling anime ballad instrumental, piano into full strings, hopeful and emotional, 84 bpm |
| `end_true.mp3` | the polycule ending | triumphant J-pop anime ending theme, bright brass and synths, joyful choir pads, 132 bpm |
| `end_bittersweet.mp3` | bad endings | bittersweet solo piano with soft strings, gentle and kind, not tragic, 72 bpm |

The engine change is small: a scene-level `music:` field in the YAML (checked against
`content/assets.yaml` like backgrounds), crossfading between tracks, and separate music and sound
volume controls. Audio starts on the first click, because browsers block it before then.

## Sound effects (ElevenLabs)

ElevenLabs' sound-effects API takes a text prompt and returns a short clip, so I can generate and
wire these myself once the API key is set up.

| file | trigger | prompt |
|---|---|---|
| `advance.mp3` | advancing a line | soft bubbly pop, cute UI click, very short |
| `choice.mp3` | picking a choice | sparkly two-note chime, bright and happy, UI |
| `pager.mp3` | the opening page | retro pager buzzing on a wooden bedside table, urgent |
| `whoosh.mp3` | the fall through the glass | magical whoosh with glittering particles, falling |
| `hotfix.mp3` | the DBA ships a hotfix | tiny desk bell ding with a satisfied stamp |
| `shell_open.mp3` | opening the Query Shell | cute retro computer powering on, CRT hum, cheerful beep |
| `query.mp3` | running a query | fast mechanical keyboard burst ending in a soft sparkle |
| `affection.mp3` | affection goes up | small heart sparkle, twinkly, cute |
| `sampled.mp3` | Traces misses a moment | camera shutter that doesn't quite fire, soft and sad |
| `page_flip.mp3` | Logs gets going | quick notebook page flips, papery |
| `counter.mp3` | Metrics counts something | crisp mechanical counter clicking up |
| `ending.mp3` | reaching an ending | warm magical sting, sparkling resolve |
| `error.mp3` | unsupported browser / query error | gentle cartoon error boop, not harsh |

## Voices: babble rather than voice acting

Full voice acting doesn't fit this game: lines contain the player's name and pronouns, which are
only known at runtime. Instead, each character gets a babble, short voiced syllables that play
under their text as it types out, the way Animal Crossing and Undertale do it. Logs babbles fast
and long, Metrics in short clipped bursts, and Traces' babble drops out mid-line. It costs seven
short sound sets, works with any text, and says a lot about each character.

## Other polish, in priority order

1. Typewriter text with click-to-finish. It's the core VN feel, it gives the babble something to
   play under, and it switches off for reduced motion.
2. A backlog of past lines, labelled "logs" and built as `SELECT … FROM logs`. It's a VN staple,
   and the joke is that it's the Logs view itself.
3. Skip already-read lines, driven by a query over your own events.
4. Crossfades between backgrounds and between sprite expressions instead of hard cuts.
5. An endings gallery that survives new sessions, with the ending illustrations unlocked.
6. A share card when you reach an ending (Open Graph image plus a short stat line from SQL).
