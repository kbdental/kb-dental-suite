# Apps Script — changes to make in `Code.gs`

**Eight changes**, in five unrelated pieces of work:

| | Function | Change |
|---|---|---|
| 1 | `savePathology` | store the `remarks` it currently discards |
| 2 | `saveRadiology` | same |
| 3 | `saveToDailyRegister` | stop answering two compliance questions by itself |
| 4 | `patientCompleteRegistration` | repair a corrupted alias string |
| 5 | `fmtTime` | format in the spreadsheet's timezone, not the script's |
| 6 | `getAppointments` | format check-in / engaged / check-out times |
| 7 | `FINANCE_SHEET_ID_DEFAULT` | point at **K. B. Dental - Finance Sheet PMS** |
| 8 | `saveReceipt` | write to **Patient Fee Receipt**, mirror into **Working** |

(1) and (2) supersede `CLINICAL-FORMS-PATCH.md` — the same two lines, which
have gone from *worth fixing* to *required*; the reason is below. (3) is
unrelated to the template work and was turned up while checking it.

Everything else the template change needs, the backend already does.

---

## Required — Pathology and Radiology throw away the text the template writes

Every one of the eighteen clinical forms sends its notes under `remarks`
(Ortho Progress uses `notes`). Sixteen of the eighteen save actions map it.
**`savePathology` and `saveRadiology` do not**, so the text is dropped on
arrival — the record saves, and the words are gone with nothing said.

That was already true before this change. What makes it urgent now:

- the new **Insert Work Done Template** dropdown on those two forms writes into
  `remarks`, so a template the clinician picks is silently discarded;
- `remarks` is also what the new **Daily Register** prompt reads for its
  *Work Done* column, so the register entry comes up blank for those two forms.

Everything else about the change works without this. These two forms do not.

### 1. `savePathology`

Find:

```javascript
      "Follow-up Action": p.followupAction || ""
```

Add a comma to that line and a new line after it:

```javascript
      "Follow-up Action": p.followupAction || "",
      "Remarks": p.remarks || ""
```

### 2. `saveRadiology`

Find:

```javascript
      "Follow-up Recommendation": p.followupRecommendation || ""
```

Same shape:

```javascript
      "Follow-up Recommendation": p.followupRecommendation || "",
      "Remarks": p.remarks || ""
```

### The two sheet columns appear by themselves

`saveClinicalRecord` extends the header row with any field key it has not seen
before, so a **Remarks** column appears at the far right of the **Pathology**
and **Radiology** tabs on the next save. Older rows stay blank under it.
Nothing to add by hand.

---

## The template change needs nothing else. Specifically:

**The Daily Register hand-off** uses `saveToDailyRegister` exactly as it
already exists — `date`, `uhid`, `patientName`, `age`, `procedureDone`,
`toothNo`, `workDone`, `operatingDoctor` are all fields it already maps by
header name.

**The template dropdowns** read from `getClinicalNoteTemplates`, unchanged. The
nine newly-wired forms use categories already in your Master sheet
(Diagnostic, Periodontics, Orthodontics, Prosthodontics, Pedodontics), and the
three that take every category are filtered in the browser, not the backend.

**The failure-reporting work** only changed how the app reacts to what
`Code.gs` already returns.

---

## Required — stop the register answering two compliance questions by itself

`saveToDailyRegister` currently fills these in when the caller omits them:

```javascript
  setBy(row, ["initial assessment done","initial assessment"], p.initialAssessment || "Yes");
  setBy(row, ["care plan documented","care plan"], p.carePlanDocumented || "Yes");
```

Neither the existing **Add New Entry** form nor the new register prompt sends
them, so **every** register row has been recording *Initial Assessment Done:
Yes* and *Care Plan Documented: Yes* without anyone having said so. On a day
book that may be read as a compliance record, that is a claim the clinic did
not make.

Change both `|| "Yes"` to `|| ""`:

```javascript
  // An unanswered question stays blank. These are compliance answers, and
  // the register should not be giving them on the clinic's behalf.
  setBy(row, ["initial assessment done","initial assessment"], p.initialAssessment || "");
  setBy(row, ["care plan documented","care plan"], p.carePlanDocumented || "");
```

Rows already in the sheet keep whatever they say — this only affects new ones.

### The app now asks both questions

Both the Daily Register prompt and **Add New Entry** carry these two questions,
defaulting to *not answered*, and send whatever was chosen — including nothing.
So after this patch a register row records exactly what the person filling it
in said.

