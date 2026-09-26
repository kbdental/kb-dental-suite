# Empanelled instance — what to paste, and in which book

There are **two books** now, and they need different things done to them.
Do them in this order.

| | Book | What it needs |
|---|---|---|
| **1** | Empanelled copy | Patch A (isolation), then clear the patient data |
| **2** | Main K.B. Dental | Patch A (isolation) only |

`?clinic=empanelled` on the app already points at the empanelled
deployment — that part is live. Everything below is inside Apps Script.

**The books, by ID** — so a log can be read without guessing:

| Book | ID |
|---|---|
| K.B. Dental PMS (main) | `1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4` |
| K. B. Dental - Finance Sheet | `1Zdxq3Xf-e41Xak4VDcufrURLkKDAp8MvRCZadC0htUI` |
| KB Dental — PMS Empaneled | `1yg9Umwwkxao-RUwxXuycjG7CVXjRAQUmMvMHa_l6sjo` |

**Done in the empanelled book, 26 Sep 2026:**

- Patch A applied. `reportInstanceFiles` resolved both clinical records and
  finance to `1yg9Umww…`, its own ID — neither flagged as the main clinic's.
- Cleared. 7764 patient rows removed across 10 tabs; 552 rows of Masters kept.
  The dry run and the clear agreed exactly, tab for tab.

**Still to do:** Patch A in the MAIN book (nothing changes for it, but the two
projects must not drift), and the empanelled book's own Doctors, Chairs,
Payment Modes and Appointment Reasons — those tabs came across empty.

---

## Patch A — stop a copied book writing into the main clinic's files

**This is the one that must be done first, in the empanelled book, before a
single empanelled patient is entered.**

The empanelled book was made by copying the main one, so its Code.gs still
carries the main clinic's file IDs. Left as they are, every clinical record
and every receipt entered in the empanelled app would be written into
**K. B. Dental's own files** — silently, with nothing on screen to show it.
The instance guard in the app cannot stop this; by then the request is
already inside the wrong Apps Script project.

Three small edits. **Do them in BOTH books** — the main clinic's behaviour
does not change (it checks whether it is the main book, and it is), but the
two projects must stay identical or the next copy reintroduces the bug.

### A1

**Ctrl+F for `var FINANCE_SHEET_ID_DEFAULT`.** Paste these lines
**immediately above** that line:

```javascript
// A COPY OF THIS BOOK MUST NEVER FALL BACK TO THE MAIN CLINIC'S FILES.
// This project is copied to make a new instance — the empanelled book, a new
// branch — and a copy carries these hardcoded IDs with it. Left as plain
// defaults they would send that instance's clinical records and its money into
// K. B. Dental's own files, silently and with nothing on screen to show it.
// So the hardcoded IDs below are the MAIN CLINIC'S, and apply only when this is
// the main clinic's book. Any other book defaults to keeping its records in
// itself, until a Script Property says otherwise.
var MAIN_PMS_SHEET_ID = "1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4";
function defaultSheetId_(mainClinicFileId) {
  return SS_ID === MAIN_PMS_SHEET_ID ? mainClinicFileId : SS_ID;
}
```

### A2

**Ctrl+F for `return stored || FINANCE_SHEET_ID_DEFAULT;`** and change it to:

```javascript
  return stored || defaultSheetId_(FINANCE_SHEET_ID_DEFAULT);
```

### A3

**Ctrl+F for `return stored || CLINICAL_SHEET_ID_DEFAULT;`** and change it to:

```javascript
  return stored || defaultSheetId_(CLINICAL_SHEET_ID_DEFAULT);
```

### Then, in each book

1. **Ctrl+S**
2. **Deploy → Manage deployments → pencil → Version: New version → Deploy**

Saving alone does nothing. The new version has to be deployed.

### How to tell it worked

In the **empanelled** book's Apps Script editor, run `getClinicalSheetId`
from the function list and open the Execution log. It must print the
**empanelled** book's own ID — not one starting `1DtoZ3`.

---

## Then clear the empanelled book

Only after Patch A is deployed there.

The copy holds a duplicate of every existing K.B. Dental patient. Clearing
it keeps every tab, every header row and all the Masters — doctors,
treatments, medicines, implant brands — so the book is usable at once. Only
patient rows go.

1. Open the **empanelled** spreadsheet → Extensions → Apps Script
2. **+ → Script**, name it `new-instance-reset`, and paste the whole of
   `apps-script/maintenance/new-instance-reset.gs` into it. **Ctrl+S.**
3. Pick **`reportInstanceData`** in the function list → **Run** →
   **read the log.** It prints the book's name. **Confirm it says the
   empanelled copy and not K.B. Dental before going further.**
4. Set `CONFIRM = "YES"` at the top of that file. **Ctrl+S.**
5. Pick **`clearBookForNewInstance`** → **Run** → read the log.
6. Set `CONFIRM` back to `""` and **Ctrl+S**, so it cannot be re-run by
   accident.

It refuses outright to run in the live K.B. Dental book, by ID. The worst
case if you run it in the wrong place is a refusal message.

No redeploy is needed for this — it is a one-off editor script, not part of
the web app.

### Afterwards, by hand in the empanelled book

- **Master → Clinic**: whatever the letterhead should say for empanelled work
- **Script Properties**: its own `APP_PASSWORD`

---

## Not yet — the clinical-records move

`APPS-SCRIPT-PENDING.md` describes moving clinical records into their own
spreadsheet. **Leave that for now.** It is a separate change, it is unrelated
to empanelment, and Part 2 of it has to be done outside clinic hours. Doing
it in the same sitting as the above would make it much harder to tell which
change caused a problem.
