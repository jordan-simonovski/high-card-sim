-- The Collector's "Wrapped" for the player: every event they've read so far, by scene. All of it.
SELECT scene, count() AS events_read, countIf(event_type = 'choice') AS choices_read
FROM events
WHERE scene != ''
GROUP BY scene
ORDER BY events_read DESC
LIMIT 6
