# Answers: sheets and data consistency (30 Oct 2026)

Replies to *Questions for Viveyk: sheets and data consistency (30 Oct 2026)*.

**Where these answers come from.** Everything here was traced in the
`kbdental/kb-dental-suite` GitHub repo: `apps-script/out/Code.gs` (the
reference copy of the live backend), the maintenance scripts, the
`migration/` scripts, the patch notes and the commit history. Nothing here
came from opening patient rows. Each answer is marked:

- **Confirmed (repo):** the code or a dated note in the repo says so.
- **Needs the live sheet:** the repo cannot settle it. Someone has to look in the Apps Script editor or in the sheet, and the answer says where.
- **Proposed, Viveyk to confirm:** a Part B decision. The repo facts are given, plus a suggested answer.

> **Caveat.** `apps-script/out/Code.gs` is a *reference copy*. Per
> `HANDOVER.md`, nothing reads it and the live project can drift from it.
> Where an answer depends on the code, it describes the code as last
> recorded in the repo.

---

## Three things to fix before the next rehearsal load

1. **The export misses the live clinical-records workbook.**
   `migration/export-sheets.gs` exports four books: PMS, Empanelled, Old
   registration and Finance. It does *not* export **KB Dental — Clinical
   Records** (`1g3t7vbpOKcVEkYdTIsge4u2e8LKC12m71AY51Ps6NlU`), which is where
   the main clinic's clinical forms are written now (see A1). A load built
   from that export holds only the clinical rows still left in the PMS book,
   which were frozen when the records moved. Add that book to
   `EXPORT_BOOKS`.
2. **`migration/import.js` reads the wrong expense tab.** It reads
   `Expenses` (1 row). The real expense data is the Finance `Expense` tab
   (see A4).
3. **`migration/import.js` undercounts split payments, and may drop
   receipts.**
   - `importPayments` takes the first `Amount` column only. It ignores
     `Amount (Payment mode is more than one)`. The live app adds both (see
     `receiptFeeAndMode` in `Code.gs`), so any receipt paid in two modes
     loses its second part on import.
   - It reads the date from a `Date` column. `Patient Fee Receipt` carries
     only `Timestamp` (see `finReceiptRow_`), so its rows may be rejected as
     having "no readable date".

   If your load uses a different importer, check it for the same two
   faults. The split-payment one alone could explain a gap of a percent or
   two in the earlier years (A2).

---

## Part A

### A1. Where do the Script Properties point?

**Confirmed (repo)** for which file is live. **Needs the live editor** to
read the actual property list.

- **`CLINICAL_SHEET_ID` points at "KB Dental — Clinical Records"**
  (`1g3t7vbpOKcVEkYdTIsge4u2e8LKC12m71AY51Ps6NlU`). `EMPANELLED-SETUP.md`
  says: *"The main clinic keeps its clinical records in that fourth file,
  via the `CLINICAL_SHEET_ID` Script Property."* The file was made by
  `copyClinicalRecordsToNewFile`, added in commit `abe9689` (14 Sep 2026,
  *Clinical records in a spreadsheet of their own*). That function copies
  every clinical tab, checks the row and column counts, and only then sets
  the property.
- **The clinical tabs still inside the PMS book are the pre-move originals.**
  The copy deletes nothing, so they stop at the switch-over date in
  September 2026. Do not import both sets: the PMS copies duplicate the
  older part of Clinical Records.
- **"Patient Treatment Record (Responses)" is not referenced anywhere in the
  code.** The name follows the Google Forms convention, so it is almost
  certainly the response book of the paper-era Google Form, from before the
  app. It is not the live target. Whether it holds records that never
  reached the app's tabs is the open point: compare its date range with the
  earliest rows in Clinical Records.
- **`FINANCE_SHEET_ID`.** If the property is unset, the code falls back to
  **"K. B. Dental - Finance Sheet"** (`1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI`).
  Per the comment in `Code.gs`, that is the live book.
  **"K. B. Dental - Finance Sheet PMS"** (`1zi5xjxG…`) is a copy made on
  21 Aug that "fell behind the same day it was made" and is deliberately not
  used. Drive shows it was last modified on 22 Aug 2026, which agrees.
