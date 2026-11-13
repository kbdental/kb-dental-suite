-- A missing collection date must not be represented as the import day.
ALTER TABLE patient_registrations ALTER COLUMN collected_at DROP NOT NULL;
UPDATE patient_registrations SET collected_at=NULL
 WHERE form->>'source'='live_sheets' AND form->>'collection_date_unknown'='true';
