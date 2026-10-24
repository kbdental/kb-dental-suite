// Files the panel patients already in the CRM under their panel.
//
// Registration has asked private-or-panel for a while, and the CRM files a
// panel patient under their panel as a company -- that is what separates the
// CGHS and DGEHS patients from the cash patients instead of showing every one
// of them as "Individual". But the queue that carries a newly registered
// patient into the CRM left the company blank, so every patient registered
// between that queue arriving and the fix landed with none.
//
// This is for those. It reads what each contact already says their panel is
// -- nothing is guessed, and no patient's panel is invented -- and gives them
// the company for it, making the company if the CRM has not got one yet.
//
// Rows it will not touch:
//   - a contact already filed under a company, whatever that company is
//   - a contact with no panel on it: a private patient belongs under no
//     company, and that is what makes the split mean anything
// Only the one cell per contact is written. Nothing else in the row is
// rewritten, so a name, a number or a UHID cannot be disturbed.
//
// CLOSE THE CRM SCREEN BEFORE RUNNING THIS. The CRM saves a list by writing
// its whole copy back over the tab, so a CRM left open could overwrite what
// this does with what it had in memory before.
//
// WHERE: the MAIN PMS book's Apps Script project, as a new script file.
// HOW:   Run reportPanelCompanies first -- it only reads, and prints exactly
//        what would change. Then set CONFIRM to "YES" and run
//        backfillPanelCompanies. Set CONFIRM back to "" afterwards.

var CONFIRM = "";

function pcSheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// A tab of CRM records as {header: value} plus the row it came from.
function pcRead_(name) {
  var sh = pcSheet_(name);
  if (!sh || sh.getLastRow() < 2) return { sheet: sh, headers: [], rows: [] };
  var data = sh.getDataRange().getValues();
  var headers = data[0].map(String);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var rec = { __row: i + 1 };
    var any = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      rec[headers[c]] = data[i][c];
      if (String(data[i][c] || "").trim()) any = true;
    }
    if (any) rows.push(rec);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

function pcName_(c) {
  var n = (String(c.firstName || "").trim() + " " + String(c.lastName || "").trim()).trim();
  return n || String(c.uhid || "").trim() || "(no name)";
}

// Everything both functions have to agree on, worked out once.
function pcPlan_() {
  var contacts = pcRead_("CRM Contacts");
  if (!contacts.sheet) return { error: "No CRM Contacts tab in this book. Open the CRM once first." };
  if (!contacts.rows.length) return { error: "There are no contacts in the CRM yet." };
  if (contacts.headers.indexOf("panel") < 0) {
    return { error: "No panel column on CRM Contacts — no panel patient has ever reached the CRM, so there is nothing to file." };
  }

  var companies = pcRead_("CRM Companies");
  var byName = {};
  companies.rows.forEach(function (co) {
    var k = String(co.name || "").trim().toUpperCase();
    if (k) byName[k] = String(co.id || "").trim();
  });

  var plan = {
    contacts: contacts, companies: companies, byName: byName,
    total: contacts.rows.length,
    toFile: [],        // contacts that will get a company
    newPanels: [],     // panels the CRM has no company for yet
    alreadyFiled: 0, private: 0
  };

  var wanted = {};
  contacts.rows.forEach(function (c) {
    if (String(c.companyId || "").trim()) { plan.alreadyFiled++; return; }
    var panel = String(c.panel || "").trim();
    if (!panel) { plan.private++; return; }
    plan.toFile.push({ row: c.__row, name: pcName_(c), uhid: String(c.uhid || "").trim(), panel: panel });
    var key = panel.toUpperCase();
    if (!byName[key] && !wanted[key]) { wanted[key] = panel; plan.newPanels.push(panel); }
  });
  return plan;
}

