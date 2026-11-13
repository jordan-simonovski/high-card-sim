-- First time in the Service Mesh hub (the scene_enter for this visit is already logged).
SELECT count() = 1 FROM events WHERE event_type = 'scene_enter' AND scene = 'mesh'
