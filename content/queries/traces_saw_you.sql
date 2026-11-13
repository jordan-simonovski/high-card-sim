-- Traces only sees sampled events: 1% at random, plus anything marked sampling.priority = 1.
SELECT count() > 0 FROM traces WHERE scene = 'date_traces'
