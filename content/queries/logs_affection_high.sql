-- Logs remembers every word, unstructured: affection is how much of the conversation the
-- player sat through with her (her lines plus the player's replies to her), up to the incident.
-- The incident's own lines don't count: that's where the turning point plays out.
SELECT count() >= 52 FROM logs
WHERE character = 'logs'
  AND ts < (SELECT if(count() = 0, toDateTime64('2999-01-01', 3), min(ts)) FROM events WHERE event_type = 'incident_started')
