-- Source registers may contain several distinct entries for a patient/day.
-- Preserve those rows; keep the familiar one-patient/day guard for native inserts.
ALTER TABLE daily_register ADD COLUMN source_record_key text;
DROP INDEX daily_register_patient_day;
CREATE UNIQUE INDEX daily_register_patient_day ON daily_register(clinic_id,uhid,visit_date)
 WHERE uhid IS NOT NULL AND uhid<>'' AND source_record_key IS NULL;
CREATE UNIQUE INDEX daily_register_source ON daily_register(clinic_id,source_record_key)
 WHERE source_record_key IS NOT NULL;

-- A few historical forms have no recorded timestamp. Unknown is not import time.
ALTER TABLE clinical_records ALTER COLUMN recorded_at DROP NOT NULL;
