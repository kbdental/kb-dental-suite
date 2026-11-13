# Replicate the current application on Viveyk's VM

13 November 2026. Handoff for the operator and Claude on the destination VM.
This is a copy of the current verification installation, not a production cutover.
The VM operating system, hostname, domain and remote access are not yet verified.
No VM installation or private-data transfer was performed by this GitHub update.

Publication validation: 75 backend tests passed in 10 individually serialized
files; the selected importer/UI Node run passed 49 tests across 12 files (the
legacy scripts also report their internal assertions). Typecheck, build and the
Git migration-byte preservation check passed. The older Master-menu expectation
and a CRLF-sensitive registration test were reproduced and corrected. This is
targeted validation, not a full-suite run or verification of the destination VM.

## Start here

Read `HANDOVER.md`, `PATIENT-CRM-DIRECTION.md`, `LAUNCH-SHEETS-SYNC.md`,
`UPDATE-AND-SYNC-2026-11-12.md` and `LOCAL-ANALYTICS.md` before making changes.
`ANOTHER-LAPTOP.md` creates synthetic development/demo installations; its bootstrap
and seed sequence does not reproduce the current patient database.

The target is the familiar clinical website backed by PostgreSQL, with native
organization/clinic controls and the captured Sheets history. The latest profile
is `api/.organization-demo-runtime/launch-sync/`, served by
`api/scripts/launch-sync/server.mjs` on loopback 8350. The older `realdata-review`
profile on port 8300 and the synthetic organization demos are separate installations.
Do not substitute one for the other or merge their databases.

One organization owns its database, deployment, credentials, sessions, files and
hostname. Its clinics share that database with scoped access. Preserve existing
clinical workflows and shared patient identity. Full visit/material history is
still follow-on work; the admin demo does not prove that feature is complete.

## What GitHub contains

Use the fork `MJ-06/kb-dental-suite`, branch `saas/multi-clinic`:

```powershell
git clone --branch saas/multi-clinic --single-branch https://github.com/MJ-06/kb-dental-suite.git
cd kb-dental-suite
git status --short
git rev-parse HEAD
cd api
npm ci
npm run typecheck
npm run build
```

Install Git, Node.js 24 and PostgreSQL 18 including client tools first. Record the
checked-out commit in the VM's private deployment record. For an existing checkout,
preserve local changes and use a fast-forward update; never reset it to match this guide.
Stay off `main`. Repository migration attributes preserve checksum-sensitive SQL
bytes on Windows and Linux. Do not reformat or normalize applied migration files.

The branch includes application source and static screens, migration files through
0038, import/capture code, fictional test fixtures, analytics setup scripts and
operating notes. `node_modules`, generated builds, databases and private runtimes
are not deployment artifacts in Git. Reinstall/build them on the destination.
The abandoned `sheets-bridge.mjs` is historical tooling; do not use it as this server.

## Required private transfer

Arrange a fresh backup and a private manifest with the operator. Do not put file
contents, patient identifiers, credentials or per-patient hashes in GitHub, issues,
Claude prompts or chat. Keep the manifest with the encrypted transfer.

