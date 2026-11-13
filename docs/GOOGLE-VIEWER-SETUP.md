# Google Viewer access for the VM importer

13 November 2026. The user chose a fresh Google-to-VM import and a new Umami
installation without analytics history. No laptop database dump or old runtime
secrets are required for that route. Follow [FRESH-VM-IMPORT.md](FRESH-VM-IMPORT.md)
for the implemented new-database installer and capture/import commands.

## Option A: create a dedicated VM service account

The operator performs Google account sign-in and key creation in Google Cloud.
No Google password needs to be stored in the application or given to Claude.

1. Open the intended Google Cloud project. In **APIs & Services → Library**,
   enable **Google Sheets API** and **Google Drive API**. Apps Script API is not
   used by this importer.
2. Open **IAM & Admin → Service Accounts → Create service account**. Give the VM
   its own account, for example `kb-dental-vm-reader`. It does not need a
   project-wide Owner, Editor or Viewer role just to read explicitly shared
   spreadsheets. Cloud project IAM and spreadsheet sharing are different grants.
3. Copy the service account email, ending in `iam.gserviceaccount.com`.
4. As an owner or authorized sharing manager of the source files, share each of
   these five spreadsheets with that email using the **Viewer** file role:
   main PMS, Clinical Records, Finance, empanelled PMS, and historical
   registration. These are the same five sources already used by the importer.
   Share the specific files rather than making them public or granting access
   to an entire patient-document folder. Verify the intended Clinical Records
   workbook is the only shared workbook matching that discovery name.
5. In the service account's **Keys** tab, choose **Add key → Create new key →
   JSON**, then download the JSON directly on the VM if convenient. Creating a
   key requires the operator's Google Cloud permission. Keep the downloaded
   JSON private: it contains a private key. The service account email alone
   cannot authenticate the importer.
6. Store it outside Git, for example `C:/KB-Dental/secrets/google-viewer.json`
   on Windows or `/etc/kb-dental/google-viewer.json` on Linux. Limit file access
   to the service/operator accounts using the actual VM's ACLs/permissions.
   Do not paste the JSON, key or access token into a prompt, issue, log or chat.
7. After cloning `kbdental/kb-dental-suite` branch `saas/multi-clinic` and running
   `npm ci` in `api/`, run the preview below with the actual local key path.

Official instructions:
[Google service-account credentials and direct file sharing](https://developers.google.com/workspace/guides/create-credentials),
[JSON key creation](https://docs.cloud.google.com/iam/docs/keys-create-delete),
[Google Drive Viewer sharing](https://support.google.com/drive/answer/2494822),
[Sheets read-only scopes](https://developers.google.com/workspace/sheets/api/scopes).

## Option B: use the already authorized service account

A new JSON key for the existing service account inherits that account's existing
file access; it does not require sharing the five files with another email.
Creating a separate VM service account makes its access independently manageable.

Alternatively, the operator can reuse the current JSON credential. On the source
laptop, its actual private path is the `credentialFile` value in
`api/.organization-demo-runtime/launch-sync/worker-config.json`. Locate that file
privately rather than printing its contents or copying the runtime folder.

For WhatsApp transfer, put only the intended JSON file in a password-encrypted
archive with encrypted filenames, send it as a **document** to the verified
operator or your own account, and give the archive password separately, such as
by voice call. Download/decrypt on the VM, restrict access and verify the file's
SHA-256 checksum. Do not send the raw key text or its archive password in the
same conversation. No WhatsApp delivery is performed by these instructions.

## Verify access without a database import

From `api/`, on the VM, substitute the real local path:

```powershell
node scripts/launch-sync/rehearse.mjs --credentials 'C:/KB-Dental/secrets/google-viewer.json'
```

This default mode captures the five workbooks read-only, prints aggregate counts
and writes a private `source-preview-summary.json`. It does **not** create a
database, import application records, enable scheduling or write to Google.
It needs network access and installed npm dependencies. On Linux use the Linux
key path in the same command. Review only aggregate/error codes in shared logs.

The importer requests `spreadsheets.readonly` and `drive.metadata.readonly`.
The latter supports file discovery/version checks, not document-content download.
Both the code's scopes and the actual source-file Viewer grants matter. A JSON
key is not intrinsically read-only if its account is granted broader access.

Do not add `--apply-copy` to try to complete a fresh install: that flag currently
expects the laptop-style `kb_realdata_review` database and private source state.
Use `fresh.mjs` to initialize the new VM database, then capture with `--reuse-copy`,
preview/apply the import, verify counts/totals and configure the VM's own schedule.
An expired laptop `worker-config.json` is not a VM schedule.

## What still cannot be recovered from Sheets automatically

The current importer reads spreadsheet data. It does not download attachment
contents from Drive. Local-only app edits, uploaded files, access grants, password
changes and prior import-conflict baselines are not recreated just by reading
the source workbooks. Retrieve needed source documents separately from their
authorized location, or transfer selected local-only files later if wanted.
Keep the laptop copy intact while the VM import and coverage are accepted.
