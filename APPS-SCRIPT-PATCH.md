# Apps Script patch — paste into Code.gs

Three changes. Everything else in `Code.gs` stays as it is.

`saveRegistration` already upserts on UHID, so the duplicate-row problem I
flagged earlier does not exist — that part needs nothing.

---

## 1. Two new patient-facing actions

`register.html` runs on the iPad with no staff token. It must not use
`getPatient` (returns the whole record) or `saveRegistration` (can create a
patient and rewrite name/DOB). These two actions do only what the patient form
needs, and enforce the mobile-number check server-side.

Paste this block anywhere below `findRegColumn_` (e.g. just after
`saveRegistration`):

```javascript
// ── Patient-facing registration completion (register.html) ──────────
// Public and tokenless, so deliberately narrow: both actions require the
// patient's own mobile number to match the row, return only the fields the
// form needs, and can never create a patient or change UHID, name or DOB.

function regRow_(uhid) {
  var sh = getSheet("Registrations");
  var data = sh.getDataRange().getValues();
  if (data.length <= 1) return null;
  var headers = data[0];
  var uhidCol = findRegColumn_(headers, ["UHID", "Registration ID"]);
  if (uhidCol < 0) return null;
  var want = String(uhid || "").trim().toUpperCase();
  if (!want) return null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][uhidCol]).trim().toUpperCase() === want) {
      return { sheet: sh, headers: headers, values: data[i], rowNum: i + 1 };
    }
  }
  return null;
}

function regGet_(row, candidates) {
  var col = findRegColumn_(row.headers, candidates);
  return col >= 0 ? String(row.values[col] || "").trim() : "";
}

// UHIDs are sequential and guessable, so the record is gated on something only
// the patient knows. WhatsApp counts too — plenty of patients give one number
// at the desk and quote the other.
function mobileMatches_(row, mobile) {
  var entered = String(mobile || "").replace(/\D/g, "").slice(-10);
  if (entered.length !== 10) return false;
  var onFile = regGet_(row, ["Mobile No.", "Mobile"]).replace(/\D/g, "").slice(-10);
  var wa     = regGet_(row, ["WhatsApp No.", "WhatsApp"]).replace(/\D/g, "").slice(-10);
  return (!!onFile && entered === onFile) || (!!wa && entered === wa);
}

function patientLookup(p) {
  var row = regRow_(p.uhid);
  // Identical answer whether the UHID is wrong or the mobile is wrong, so this
  // cannot be used to find out which UHIDs exist.
  if (!row || !mobileMatches_(row, p.mobile)) {
    return { success: false, error: "We could not match those details." };
  }
  return { success: true, patient: {
    uhid:              regGet_(row, ["UHID", "Registration ID"]),
    name:              regGet_(row, ["Full Name", "Name"]),
    dob:               formatDOB(regGet_(row, ["Date of Birth", "DOB"])),
    mobile:            regGet_(row, ["Mobile No.", "Mobile"]),
    gender:            regGet_(row, ["Gender"]),
    bloodGroup:        regGet_(row, ["Blood Group"]),
    occupation:        regGet_(row, ["Occupation"]),
    maritalStatus:     regGet_(row, ["Marital Status"]),
    address:           regGet_(row, ["Complete Address", "Address"]),
    whatsapp:          regGet_(row, ["WhatsApp No.", "WhatsApp"]),
    email:             regGet_(row, ["Email"]),
    referredBy:        regGet_(row, ["Referred By"]),
    emergencyName:     regGet_(row, ["In Case Of Emergency Contact Person", "Emergency Name"]),
    emergencyRelation: regGet_(row, ["Relation with Person", "Emergency Relation"]),
    emergencyContact:  regGet_(row, ["In Case Of Emergency Contact Number", "Emergency Contact"]),
    conditions:        regGet_(row, ["Have you ever suffered/suffering from any of the following?", "Conditions"]),
    medicines:         regGet_(row, ["Medicines you are taking currently:", "Medicines"]),
    allergies:         regGet_(row, ["Are you allergic to any of the following?", "Allergies"]),
    complaint:         regGet_(row, ["What is your chief complaint?", "Complaint"])
  }};
}

function patientCompleteRegistration(p) {
  var row = regRow_(p.uhid);
  if (!row || !mobileMatches_(row, p.mobile)) {
    return { success: false, error: "We could not match those details." };
  }

  // UHID, name and DOB are never taken from the patient's submission — they
  // stay whatever the front desk entered.
  var habitsStr = String(p.habits || "");
  var fieldToValue = {
    "Gender": p.gender,
    "Blood Group": p.bloodGroup,
    "Occupation": p.occupation,
    "Marital Status": p.maritalStatus,
    "Complete Address|Address": p.address,
    "WhatsApp No.|WhatsApp": p.whatsapp,
    "Email": p.email,
    "In Case Of Emergency Contact Person|Emergency Name": p.emergencyName,
    "In Case Of Emergency Contact Number|Emergency Contact": p.emergencyContact,
    "Relation with Person|Emergency Relation": p.emergencyRelation,
    "Have you ever suffered/suffering from any of the following?|Conditions": p.conditions,
    "Medicines you are taking currently:|Medicines": p.medicines,
    "Are you allergic to any of the following?|Allergies": p.allergies,
    "How did you know about this clinic?": p.howKnown,
    "What is your chief complaint?|Complaint": p.complaint,
    "Are you in Pain?": p.painLevel ? "Yes" : "",
    "What is your level of pain on a scale of 0-10?|Pain Level": p.painLevel,
    "Habits [Do you Smoke Beedi/Cigarette?]": habitsStr.indexOf("Smoking") >= 0 ? "Yes" : "",
    "Habits [Do you Chew Pan Masala]":        habitsStr.indexOf("Pan Masala") >= 0 ? "Yes" : "",
    "Habits [Do you Consume Tobacco]":        habitsStr.indexOf("Tobacco") >= 0 ? "Yes" : "",
    "Habits [Do you Consume Alcohol]":        habitsStr.indexOf("Alcohol") >= 0 ? "Yes" : "",
    "Registration Status": "Complete",
    "Consent": p.consent || ""
  };

  var values = row.values.slice();
  Object.keys(fieldToValue).forEach(function(key) {
    var val = fieldToValue[key];
    // Only write what the patient actually filled in, so a blank field can
    // never wipe something the front desk or a doctor already recorded.
    if (val === undefined || val === null || String(val).trim() === "") return;
    var col = findRegColumn_(row.headers, key.split("|"));
    if (col >= 0) values[col] = val;
  });

  row.sheet.getRange(row.rowNum, 1, 1, row.headers.length).setValues([values]);
  return { success: true, uhid: regGet_(row, ["UHID", "Registration ID"]) };
}
```

