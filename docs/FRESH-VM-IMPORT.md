# Fresh VM installation directly from Google

13 November 2026. This is the user-selected route: a new clinical database,
fresh Google capture, new credentials/key and new Umami without old history.
No laptop database dump or old runtime configuration is needed. It preserves
the familiar clinical website; it does not change the original Sheets website
or perform a production cutover.

## Prerequisites and private files

Read `AGENTS.md`, `docs/HANDOVER.md`, `docs/PATIENT-CRM-DIRECTION.md` and
`docs/GOOGLE-VIEWER-SETUP.md`. Use `kbdental/kb-dental-suite`, branch
`saas/multi-clinic`. Install Git, Node.js 24 and PostgreSQL 18 with client tools.
PostgreSQL must be running locally. The fresh installer supports Windows and
Linux; actual VM OS/service/proxy setup must still be checked there.

```powershell
git clone --branch saas/multi-clinic --single-branch https://github.com/kbdental/kb-dental-suite.git
cd kb-dental-suite/api
npm ci
npm run typecheck
npm run build
```

On an existing checkout preserve changes before updating. Do not use
`db:bootstrap`, `db:seed`, `db:reset-dev`, `rehearse --apply-copy` or
`provision-runtime.mjs` for this route. Those are different development/clone
workflows. Do not change applied SQL or bypass database marker checks.

Two private files are prepared on the VM, outside Git:

| File | Contents |
| --- | --- |
| Google JSON, e.g. `C:/KB-Dental/secrets/google-viewer.json` | Existing privately transferred service-account JSON, or a newly authorized VM service account. The five workbooks must grant it Viewer access. |
| Administrator env, e.g. `C:/KB-Dental/secrets/postgres-admin.env` | `KB_SYNC_ADMIN_URL` set to a local PostgreSQL administrator connection URL for the `postgres` database, using the **VM's own** username/password. URL-encode password characters where required. |

The administrative URL is used only for initialization, not written into runtime
state, and not needed by the importer/server/worker afterwards. Do not put an
actual password in shared commands/prompts. Limit access to the files using the
VM OS's ACLs/permissions. On Linux substitute the actual private Linux paths.

## 1. Check Google access without any database operation

Run from `api/`, replacing the example key path:

```powershell
node scripts/launch-sync/rehearse.mjs --credentials 'C:/KB-Dental/secrets/google-viewer.json'
```

This reads five workbooks, validates capture stability, reports aggregate counts
and writes a private `source-preview-summary.json`. It does not import, start a
worker, or write to Google. Fix credential/file-sharing problems before continuing.
The sources are main PMS, Clinical Records, Finance, empanelled and historical
registration. Empanelled is a workflow in the same clinic, not another clinic.

## 2. Plan, then initialize a new empty installation

```powershell
node --import tsx scripts/launch-sync/fresh.mjs
node --import tsx --env-file='C:/KB-Dental/secrets/postgres-admin.env' scripts/launch-sync/fresh.mjs --apply --hostname 'vm.example.com'
```

Replace `vm.example.com` with the VM's intended application hostname. Optional
`--organization-name` and `--clinic-name` set the public installation labels;
both default to KB Dental. These are metadata, not automatic DNS/proxy setup.

The plan has no database/credential/file writes. The apply command creates:

- A uniquely named database with a private identity marker and all 38 migrations.
  The `kb_launch_sync_test_...` name is retained to satisfy existing safety guards;
  it does not refer to the shared `kb_pms_test` database.
- One organization and one clinic (login code `kb-review`), four newly generated
  staff accounts (`admin`, `doctor`, `reception`, `accounts`), organization access
  grants and screen passwords. No synthetic patients, care or finances are seeded.
- Dedicated owner/app roles with no superuser, RLS bypass, database-creation or
  role-creation privileges. The app cannot access raw `launch_sync` captures.
- Private `app.env`, `runtime-state.json`, `copy-state.json`, `logins.txt` and an
  empty documents directory under `api/.organization-demo-runtime/launch-sync/`.
  A new storage-credential encryption key is generated locally.

The website refuses startup until a reconciled import with source patients is
complete. A second apply on a completed matching fresh installation verifies its
identity and leaves credentials unchanged. It will not adopt/replace the old
clone profile, an unrelated database, or mismatched/incomplete state. After a
failure stop and inspect private setup state; do not erase files or run reset
commands as a retry. No partially created resources are silently deleted.

`KB_SYNC_RUNTIME_DIR`, if explicitly set, must be an absolute private directory.
Use the same value for **every** capture/import/server/verifier/worker command.
It is useful for isolated tests/installations; never point it at another profile.

## 3. Capture into the new database, preview, then apply

```powershell
node scripts/launch-sync/rehearse.mjs --credentials 'C:/KB-Dental/secrets/google-viewer.json' --reuse-copy
node --import tsx scripts/launch-sync/import.mjs
node --import tsx scripts/launch-sync/import.mjs --apply
```

Despite its historical `--reuse-copy` flag name, capture now supports the fresh
database created above. It uses the dedicated owner role and verifies state and
database markers; it does not require the administrative URL or a review clone.

Preview reports projected counts/warnings without changing business tables.
Apply records source baselines, preserves repeated register rows, original
attendance and source values, and retains unknown dates/review flags. Receipts
and expenses start on 1 April 2024. Unreadable amounts and ambiguous records are
held rather than guessed. Check `readyForVerification`, aggregate counts,
financial reconciliation, rejection categories and source issues privately.

