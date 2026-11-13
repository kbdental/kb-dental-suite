# Upstream integration and Sheets refresh — 12 November 2026

Latest upstream `d8cd654` (including main `9300a96`) is integrated locally on
`saas/multi-clinic` as `88ff906`. Existing native organization, clinic creation,
login, responsive layout and conflict protections were preserved. Main and the
live Apps Script deployments were not changed; no GitHub push was performed.
A named stash preserves the tracked pre-integration work. Private/untracked data
was not stashed or added to Git.

## What changed and what was tested

- Added the native get/save examination-list contract used by the latest Master
  and Care Plan screens. Examination keys are required and duplicates rejected;
  readers cannot write the list.
- Added native paginated `listClinicalSheetRecords` and `appendClinicalRecordRows`
  contracts. Only allowed clinical record tabs/columns can be written, patient
  identity must be part of the key, updates are serialized, ambiguous matches are
  refused and repeated saves update the same patient/date/tooth row.
- Preserved embedded-sheet header behavior while implementing the requested tooth
  report selection. The upstream page referenced `only` without declaring it;
  the integrated component now accepts it and initializes the requested tab.
- Imported the new bilingual template library, Normal/CGHS plan entries,
  examination definitions and clinical departments from their authoritative main
  workbook configuration tables.

New behavior was exercised with fictional records in the separate shared test DB:
examination list5/5 (including prior config contracts), readable clinical copy4/4
(including new examination answer round-trip), page security7/7 and native API
transport1/1, established clinical16/16 and CGHS bills2/2. These database files ran separately. Source/conversion/selection/
navigation/session Node checks38/38 and backend build pass.

## Database schema decision

All38 migration files are applied to the marked verification database and their
checksums match. No new migration was required for this upstream batch:

| New behavior | Existing storage |
| --- | --- |
| Examination definitions | `clinic_settings.value` JSON, with stable finding keys |
| Examination answers | Versioned `care_plans.page1`–`page4` JSON |
| Bilingual, concise and comprehensive templates | `clinic_settings.value` JSON |
| Normal/CGHS plan configuration | `clinic_settings.value` JSON |
| Work-done sheet history and paging | Existing `clinical_sheets` rows and JSON |
| Readable clinical copy | Existing `clinical_records.fields` JSON and recorded row identity |

Do not equate a schema change with every UI change. Add a numbered migration when
new relational storage, constraints, indexes or permissions actually need one;
never edit already-applied migrations. The tests verify saved fields are not
silently dropped. Per-treatment prescription dates remain the upstream print-time
UI choice; this batch does not introduce a new durable encounter/date model.

## Source capture, import and reconciliation

Five authorized workbooks were captured read-only:154 tabs /41,897 body rows.
Capture completed **12 November at12:00:40 IST**; application import began at12:02:10.
The capture passed workbook-version stability checks. A complete private backup,
`before-refresh-2026-11-12.dump`, was created before the normalized import using the
existing backup administrator. No row-level-security protection was disabled.

The application import added one patient,20 appointments,19 clinical forms,
10 register rows, four receipts, one treatment case and two CGHS bills. Source
reference/library updates include156 bilingual templates,277 plan entries and17
examination findings. Readable receipt and expense totals reconcile exactly;
finance remains **1 April 2024 onward**.

Eight CRM conflicts remain held: six contact-record conflicts first seen during
the previous verification period and two lead-inbox changes involving taken_at.
Unconflicted source updates were applied. Existing app-side changes were preserved,
not blindly overwritten. The old12 unreadable expense amounts remain held with
source-row review links. Missing-identifier, name-variant and unknown-date flags
remain explicit. This is not a claim that every historical row is fully resolved
or that production cutover has been accepted.

The real verification DB passed14 local application checks. Read-only integration
checks compared actual API values with the DB: template library156 rows, plans277,
examination17, saved tooth JSON and paginated history all matched. Schema drift:0.
No fictional test writes were made to the live verification data. The refresh is
one-off; the expired hourly worker was not silently extended.

## Access status

The updated native server runs on loopback8350. The old Quick Tunnel URL stopped
resolving. Cloudflare rejected three temporary-tunnel creation attempts with
HTTP429 /Tunnelstore error10000, including a retry after a six-minute pause.
No exact cooldown was established. A diagnostic provisioning request later returned
200 with no Retry-After or rate-limit headers. The standard client subsequently
created a new tunnel at06:50UTC, roughly eleven minutes after the first rejection.
There was also a brief new-hostname DNS propagation/cache delay. Cloudflare and
Google public DNS both resolved it; normal local DNS then resolved it too.

The current public URL is in private `public-url.txt`. Public verification passed
14/14 at12:22:53 IST, and five read-only integration checks matched the actual DB.
No alternate provider was started: Cloudflare recovered. Free alternatives checked
were localhost.run (temporary HTTPS domains without signup) and Localtunnel. Their
temporary names/limits make them verification options rather than a fixed launch URL.
Existing staff login credentials are unchanged. Browser startup and clinical
Records → Clinical Records → Work Done Sheet gallery/patient picker rendered with
no errors after user sign-in; no live backfill or clinical write was triggered.
