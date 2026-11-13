-- True ending gate: every pillar's turning point landed.
SELECT
  (SELECT count() >= 18 FROM logs WHERE character = 'logs'
     AND ts < (SELECT if(count() = 0, toDateTime64('2999-01-01', 3), min(ts)) FROM events WHERE event_type = 'incident_started'))
  AND (NOT (SELECT countIf(position(attributes['query.text'], 'ERROR') > 0) > 0
  AND (countIf(position(attributes['query.text'], 'WARN') > 0 OR position(attributes['query.text'], 'pattern') > 0) = 0
    OR minIf(seq, position(attributes['query.text'], 'ERROR') > 0)
     < minIf(seq, position(attributes['query.text'], 'WARN') > 0 OR position(attributes['query.text'], 'pattern') > 0)) FROM events WHERE event_type = 'query_run' AND scene = 'phase_logs') OR (SELECT count() > 0 FROM events WHERE event_type = 'choice' AND scene = 'quiet' AND choice_id = 'repair'))
  AND (SELECT sum(affection) >= 3 FROM metrics_agg WHERE character = 'metrics')
  AND (SELECT count() >= 3 FROM traces WHERE character = 'traces')
