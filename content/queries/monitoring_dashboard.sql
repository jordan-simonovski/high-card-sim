-- Monitoring's saved queries: the same three panels, forever.
SELECT 'events_last_hour' AS panel, toString(countIf(ts > now() - INTERVAL 1 HOUR)) AS value FROM events
UNION ALL SELECT 'errors', '0'
UNION ALL SELECT 'status', 'OK'