Then register them. In `PUBLIC_ACTIONS`, add the two names:

```javascript
var PUBLIC_ACTIONS = [
  "staffLogin", "staffLogout", "authStatus", "ping",
  // Patient-facing (chatbot.html) — these users have no login by design.
  "chatbotReply", "saveChatbotAppointment", "findAppointmentsByPhone",
  // Patient-facing (register.html) — mobile-number gated, see above.
  "patientLookup", "patientCompleteRegistration"
];
```

And in the `switch (p.action)` block, under `// ── Registration ──`:

```javascript
      case "patientLookup":               return patientLookup(p);
      case "patientCompleteRegistration": return patientCompleteRegistration(p);
```

---

## 2. Record which patients still owe a full form

In `saveRegistration`, add one line to the `fieldToValue` object — after the
`"What is your level of pain..."` line is fine:

```javascript
    "Registration Status": p.regStatus || "",
```

Then add two columns to the **Registrations** sheet, at the far right of the
header row: **`Registration Status`** and **`Consent`**.

Quick registrations write `Quick`; a completed iPad form writes `Complete`.
Without the columns nothing breaks — the values are simply dropped.

---

## 3. Optional but recommended — stop blank fields overwriting real data

In `saveRegistration`, this line writes every mapped field including the empty
ones:

```javascript
    if (col >= 0) rowValues[col] = fieldToValue[key];
```

On a NEW row that is correct. On an UPDATE it means any field the caller
didn't send gets blanked. Quick registration sends four fields, so if anyone
re-saves a completed patient from a partly-filled form, the rest of the record
is cleared.

Change it to:

```javascript
    // On an update, only overwrite what was actually sent — a caller that
    // didn't include a field shouldn't be able to erase it.
    if (col < 0) return;
    var val = fieldToValue[key];
    if (existingRow > 0 && (val === undefined || val === null || String(val).trim() === "")) return;
    rowValues[col] = val;
```

Trade-off: staff can no longer clear a field back to blank by emptying it in
the app. Say the word if you'd rather keep that and accept the risk.

---

## After pasting

**Deploy → Manage deployments → edit the active deployment → New version → Deploy.**
Editing the code alone does not change what the `/exec` URL serves.
