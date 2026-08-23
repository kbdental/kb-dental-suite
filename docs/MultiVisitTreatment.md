# Multi-visit treatment tracking

Implements `docs/ClinicalSuiteMultiVisitSpec.md`: appointments for
treatments spanning several visits (Crown = 3 visits, RCT Molar = 4, Full
Denture = 5, etc.) now carry the fields needed to know where a patient is in
a treatment and what the next visit should be —

> Procedure → Visit No. → Stage → Completion

This is deliberately not a clinical engine — it's an ordered stage list per
procedure, decided by three exception options at the end of every visit
(continue as planned / add another visit / complete now).

## Backend (`apps-script/out/Code.gs`)

- `APPOINTMENT_HEADERS` gains nine optional columns: `CaseId`,
  `ProcedureCode`, `ProcedureName`, `VisitNo`, `TotalVisits`, `StageCode`,
  `StageName`, `IsFinalVisit`, `CaseStatus`. A plain one-off appointment
  (walk-in, phone call) simply leaves them blank — nothing about the existing
  Appointments sheet or a normal booking changes.
- **Procedure Library** — a new sheet tab, seeded automatically on first read
  from `PROCEDURE_LIBRARY_DEFAULTS` (115 procedures / 274 stages, from the
  V2 master list). After that first seed the sheet is the source of truth;
  adding a procedure or renaming a stage is a row edit, not a code change.
  Section 14 of the master list (Review / Maintenance) was excluded on
  purpose — the spec calls those reusable follow-up stages, not standalone
  tracked procedures.
- New actions: `getProcedureLibrary`, `saveProcedureLibrary`,
  `getNextVisitSuggestion` (what the booking form should default to for a
  patient + procedure), `resolveVisitException` (applies the three options
  at the end of a visit).
- The actual decision logic (`nextVisitAfterUsingStages_`,
  `newCaseFromStages_`) is pure and unit-tested against the real library in
  `test/procedure-library.test.js` — no Sheets access needed to test it.

## Frontend (`index.html`, Appointments)

- The booking form gets one new optional field, "Procedure" — selecting one
  shows a read-only "Visit N of M — Stage" line, auto-filled (next unfinished
  visit for a returning patient + procedure, or visit 1 for a new case) and
  editable per the spec.
- Completing a visit that belongs to a tracked, still-open case asks the
  three exception options instead of just marking it done. Continuing or
  adding a visit hands the computed next visit straight to the booking form
  — staff still pick date/time/chair themselves; nothing is auto-scheduled.

## Deploying

Same as any other backend change: paste the full `Code.gs` into the Apps
Script editor, **Ctrl+S**, then **Deploy → Manage deployments → pencil → New
version → Deploy.**
