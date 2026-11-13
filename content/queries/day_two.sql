-- The first night has passed: Day 2's hub is open.
SELECT count() > 0 FROM events WHERE event_type = 'scene_enter' AND scene = 'overnight'
