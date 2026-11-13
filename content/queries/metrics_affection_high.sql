-- Metrics only has pre-aggregated counters: the sum survives, the reasons were never stored.
SELECT sum(affection) >= 7 FROM metrics_agg WHERE character = 'metrics'
