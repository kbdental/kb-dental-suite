# Apps Script — fix the UHID format

## The problem

`getNextUHID` currently builds:

```javascript
var next = "KBDC-" + new Date().getFullYear() + "-" + String(num + 1).padStart(4, "0");
```

which produces `KBDC-2026-0043`. The clinic's actual format is different:

```
AL 07 77
│  │  └── 77th new patient of that month, restarting at 01 each month
│  └───── month (07 = July)
└──────── year code: AA = 2015, one letter per year, so AL = 2026
```

It also numbers from the sheet's **row count**, so deleting any row hands the
next patient a UHID that already belongs to someone else.

## Replace the whole `getNextUHID` function with this

Ctrl+F for `function getNextUHID()`, select from that line down to its closing
`}`, and paste this in its place:

```javascript
// UHID format: two-letter year code + 2-digit month + that month's running
// number. The year code started at AA for 2015 and advances one letter a year,
// so 2026 is AL — AL0777 is the 77th new patient of July 2026. The number
// restarts at 01 on the 1st of every month.
function uhidYearCode_(year) {
  var i = year - 2015;
  if (i < 0) i = 0;
  return String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function getNextUHID() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var now = new Date();
  var prefix = uhidYearCode_(Number(Utilities.formatDate(now, tz, "yyyy")))
             + Utilities.formatDate(now, tz, "MM");

  // Read the highest number already issued this month instead of counting
  // rows: a row deleted for any reason would otherwise send the counter
  // backwards and reissue a UHID that already belongs to a patient.
  var sh = getSheet("Registrations");
  var data = sh.getDataRange().getValues();
  var highest = 0;
  if (data.length > 1) {
    var uhidCol = findRegColumn_(data[0], ["UHID", "Registration ID"]);
    if (uhidCol >= 0) {
      for (var i = 1; i < data.length; i++) {
        var v = String(data[i][uhidCol] || "").trim().toUpperCase();
        if (v.indexOf(prefix) !== 0) continue;
        var n = parseInt(v.substring(prefix.length), 10);
        if (!isNaN(n) && n > highest) highest = n;
      }
    }
  }

  // Two digits normally (AL0701 … AL0799); a month busy enough to pass 99
  // simply grows to three (AL07100) rather than wrapping or colliding.
  return { success: true, uhid: prefix + String(highest + 1).padStart(2, "0") };
}
```

## Check it before trusting it

In the Apps Script editor, pick **`getNextUHID`** from the function dropdown at
the top and press **Run**, then open **Execution log**. It will print the UHID
it would issue next. Confirm it follows on from the last patient registered
this month — e.g. if your newest is `AL0812`, this should say `AL0813`.

Nothing is written to the sheet by running it, so it is safe to run as often
as you like.

## Notes

- **Year rollover is automatic.** 1 January 2027 starts issuing `AM01xx`,
  2028 `AN01xx`, and so on. It keeps working past `AZ` (2040) by moving to
  `BA` — no maintenance needed.
- **Month rollover is automatic** — the number restarts at 01 because no
  existing UHID carries the new month's prefix yet.
- **Old records are safe.** Nothing reads or rewrites existing UHIDs; this
  only decides the next one.
- The app no longer invents a UHID of its own if this call fails. It used to
  fall back to `"AL" + <four timestamp digits>`, which in 2026 looks exactly
  like a real UHID but lands in an impossible month and outside the sequence.
  It now asks staff to retry instead.
