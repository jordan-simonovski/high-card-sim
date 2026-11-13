-- The wide-event answer: errors by tier, with how many distinct subscriber_ids each carries.
SELECT attributes['tier'] AS tier, countIf(attributes['status'] = 'error') AS errors,
       uniqExact(attributes['subscriber_id']) AS distinct_subscriber_ids
FROM events
WHERE event_type = 'realm_span'
GROUP BY tier
ORDER BY errors DESC