- **`REQUIRE_AUTH`.** Read by `authRequired_()`. Sign-in is enforced only
  when the value is exactly `true`.
- **Other properties the code reads** (names only):
  - `APP_PASSWORD`, `MASTER_PASSWORD`, `FINANCE_PASSWORD`, `REPORTS_PASSWORD_1`, `REPORTS_PASSWORD_2`
  - `SESSIONS` (live login tokens, not a setting)
  - `ANTHROPIC_API_KEY`
  - `CLINICAL_SHEET_ID_NEW` (used once, by the copy)
- **Still to do in the editor:** run **`reportInstanceFiles`**, which is
  already in `Code.gs` and only reads. It logs the name and ID of the
  clinical and finance files this book actually uses. Paste that log in as
  the final answer.
- **Panel book.** The empanelled book (`1yg9Umww…`) has no
  `CLINICAL_SHEET_ID`, so its clinical records stay in itself. Its
  `reportInstanceFiles` log was checked on 26 Sep 2026.

### A2. Do the receipt tabs reconcile?

**Confirmed (repo)** for which tabs are formula-fed. **Needs the live sheet**
for the gap in the first two years.

**The receipt chain, as the code describes it:**

```
Patient Fee Receipt   ← the only tab anyone types into (Google Form + app); no formulas
        ↓ (sheet's own linkage)
Working               ← ARRAYFORMULA on Date/Time columns
        ↓ formulas
Receipt No.           ← E. Receipt No. sequence is formula-driven off Working
FY tabs               ← derived from the same chain
```

Source: the comment above `FIN_ENTRY_TAB` in `Code.gs`, and
`APPS-SCRIPT-PATCH-CLINICAL-TEMPLATES.md`. The app writes only to
`Patient Fee Receipt` and reads back from `Receipt No.`.

**Known damage in the chain.** It is all in 2026-27, not in the two years
that fail to reconcile:

- **22 Aug 2026, commit `1f01bd5`.** An app write landed about 190 rows past
  the end of `Working`, around row 1858. That **restarted the E. Receipt No.
  sequence at 1**, when the clinic had reached 233.
  `APPS-SCRIPT-PATCH-CLINICAL-TEMPLATES.md` says this residue *"has not been
  cleaned up"*.
- **26–29 Aug 2026, commits `504c417` and `e7719f3`.** A restored mirror
  write made *"every receipt appear twice, in two tabs"* until it was
  removed.

The 22 Patient Fee Receipt rows with no e-receipt number, and any repeated
`26-27/n` numbers, probably come from these two incidents. FY 2026-27 still
reconciles, so the duplicate rows evidently are not in `Receipt No.`
itself.

**For FY 2024-25 and 2025-26**, the repo has nothing that explains a 1.5%
gap. Two things to check, in this order:

1. **Split payments.** See fault 3 above. Total
   `Amount (Payment mode is more than one)` for each of the two years. If
   that roughly equals the gap, the cause is the load, not the sheet.
2. **Two-digit-year or `m/d` dates.** The repo's `dateISO` reads
   `dd/mm/yyyy` and ISO dates only. Anything else goes to `new Date()`,
   which reads `05/04/24` as 4 May (US order). Rows near a 31 March
   boundary would then move between years.

**Needs the live sheet:** open `Working`, `Receipt No.` and one FY tab, and
copy the formula in row 2 of each column into the reply. That settles
"which tabs are formula-fed" from the source.

### A3. Why do the yearly tabs hold rows from the next year?

**Needs the live sheet.** No code in the repo builds, filters or writes the
FY tabs. They are entirely the spreadsheet's own formulas.

The same pattern in both years (51 rows, then 273) points to a
**cumulative or open-ended range** rather than date filtering: for example
a `FILTER`/`QUERY` over `Working` with only a lower date bound, or a fixed
row range copied when the year was created.

- If it is an open-ended range, every next-year row in the older tab also
  appears in the correct tab, so **yes, receipts are in two tabs.**
- Import by `Receipt No.` plus the receipt date. Never sum the FY tabs
  together.

