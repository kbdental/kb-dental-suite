# KB Dental Clinical Suite — Multi-Visit Treatment Spec

> **Superseded by `ClinicalSuiteTreatmentCaseSpecV2.md`.** V2 replaced this
> spec's per-appointment visit-number model with a Case entity and
> stage-based completion. Kept here for history only — see
> `docs/MultiVisitTreatment.md` for what's actually implemented.

**Purpose:** Let Clinical Suite track treatments that span several appointments (Crown = 3 visits, RCT Molar = 4, Full Denture = 5, etc.), so that any connected app — and the clinic's own staff — always knows *where we are in the treatment and what the next visit should be*.

**Design principle:** the clinical complexity lives in the procedure library. Staff only ever see three things:

> Current stage → Next stage → Complete

---

## 1. What changes in the appointment record

The appointment form currently captures:

`Patient (name + UHID) · Cell phone · Email · Date · Time · Att. Doctor · Chair · Reason · Comments · Notify flags`

### Fields to ADD

| Field | Type | Example | Notes |
|---|---|---|---|
| `caseId` | string | `AA0127-CR-01` | Groups all visits of one treatment together. Suggested format: UHID + procedure code + sequence. |
| `procedureCode` | string | `CROWN` | Key into the procedure library (section 2). Replaces free-text "Reason" for clinical procedures. |
| `procedureName` | string | `Crown` | Display name, from the library. |
| `visitNo` | integer | `2` | Which visit this appointment is. |
| `totalVisits` | integer | `3` | Current expected total. **Not fixed** — changes if a visit is added (section 3). |
| `stageCode` | string | `TRY_IN` | Key for the stage. |
| `stageName` | string | `Try-in` | Display name for the stage. |
| `isFinalVisit` | boolean | `false` | True when this visit completes the treatment. |
| `caseStatus` | enum | `in_progress` | `in_progress` \| `completed` \| `abandoned` |

### Fields to KEEP unchanged

Everything already in the form. `Reason` stays for non-procedure appointments (walk-ins, phone consultations, follow-up calls) — in that case the new fields are simply empty.

### Important: fields must be optional

An appointment with no `caseId` is valid — it's a one-off visit. Any app reading this data must work whether these fields are populated or not.

---

## 2. The procedure library

A reference table, edited rarely, not shown to staff in full. One row per **stage**, not per procedure.

### Table structure

| Column | Type | Example |
|---|---|---|
| `procedureCode` | string | `CROWN` |
| `procedureName` | string | `Crown` |
| `standardVisits` | integer | `3` |
| `visitNo` | integer | `2` |
| `stageCode` | string | `TRY_IN` |
| `stageName` | string | `Try-in` |
| `completesTreatment` | boolean | `false` |

### Worked examples

**Crown — 3 visits**

| procedureCode | standardVisits | visitNo | stageCode | stageName | completes |
|---|---|---|---|---|---|
| CROWN | 3 | 1 | PREPARATION | Preparation | No |
| CROWN | 3 | 2 | TRY_IN | Try-in | No |
| CROWN | 3 | 3 | FINAL_FITTING | Final fitting | **Yes** |

**RCT Molar — 4 visits**

| procedureCode | standardVisits | visitNo | stageCode | stageName | completes |
|---|---|---|---|---|---|
| RCT_MOLAR | 4 | 1 | TREATMENT | Treatment | No |
| RCT_MOLAR | 4 | 2 | CLEANING_MEDICATION | Cleaning / medication | No |
| RCT_MOLAR | 4 | 3 | OBTURATION | Obturation | No |
| RCT_MOLAR | 4 | 4 | RESTORATION | Restoration | **Yes** |

**Full Denture — 5 visits**

