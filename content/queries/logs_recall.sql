-- Logs, reciting the last things she heard. Everything, unstructured.
SELECT formatDateTime(ts, '%H:%i:%S') AS ts, character, dialogue_text
FROM logs
WHERE dialogue_text != ''
ORDER BY ts DESC
LIMIT 5