| Item | Source on this laptop | Destination handling |
| --- | --- | --- |
| Current clinical database | Database named in `launch-sync/runtime-state.json` and `copy-state.json` | Fresh PostgreSQL 18 custom-format dump of the complete database, including the private `launch_sync` schema and import baselines/conflicts. Existing pre-refresh dumps are rollback history, not the latest copy. |
| Patient documents | `api/.organization-demo-runtime/launch-sync/documents/` | Preserve storage keys, file bytes and recorded checksums. Set the VM's `DOCUMENT_DIR` to its own absolute path. |
| Clinical runtime settings | `launch-sync/app.env`, `runtime-state.json`, `copy-state.json` | Restricted files at the same relative runtime location. Preserve marker/identity consistency; adapt machine paths and connection settings privately. These files contain secrets. |
| Review state | `launch-sync/import-summary.json`, `source-issues.json`, `latest-summary.json` | Private runtime files required for sync status/review context. The database retains the complete source and conflict history. |
| Staff access handoff | `launch-sync/logins.txt` | Deliver privately to the operator, not to source control. This is not a substitute for the password hashes/accounts already in the database. |
| Encryption material | Existing `KB_SECRETS_KEY` in the selected profile's `app.env` | Preserve it for existing encrypted settings. Do not replace it blindly: the new machine must still decrypt restored values. |
| Analytics history, if continuity is wanted | `kb_umami_review` database | Separate fresh dump; clinical backups do not include it. A fresh analytics install can instead start with empty history. |
| Analytics private configuration | `analytics/state.json`, `analytics/umami/.env`, optional `analytics/demo-logins.txt` | Restrict access; adapt database URL/paths. Preserve website ID and event salt when retaining historical analytics continuity. |
| Google read access, only if later needed | Service-account JSON referenced by `launch-sync/worker-config.json` | Viewer-only credential or a newly issued equivalent. Keep outside Git. The credential is unnecessary just to serve the restored database. |

Paths abbreviated above are below `api/.organization-demo-runtime/`. Inspect the
private configuration for any additional storage/archive-provider credentials
needed by enabled integrations; encrypted settings need both the DB and its key.
Do not copy the entire runtime parent: it contains other profiles, old backups and
temporary logs. Do not transfer this laptop's PostgreSQL superuser password,
SSH private key, browser profile or unrelated `~/.kb-pms` development credentials.
Create destination administration credentials separately.

## Restore and configure

1. Inventory the VM's OS, software, disks, existing databases/services and ports
   read-only. Pick a new destination; back up anything already there. Secure remote
   command access is separate from AnyDesk. Keep the current laptop site running.
2. Take a fresh consistent clinical dump with an account authorized to read all
   forced-RLS tables. Exporting as the ordinary application role is insufficient.
   Coordinate a quiet backup window for document files so DB metadata and file
   contents agree. Generate SHA-256 checksums for the archive/files privately.
3. Inspect the dump inventory and source role/ACL metadata. Recreate only the
   referenced roles needed for this installation with destination credentials.
   Do not restore all global roles/passwords from this laptop. Restore into the
   new database with errors treated as failures; preserve database marker,
   function/table ownership, grants and forced RLS. If ownership/ACLs are omitted
   from the dump or restore, reconstruct and verify them explicitly before startup.
   Do not leave SECURITY DEFINER functions owned by a superuser. The app role must
   remain NOSUPERUSER and NOBYPASSRLS and must not read `launch_sync`.
4. Match the database name/comment marker and dedicated role names with the private
   state files. `server.mjs` validates those values and the existing database-name
   pattern; do not remove its guards to make a mismatched restore start. Update
   role passwords consistently in PostgreSQL, `runtime-state.json` and `app.env`.
   Restore document paths/checksums and restrict private-directory access to the
   service/operator accounts. POSIX file modes alone do not set Windows ACLs.
5. Compare all 38 `schema_migrations` names/checksums with the repository bytes.
   A fresh current dump should already contain them. Do not run `db:bootstrap`,
   `db:seed`, `rehearse --apply-copy`, `restore-test-copy`, or `provision-runtime`
   against the restored installation: those create/reset demo state or credentials.
   An actual pending migration needs a backup and the selected profile's owner;
   `npm run db:migrate` otherwise uses the unrelated default owner environment.
6. Start from `api/` with `node --import tsx scripts/launch-sync/server.mjs` and
   inspect private service logs without exposing rows or secrets. The current
   entry point binds loopback 8350 with secure cookies; put an HTTPS reverse proxy
   or approved tunnel in front of it. Use a new VM hostname for session isolation.
   A laptop Quick Tunnel URL is temporary and does not migrate with the database.
7. Keep automatic Sheets refresh stopped. Its old verification window expired on
   8 November; the last recorded one-off refresh was 12 November. Do not copy a
   stale `running` flag or extend `worker-config.json` automatically. A later import
   must preserve conflict baselines, Viewer access, held rows and app-side edits.
