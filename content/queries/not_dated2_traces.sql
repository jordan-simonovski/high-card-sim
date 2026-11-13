-- The player hasn't been on the second date with traces yet.
SELECT count() = 0 FROM events WHERE event_type = 'scene_enter' AND scene = 'date2_traces'
