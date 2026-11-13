-- Metrics' run, as he keeps it: one row per lap, how far you were off his pace. No reasons.
SELECT node AS lap, choice_id AS pace, affection_delta AS counter
FROM events
WHERE event_type = 'choice' AND scene = 'date2_metrics' AND node LIKE 'lap%'
ORDER BY seq
