-- How the picnic with Logs ends: did the player actually talk to her? Rows she has from this date
-- (her lines, her "mm"s, and the player's replies). Open the whole way: 25. Brushed off: 15.
SELECT count() >= 21 FROM events WHERE character = 'logs' AND scene = 'date2_logs'
