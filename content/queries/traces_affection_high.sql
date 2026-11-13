-- Traces remembers only the moments that made it into the sample.
SELECT count() >= 6 FROM traces WHERE character = 'traces'