8. Install services/startup and recovery appropriate to the actual VM OS after
   manual startup succeeds. Configure clinical/documents and analytics backups
   separately and prove a restore before relying on them. Archive destination and
   launch-week/cutover settings remain decisions, not completed production setup.

Capture/import rollback helpers currently invoke Windows PostgreSQL `.exe` tools;
they are not Linux deployment scripts. The analytics startup helper is PowerShell.
On Linux use native clients and a service manager after reviewing the paths and
environment. Do not copy a Windows `node_modules` or Umami build onto Linux.

## Tracking must be connected explicitly

Configuration inspection on 13 November found Umami configured for the older
`realdata-review` profile but **not configured for `launch-sync/app.env`**. Running
the latest website alone therefore does not reproduce tracking collection.

Follow `LOCAL-ANALYTICS.md` for Umami 3.4.1. Choose either a new marked analytics
database or a verified restore with its matching state; do not run the fresh
provisioner/initializer indiscriminately over restored analytics history. Build
Umami on the VM and keep its dashboard on loopback 8091 or private authenticated
access. Set these in the VM clinical profile's private `app.env`:

```text
UMAMI_LOCAL_URL=http://127.0.0.1:8091
UMAMI_WEBSITE_ID=<VM analytics website ID>
UMAMI_EVENT_SALT=<private installation salt>
```

Restart the clinical service. `initialize-local-analytics.ts --connect-review`
only targets the older review profile; it does not connect `launch-sync`.
Preserve patient-free allowlisted events, pseudonymous staff/clinic keys and
disabled replay. Verify one authorized screen/action event actually persists in
Umami; a configured-status response alone is insufficient. Verify clinical reads
and saves remain usable when analytics is stopped, using fictional disposable
data only for write testing.

## Acceptance before sharing the VM URL

- Compare database/schema checksums, aggregate record counts and financial totals
  with the private fresh-backup manifest. Compare document checksums. Preserve
  unknown dates, source review flags, held expenses and CRM conflicts.
- Verify HTTPS, anonymous/signed-out rejection, staff login/logout, clinic access
  and populated clinical/register/finance reads. User/operator sign-in can remain
  manual. No real patient or source writes are needed for these checks.
- `node scripts/launch-sync/verify-site.mjs <VM HTTPS URL>` is a profile-specific
  verifier: first validate the destination and record it in private `public-url.txt`
  on the VM before sending credentials. Its expected counts/flags reflect this
  snapshot; explain any drift instead of changing data to satisfy an assertion.
  It reads application records but creates/ends login sessions.
- Verify tracking persistence, restart recovery and a separate backup/restore.
  Browser/write/print acceptance and operational cutover still need explicit
  completion. Do not switch live clinic entry from Sheets merely because restore
  and login succeed. Run DB tests only on a separate disposable test database,
  one file/run at a time; never target the restored patient database.

## Can the private files go through WhatsApp?

Yes, as **documents in an encrypted archive**, sent to the verified operator or
your own account for download on the VM. WhatsApp states personal messages/files
use end-to-end encryption and documents can be up to 2 GB per file. For this
transfer, additionally use a strong archive password with encrypted filenames
(for example 7z AES-256), and share the password by a separate channel such as a
voice call. Verify the recipient and SHA-256 checksum after download/decryption.
For a larger backup use a private file-transfer route or encrypted split volumes
below the per-file limit. A normal ZIP without encryption is insufficient here.

Do not paste database rows, passwords, keys or `.env` text into a message, send
them to a group or AI bot, or put the decryption password beside the archive.
Ordinary extracted/downloaded copies remain sensitive on both machines. Restrict
those files and agree cleanup of staging/download copies after the restore and
backup have been verified. No WhatsApp messages or files have been sent by this
handoff task; the user handles delivery.

Official references checked 13 November 2026:
[WhatsApp document messaging](https://www.whatsapp.com/messaging),
[2 GB file sharing and encryption](https://blog.whatsapp.com/reactions-2gb-file-sharing-512-groups),
[encrypted backups](https://www.whatsapp.com/privacy).
