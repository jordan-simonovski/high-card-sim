-- Did the player take more than 3 s, on average, to make their choices?
SELECT avg(time_to_choose_ms) > 3000
FROM events
WHERE session_id = {session_id:UUID} AND event_type = 'choice'
