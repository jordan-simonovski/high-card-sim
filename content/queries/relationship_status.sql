-- What each pillar knows about the player, from that pillar's own view.
SELECT 'Logs' AS pillar, 'lines remembered' AS measure, toString((SELECT count() FROM logs WHERE character = 'logs')) AS value
UNION ALL
SELECT 'Metrics', 'affection counter', toString((SELECT sum(affection) FROM metrics_agg WHERE character = 'metrics'))
UNION ALL
SELECT 'Traces', 'moments sampled', toString((SELECT count() FROM traces WHERE character = 'traces'))
