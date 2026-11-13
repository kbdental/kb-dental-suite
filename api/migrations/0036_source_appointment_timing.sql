-- Keep inconsistent historical source clocks without inventing ordered instants.
ALTER TABLE appointments ADD COLUMN source_timing jsonb NOT NULL DEFAULT '{}'::jsonb;
