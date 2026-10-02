# Apps Script — two edits waiting, then two scripts to run

Both books: **K. B. DENTAL SUITE - PMS** and **KB Dental — PMS Empaneled**.
Not the finance workbook — nothing here concerns it.

Master now holds Doctors, Payment Modes and Chairs (seeded 2 Oct 2026). These
edits remove the copies the backend still carries, so the sheet is the only
answer. Until they are done the app keeps working exactly as it does now.

---

## Edit 1 — stop inventing four chairs

**Ctrl+F for `if (items.length === 0) items = ["Chair 1"`.** Replace that one
line with:

```javascript
  // No built-in fallback. It used to return Chair 1-4 whenever the tab was
  // empty, which is why the clinic never had to fill the tab in — and why a
  // chair deleted in Master reappeared. The tab is the only source now, and an
  // empty one honestly reports no chairs rather than inventing four.
```

(The `return { success: true, chairs: items };` line below it stays.)

## Edit 2 — remove the second doctors list

**Ctrl+F for `case "getDoctorsList":`.** Delete **both** of these lines:

```javascript
      case "getDoctorsList":   return getDoctorsList();
      case "saveDoctorsList":  return saveDoctorsList(p);
```

**Then Ctrl+F for `function getDoctorsList() {`.** Delete that whole function
**and** the `saveDoctorsList` function directly below it — from
`function getDoctorsList() {` down to the closing `}` of `saveDoctorsList`,
ending just before the next `function`. In its place paste:

```javascript
// The "Doctors" tab and its two functions are gone. It was a SECOND doctors
// list beside the "Doctor Details" tab that Master edits, and getDoctorsList
// carried its own hardcoded pair of names on top of that — so a clinic with an
// empty tab got those two whatever Master said, and nobody could tell which
// list a screen was showing. Doctor Details is the only list now.
//
// The functions are removed rather than left unused because getSheet() creates
// a tab that is missing: leaving them in would have recreated "Doctors" the
// first time anything called one, and the tab would quietly come back after
// being deleted.
```

## Deploy

**Ctrl+S**, then **Deploy → Manage deployments → pencil → Version: New version
→ Deploy.** Saving alone does nothing.

**Do this in both books before running the script below.** While the old
functions are still deployed, deleting the "Doctors" tab only lasts until the
next call — `getSheet()` creates it again.

---

## Then: retire the "Doctors" tab

`apps-script/maintenance/retire-doctors-tab.gs`, as a new script file in each
book.

1. Run **`reportDoctorsTabs`** — read-only. Shows both lists side by side.
2. Set `CONFIRM_RETIRE = "YES"`, Ctrl+S, run **`retireDoctorsTab`**.
3. Set it back to `""`.

It moves across any name that exists **only** in "Doctors", then deletes that
tab. A doctor already in Doctor Details keeps their phone, email and role —
the names-only list never held those, so taking anything from it would be a
downgrade.

No deploy needed for this one; it is an editor script.

## How to tell it all worked

- **Master → Doctors** lists your doctors, and so does every doctor dropdown.
- Add a doctor in the ⚙ settings screen beside the signatures — it appears in
  Master too. They are the same list now.
- The spreadsheet has **no "Doctors" tab**, and it does not come back.
- **Master → Accounts → Payment Modes** shows Cash, UPI, NEFT/RTGS, Cheque,
  Card, N/A — and the Daily Register and the finance receipt both offer
  exactly those.
