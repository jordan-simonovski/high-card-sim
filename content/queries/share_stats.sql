-- The numbers on the ending's share card: one row, read from the same tables the story used.
-- The Realm's own telemetry (realm_span, realm_log) is left out; this is about the player.
SELECT
  countIf(event_type = 'choice') AS choices,
  countIf(event_type IN ('line', 'choice')) AS moments,
  countIf(event_type = 'query_run') AS queries,
  quantileIf(0.5)(time_to_choose_ms, event_type = 'choice') AS median_ms,
  maxIf(time_to_choose_ms, event_type = 'choice') AS slowest_ms,
  argMaxIf(choice_text, time_to_choose_ms, event_type = 'choice') AS slowest_choice,
  countIf(event_type = 'incident_resolved') AS resolved,
  dateDiff('second', minIf(ts, event_type = 'incident_started'), maxIf(ts, event_type = 'incident_resolved')) AS resolve_s,
  (SELECT count() FROM logs WHERE character = 'logs') AS logs_lines,
  (SELECT sum(affection) FROM metrics_agg WHERE character = 'metrics') AS metrics_sum,
  (SELECT count() FROM traces WHERE event_type IN ('line', 'choice')) AS traces_kept
FROM events
WHERE event_type NOT IN ('realm_span', 'realm_log')
