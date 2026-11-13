-- Traces remembers only the moments that made it into the sample.
SELECT count() >= 3 FROM traces WHERE character = 'traces'
