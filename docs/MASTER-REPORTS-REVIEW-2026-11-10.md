# Master and Reports review — 10 November 2026

The latest upstream UI is integrated locally on `saas/multi-clinic`. The server
and a new temporary Cloudflare tunnel are running. No changes were pushed to
GitHub, the existing Apps Script deployments were not published, and no clinical
records were edited by this review.

## Integration and current behavior

- Upstream reviewed: `origin/main` at `6467d5b` and Viveyk's working branch
  `origin/claude/kb-dental-sheet-structure-mlfjr0` at `e451b3f`, which includes main
  plus the latest form-ending/doctor-list work. Local merge: `c5c4f4e`.
- The fork's application branch was already at the prior local HEAD. Main was
  never checked out. Existing uncommitted sync, clinic creation and layout work
  was stashed by explicit tracked path, merged back and left uncommitted. The
  preservation stash is retained as a recovery point; untracked private files
  were not included or moved.
- Retained native Organization, Clinics, Roles & access, Passwords, archiving,
  selected-clinic isolation, report tabs, import protections and responsive fixes.
- Added the six native library/plan/department read/write actions required by the
  new Master UI. Existing curated notes are exposed without replacing them with
  shipped seeds. Until separately edited, existing single-length notes appear in
  both length fields. Explicit empty libraries stay empty. Hindi and separate
  concise/comprehensive text round trip; saved clinical text uses comprehensive,
  printed text can use concise. No live seed/load/reset buttons were pressed.
- Fixed a reproduced blank-page integration defect: nonce insertion had edited a
  literal `<script>` inside upstream JavaScript. Only actual outer HTML script
  elements are now changed; CSP remains enabled, with no unsafe-eval added.

## Current flows

| Area | Current route and behavior |
| --- | --- |
| Organization | Master unlock → Organization Details, Clinics, Roles & access, All-clinic Reports, Data Archiving, Passwords. Clinic creation is real, grants only its creator access, and keeps clinical records scoped. |
| Clinic setup | Selected clinic → Clinic Details, Doctors, Employees, Chairs, clinical template library, Plan, Plan CGHS, Departments, Examination placeholder, patient/post-op instructions and implant brands. |
| Other reference lists | Schedule, Patient, Prescriptions and Accounts contain their corresponding reference editors. Examination, Drug categories and Account Heads remain placeholders. |
| Clinic Reports | Reports access → date range → Apply → Summary, Patients or Doctors. Reads receipt, expense, register, appointment, patient, treatment and follow-up sources. Five critical failed reads block the report. |
| Organization reporting | Master → Organization → All-clinic Reports. Only authorized clinics are included. Appointment/finance metrics use dates; plan totals are explicitly all-time. This is a different scope from clinic Reports. |

## Improvements to agree before parallel edits

| Priority | Improvement | Evidence and expected behavior | Proposed work split |
| --- | --- | --- | --- |
| High | Save department renames atomically | `ClinicalDepartmentEditor.commit` independently fires department, template and plan saves, then announces that records moved without awaiting them. A partial failure can leave references split. One native transaction should validate references/version and return success before the UI closes the editor. | Viveyk: editor feedback; native backend: transaction, conflict checks and rollback tests. |
| High | Make Reports password wording match its actual policy | UI says “Two-Person Control” and that each person can change only their own password. Native backend accepts either password, permits `masters:write` to change either slot, and lets authorized administrators bypass the extra unlock. This is not two-person approval. Report readers also see password-change controls they may not be allowed to use. Keep access protection; agree the intended policy, then rename/move settings under Organization → Passwords and show only permitted controls. | Joint product decision; Viveyk: wording/layout; native backend: enforcement and tests. |
| High | Guard report requests and distinguish selected versus applied dates | Reports has seven parallel reads, no generation/cancellation guard, and editable filters while a request is running. Keep “Showing from…to…” from the returned dataset, mark unapplied edits, and prevent an obsolete response from publishing data after navigation/range changes. Optional failed treatment/follow-up reads should be labeled unavailable rather than silently degrading classification. | Viveyk: filter/applied-state UI; native backend: stable result contract and failure tests. |
| Medium | Clarify scope and reduce competing report entrances | Clinic Reports and Organization All-clinic Reports have different scope and mixed period/all-time metrics. Add a consistent scope line (organization, clinic(s), applied dates, data capture time). Do not sum clinic patient counts and call that unique organization patients. Counts of patients with appointments must not be labeled patients treated. | Viveyk: labels/navigation; native backend: metric definitions. |
| Medium | Make Master dependencies easier to follow | The accepted single Clinic category now has many subtabs. Keep one location, but group links into clinic setup and clinical configuration; rename “Plan” to “Normal Plan” if agreed. Present Departments → Templates → Plans as a setup sequence, with unresolved-reference counts. Mark placeholders visibly before opening them. | Viveyk: menu/editor UX; native backend: dependency validation. |
| Medium | Make partial configuration failures visible | Master loads many reference lists in one batch and some editors can appear empty when a read fails. Show per-section loading/error/retry, disable saves for a list that failed to load, and preserve drafts until save confirmation. | Shared contract; Viveyk: states; native backend: versioned writes. |

