-- In the Logs phase, the player's first move was ERROR: they filtered or searched for it before
-- trying WARN or the patterns. Logs logged the query, so she knows.
SELECT countIf(position(attributes['query.text'], 'ERROR') > 0) > 0
  AND (countIf(position(attributes['query.text'], 'WARN') > 0 OR position(attributes['query.text'], 'pattern') > 0) = 0
    OR minIf(seq, position(attributes['query.text'], 'ERROR') > 0)
     < minIf(seq, position(attributes['query.text'], 'WARN') > 0 OR position(attributes['query.text'], 'pattern') > 0))
FROM events WHERE event_type = 'query_run' AND scene = 'phase_logs'
