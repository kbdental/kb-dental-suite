CREATE TABLE cghs_prescriptions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  clinic_id uuid NOT NULL DEFAULT app_clinic_id() REFERENCES clinics(id),
  patient_id uuid NOT NULL,
  uhid text NOT NULL,
  prescription_date date NOT NULL,
  document jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id)
);

CREATE INDEX cghs_prescriptions_by_date ON cghs_prescriptions (clinic_id, prescription_date DESC, id DESC);
CREATE INDEX cghs_prescriptions_by_uhid ON cghs_prescriptions (clinic_id, uhid, prescription_date DESC, id DESC);

SELECT enable_tenant_table('cghs_prescriptions');
