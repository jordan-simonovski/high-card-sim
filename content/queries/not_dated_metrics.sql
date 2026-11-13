-- The player hasn't been on the date with metrics yet.
SELECT count() = 0 FROM events WHERE event_type = 'scene_enter' AND scene = 'date_metrics'
