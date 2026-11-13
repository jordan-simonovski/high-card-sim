-- Error spans in the Realm, for a show: table during the incident.
SELECT attributes['service'] AS service, count() AS errors
FROM events
WHERE event_type = 'realm_span' AND attributes['status'] = 'error'
GROUP BY service
ORDER BY errors DESC
