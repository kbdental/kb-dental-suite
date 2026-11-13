# Database-backed Sheets verification site

7 November 2026. The separate native website is running on loopback 8350 and is
shared through a temporary Cloudflare Quick Tunnel. The existing GitHub Pages,
Apps Script properties, passwords and operational Sheets workflow are unchanged.
The earlier Sheets-backed bridge is abandoned; do not start it or enable old-site
authentication as a prerequisite for this setup.

## Current operating model

Google Sheets is authoritative. A read-only service account captures five shared
workbooks: main PMS, Clinical Records, Finance, empanelled and historical
registration. Sheets and Drive APIs are used; Apps Script API is unnecessary.
The empanelled workbook is a panel workflow for the same clinic, not a separate
organization or operating unit. Panel patients are not automatically all CGHS.

The converter updates a marked isolated PostgreSQL copy, not the active review DB.
Receipts and expenses start on **1 April 2024**. Earlier raw source rows remain
private for reconciliation. Source-absent copied business records are not carried
forward automatically. Existing source-backed improvements require review.

The website uses independent staff accounts and session protection. Anonymous
patient reads are rejected. The restricted application DB role cannot read the
private source-capture schema. The importer has a separate owner role limited to
this copy. Copied sessions were cleared, separate credentials generated, and three
local document files copied with checksum verification. Google access remains Viewer.

Hourly refresh is enabled for today's verification window, ending **8 November
2026 at 10:28:35 IST**. A failed capture retries after five minutes and retains the
last imported dataset. The successful 7 November refresh finished at 10:37:52 IST,
picked up one appointment change, and reported zero conflicts or missing-source
records. Scheduling is a separate worker; the importer report's scheduleEnabled
field means the import command itself does not enable scheduling.

Continue operational entries on the existing website during verification. New-site
test edits do not return to Sheets. After acceptance, agree a cutover time, finish
the last source catch-up, resolve review items, and choose the new operational URL.
The actual launch-week schedule is not yet configured.

## Review results and limitations

The copy contains 2,602 source-backed patient identities, 2,543 registration-history
records, 4,332 clinical forms, 31 clinical charts, 5,214 register rows, 349 appointments,
1,687 receipts and 967 expenses. These are converted record counts, not a guarantee
that every historical identity represents a distinct verified person. Repeated
patient/day register entries are preserved. Authored treatment plans and explicitly
marked finance-opening estimates remain separate.

Readable receipt and expense totals reconcile exactly. Twelve expense rows with
unreadable amounts are held for review, not guessed. The admin review page links
to their source rows. Other review flags include missing identifiers, name variants,
three undated clinical forms and four inconsistent appointment clocks. Undated
histories remain undated; recorded attendance statuses are preserved.

Source-only changes update the target. App-only changes are preserved. Changes on
both sides, ambiguous identity matches and disappeared source records are held for
review rather than silently overwritten/deleted. Comparisons use source and target
content against the baseline, not capture timestamps alone. Target rows are locked
and checked again before an update. Repeated identical imports produced no business
updates; a later live capture correctly updated one changed appointment.

Public verification passed 14 checks: independent login/session/logout, anonymous
and signed-out access rejection, patient directory count, populated plan/care-plan
values, separate register rows, appointments and review flags, financial API totals,
and authorized sync status. No clinical/application records were written by those
checks. The focused Node tests pass 37/37 and the backend build passes. Browser
automation failed to initialize, so visual acceptance and real clinical write-flow
acceptance remain manual checks. This is verification readiness, not production
acceptance. Migrations 0035-0037 are applied only to this isolated copy.

## Access and verification

Private files are under `api/.organization-demo-runtime/launch-sync/` (ignored by
Git and restricted to the current Windows user):