To settle it, read the formula in cell A2 of each FY tab and check whether
it has an upper date bound.

### A4. Where are expenses?

**Confirmed (repo).**

- **The app writes to `Expenses`.** `expense.html` and the in-app form both
  call `saveExpense`, which appends to the Finance `Expenses` tab. The app
  created that tab. It holds 1 row because the clinic does not enter
  expenses through the app.
- **The clinic actually uses the Google Form "Expense Form",** whose
  responses land in "Expense Form (Responses)" → `Expense New`, mirrored
  into Finance → `Expense`. In 2026 the repo notes said Finance → `Expense`
  was showing `#REF!`. They described it as *"the clinic's separate
  `Expense` Google Form tab — different columns… not read by the app. Worth
  deciding later whether the two should be merged."* That decision was
  never made.
- **The book of record is Finance `Expense` (978 rows).** `Expenses` is the
  app's own unused tab.
- **Whether the 297 "Expense Form Old" rows are already inside the 978:**
  **needs the sheet.** The Code.gs comment of Aug 2026 counted 885 rows in
  Finance `Expense`. Check whether the 978 start before the first
  `Expense New` timestamp. If they do, the old rows were folded in.
  Otherwise match on date + amount + name.

### A5. Which tabs does the code write that the sheets never had?

**Confirmed (repo).** Most of these were never used. None of them stores its
data somewhere else.

| Tab | What the code does | Verdict |
|---|---|---|
| **Consents** | `saveConsent` appends only when staff press **Save to Sheets** in the AI consent generator. Patient consent at registration is a column in `Registrations` (filled by `patientCompleteRegistration`), not this tab. | Optional button, never pressed. Registration consent is in Registrations. Signed consents are on paper. |
| **Treatment Progress** | **Never written.** `getTreatmentProgress` reads from **Daily Register** (*"read-only — pulls from Daily Register"*). | Empty by design. The data is the Daily Register. |
| **Care Plans** | `saveCarePlan` from the Care Plan screen. | Feature not used. |
| **Treatment Plans** | `saveTreatmentPlan` from the estimate screen (1 row). | Used once, probably a test. |
| **Signatures** | `saveSignature` stores **doctors'** signature images for printouts, one row per doctor. Not patient signatures. | No doctor signature uploaded yet. |
| **Pending** | Only read (`getPending`) and cleared (`removePending`). **Nothing in the current code writes it.** | Left over from an older registration flow. Empty is correct. |
| **Clinic Timings** | `CLINIC_TIMINGS_TAB`, a Master list added in PR #103 (16 Oct 2026). | A new master list, so it is empty until the clinic fills it. |

One correction: Consents only ever appears in the PMS book **once someone
saves**, because `getSheet()` creates a tab the first time it is asked for
one. Its absence shows the button was never used.

### A6. Date of birth and mobile formats

**Partly confirmed (repo). Needs the live sheet** for the actual mix.

How the rows came to differ:

- **New registrations** (app and `register.html`) send DOB as
  `dd/mm/yyyy` text. `formatDOB` passes `dd/mm/yyyy` through as-is and
  formats real Date cells as `dd/MM/yyyy` in the sheet's timezone. So the
  1,002 text DOBs are mostly app-era `dd/mm/yyyy`, and the 1,533 real dates
  are mostly Google-Form-era entries.
- **Mobile.** `register.html` asks for exactly 10 digits
  (`maxlength="10"`, rejects anything else) with no country code. Older
  Google Form rows were free text. Expect `+91…`, `91…`, a leading `0`,
  spaces and two numbers in one cell. Since PR #129 (26 Oct) a second
  number has its own `Mobile 2` column.
- **Numbers stored as numbers** lose nothing for Indian mobiles, but the
  export uses `getDisplayValues()`, so any formatting shows through.

Formulas to run on Registrations. These assume DOB is column F and Mobile is
column G; adjust to match.

