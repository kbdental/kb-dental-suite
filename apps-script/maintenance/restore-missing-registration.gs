// ═══════════════════════════════════════════════════════════════════════════
// RESTORE A MISSING REGISTRATION ROW
//
// HOW TO USE
//   1. Open any Apps Script project bound to the PMS spreadsheet
//      (Extensions -> Apps Script from the sheet), or a standalone one and
//      set SPREADSHEET_ID below. Paste this whole file in. Save (Ctrl+S).
//   2. Function dropdown -> pick one -> Run -> open Execution log.
//
//   findOrphanRegistrations   READ-ONLY. Lists every UHID that appears in
//                             Appointments or Clinical Sheets but has NO row
//                             in Registrations — i.e. patients the app has
//                             treated but cannot find in Patient Search.
//   restoreAL0808             Writes back the one row for AL0808
//                             (Dr Garima Chahal). Safe to run twice: it does
//                             nothing if the row already exists.
//
// WHY THE ROW WENT MISSING
//   The old getNextUHID numbered from the sheet's ROW COUNT, so deleting any
//   row handed the next patient a UHID already in use; it also had a fallback
//   that invented "AL" + four timestamp digits when the call failed. Either
//   path can leave a patient with appointments and clinical sheets but no
//   registration. Applying UHID-FORMAT-PATCH.md stops it recurring — this
//   file only repairs what already happened.
//
// WHAT IS RESTORED
//   Only what the clinic already holds elsewhere: name, gender, age-derived
//   fields and mobile came from the 27-Aug-2026 appointment row and the Crown
//   & Bridge clinical sheet saved the same morning. Everything the patient
//   would have filled in themselves (address, DOB, medical history, consent)
//   is left blank and marked Incomplete, so front desk knows to collect it
//   rather than the record silently looking complete.
//
// This file is self-contained and shares no names with the clinic's main
// Code.gs, so it can sit alongside it without clashing.
// ═══════════════════════════════════════════════════════════════════════════

// Leave "" when this script is bound to the PMS spreadsheet itself.
var SPREADSHEET_ID = "";

// The record to put back, exactly as recovered from the appointment and the
// clinical sheet. Add more entries here if findOrphanRegistrations turns up
// others and you have their details.
var AL0808 = {
  uhid:     "AL0808",
  name:     "Dr Garima Chahal",
  gender:   "Female",
  mobile:   "9953781114",
  whatsapp: "9953781114",
  regStatus: "Incomplete"
};

function ss_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function col_(headers, candidates) {
  for (var c = 0; c < candidates.length; c++) {
    var want = String(candidates[c]).toLowerCase().replace(/[^a-z0-9]/g, "");
    for (var i = 0; i < headers.length; i++) {
      var have = String(headers[i]).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (have === want || have.indexOf(want) >= 0) return i;
    }
  }
  return -1;
}

function uhidsIn_(sheetName, headerCandidates) {
  var sh = ss_().getSheetByName(sheetName);
  var out = {};
  if (!sh) return out;
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return out;
  var c = col_(data[0], headerCandidates);
  if (c < 0) return out;
  for (var i = 1; i < data.length; i++) {
    var v = String(data[i][c] || "").trim().toUpperCase();
    if (v) out[v] = true;
  }
  return out;
}

// READ-ONLY. Every UHID that has been treated but cannot be found.
function findOrphanRegistrations() {
  var registered = uhidsIn_("Registrations", ["UHID", "Registration ID"]);
  var seen = {};
  ["Appointments", "Clinical Sheets", "Clinical Records", "Daily Register"]
    .forEach(function (name) {
      var found = uhidsIn_(name, ["UHID", "UHID No.", "Registration ID"]);
      Object.keys(found).forEach(function (u) {
        if (!seen[u]) seen[u] = [];
        seen[u].push(name);
      });
    });

  var orphans = Object.keys(seen).filter(function (u) {
    return !registered[u] && u.indexOf("TEST") !== 0;
  }).sort();

  Logger.log("Registrations holds %s UHIDs.", Object.keys(registered).length);
  if (!orphans.length) {
    Logger.log("No orphans — every treated patient has a registration row.");
    return;
  }
  Logger.log("%s treated patient(s) with NO registration row:", orphans.length);
  orphans.forEach(function (u) {
    Logger.log("   %s   (seen in: %s)", u, seen[u].join(", "));
  });
}

function restoreRegistration_(rec) {
  var sh = ss_().getSheetByName("Registrations");
  if (!sh) throw new Error('No "Registrations" tab found.');

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var uhidCol = col_(headers, ["UHID", "Registration ID"]);
  if (uhidCol < 0) throw new Error('No UHID column in Registrations.');

  // Never write a second row for a UHID that is already there.
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][uhidCol]).trim().toUpperCase() === rec.uhid.toUpperCase()) {
      Logger.log("%s is already in Registrations at row %s — nothing written.",
                 rec.uhid, i + 1);
      return;
    }
  }

  var fieldToValue = {
    "UHID|Registration ID": rec.uhid,
    "Full Name|Name": rec.name,
    "Gender": rec.gender,
    "Mobile No.|Mobile": rec.mobile,
    "WhatsApp No.|WhatsApp": rec.whatsapp,
    "Registration Status": rec.regStatus
  };

  var values = headers.map(function () { return ""; });
  Object.keys(fieldToValue).forEach(function (key) {
    var c = col_(headers, key.split("|"));
    if (c >= 0) values[c] = fieldToValue[key];
  });

  sh.appendRow(values);
  Logger.log("Restored %s (%s) to Registrations at row %s.",
             rec.uhid, rec.name, sh.getLastRow());
  Logger.log("Marked Registration Status = %s — address, DOB, medical history " +
             "and consent still need collecting at the front desk.", rec.regStatus);
}

function restoreAL0808() {
  restoreRegistration_(AL0808);
}
