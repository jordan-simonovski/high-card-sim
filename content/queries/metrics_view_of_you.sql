-- Everything Metrics keeps about the player: counts and sums per (character, scene). No words.
SELECT character, scene, sum(events) AS events, sum(affection) AS affection
FROM metrics_agg
GROUP BY character, scene
ORDER BY events DESC
LIMIT 8
