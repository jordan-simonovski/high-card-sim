-- The Sev-1 has been declared (the Realm's telemetry is in the events table).
SELECT count() > 0 FROM events WHERE event_type = 'incident_started'
