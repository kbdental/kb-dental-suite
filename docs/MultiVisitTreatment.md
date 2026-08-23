# Multi-visit treatment tracking (V2)

Implements `docs/ClinicalSuiteTreatmentCaseSpecV2.md`, which **supersedes**
`docs/ClinicalSuiteMultiVisitSpec.md` (kept for history — its per-appointment
visit-number model is no longer what's built).

Core principle: **stage completion is the logic, the visit number is only a
counter.** A dentist doing Preparation + Scan + Temporary in one sitting
records those three stages as completed against that one appointment — the
case moves on however far that actually went, not by "one visit = one stage."

## Backend (`apps-script/out/Code.gs`)

**Procedure Library** — a self-seeding sheet tab, 115 procedures / 274 stages
from the V2 master list. Each row: `procedureCode, procedureName, familyCode,
visitsMin, visitsMax, sequenceNo, stageType, stageCode, stageName,
completesTreatment`. `visitsMin/Max` are guidance only — nothing in the logic
reads them. Section 14 of the master list (Review/Maintenance) is excluded on
purpose — those are reusable follow-up stages (`REVIEW_STAGE_TYPES`), not
standalone procedures, appendable to any case via `appendCaseStage`.

**Treatment Cases** — a new sheet, one row per case, holding a JSON `stages`
array (copied from the library at case creation, then modified as reality
dictates: `pending` → `completed` or `skipped`, with an `adjustment_required`
outcome able to insert an extra pending stage). Current stage, next stage,
and whether the case is complete are **never stored** — always derived from
the stages array (`deriveCaseView_`).

New actions: `getProcedureLibrary`, `saveProcedureLibrary`,
`startTreatmentCase` (persists a new case — called at Save time, not at
selection time, so cancelling a booking never leaves an orphan case),
`getOpenCase` (finds a patient's existing open case for a procedure),
`getCaseState` (full state by caseId), `resolveStageOutcome` (applies one of
the three outcomes to whichever stages an appointment covered),
`appendCaseStage`.

The actual stage-sequencing logic (`deriveCaseView_`, `applyStageOutcome_`,
`buildInitialStages_`, `caseIdFor_`) is pure — no Sheets access — and
unit-tested directly in `test/treatment-case.test.js` against the real
shipped library, including the case V2 exists for: three stages closing
against one appointment in a single call.

Appointments carry `CaseId, ProcedureCode, ProcedureName, FamilyCode,
PlannedStages, CompletedStages, VisitCounter` — all optional. They do **not**
carry their own stage or visit-count state; that lives on the Case.

## Frontend (`index.html`, Appointments)

- The booking form's Procedure dropdown is narrowed to the family matching
  the selected Reason (`REASON_FAMILY_CODE`) — e.g. picking "RCT" only shows
  Endodontic procedures instead of all 115.
- Selecting a procedure shows two read-only lines, per section 8 of the spec:

  ```
  CURRENT:  Try-in
  NEXT:     Final fitting
  ```

  For a returning patient this comes from their existing open case
  (`getOpenCase`); otherwise it's a client-side preview computed straight
  from the library — no case is created until the appointment is actually
  saved (`startTreatmentCase`).
- Completing a case-linked appointment fetches the case's current pending
  stages, lets staff tick off whichever ones this visit covered (usually
  just the current one, sometimes several done in one sitting), then applies
  one of the three outcomes: **Approved/done**, **Adjustment required**
  (inserts a repeat of the last ticked stage), **Proceed to completion**
  (skips whatever's left and closes the case).

## Deploying

Same as any other backend change: paste the full `Code.gs` into the Apps
Script editor, **Ctrl+S**, then **Deploy → Manage deployments → pencil → New
version → Deploy.**

Note: the Procedure Library sheet auto-detects and re-seeds itself if it
finds the old (V1) header shape, so no manual cleanup is needed there — but
any appointment already booked under V1's `VisitNo/StageCode` columns won't
carry a Case forward automatically, since V1 never created one.
