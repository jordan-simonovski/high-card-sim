-- Traces' date has a budget: two moments kept on purpose (the first mark, which makes them
-- appear, is free). True while there is budget left.
SELECT count() < 2 FROM events WHERE event_type = 'choice' AND scene = 'date_traces' AND choice_id = 'keep'
