-- The player agreed to get back together with Monitoring.
SELECT count() > 0 FROM events WHERE event_type = 'choice' AND choice_id = 'relapse'