function reportPanelCompanies() {
  var p = pcPlan_();
  if (p.error) { Logger.log(p.error); return; }

  Logger.log("Contacts in the CRM:            %s", p.total);
  Logger.log("Already filed under a company:  %s", p.alreadyFiled);
  Logger.log("Private — no panel, left alone: %s", p.private);
  Logger.log("On a panel but filed nowhere:   %s", p.toFile.length);
  Logger.log("");

  if (!p.toFile.length) {
    Logger.log("Nothing to do — every panel patient is already filed under their panel.");
    return;
  }

  var byPanel = {};
  p.toFile.forEach(function (t) {
    if (!byPanel[t.panel]) byPanel[t.panel] = [];
    byPanel[t.panel].push(t);
  });
  Object.keys(byPanel).forEach(function (panel) {
    var isNew = p.newPanels.indexOf(panel) >= 0;
    Logger.log("%s — %s patient(s)%s", panel, byPanel[panel].length,
               isNew ? "  (no company for this panel yet — one would be made)" : "");
    byPanel[panel].slice(0, 10).forEach(function (t) {
      Logger.log("    row %s  %s  %s", t.row, t.uhid || "—", t.name);
    });
    if (byPanel[panel].length > 10) Logger.log("    … and %s more", byPanel[panel].length - 10);
  });

  Logger.log("");
  Logger.log("Nothing has been changed. To file those %s patient(s): CLOSE THE CRM", p.toFile.length);
  Logger.log('SCREEN, set CONFIRM = "YES" at the top of this file, and run');
  Logger.log("backfillPanelCompanies.");
}

function backfillPanelCompanies() {
  var p = pcPlan_();
  if (p.error) { Logger.log(p.error); return; }

  if (String(CONFIRM).trim().toUpperCase() !== "YES") {
    Logger.log("Nothing was changed — CONFIRM is not set.");
    Logger.log("");
    Logger.log('Run reportPanelCompanies first, then set CONFIRM = "YES" and run again.');
    return;
  }
  if (!p.toFile.length) {
    Logger.log("Nothing to do — every panel patient is already filed under their panel.");
    return;
  }

  // The companies first, so no contact is ever pointed at one that does not
  // exist. A run that stops between the two leaves contacts unfiled, which
  // this can simply be run again to finish -- the other order would leave
  // contacts pointing at nothing.
  var made = 0;
  if (p.newPanels.length) {
    var csh = p.companies.sheet;
    var headers = p.companies.headers.slice();
    if (!csh) {
      csh = SpreadsheetApp.getActiveSpreadsheet().insertSheet("CRM Companies");
      headers = ["id", "name", "industry", "createdAt"];
      csh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else if (!headers.length) {
      headers = ["id", "name", "industry", "createdAt"];
      csh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    var now = new Date().toISOString();
    p.newPanels.forEach(function (panel) {
      // The CRM's own id shape, so these are indistinguishable from the ones
      // it makes itself.
      var id = "c" + new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 5);
      var rec = { id: id, name: panel, industry: "Panel", createdAt: now };
      csh.appendRow(headers.map(function (h) { return rec[h] === undefined ? "" : rec[h]; }));
      p.byName[panel.toUpperCase()] = id;
      made++;
    });
    SpreadsheetApp.flush();
  }

  // Then the contacts. One cell each -- the company they belong under.
  var col = p.contacts.headers.indexOf("companyId");
  if (col < 0) {
    // No contact has ever carried one, so the column is not there to write to.
    col = p.contacts.headers.length;
    p.contacts.sheet.getRange(1, col + 1).setValue("companyId");
    Logger.log("Added a companyId column to CRM Contacts.");
  }

  var filed = 0, missing = 0;
  p.toFile.forEach(function (t) {
    var id = p.byName[t.panel.toUpperCase()];
    if (!id) { missing++; return; }
    p.contacts.sheet.getRange(t.row, col + 1).setValue(id);
    filed++;
  });
  SpreadsheetApp.flush();

  Logger.log("Filed %s patient(s) under their panel.", filed);
  if (made) Logger.log("Made %s panel company(ies): %s", made, p.newPanels.join(", "));
  if (missing) Logger.log("%s could not be filed — their panel had no company and none could be made.", missing);
  Logger.log("%s were already filed and %s are private, both left alone.", p.alreadyFiled, p.private);
  Logger.log("");
  Logger.log("Then:");
  Logger.log('  - Set CONFIRM back to "" so this cannot run again by accident');
  Logger.log("  - Reopen the CRM and check Contacts: the panel patients should show");
  Logger.log("    their panel under Company instead of Individual");
}
