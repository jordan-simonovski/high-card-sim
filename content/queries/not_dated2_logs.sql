-- The player hasn't been on the second date with logs yet.
SELECT count() = 0 FROM events WHERE event_type = 'scene_enter' AND scene = 'date2_logs'