- `public-url.txt`: current public HTTPS URL.
- `logins.txt`: clinic code `kb-review`, independent staff passwords and screen pass.
- `worker-state.json`: last success, next attempt, error and expiry.
- `import-summary.json`: normalized counts, totals, conflicts and source warnings.
- `public-verification.json`: latest public check results.
- `source-issues.json`: workbook/tab/row references for held rows.

The on-page verification banner has been removed at the user's request. The
dataset remains the same isolated import-only trial; removing the label does not
change cutover status. Master now has one Clinic category (including clinical
templates), Organization → Roles & access, and Organization → Passwords. The
legacy non-provisioning Other Clinic entry and native Finance sheet selector are
hidden. The source sync configuration is unchanged.

The later user correction restores clinic management at **Master → Organization
→ Clinics → Add Clinic**. This creates a working clinic in the same organization,
with an explicit access grant for the creating administrator. Configured roles
are copied, but patients, visits and finances are not copied. Other staff get no
automatic access. Use the sidebar Clinic selector to open a granted clinic. Two
existing linked clinics were listed during verification; no extra live clinic was
created by the checks. Migration0038 enables the narrowly authorized function only
in the marked verification copy; the existing website is unchanged.

Sign in at the website root, then open `/sync-review` as admin. Check last successful
refresh, counts, conflicts and held source rows. Select familiar patients privately
and compare their recorded history, register, appointments and finance with Sheets.
Make test edits only where intentionally disposable; they are not live records.
Do not share the private credential files or service-account key through Git.

From `api/`, recheck the recorded public site without patient output:

```powershell
$publicUrl = (Get-Content .organization-demo-runtime/launch-sync/public-url.txt -Raw).Trim()
node scripts/launch-sync/verify-site.mjs $publicUrl
Get-Content .organization-demo-runtime/launch-sync/worker-state.json
```

Keep the laptop awake and connected. The three background processes are native
server, worker and cloudflared; closing this chat does not intentionally stop them,
but Windows restart does. To restart, first check that each process is absent to
avoid duplicates. Run these separately from `api/`:

```powershell
node --import tsx scripts/launch-sync/server.mjs
node scripts/launch-sync/worker.mjs
& .organization-demo-runtime/tools/cloudflared.exe tunnel --url http://127.0.0.1:8350 --protocol http2
```

Foreground commands remain running in their own terminals. For background startup,
use `Start-Process -WindowStyle Hidden` with separate private output/error logs.
Do not rerun runtime provisioning to restart the server: provisioning clears sessions.
The worker retains its explicit expiry; restarting does not extend it.

A Quick Tunnel URL stays usable while that tunnel runs, but may change after
restart. A fixed purchased-domain hostname needs a named Cloudflare Tunnel and DNS
setup later; no domain/nameserver changes were made here. Record and verify a newly
created tunnel URL before sending credentials to it.

## Capture, safety and historical incident

All source cells retain positions, duplicate headings, raw values and display
values. Drive versions are checked per workbook and over the complete capture;
observed edits abort staging. This detects instability, not a transaction across
Google workbooks. The initial copy matched an exported database snapshot across
68 public tables / 60,325 rows before its application data was converted. A private
pre-import backup remains available. The current app.env guards against casually
restoring over the now-published copy. No shared test DB was used by focused tests.

An earlier empty live saveRegistration probe was a verification mistake and appended
one identity-empty registration row to each main/panel workbook (main row 2537,
empanelled row 13 at discovery). Original row prefixes matched the earlier capture.
No further live write probes are permitted. The converter excludes these blank
identities. A private guarded owner cleanup helper exists at
`api/.organization-demo-runtime/launch-sync/cleanup-blank-probe-registrations.gs`;
it checks exact row hashes/widths before deleting. It has **not been executed**;
Viewer credentials cannot clean source rows. Any owner cleanup needs read-only
comparison afterward. Do not delete rows solely from the historical row numbers.

The old published login bug and late-response session race were reproduced with
fake/offline data and corrected locally. No GitHub publish, old Apps Script auth
change, or historical-secret-removal audit is included in this setup.