```
Real dates:            =SUMPRODUCT(--ISNUMBER(F2:F))
dd/mm/yyyy text:       =SUMPRODUCT(--REGEXMATCH(TO_TEXT(F2:F),"^\d{2}/\d{2}/\d{4}$"))
d-m-yy / d/m/yy:       =SUMPRODUCT(--REGEXMATCH(TO_TEXT(F2:F),"^\d{1,2}[-/.]\d{1,2}[-/.]\d{2}$"))
Other DOB text:        =FILTER(F2:F, NOT(ISNUMBER(F2:F)), F2:F<>"", NOT(REGEXMATCH(TO_TEXT(F2:F),"^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$")))
Clean 10-digit mobile: =SUMPRODUCT(--REGEXMATCH(TO_TEXT(G2:G),"^[6-9]\d{9}$"))
With 91 / +91 / 0:     =SUMPRODUCT(--REGEXMATCH(TO_TEXT(G2:G),"^(\+?91|0)[6-9]\d{9}$"))
```

Recommendation for the import:

- **Normalise mobiles:** strip spaces, `+`, `-`. Drop a leading `91` or `0`
  when 12 or 11 digits remain. Keep the raw value whenever the result is
  not 10 digits.
- **Two-digit-year DOBs:** never guess the century. Send them to the review
  list.

### A7. Unregistered UHIDs

**Confirmed (repo)** for where to look. **Needs the live sheet** for the
sample.

- **Registrations live in three books.** The app searches all of them:
  - PMS **Registrations**
  - **KB Dental — PMS Empaneled → Registrations** (`regSheets_()` reads
    both)
  - The **old registration book** (`1g_sAiX91CxYNJKYiOrSSgUk3ff26Nlz1qjxRL_YyhUA`,
    first tab), read by `getOldPatientData` / `fromArchive`. Its columns are
    `Registration ID`, `Full Name`, `Gender`, `Date of Birth`, `Mobile No`.

  If the unregistered-UHID check counted only PMS Registrations, most of
  those rows will resolve in one of the other two.
- **Run `reportPatientSources`** (`apps-script/maintenance/report-patient-sources.gs`)
  for the counts per book. For the orphans specifically, run
  **`findOrphanRegistrations`** (`restore-missing-registration.gs`). It
  checks Appointments, Clinical Sheets, Clinical Records and Daily Register
  against Registrations. `HANDOVER.md` lists it as *not yet run*.
- **Known case:** AL0808 was treated but missing from Registrations, and was
  restored and marked `Incomplete` (HANDOVER). Expect a few more like it.
- **Appointments with a blank UHID are expected.** Chatbot and phone
  bookings are saved with `UHID: ""` until the patient registers
  (`saveChatbotAppointment`; linking added in commit `6807c78`).

### A8. Blank and malformed UHIDs

**Confirmed (repo).** The 9 `AA99999` shapes are probably **valid**.

- The format is **year code + 2-digit month + that month's running
  number**. AA = 2015, one letter per year, so 2026 = AL.
- The number is 2 digits by default and **grows to 3 digits in a month with
  more than 99 new patients**. The comment in `getNextUHID` gives
  `AL08100` as the example.
- So `AA99999` = 2 letters + month + a 3-digit count is a legitimate UHID
  for the 100th or later patient of a month. Check that the two digits after
  the letters are 01–12 and the letters fall in AA–AL. Those that pass are
  real. Any that fail are errors.
- **Before 20 Aug 2026, a failed `getNextUHID` fell back to `"AL"` + four
  timestamp digits** (commit `f403a4f`). That gives a UHID with an
  impossible month such as `AL5731`. Treat any of those as errors that need
  a new number.
- **Blank UHIDs:** **needs the live sheet.** Quick registration always
  issues a UHID, so a blank one is most likely a row typed straight into the
  sheet or a test. Look at their Timestamp and Name before deciding.

### A9. Appointment statuses

**Needs the live sheet.** The data is the answer here, not the code.

```
=FILTER(Appointments!A2:Z, (Appointments!<Status>2:<Status>="Scheduled")+(Appointments!<Status>2:<Status>="In Chair")+(Appointments!<Status>2:<Status>="Checked In"), Appointments!<Date>2:<Date> < TODAY())
```

