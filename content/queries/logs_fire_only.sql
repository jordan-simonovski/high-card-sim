-- Read on the quiet day, grepped in the fire, and never mended it.
SELECT (SELECT count() >= 18 FROM logs WHERE character = 'logs'
     AND ts < (SELECT if(count() = 0, toDateTime64('2999-01-01', 3), min(ts)) FROM events WHERE event_type = 'incident_started'))
  AND (SELECT countIf(position(attributes['query.text'], 'ERROR') > 0) > 0
  AND (countIf(position(attributes['query.text'], 'WARN') > 0 OR position(attributes['query.text'], 'pattern') > 0) = 0
    OR minIf(seq, position(attributes['query.text'], 'ERROR') > 0)
     < minIf(seq, position(attributes['query.text'], 'WARN') > 0 OR position(attributes['query.text'], 'pattern') > 0)) FROM events WHERE event_type = 'query_run' AND scene = 'phase_logs') AND NOT (SELECT count() > 0 FROM events WHERE event_type = 'choice' AND scene = 'quiet' AND choice_id = 'repair')
