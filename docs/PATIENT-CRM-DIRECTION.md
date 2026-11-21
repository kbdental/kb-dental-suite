# Patient and clinic CRM: latest product direction

## Central patient clarification — 3 November 2026

The patient is created once at organization level. Clinics record the care:
visits, actual treating doctors, treatments and items/materials used. CRM should
use that one organization patient identity. Do not require staff to add/register
the same person again for each clinic. Steps1–2 (central access and permitted
history) are implemented as described in `CENTRAL-PATIENT-HISTORY.md`; structured
visit recording is the next slice. Preserve the familiar clinical UI.


31 October 2026. Explicit user correction in the main coordination chat.
This direction takes precedence over the contact-centre analogy and demo layout.

The organization/unit hierarchy is for ownership, isolation and settings inheritance.
It must not determine a contact-centre-style operational interface. The product is
a patient-centred clinical CRM and longitudinal record system. Keep clinical screens
familiar to the existing suite; study the live-source HTML and Apps Script behavior
before redesigning workflows. The new organization workspace is a functional demo,
not a feature-complete replacement or the agreed final clinical interface.

## Primary journey

1. Find the returning patient's shared organization identity and open their record.
2. See relevant demographics, medical/dental history, prior visits, treating doctors,
   procedures/treatment cases, forms, documents and permitted financial history.
3. Create/assign the current visit to a clinic and a doctor who works at that clinic.
4. Record the visit's treatments/procedures, notes and items/materials used.
5. Preserve these links in the patient timeline and in doctor, clinic and item histories.

The core relationships are patient -> visit -> clinic + treating doctor, with visit
treatments and item-usage entries. Multi-visit treatment cases link visits when
needed; an appointment is a scheduling record, not the complete clinical encounter.
Item usage means a clinical consumption/history record; full stock purchasing,
warehouse/inventory accounting and lab workflows need separate scope.

## Next implementation work (not already delivered)

- Audit the existing registration, diary, patient profile, clinical forms,
  treatment-case and finance screens and map their required behavior.
- Add a first-class visit/encounter and a patient-first longitudinal timeline.
- Preserve historical treating doctor/clinic attribution even when staff or unit
  details are later changed; distinguish planned doctor from actual treating doctor.
- Link performed treatments and item usage to visit, patient and treating doctor.
  Record item identity, quantity/unit and relevant lot/batch information where needed,
  with audit/correction behavior; do not silently rewrite historical usage.
- Provide doctor history (visits/treatments performed) and item history (where/when
  used) as authorized views of the same clinical records, not duplicated stores.
- Focus metrics on patient history and recorded care: visits over time, treatments,
  doctor activity and material usage, with explicit definitions. "Active patients"
  is not the organizing concept or primary product goal.

Organization isolation, explicit clinic/clinical permissions, assigned forms,
controlled overrides and the familiar clinical workflows remain requirements.
Shared identity must not expose restricted histories or finance across staff scopes.

## Visit linking and record search design

1. Add a stable visit ID at the clinic, pointing to the patient's shared
   organization identity. Store the visit's actual treating clinician, clinic,
   encounter time, status and audit trail. Keep an optional link to the booking
   so walk-ins and visits with a changed clinician remain representable.
2. Link performed procedures, tooth/surface, case stage, notes, forms,
   prescriptions and documents to the visit. Link receipts when the payment was
   collected for that encounter and keep independent payments under the patient.
   Use separate treatment and material rows for code, item, quantity, unit and
   lot where recorded. Keep original source references and signed files intact.
3. Reuse the appointment check-in, Daily Register and clinical form entry points.
   Carry the selected visit into the forms as staff move between screens. Show
   the patient, visit date, clinic and treating doctor before a save. Keep writes
   transactional and retry-safe so two tabs cannot silently create the same visit.
4. Reconcile historical links in a preview. Auto-link explicit source IDs and
   uniquely evidenced matches. A shared date or patient ID alone is insufficient
   when there were multiple treatments or visits. Hold ambiguous rows for review
   and continue to show unlinked records with their original dates and provenance.
5. First ship patient history grouped by visit, with filters for date range,
   clinic, treating doctor, procedure, tooth, and document type. Index the shared
   patient ID and clinic/date/doc fields for these reads. Then expose doctor and
   material views over the same records, with clinic and permission checks on
   search results and drill-downs.

Validate with same-day return visits, walk-ins, substituted treating doctors,
unlinked historical notes, patient-level receipts, and denied cross-clinic access.
Keep old search available while the new visit links are reconciled.

## Current handoff boundary

The committed organization demo already proves isolated organization runtimes,
shared patients, clinic-scoped notes/forms/appointments, simple receipts, settings
and admin controls. It does not yet implement the complete visit/treatment/item
history model above. The older suite remains runnable separately for comparison.
The user's immediate priority is saving runnable code and fresh-laptop instructions;
do not replace clinical screens during that handoff merely to change their appearance.
