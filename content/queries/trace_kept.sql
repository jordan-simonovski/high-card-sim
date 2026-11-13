-- The player tail-sampled the failing request, so Traces can see its whole path.
SELECT count() > 0 FROM traces WHERE event_type = 'realm_span' AND attributes['request'] = 'the-one-that-never-finishes'
