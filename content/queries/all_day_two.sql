-- Day 2 is done: all three second dates and Baggage's lost tag.
SELECT uniqExact(scene) = 4 FROM events
WHERE event_type = 'scene_enter' AND scene IN ('date2_logs', 'date2_metrics', 'date2_traces', 'lost_tag')