| procedureCode | standardVisits | visitNo | stageCode | stageName | completes |
|---|---|---|---|---|---|
| FULL_DENTURE | 5 | 1 | PRIMARY_IMPRESSION | Primary impression | No |
| FULL_DENTURE | 5 | 2 | FINAL_IMPRESSION | Final impression | No |
| FULL_DENTURE | 5 | 3 | JAW_RELATION | Jaw relation | No |
| FULL_DENTURE | 5 | 4 | TRY_IN | Try-in | No |
| FULL_DENTURE | 5 | 5 | DELIVERY | Delivery | **Yes** |

**Single-visit procedures** get exactly one row, with `standardVisits = 1`, `visitNo = 1`, `completes = Yes`. Example: `CONSULTATION`, `SCALING`, `SIMPLE_EXTRACTION`.

The full 55-procedure library is in the master list already agreed. Adding a procedure or renaming a stage is a data change only — no code change.

---

## 3. The three exception options

Real dentistry doesn't always follow the standard number of visits. At the **end of every visit**, the doctor picks one of three options. This is the only clinical decision the system asks for.

### Option A — Continue as planned

Nothing changes. The next appointment is booked at `visitNo + 1` with that stage from the library.

*Crown visit 1 done → next appointment is Crown, Visit 2 of 3, Try-in.*

### Option B — Add another visit

Insert an extra visit **at the current stage**, and push everything after it down by one.

- `totalVisits` increases by 1
- The next appointment repeats the current stage (usually annotated, e.g. "Try-in / adjustment")
- Later stages keep their order, with visit numbers shifted

*Crown visit 2 (Try-in) done, adjustment needed → totalVisits becomes 4. Next appointment is Crown, Visit 3 of 4, Try-in / adjustment. The Final fitting becomes Visit 4 of 4.*

### Option C — Complete procedure

End the treatment now, regardless of how many visits the library expected.

- `caseStatus` becomes `completed`
- `isFinalVisit` on this appointment becomes `true`
- No further appointment is generated for this case

*Crown visit 2 — the crown fits perfectly at try-in, doctor cements it same day → case completed at Visit 2 of 3. No third appointment.*

### Rules

- These options apply at **every** stage, including the last one (Option B after a "final" stage extends the treatment — e.g. a denture needing extra adjustment).
- A case is only ever completed by Option C or by finishing a stage where `completesTreatment = Yes` with Option A.
- Nothing prevents booking out of order; the system informs, it does not block.

---

## 4. What Clinical Suite should expose to other apps

Each appointment record, published in whatever form the integration takes (Google Sheets sync is the current mechanism):

```
uhid
patientName
date
time
doctor
chair
caseId
procedureCode
procedureName
visitNo
totalVisits
stageCode
stageName
isFinalVisit
caseStatus
reason           (for non-procedure appointments)
comments
```

### What other apps write back

When a visit is finished, the operational app (KuBi) should be able to report:

```
caseId
appointmentId
stageCompleted      true / false
exceptionOption     continue | add_visit | complete
actualStartTime
actualEndTime
```

Clinical Suite consumes that to decide the next appointment per section 3.

---

## 5. UI change in the appointment form

Minimal — one dropdown becomes smarter:

1. **Reason** → when the selection is a clinical procedure, show a second line: **Visit** — auto-filled with the next expected visit for that patient + procedure, editable if the receptionist needs to override.
2. Display the stage read-only beside it: *"Visit 2 of 3 — Try-in"*.
3. For a new case, visit defaults to 1. For an existing open case, it defaults to the next unfinished visit.

Staff never see the library table. They see, at most, one extra line on the form.

---

## 6. Suggested build order

1. Create the procedure library table with 8–10 of the most common procedures (Consultation, Scaling, Filling, Crown, RCT variants, Extraction, Denture). Add the rest later.
2. Add the new fields to the appointment record, all optional.
3. Add the Visit line to the appointment form.
4. Add the three exception options at visit completion.
5. Expose the fields to the sync layer.

Steps 1–3 are useful on their own even before any other app consumes them.