**Until this patch is deployed** the app's side works only partly: answering
*Yes* or *No* is stored correctly, but leaving a question **unanswered still
lands in the sheet as "Yes"**, because that fallback lives in `Code.gs`. That
is the whole reason this change is on the required list.

---

## Required — repair the corrupted alias string

```javascript
    "In Case Of Emergency Contact Number|Emergency Covar PUBLIC_ACTIONStact": p.emergencyContact,
```

in `patientCompleteRegistration`. The text after the `|` is a find-and-replace
that went through the wrong buffer. It is **harmless today** — the alias before
the `|` matches the real column and is tried first, so emergency contact
numbers do get written — but it should not be left sitting in the file:

```javascript
    "In Case Of Emergency Contact Number|Emergency Contact": p.emergencyContact,
```

Nothing about the behaviour changes. This is tidying, grouped into the same
deploy rather than left for later.

---

## Required — check-in times showed as `1899-12-30T05:35:50.000Z`

Sheets turns an `"HH:MM"` write into a **time-of-day** cell, which Apps Script
reads back as a `Date` on the 1899-12-30 epoch. `getAppointments` put `Time`
through `fmtTime` but returned `CheckinTime`, `EngagedTime` and `CheckoutTime`
raw, so they reached the browser as ISO strings and the Daysheet printed them
that way. Those three now go through `fmtTime` too.

`fmtTime` itself also stops using `getHours()`, which reads in the *script's*
timezone, and formats in the **spreadsheet's** instead. Both are normally IST,
but nothing enforces it, and a mismatch would shift every stamp silently.

One thing worth knowing if you ever touch this: the 1899 epoch is before India
moved to +05:30 — it ran at **+05:21:10** then. So the value must be read
through the named zone `Asia/Kolkata`, which recovers the true clock time. A
hardcoded `+05:30` looks right and is wrong by 8 minutes 50 seconds:
`05:35:50Z` is **10:57**, not 11:05.

The stored data was never wrong — only the display.

## Finance — connecting the receipt form to the real sheet

The finance sheet is **K. B. Dental - Finance Sheet PMS**
(`1zi5xjxGaVVtCMNGYiqxNrhppUv1eswPsJGdp4P-DGmM`). Nothing about the sheet is
changed; the app is pointed at it and taught its existing shape.

New receipts are written to **Patient Fee Receipt** — the clinic's own entry
tab, and the only one in the receipt chain with no formulas in it. Its
`Checked` column is left alone, since that is the clinic's reconciliation tick.

### Why the receipt is also written to `Working`

The chain is **Patient Fee Receipt → Working → Receipt No. / E-Receipt / FY
tabs**, and the app reads back from `Receipt No.`. But `Working` is *not*
formula-linked to the entry tab — its columns A:H are a static mirror kept
alongside it. A row written only to the entry tab would save correctly and then
be invisible in the app.

So both are written. The mirror deliberately stops at column H: `Working`'s
**Date** and **Time** are an `ARRAYFORMULA` spilling down from row 2, and
writing into a spilled cell breaks the entire array.

If the entry tab is written but the mirror fails, the save reports a warning
saying the receipt is recorded but will not appear yet — rather than a clean
success.

### One limit worth knowing

`Working`'s `ARRAYFORMULA` covers rows 2–1857 and the data currently ends
around row 1562, so **roughly 295 more receipts** will compute their Date and
Time before that formula needs extending. `Receipt No.` has formulas to row
2000. Neither is urgent, but they are finite — when Date/Time start coming up
blank on new rows, that range is why.

### Expenses

Left pointing at the **`Expenses`** tab, which the app created and owns
(formula-free, and where the P&L already reads from). The clinic's separate
**`Expense`** Google Form tab — different columns, currently `#REF!` — is not
read by the app. Worth deciding later whether the two should be merged; it is
not something to change silently.

## Deploy

**Ctrl+S**, then **Deploy → Manage deployments → pencil → New version → Deploy.**
Editing the code alone does not change what the `/exec` URL serves.

## After deploying, worth checking on a real patient

1. Open **Pathology**, pick a Work Done template, insert it, save — then look at
   the Pathology tab and confirm a **Remarks** column appeared with the text in
   it. That is fix 1 doing its job.
2. Confirm the Daily Register prompt that follows carries the same text in
   **Work Done**.
3. Confirm that row's **Initial Assessment Done** and **Care Plan Documented**
   are now blank rather than "Yes". That is fix 3.

Neither could be tested from where this was written: `script.google.com` is not
reachable from that environment, so everything above is read off your `Code.gs`
and the sheet's own column headers rather than from a live run.
