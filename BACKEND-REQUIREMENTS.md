# Backend (Apps Script) changes needed for Quick Registration

The front end for quick registration + the patient completion form is built and
tested (`index.html` → Registration tab, and `register.html`). Both talk to the
existing `/exec` endpoint. Three things must be true on the Apps Script side
before the flow works end to end in the clinic.

## 1. `saveRegistration` must UPSERT on UHID (required)

This is the one that matters. Today the action is only ever called once per
patient, so it almost certainly appends a row.

The new flow calls it **twice for the same UHID**:

1. front desk quick registration — writes name, DOB, mobile, whatsapp,
   complaint, `regStatus=Quick`
2. patient completes the form on the iPad, possibly weeks later — writes the
   full record for the **same** UHID, `regStatus=Complete`

If it appends, the sheet ends up with two rows for one UHID and every
`getPatient` lookup becomes ambiguous.

Required behaviour: **if a row with this UHID already exists, update it in
place; otherwise append.** On update, only overwrite columns that arrived
non-empty in the request, so the second call cannot blank out something the
first one set (or that a doctor edited in between).

## 2. New optional columns

Both calls now send fields the sheet may not have. Add the columns, or ignore
the params — the front end does not read them back except `regStatus`.

| param       | suggested column      | values                                  |
|-------------|-----------------------|-----------------------------------------|
| `regStatus` | `Registration Status` | `Quick` (4 details only) / `Complete`   |
| `howKnown`  | `How Known`           | comma-separated                         |
| `consent`   | `Consent`             | `Accepted`                              |

`regStatus` is what tells the front desk which records still owe a full form.
A `getIncompleteRegistrations` action (rows where `Registration Status` is
`Quick`) would let the Registration screen list them for follow-up — not built
yet, say the word and I'll add both halves.

## 3. `register.html` is a public page — tokenless access

`register.html` runs on the patient's iPad with **no staff session token**, the
same way `chatbot.html` already does. It calls exactly two actions:

- `getPatient` with the one UHID from the link
- `saveRegistration` with that same UHID

If `REQUIRE_AUTH` is switched on, these two must be allowed without a token,
and should be scoped as narrowly as possible:

- `getPatient` (tokenless) should return **only** the fields the form needs to
  prefill — never balances, clinical notes, documents, or treatment history.
- `saveRegistration` (tokenless) should only be allowed to update an
  **existing** UHID, never to create one and never to change name or DOB.

### Note on UHID guessing

UHIDs are sequential, so anyone with the link format could try `AL0778`.
The page therefore refuses to show any patient detail until the person enters
the mobile number already on the record. That check currently runs in the
browser, which means the record still crossed the wire before it was checked.
To close that properly the backend should take the mobile as a parameter and
refuse the lookup itself:

```
getPatient(uhid, mobile)  →  match last 10 digits, else { success: false }
```

Tell me when the endpoint accepts it and I'll switch the page over — it is a
small change on this side.
