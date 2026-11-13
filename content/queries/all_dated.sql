-- All three first dates are done.
SELECT uniqExact(scene) = 3 FROM events
WHERE event_type = 'scene_enter' AND scene IN ('date_logs', 'date_metrics', 'date_traces')
