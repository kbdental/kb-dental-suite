# Apps Script

`Code.gs` lives in the Apps Script project bound to the sheet, not in this
repo, so the changes it needs are applied to your copy rather than shipped
from here.

## Applying the changes

Download or copy your current `Code.gs` to a file, then:

    node apps-script/apply-patch.js path/to/Code.gs

It writes `Code.patched.gs` beside it. Diff the two before deploying — the
whole diff should be the eight edits below and nothing else.

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

5. **`fmtTime`** and 6. **`getAppointments`** — check-in/checkout times were
   reaching the browser as raw `1899-12-30T05:35:50.000Z` values instead of a
   clock time. Times are now formatted through the spreadsheet's own timezone.

7. **`FINANCE_SHEET_ID_DEFAULT`** and 8. **`saveReceipt`** — connects the
   Patient Fee Receipt form to the finance sheet, writing only to the
   **Patient Fee Receipt** tab. An earlier version of this also mirrored the
   row into `Working` using `getLastRow()+1`, which is unsafe on a tab with a
   spilled `ARRAYFORMULA` — in production it landed the write ~190 rows past
   the real data and reset the clinic's E. Receipt No. sequence to 1 (it had
   already reached 233). That mirror write is now gone; see
   `../APPS-SCRIPT-PATCH-CLINICAL-TEMPLATES.md` for the full account,
   including what still needs cleaning up on the live sheet.

## Deploying

**Ctrl+S**, then **Deploy → Manage deployments → pencil → New version →
Deploy.** Editing the code alone does not change what the `/exec` URL serves,
and "New version" is what makes rollback one click if anything looks wrong.

Deploy this **before** shipping the matching `index.html`: until it lands, a
register question left unanswered still stores as "Yes", because that fallback
is here rather than in the app.