From the repo: nothing closes these automatically. A patient left
`In Chair` or `Checked In` was never checked out, and past `Scheduled`
rows are no-shows nobody marked. **Proposed:** at import, mark past
`Scheduled` rows as `No-show`, and past `In Chair`/`Checked In` rows as
`Completed`, with a note saying the status was closed at import.

---

## Part B (proposed, Viveyk to confirm)

### B1. Duplicate UHIDs

**Repo fact.** A repeated UHID is mostly **deliberate**. A patient returning
after a long gap has details re-collected for NABH, and registration writes
a **new row under the same UHID**. The newest row is current, and the app
everywhere takes the latest by Timestamp (`regLatestByUhid_`). The comment
in `report-duplicate-uhids.gs` says so explicitly. Only a pair with
**genuinely different names** is two people on one number.

**Proposed rule:**

- **Identical pairs:** merge into one patient. *(Agree.)*
- **Pairs that differ only in mobile, address or similar:** **not** a
  review item. One patient. Keep the **latest row as current**, and keep the
  older row as registration history.
- **Pairs that differ in name, gender or DOB:** review list. The reviewer
  decides each case. Running `reportDuplicateUhids` in the PMS editor lists
  exactly these.
- **True clash** (two different people): the **later-registered person
  gets a new UHID** in the new system, and the old UHID is kept as an alias
  on their record so old paperwork still finds them. Nobody is renumbered
  without the reviewer's sign-off.
- **Reviewer:** *Viveyk to name, e.g. the front-desk lead plus one doctor.*

### B2. Receipt book of record and numbering

**Proposed:**

- **Confirm:** e-receipts come from `Receipt No.`, and the 23 manual lines
  come from the FY tabs.
- Keep the old `yy-yy/n` number as text on each migrated receipt.
- **The new system should continue the `yy-yy/n` format per financial
  year,** e.g. `26-27/1234` onward, rather than a bare integer. The printed
  receipts, the CA and the patients all know that format, and a mid-year
  switch makes FY 2026-27 two series. Note: `server/src/actions/finance.js`
  currently computes the next number only from receipt numbers shaped
  `^[A-Za-z]*[0-9]+$`, so `26-27/…` numbers are ignored and it would restart
  at 1. That needs changing either way.
- **Manual receipts:** *Viveyk to say whether they carry printed book
  numbers.* If they do, record them as `M-<book no>`.

### B3. History before April 2024

- **Repo fact.** The Finance book was created on 30 Sep 2024, and the old
  registration book holds pre-app patients. The repo has no receipts or
  expenses before April 2024.
- **Proposed:** the accounting year is fixed **April to March** (Indian FY,
  matching the `yy-yy` receipt numbers).
- *Viveyk to confirm* whether older books exist (Excel "Master File" or
  paper) and whether they should be migrated. Suggestion: migrate
  **patients** from all eras, and keep **money** from April 2024 only.
  Archive older finance as files.

### B4. Unused features

**Repo fact (A5):**

- Consents, Care Plans, Treatment Progress, Signatures and Pending were
  never really used.
- Treatment Progress has no data of its own; it is the Daily Register.
- Registration consent is recorded in Registrations.

**Proposed:**

- Consents stay on paper for now.
- Launch with the screens the clinic uses daily: registration, appointments
  and day sheet, clinical forms, Daily Register / progress, receipts,
  expenses, masters.
- Keep Care Plans, Treatment Plans and AI consents hidden until after
  cutover.
- **Signatures:** get each doctor to upload one before go-live if signed
  printouts are wanted.

### B5. Roles and permissions

**Repo fact.** Today there is **one shared login** (`APP_PASSWORD`, falling
back to `MASTER_PASSWORD`), plus separate passwords for Finance, Master and
Reports (two Reports passwords, one per person). Those passwords are the
only access control there is now.

**Proposed starting map**, for Viveyk to fill in names:

| Role | Sees / does |
|---|---|
| admin | everything, including masters, expenses, P&L, reports, user management |
| doctor | patients, appointments, clinical notes (edit), Daily Register, receipts (view) |
| reception | registration, appointments, receipts (create), patient documents (upload); no clinical edit, no expenses, no P&L |
| accounts | receipts, expenses, collections, P&L, reports; clinical notes hidden |

