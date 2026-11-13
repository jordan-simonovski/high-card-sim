-- True ending gate: the player queried the base `events` table in the Query Shell.
SELECT count() > 0 FROM events WHERE event_type = 'query_run' AND attributes['query.base_table'] = 'true'
