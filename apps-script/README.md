# Apps Script

`Code.gs` lives in the Apps Script project bound to the sheet, not in this
repo, so the changes it needs are applied to your copy rather than shipped
from here.

## Applying the three changes

Download or copy your current `Code.gs` to a file, then:

    node apps-script/apply-patch.js path/to/Code.gs

It writes `Code.patched.gs` beside it. Diff the two before deploying — the
whole diff should be the four edits below and nothing else.

Every anchor must match exactly once. If one does not, **nothing is written**
and the script says which — a silent near-miss on a live clinic backend is the
thing this exists to avoid. Re-running on an already-patched file refuses in
the same way rather than applying anything twice.

## What it changes, and why each matters

See `../APPS-SCRIPT-PATCH-CLINICAL-TEMPLATES.md` for the reasoning. In short:

1. **`savePathology`** and 2. **`saveRadiology`** — both discard the `remarks`
   the form sends. All eighteen clinical forms send their notes that way and
   sixteen save actions store it; these two do not. The Work Done template
   dropdown on those forms writes into `remarks`, and the Daily Register
   prompt reads `remarks` for its Work Done column, so without this a chosen
   template is silently dropped and the register entry comes up blank.

3. **`saveToDailyRegister`** — filled in *Initial Assessment Done: Yes* and
   *Care Plan Documented: Yes* whenever the caller omitted them, which no
   caller sent. Every row carried both without anyone having said so. Both
   become blank unless answered; the app now asks.

4. **`patientCompleteRegistration`** — repairs a corrupted alias string
   (`"...|Emergency Covar PUBLIC_ACTIONStact"`), a find-and-replace that went
   through the wrong buffer. Harmless today, since the alias before the `|`
   matches the real column and is tried first, so nothing behaves differently
   — but it should not be left in the file.

## Deploying

**Ctrl+S**, then **Deploy → Manage deployments → pencil → New version →
Deploy.** Editing the code alone does not change what the `/exec` URL serves,
and "New version" is what makes rollback one click if anything looks wrong.

Deploy this **before** shipping the matching `index.html`: until it lands, a
register question left unanswered still stores as "Yes", because that fallback
is here rather than in the app.
