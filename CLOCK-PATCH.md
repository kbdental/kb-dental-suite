# Apps Script — stamp times in the clinic's timezone

## Status: checked, and currently correct

Verified 20 Aug 2026 by running `checkClocks` (below):

```
Spreadsheet timezone : Asia/Calcutta
Script timezone      : Asia/Kolkata
Time the app stamps  : 13:25
Time in sheet's zone : 13:25
Correct IST time     : 13:25
```

`Asia/Calcutta` and `Asia/Kolkata` are the same zone under an old and a
current name, so there is no offset between them and the stamped times are
right. **Nothing is broken today.**

The replacement below is therefore optional hardening, not a fix: it removes
the dependency on the two settings happening to agree, so a future change to
the script project's timezone cannot silently shift every recorded time.

## The risk it removes

`fmtTime` reads the hour off the raw `Date`:

```javascript
var hh = String(d.getHours()).padStart(2, "0");
var mm = String(d.getMinutes()).padStart(2, "0");
```

In Apps Script, `getHours()` resolves in the **script project's** timezone,
which is set when the project is created and is often not the clinic's. Every
time the app stamps a clock reading through this — appointment Checked In,
In Chair and Completed on the Daysheet — it can be hours out.

The same class of bug already bit `formatDOB`, which now formats explicitly in
the spreadsheet's timezone. This does the same for times.

## Re-checking later

Paste this at the bottom of `Code.gs`, save, select `checkClocks` from the
function dropdown, press Run, open **Execution log**:

```javascript
function checkClocks() {
  var ssTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var now = new Date();
  Logger.log("Spreadsheet timezone : " + ssTz);
  Logger.log("Script timezone      : " + Session.getScriptTimeZone());
  Logger.log("Time the app stamps  : " + fmtTime(now));
  Logger.log("Time in sheet's zone : " + Utilities.formatDate(now, ssTz, "HH:mm"));
  Logger.log("Correct IST time     : " + Utilities.formatDate(now, "Asia/Kolkata", "HH:mm"));
}
```

Writes nothing to the sheet. Worth re-running if the clinic ever moves the
script or sheet between Google accounts, since a new project picks up the
creating account's timezone.

## Replace `fmtTime` with this

Ctrl+F for `function fmtTime(val)`, select down to its closing `}`, and paste:

```javascript
// Wall-clock "HH:MM" in the SPREADSHEET's timezone. getHours() would resolve
// in the script project's timezone instead — set when the project was created,
// not necessarily the clinic's — which silently shifts every stamped time by
// the offset between them.
function fmtTime(val) {
  if (!val) return "";
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      return Utilities.formatDate(d, tz, "HH:mm");
    }
    return String(val);      // already plain text like "10:30"
  } catch (e) { return String(val); }
}
```

Then **Ctrl+S**, and **Deploy → Manage deployments → pencil → New version →
Deploy**.

## What this affects

- **Appointment status stamps** — Checked In, In Chair, Completed on the
  Daysheet. These are written server-side and were the ones at risk.
- **Reading times back** — appointment times and blocked slots that Sheets
  stored as time-of-day cells. Same wall-clock value, now read consistently.

Daily Register walk-in and consultation times are **not** affected: those are
now taken from the front desk computer's own clock, in the browser, so they
match what staff see on the wall regardless of any server setting.
