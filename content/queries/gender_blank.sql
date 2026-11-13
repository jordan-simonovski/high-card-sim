-- The player left player.gender empty.
SELECT attributes['player.gender'] = ''
FROM events
WHERE event_type = 'character_created'
ORDER BY seq DESC
LIMIT 1
