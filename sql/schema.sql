-- M0 spike schema. One wide table; the Three Pillars are lossy views over it.

CREATE TABLE events (
    event_id          UUID,
    session_id        UUID,
    ts                DateTime64(3),
    seq               UInt64,
    scene             LowCardinality(String),
    node              String,
    event_type        LowCardinality(String),
    character         LowCardinality(String),
    choice_id         String,
    choice_text       String,
    dialogue_text     String,
    affection_delta   Int32,
    time_to_choose_ms UInt32,
    route             LowCardinality(String),
    attributes        Map(String, String)
) ENGINE = MergeTree ORDER BY (session_id, seq);

-- Metrics: pre-aggregated at write time. choice_text/dialogue_text never reach him.
CREATE TABLE metrics_agg (
    character LowCardinality(String),
    scene     LowCardinality(String),
    events    UInt64,
    affection Int64
) ENGINE = SummingMergeTree ORDER BY (character, scene);

CREATE MATERIALIZED VIEW metrics_mv TO metrics_agg AS
SELECT character, scene, count() AS events, sum(affection_delta) AS affection
FROM events GROUP BY character, scene;

-- Traces: head-sampled at 1%.
CREATE VIEW traces AS SELECT * FROM events WHERE cityHash64(event_id) % 100 = 0;

-- Logs: everything, unstructured.
CREATE VIEW logs AS SELECT ts, character, dialogue_text FROM events;
