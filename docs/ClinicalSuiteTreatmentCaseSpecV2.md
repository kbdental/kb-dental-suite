# KB Dental Clinical Suite — Treatment Case Spec (V2)

**Purpose:** Track treatments that span several appointments, so any connected app — and the clinic's own staff — always knows *what stage the case is at and what comes next*.

**Core principle (changed in V2):**

> **Stage completion is the logic. The visit number is only a counter.**

If a dentist does Preparation + Scan + Temporary in a single appointment, the system records those stages as completed and moves the case to Try-in. It does not care that "three theoretical visits" happened at once.

**Second principle:** the library is never shown to staff. They see three lines:

```
CURRENT:  Try-in
NEXT:     Final fitting
STATUS:   Pending
```

---

## 1. The five stage codes

Every stage in every procedure is one of these five. This is the vocabulary the whole system runs on.

| Code | Stage | Meaning |
|---|---|---|
| `P` | Plan | Diagnosis, records, treatment planning |
| `R` | Prepare | Tooth/site preparation, impressions, scans |
| `T` | Treat | Active treatment |
| `TI` | Try-in / Review | Try-in, verification, adjustment, review |
| `C` | Complete | Final fitting, delivery, cementation, completion |

A stage may carry two codes where the appointment genuinely does both — e.g. `TI/C — Try-in + Cementation`. Store the primary code and treat the pair as display text.

---

## 2. The ten families

Every procedure belongs to exactly one family. Families exist for grouping, reporting, and picking sensible defaults — they carry no logic of their own.

| # | Family | Example procedures |
|---|---|---|
| 1 | Diagnostic | Consultation, Examination, X-ray, CBCT, Treatment Planning |
| 2 | Preventive | Scaling, Polishing, Fluoride, Sealants |
| 3 | Restorative | Composite, GIC, Temporary Filling, Inlay, Onlay |
| 4 | Endodontic | RCT, Re-RCT, Post & Core, Apexification |
| 5 | Prosthodontic | Crown, Bridge, Veneer, Denture, Partial Denture |
| 6 | Surgical | Extraction, Surgical Extraction, Wisdom Tooth, Apicoectomy |
| 7 | Implant | Implant Placement, Bone Graft, Sinus Lift, Implant Crown/Bridge |
| 8 | Orthodontic | Braces, Aligners, Retainers |
| 9 | Aesthetic | Whitening, Veneers, Smile Makeover |
| 10 | Occlusion / TMD | Occlusal Adjustment, Night Guard, Splint, TMD Treatment |

---

## 3. The procedure library

Reference data, edited rarely. **One row per stage**, in sequence order.

| Column | Type | Example |
|---|---|---|
| `procedureCode` | string | `CROWN_SINGLE` |
| `procedureName` | string | `Single Crown` |
| `familyCode` | string | `PROSTHODONTIC` |
| `typicalVisitsMin` | integer | `2` |
| `typicalVisitsMax` | integer | `3` |
| `sequenceNo` | integer | `2` |
| `stageCode` | enum | `TI` |
| `stageName` | string | `Try-in` |
| `completesTreatment` | boolean | `false` |

Note `typicalVisitsMin` / `typicalVisitsMax` — V2's library gives ranges ("2–3", "8–15+"), not fixed counts. These are **guidance for scheduling only**; they never drive logic.

### Worked example — Single Crown

| procedureCode | sequenceNo | stageCode | stageName | completes |
|---|---|---|---|---|
| CROWN_SINGLE | 1 | R | Preparation + scan/impression | No |
| CROWN_SINGLE | 2 | TI | Try-in | No |
| CROWN_SINGLE | 3 | C | Final fitting | **Yes** |

### Worked example — RCT Molar

| procedureCode | sequenceNo | stageCode | stageName | completes |
|---|---|---|---|---|
| RCT_MOLAR | 1 | T | Cleaning | No |
| RCT_MOLAR | 2 | T | Cleaning / medication | No |
| RCT_MOLAR | 3 | T | Obturation | No |
| RCT_MOLAR | 4 | C | Restoration | **Yes** |

### Worked example — Complete Denture

| procedureCode | sequenceNo | stageCode | stageName | completes |
|---|---|---|---|---|
| COMPLETE_DENTURE | 1 | R | Primary impression | No |
| COMPLETE_DENTURE | 2 | R | Final impression | No |
| COMPLETE_DENTURE | 3 | R | Jaw relation | No |
| COMPLETE_DENTURE | 4 | TI | Try-in | No |
| COMPLETE_DENTURE | 5 | C | Delivery | **Yes** |

Single-visit procedures get one row: `sequenceNo = 1`, `completesTreatment = Yes`.

### Reviews are not procedures

Per V2, review/maintenance items (post-extraction review, RCT review, crown review, etc.) are **reusable `TI` stages**, not separate procedures. A review can be appended to any case as an extra `TI` stage rather than modelled as its own treatment.

---

## 4. The treatment case

A **case** is the unit that spans appointments. This is the new entity.

