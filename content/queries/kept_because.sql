-- Which date moment Traces kept: read from their own view, so only tail-sampled choices count.
SELECT count() > 0 FROM traces WHERE scene = 'date_traces' AND node = 't2' AND choice_id = 'keep'
