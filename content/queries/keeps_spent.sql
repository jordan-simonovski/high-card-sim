-- Both of the date's kept moments are used up.
SELECT count() >= 2 FROM events WHERE event_type = 'choice' AND scene = 'date_traces' AND choice_id = 'keep'
