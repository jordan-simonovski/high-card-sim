-- True ending gate: every pillar's turning point landed (each one's affection is high).
SELECT
  (SELECT count() >= 18 FROM logs WHERE character = 'logs'
     AND ts < (SELECT if(count() = 0, toDateTime64('2999-01-01', 3), min(ts)) FROM events WHERE event_type = 'incident_started'))
  AND (SELECT sum(affection) >= 3 FROM metrics_agg WHERE character = 'metrics')
  AND (SELECT count() >= 3 FROM traces WHERE character = 'traces')