*Viveyk to send the staff list, each person's role, and who keeps a login.
Master edits should be admin only.*

### B6. Panel patients

- **Repo fact.** Panel patients sit in a separate book only for
  registration and billing. Clinical records, appointments and the UHID
  sequence are already shared (`regSheets_()`, `EMPANELLED-SETUP.md`). A
  panel fee schedule exists (CGHS, PR #81).
- **Proposed:** **yes**, one patient list with *panel*, *panel category* and
  *card ID* as fields.
- *Viveyk to name who handles claims.*

### B7. Patient documents

- **Repo fact.** The app uploads to the Drive folder
  **"KB Dental - Patient Documents"** (one subfolder per patient, listed in
  the `Patient Documents` tab). Access goes through the authenticated
  backend only (commit `7603a41`). Only 3 files means the feature has barely
  been used.
- **Proposed:** confirm keeping the existing Drive folder.
- *Viveyk to say where X-rays really live*: the RVG/OPG machine's PC, an
  intraoral scanner, or WhatsApp. If it is the imaging PC, that folder is
  the real archive and is worth a separate plan.

### B8. Live-site security

**Repo fact**, and the order matters:

1. Set **`APP_PASSWORD`** in Script Properties first. Without it, login
   falls back to `MASTER_PASSWORD`, and if neither is set every login fails
   with "No APP_PASSWORD set".
2. Set **`REQUIRE_AUTH`** = `true`.
3. **Deploy → Manage deployments → New version.** Script Properties apply
   without a redeploy, but confirm with a logged-out request that patient
   data is refused.
4. Do the same in the **PMS Empaneled** project, which has its own
   properties.

**Side effects:**

- The patient-facing pages keep working, because their actions are public
  by design: the chatbot, and `register.html` via `patientLookup` /
  `patientCompleteRegistration`, which need UHID + mobile.
- Every staff device will be asked to sign in once per session.

**Proposed: do it today.** *Viveyk to confirm.*

### B9. Other books

**Repo fact.** No code reads Inventory, Attendance, Team Management, Stock,
Conveyance or OPS. "K.B. DENTAL INVENTORY (SUITE)" exists in Drive but is
not wired to the app.

**Proposed: out of scope** for this migration. *Agree with the
assumption.*

### B10. Cutover

**Proposed:** a **Sunday afternoon, or the clinic's weekly off** (the
Working Days master has the weekly off).

1. Run the export after the last patient.
2. Run the import and `verify.js`.
3. Proceed only if total collected matches to the rupee.

*Viveyk to name the date and the person who checks week 1.* That person
compares the new system's daily collection against `Receipt No.` / the FY
tab for each day of the first week.

### B11. Staff files

*Viveyk to answer.* Suggested reply: "Shared by mistake. Please delete your
copy and confirm. The originals stay with [owner / HR]." Thank them for not
opening the files.

---

## What still needs someone in the editor or the sheet

| # | Action | Where |
|---|---|---|
| A1 | Run `reportInstanceFiles`, paste the log | PMS Apps Script editor |
| A2/A3 | Copy the row-2 formulas of `Working`, `Receipt No.`, each FY tab | Finance sheet |
| A2 | Total the split-payment Amount column for FY 24-25 and 25-26 | Finance → Patient Fee Receipt |
| A4 | Compare the first `Expense` date with the first `Expense New` timestamp | Finance + Expense Form (Responses) |
| A6 | Run the format formulas above | PMS → Registrations |
| A7 | Run `findOrphanRegistrations` and `reportPatientSources` | PMS Apps Script editor |
| A8 | Check blank-UHID rows' Timestamp and Name | PMS → Registrations |
| A9 | Run the stale-status filter | PMS → Appointments |
| B1 | Run `reportDuplicateUhids` for the different-name pairs | PMS Apps Script editor |
| fix | Add Clinical Records (`1g3t7vbp…`) to `EXPORT_BOOKS`. Point the importer at `Expense`, and at both Amount columns plus `Timestamp` | `migration/` |
