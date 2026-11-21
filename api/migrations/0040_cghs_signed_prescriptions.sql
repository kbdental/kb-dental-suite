ALTER TABLE cghs_prescriptions ADD COLUMN source_saved_at timestamptz;
ALTER TABLE cghs_prescriptions ADD UNIQUE (clinic_id, id);

CREATE TABLE cghs_prescription_pdfs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  clinic_id uuid NOT NULL DEFAULT app_clinic_id() REFERENCES clinics(id),
  prescription_id uuid NOT NULL,
  file_bytes bytea NOT NULL CHECK (octet_length(file_bytes) BETWEEN 16 AND 8388608),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  UNIQUE (clinic_id, prescription_id),
  FOREIGN KEY (clinic_id, prescription_id) REFERENCES cghs_prescriptions(clinic_id, id)
);

SELECT enable_tenant_table('cghs_prescription_pdfs');

-- Audit the file identity and fingerprint without making a second copy of its bytes.
CREATE FUNCTION audit_cghs_prescription_pdf() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (clinic_id, user_id, table_name, row_id, action, before_row, after_row)
  VALUES (coalesce(NEW.clinic_id, OLD.clinic_id), app_user_id(), TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id), lower(TG_OP),
    CASE WHEN TG_OP <> 'INSERT' THEN jsonb_build_object('prescription_id', OLD.prescription_id, 'sha256', OLD.sha256) END,
    CASE WHEN TG_OP <> 'DELETE' THEN jsonb_build_object('prescription_id', NEW.prescription_id, 'sha256', NEW.sha256) END);
  RETURN NULL;
END $$;

DROP TRIGGER audit ON cghs_prescription_pdfs;
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON cghs_prescription_pdfs
  FOR EACH ROW EXECUTE FUNCTION audit_cghs_prescription_pdf();
