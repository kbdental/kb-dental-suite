// ═══════════════════════════════════════════════════════════════════════════
// FILL THE EMPTY MASTER LISTS — Doctors, Payment Modes, Chairs
//
// The app carries its own built-in copy of these three lists and falls back to
// it whenever the Master tab is empty. All three ARE empty, which is why the
// clinic has never had to fill them in — and why editing Payment Modes in
// Master changes some screens and not others. Two lists for one thing.
//
// Master cannot become the single source while the tabs are empty: removing
// the built-in lists then would leave the app with no doctors, no payment
// modes and no chairs, and the Daily Register unusable. So this writes the
// values the app is ALREADY using into Master, exactly as they are. Nothing
// about the app's behaviour changes today; it simply becomes true that Master
// holds the lists. The built-in copies are removed afterwards, in the code.
//
//   reportMasterSeed   READ-ONLY. What is in each of the three tabs now, and
//                      what would be written. Always run this first.
//   seedMasterLists    Writes ONLY into a list that is empty. A list with any
//                      row in it is left exactly alone — if the clinic has
//                      already typed its own doctors, those are the real ones
//                      and must not be replaced by these defaults.
//
// Run it in BOTH books: K. B. DENTAL SUITE - PMS and KB Dental — PMS Empaneled.
// It is safe in either, and safe to re-run: once a list has rows it is skipped.
// ═══════════════════════════════════════════════════════════════════════════

var CONFIRM_SEED = "";

// Exactly what index.html uses today. Changing these changes what the clinic
// gets; they are not suggestions, they are the current behaviour written down.
var SEED = {
  "Doctor Details": {
    header: ["Name", "Phone", "Email", "Role", "Updated At"],
    rows: [["Dr. Viveyk Mittel", "", "", "Doctor"],
           ["Dr. Manika Mittel", "", "", "Doctor"]],
    note: "from DEFAULT_DOCTORS"
  },
  // The app had TWO payment-mode lists that did not match: the Daily
  // Register's (Cash, UPI / GPay, Card, Net Banking, Cheque, N/A) and the
  // finance receipt's (Cash, UPI, NEFT/RTGS, Cheque, Card). The same money was
  // being recorded under two names depending on the screen. This is the single
  // list the clinic settled on, and both screens will read it.
  "Payment Modes": {
    header: ["Mode", "Updated At"],
    rows: [["Cash"], ["UPI / GPay"], ["NEFT/RTGS"], ["Cheque"], ["Card"], ["N/A"]],
    note: "the one agreed list, replacing the register's and the receipt's"
  },
  "Chairs": {
    header: ["Chair", "Updated At"],
    rows: [["Chair 1"], ["Chair 2"], ["Chair 3"], ["Chair 4"]],
    note: "from DEFAULT_CHAIRS, and the same fallback inside Code.gs"
  }
};

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function dataRows_(sh) { var n = sh ? sh.getLastRow() : 0; return n > 1 ? n - 1 : 0; }

// READ-ONLY.
function reportMasterSeed() {
  var ss = book_();
  Logger.log('Book: "%s"', ss.getName());
  Logger.log("");
  var todo = [];
  Object.keys(SEED).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var have = dataRows_(sh);
    if (!sh) {
      Logger.log("%s — tab does not exist; it would be created with %s row(s)  [%s]",
        name, SEED[name].rows.length, SEED[name].note);
      todo.push(name);
    } else if (have > 0) {
      Logger.log("%s — %s row(s) already here, LEFT ALONE", name, have);
    } else {
      Logger.log("%s — empty; would write %s row(s)  [%s]",
        name, SEED[name].rows.length, SEED[name].note);
      todo.push(name);
    }
  });
  Logger.log("");
  if (!todo.length) {
    Logger.log("Nothing to do — every list already has rows.");
    return;
  }
  Logger.log("Would fill: %s", todo.join(", "));
  Logger.log('To do it: set CONFIRM_SEED = "YES" at the top, then run seedMasterLists.');
  Logger.log("");
  Logger.log("These are the values the app already uses, so nothing it does will");
  Logger.log("change. What changes is that Master, not the code, now holds them —");
  Logger.log("and you can edit them.");
}

function seedMasterLists() {
  var ss = book_();
  if (String(CONFIRM_SEED).trim().toUpperCase() !== "YES") {
    Logger.log("Nothing was changed — CONFIRM_SEED is not set.");
    Logger.log('Book: "%s"', ss.getName());
    Logger.log('Run reportMasterSeed first, then set CONFIRM_SEED = "YES" and run again.');
    return;
  }
  var filled = 0, skipped = [];
  Object.keys(SEED).forEach(function (name) {
    var spec = SEED[name];
    var sh = ss.getSheetByName(name);
    // A list with rows is the clinic's own. Never replace it.
    if (sh && dataRows_(sh) > 0) { skipped.push(name + " (" + dataRows_(sh) + " row(s))"); return; }
    if (!sh) sh = ss.insertSheet(name);
    sh.clearContents();
    sh.appendRow(spec.header);
    var now = new Date().toISOString();
    spec.rows.forEach(function (r) {
      var row = r.slice();
      while (row.length < spec.header.length - 1) row.push("");
      row.push(now);                       // the savers' "Updated At" column
      sh.appendRow(row);
    });
    Logger.log("   filled %s — %s row(s)", name, spec.rows.length);
    filled++;
  });

  Logger.log("");
  if (skipped.length) Logger.log("Left alone, already filled: %s", skipped.join(", "));
  if (!filled) { Logger.log("Nothing needed filling."); return; }
  Logger.log('Done. %s list(s) written into "%s".', filled, ss.getName());
  Logger.log("");
  Logger.log("Check them in the app under Master, change anything that is wrong,");
  Logger.log("and tell Claude once BOTH books are done — the built-in copies in");
  Logger.log("the code come out only after that, and not before.");
  Logger.log('Set CONFIRM_SEED back to "" so this cannot run again by accident.');
}
