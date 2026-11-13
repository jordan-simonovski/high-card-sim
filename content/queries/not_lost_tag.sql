-- The player hasn't followed Baggage's lost tag yet.
SELECT count() = 0 FROM events WHERE event_type = 'scene_enter' AND scene = 'lost_tag'
