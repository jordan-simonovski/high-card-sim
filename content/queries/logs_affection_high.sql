-- Logs remembers every word, unstructured: affection is how much of the conversation the
-- player sat through with her (her lines plus the player's replies to her).
SELECT count() >= 18 FROM logs WHERE character = 'logs'