These are recommendations, not an authorization to redesign the product or change
live permissions. Preserve familiar clinical workflows and the accepted organization
isolation boundary. Complete visit/treatment/material history remains separate work.

## Alignment with Viveyk

1. Use one integration branch, `saas/multi-clinic`, with explicit upstream commit
   references. Viveyk's UI source branch remains the source for new screen/content
   changes; the native integration branch owns authorization, persistence and runtime.
2. Before touching shared `index.html`, agree the exact component and API payload.
   Avoid two simultaneous whole-file rewrites. Merge a small change, test it, and
   integrate the next snapshot before more edits to that component.
3. Agree the template library, Normal/CGHS plan, department and report schemas. Changes
   to names, keys or response shapes need a matching backend test in the same batch.
4. Treat spreadsheet import as a separate deployment operation. Do not reseed edited
   native configuration or imply that a new code pull refreshed patient data.
5. For acceptance, run shared database tests one file at a time; use synthetic data
   for writes, then read-only checks on the real verification copy. Review browser
   rendering, empty/error states, clinic switching and date changes before sharing.

## Verification and limits

- New clinical configuration integration tests: 4/4; page-security tests: 7/7.
- Existing backend Master tests: 23/23; Reports: 17/17; report-tab contracts: 5/5
  (each database test file ran separately).
- Native navigation, screenshot regressions and session regression checks: 11/11.
- Report arithmetic: 113/113; checked-Master-save assertions: 17/17; build passes.
- Public and local verification: each 14/14. Master/Reports read probe: 39/39.
- After the user signed in, a read-only authenticated browser walkthrough covered
  Master category navigation, clinical configuration, clinic creation form,
  organization reports, clinic Summary/Doctor Details/Patient Details and a patient
  history drill-down. Reversed report dates were rejected and original filters
  restored. No new browser errors appeared. Saving, permission changes, seed loading
  and print/export acceptance were not exercised on the real dataset.
- Data is still the last imported capture from **7 November, 13:50:59 IST**, applied
  at13:51:03. The hourly verification window expired **8 November, 10:28:35 IST**.
  The import worker was not restarted or extended by this server restart. No worker
  process was present; its stale state file flag was corrected to stopped.
- The public URL is in the private runtime's `public-url.txt`. It changed because
  the earlier Quick Tunnel process had stopped. Existing credentials are unchanged.

## Authenticated visual follow-up

The user completed sign-in and Master unlock. At the current narrow browser pane,
the main navigation and clinic footer remain visible, but Master category/subtab
rows take substantial vertical space and the organization report table extends
horizontally. Keep the accepted single Clinic destination; compact internal
grouping and a clear horizontal-scroll cue would improve this layout.

Additional observed improvements to align with Viveyk:

- **Setup readiness:** Normal Plan and Plan CGHS are both empty in this database.
  Both offer the same bulk loader for277 default treatments. Departments is also
  uninitialized and offers14 defaults. Treat this as an explicit, previewable setup
  operation: show which lists will change, unresolved template references and the
  relationship to fee schedules. No defaults were loaded by the review.
- **Native wording:** Departments still says “Save them to the sheet.” Replace
  spreadsheet-specific copy with wording matching the native clinic configuration.
- **Report identity and freshness:** Add a visible Reports heading, selected clinic
  and source-capture time. The existing “Showing…” applied-range line is present
  and helpful; retain it. Default To currently runs to the end of the month
  (30November), rather than today (10November), so a month-to-date preset should
  state its cutoff explicitly.
- **Data-quality prominence:** The Summary shows2,110 patients without registration
  dates in a small note below the monthly table. Promote this to a clear coverage
  warning and offer a review path; do not invent dates or silently reclassify them.
- **Placeholders:** Examination, Drug categories and Sales Tracker can be reached
  alongside functioning sections. Mark their unavailable status in navigation.

Doctor and patient report tabs have search, row actions and history/paging controls;
the patient-history row action opened its detail table successfully. Patient values
and staff contact details were not copied into this document. This follow-up adds
observations only; no application configuration or clinical data was changed.
