-- How the first date with Logs ends: did the player let her talk? Rows she has from this date
-- (her lines plus the player's replies to her). All "tell me more": 24. All TL;DR: 10.
SELECT count() >= 18 FROM events WHERE character = 'logs' AND scene = 'date_logs'