| Field | Type | Example |
|---|---|---|
| `caseId` | string | `AA0127-CROWN-01` |
| `uhid` | string | `AA0127` |
| `procedureCode` | string | `CROWN_SINGLE` |
| `familyCode` | string | `PROSTHODONTIC` |
| `toothRef` | string | `26` (optional — tooth/quadrant/arch) |
| `caseStatus` | enum | `in_progress` \| `completed` \| `abandoned` |
| `openedDate` | date | `2026-08-04` |
| `closedDate` | date | null until completed |
| `stages` | array | see below |

### The stages array — this is where the logic lives

Each entry is one stage of this case, copied from the library at case creation and then modified as reality dictates:

| Field | Type | Example |
|---|---|---|
| `sequenceNo` | integer | `2` |
| `stageCode` | enum | `TI` |
| `stageName` | string | `Try-in` |
| `status` | enum | `pending` \| `completed` \| `skipped` |
| `completedDate` | date | `2026-08-18` |
| `completedInAppointment` | string | appointment id |
| `completesTreatment` | boolean | `false` |

**Derived values — never stored, always computed:**

- **Current stage** = first stage with `status = pending`
- **Next stage** = the one after that
- **Case complete** = no pending stages remain, or a stage with `completesTreatment` was completed
- **Visit count** = number of distinct appointments that completed at least one stage (a counter, nothing more)

---

## 5. What changes on the appointment record

Existing fields stay: `Patient (UHID) · Cell phone · Email · Date · Time · Att. Doctor · Chair · Reason · Comments · Notify flags`

### Fields to ADD

| Field | Type | Example | Notes |
|---|---|---|---|
| `caseId` | string | `AA0127-CROWN-01` | Links this appointment to a case. Empty = one-off appointment. |
| `plannedStages` | array of int | `[2]` | Which `sequenceNo`s this appointment intends to cover. Usually one, sometimes several. |
| `completedStages` | array of int | `[1,2,3]` | Filled in after the visit — **this is the important one.** Lets one appointment close three stages. |
| `visitCounter` | integer | `2` | Display only. Never used for logic. |

**All fields optional.** An appointment with no `caseId` is a valid one-off visit, and any app reading this must render fine without them.

---

## 6. Stage outcome — what the doctor picks

At the end of a visit, per stage covered, the doctor picks one outcome. V2 replaces the earlier generic three options with wording tied to what actually happened:

| Outcome | Effect on the case |
|---|---|
| **Approved / done** | Mark stage `completed`. Case advances to the next pending stage. |
| **Adjustment required** | Mark stage `completed`, then **insert a new stage** immediately after it — same `stageCode` and name, suffixed "/ adjustment". Everything after shifts down. |
| **Proceed to completion** | Mark this stage `completed`, mark all remaining pending stages `skipped`, close the case. |

### Worked example — Crown, Try-in visit

```
Case: CROWN_SINGLE
Stages: 1 R Preparation [completed]
        2 TI Try-in     [pending]  ← current
        3 C  Final fitting [pending]
```

- **Approved** → stage 2 completed. Current becomes 3 (Final fitting).
- **Adjustment required** → stage 2 completed, new stage inserted: `2a TI Try-in / adjustment [pending]`. Final fitting moves after it.
- **Proceed to completion** → the crown fitted perfectly at try-in and was cemented same day. Stage 2 completed, stage 3 skipped, case closed.

### Multiple stages in one appointment

The dentist did Preparation + Scan + Temporary together. All three stages are marked `completed` against the same appointment id; `completedStages = [1,2,3]`. The case advances to stage 4. `visitCounter` increments by exactly 1.

**This is the case V2 exists to handle, and the reason visit number can't be the logic.**

---

## 7. What Clinical Suite exposes to other apps

Per appointment:

```
appointmentId
uhid
patientName
date, time, doctor, chair
caseId
procedureCode, procedureName, familyCode
currentStageCode      (P | R | T | TI | C)
currentStageName
nextStageName         (null if this completes the case)
visitCounter
typicalVisitsMax      (guidance only)
caseStatus
reason, comments      (for non-procedure appointments)
```

### What other apps write back

```
appointmentId
caseId
completedStages       array of sequenceNo
stageOutcome          approved | adjustment_required | proceed_to_completion
actualStartTime
actualEndTime
```

---

## 8. UI change in the appointment form

Minimal. When Reason is a clinical procedure, show one extra read-only line:

```
CURRENT:  Try-in
NEXT:     Final fitting
```

Plus, at visit completion, the three outcome buttons from section 6. Staff never see the library, the stages array, or sequence numbers.

---

## 9. Suggested build order

1. Create the five stage codes and ten families.
2. Build the library for one family end to end — Prosthodontic is the best test, since Crown/Bridge/Denture exercise every stage code.
3. Add the case entity with its stages array.
4. Add `caseId` + `completedStages` to appointments.
5. Add the current/next line and the three outcome buttons to the form.
6. Expose the fields to the sync layer.
7. Populate the remaining nine families — pure data entry, no code changes.

Steps 1–5 are independently useful before any other app consumes this.