The initial fresh import may omit a rollback dump only after confirming this
marked installation has no business records. A clone-based initial import still
requires its backup. Normal refreshes use the existing three-way comparison:
source-only updates apply, local-only changes survive, and edits on both sides
are held as conflicts. Missing sources do not authorize deleting local records.
After readiness succeeds, the runtime is marked `importReady` and startup is
allowed. This is verification readiness, not production acceptance.

## 4. Start and verify the actual website

```powershell
node --import tsx scripts/launch-sync/server.mjs
```

Run this in its own service/terminal. Default binding is loopback 8350; the
private `PORT` setting can choose another valid port. Keep PostgreSQL/private
analytics off public listeners and put an HTTPS reverse proxy or approved
tunnel in front of the clinical server, which uses secure cookies. A temporary
laptop tunnel hostname does not transfer to the VM.

In another terminal, from `api/`:

```powershell
node scripts/launch-sync/verify-site.mjs
```

This uses the selected runtime's private credentials, compares API values with
its database and checks anonymous/sign-out rejection. It creates/ends login
sessions but does not write clinical records. Missing populated plan/register
examples are reported as skipped, not invented, and review counts come from
the selected snapshot rather than the old laptop's fixed counts.

For a public VM URL, first verify the destination and store it in the VM runtime's
private `public-url.txt`, then pass that exact URL to the verifier. Never send
credentials to an unverified hostname just to make a verifier run.

## 5. Configure the VM's own refresh window

After initial import/verification, create private `worker-config.json` in the
selected runtime with `credentialFile` set to the VM's absolute Google JSON path
and `expiresAt` set to an explicitly chosen future ISO-8601 timestamp. Do not
copy the expired laptop schedule or `worker-state.json`.

```powershell
node scripts/launch-sync/worker.mjs
```

It captures/imports hourly, retries failures after five minutes, preserves the
last imported data, and stops at that expiry. Run only one worker per runtime.
Confirm a successful refresh and that the next attempt/expiry are correct in
`/sync-review`. Configure background startup/recovery appropriate to the actual
VM OS after foreground startup succeeds; keep logs private. No schedule is
enabled merely by running `fresh.mjs` or `import.mjs`.

## 6. Install new Umami and connect it explicitly

Follow `LOCAL-ANALYTICS.md` on the VM for a fresh Umami 3.4.1 installation.
That provisioner currently reads the local VM PostgreSQL administrator password
from `~/.kb-pms/postgres-superuser.txt`; the VM operator creates that private file
locally using the VM's password. It is not a file to copy from the laptop.
Use a new analytics database/website/admin login/salt, keep replay disabled and
build Umami on the destination OS. No old analytics data/state is required.

Set `UMAMI_LOCAL_URL`, `UMAMI_WEBSITE_ID` and `UMAMI_EVENT_SALT` in the clinical
runtime's private `app.env`, using the new analytics state. Restart the clinical
service and verify an allowlisted patient-free event persists. The initializer's
`--connect-review` flag targets the older profile and is not used here.

## Acceptance and remaining boundaries

Reconcile the fresh capture/import totals, review held identities/expenses, check
clinic permissions/history, verify HTTPS/login/logout, actual tracking persistence,
service restart and backup/restore. Use only disposable fictional records for
write-flow tests. Do not run test suites against the imported patient database.

Sheets import does not recover laptop-only app edits, uploaded documents, prior
conflict decisions or document bytes in Drive. Source account scopes here allow
spreadsheet reading and Drive metadata only. Retrieve needed attachments separately
from their authorized source or arrange selective private transfer later. Keep
the laptop copy intact until the VM's coverage is accepted. Final operational
cutover, print/write/browser acceptance, domain and backups remain explicit work.

## Implementation map for Claude

- `fresh.mjs`: new empty DB, migrations, organization/clinic/accounts, privileges,
  private configuration and identity-checked rerun. It never calls `cloneReview`.
- `rehearse.mjs` + `source.mjs`: read-only Google discovery/capture and staging;
  default is preview, `--reuse-copy` writes captures into the marked target.
- `model.mjs`: pure source-to-record conversion, no network/database calls.
- `engine.mjs` + `import.mjs`: stable business fingerprints, three-way comparison,
  marked-target import, financial checks and fresh startup readiness.
- `runtime.mjs`: selected private directory, restricted connections and DB marker
  verification. `server.mjs` serves the native clinical app; `verify-site.mjs`
  verifies the selected installation. `worker.mjs` orchestrates bounded refreshes.
- `provision-runtime.mjs`, `rehearse --apply-copy` and `restore-test-copy.mjs`
  are historical clone-only tools. The provisioner refuses fresh installations.

Validation on the development machine: actual new PostgreSQL database/roles,
five-book fictional import, idempotent rerun, RLS/privilege checks, protected API
reads and real loopback server/verifier are covered by
`api/test/launch-sync-fresh.test.ts`. Google capture uses separate fake-service
tests; no live Google import or VM installation is claimed by this work.
The focused validation run passed 23 backend tests across five serialized files,
49 Node tests, TypeScript and build. This is not a full-suite or Linux/VM acceptance
claim; confirm the actual environment before exposing the VM URL.
