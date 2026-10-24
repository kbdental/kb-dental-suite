// The CRM files a panel patient under their panel as a company -- that is
// what separates the CGHS and DGEHS patients from the cash patients instead
// of showing every one of them as "Individual". The queue that carries a
// newly registered patient into the CRM left the company blank, so everyone
// registered between that queue arriving and the fix landed with none.
//
// This backfills those. It writes into the live CRM tabs, so it is not
// checked by reading it -- it is RUN, against a fake Sheets API, and the
// cells it touched are inspected afterwards.
const fs = require("fs");
const path = require("path");
const GS = fs.readFileSync(path.resolve(__dirname, "../apps-script/maintenance/backfill-panel-companies.gs"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

function book(tabs) {
  const sheets = {};
  const mk = (name, grid) => {
    const g = (grid || []).map(r => r.slice());
    return sheets[name] = {
      grid: g,
      getLastRow: () => g.length,
      getLastColumn: () => g.reduce((n, r) => Math.max(n, r.length), 0),
      getDataRange: () => ({ getValues: () => g.map(r => r.slice()) }),
      appendRow: row => g.push(row.slice()),
      getRange(r, c, nR, nC) {
        return {
          getValues: () => {
            const out = [];
            for (let i = r; i < r + (nR || 1); i++) {
              const line = [];
              for (let j = c; j < c + (nC || 1); j++) line.push((g[i - 1] || [])[j - 1] || "");
              out.push(line);
            }
            return out;
          },
          setValue(v) { while (!g[r - 1]) g.push([]); while (g[r - 1].length < c) g[r - 1].push(""); g[r - 1][c - 1] = v; },
          setValues(vals) {
            vals.forEach((line, ri) => {
              const i = r - 1 + ri;
              while (!g[i]) g.push([]);
              while (g[i].length < c - 1 + line.length) g[i].push("");
              line.forEach((v, ci) => { g[i][c - 1 + ci] = v; });
            });
          }
        };
      }
    };
  };
  Object.keys(tabs || {}).forEach(n => mk(n, tabs[n]));
  return { sheets,
    ss: { getId: () => "MAIN", getSheetByName: n => sheets[n] || null, insertSheet: n => mk(n, []) } };
}

function run(bk, which, confirm) {
  const log = [];
  const fn = new Function("SpreadsheetApp", "Logger", "WHICH", "SET_CONFIRM",
    GS.replace('var CONFIRM = "";', "var CONFIRM = SET_CONFIRM;") +
    "\nif (WHICH === 'report') reportPanelCompanies(); else backfillPanelCompanies();");
  fn({ getActiveSpreadsheet: () => bk.ss, flush() {} },
     { log: (...a) => log.push(String(a[0]).replace(/%s/g, () => String(a.splice(1, 1)[0]))) },
     which, confirm || "");
  return log.join("\n");
}
const tab = (bk, n) => (bk.sheets[n] || { grid: [] }).grid;
const colOf = (bk, n, h) => tab(bk, n)[0].indexOf(h);

// The CRM writes a tab's headers as the union of its records' keys, id first.
const CHEAD = ["id", "firstName", "lastName", "phone", "uhid", "panel", "panelCategory", "cardId", "companyId"];
const base = () => book({
  "CRM Contacts": [
    CHEAD,
    // Registered before the queue: already filed.
    ["c1", "Meera", "Das", "9811000001", "KB0001", "CGHS", "Serving", "CG-1", "CO_CGHS"],
    // Registered via the queue: panel recorded, company blank. The bug.
    ["c2", "Rohit", "Khanna", "9811000002", "KB0002", "CGHS", "Serving", "CG-2", ""],
    ["c3", "Asha", "Verma", "9811000003", "KB0003", "DGEHS", "", "DG-9", ""],
    // A private patient: belongs under nothing.
    ["c4", "Vikram", "Rao", "9811000004", "KB0004", "", "", "", ""]
  ],
  "CRM Companies": [
    ["id", "name", "industry", "createdAt"],
    ["CO_CGHS", "CGHS", "Panel", "2026-01-01T00:00:00Z"]
  ]
});

// ── it only reads until told twice ───────────────────────────────────────
let bk = base();
let out = run(bk, "report");
eq("the report changes nothing", tab(bk, "CRM Contacts")[2][8], "");
ok("and counts who is on a panel but filed nowhere", /On a panel but filed nowhere:   2/.test(out), out);
ok("who is already filed", /Already filed under a company:  1/.test(out), out);
ok("and who is private", /no panel, left alone: 1/.test(out), out);
ok("it names the panel with no company yet", /DGEHS[\s\S]*no company for this panel yet/.test(out), out);
ok("and tells you to close the CRM first", /CLOSE THE CRM/.test(out), out);

bk = base();
out = run(bk, "backfill", "");
eq("running it without CONFIRM changes nothing", tab(bk, "CRM Contacts")[2][8], "");
ok("and says so rather than looking like it worked", /CONFIRM is not set/.test(out), out);

// ── the backfill ─────────────────────────────────────────────────────────
bk = base();
out = run(bk, "backfill", "YES");
const cc = colOf(bk, "CRM Contacts", "companyId");
eq("a CGHS patient goes under the CGHS company that already existed",
   tab(bk, "CRM Contacts")[2][cc], "CO_CGHS");
const dg = tab(bk, "CRM Companies").slice(1).filter(r => r[1] === "DGEHS")[0];
ok("a panel with no company yet gets one", !!dg, JSON.stringify(tab(bk, "CRM Companies")));
eq("marked as a panel, not an ordinary company", dg[2], "Panel");
eq("and the patient on it is filed there", tab(bk, "CRM Contacts")[3][cc], dg[0]);
eq("a contact already filed is left exactly as it was",
   tab(bk, "CRM Contacts")[1][cc], "CO_CGHS");
eq("a private patient is still under no company", tab(bk, "CRM Contacts")[4][cc], "");
eq("no company is invented for the private patient",
   tab(bk, "CRM Companies").length, 3);
eq("nothing else in any contact row moved",
   tab(bk, "CRM Contacts").map(r => r.slice(0, 8)),
   base().sheets["CRM Contacts"].grid.map(r => r.slice(0, 8)));
ok("it reports what it did", /Filed 2 patient\(s\) under their panel\./.test(out), out);
ok("and names the company it made", /Made 1 panel company\(ies\): DGEHS/.test(out), out);

// ── running it again ─────────────────────────────────────────────────────
out = run(bk, "backfill", "YES");
ok("a second run finds nothing left to do", /Nothing to do/.test(out), out);
eq("and makes no duplicate company", tab(bk, "CRM Companies").length, 3);

// ── the same panel spelled differently is one company ────────────────────
bk = book({
  "CRM Contacts": [CHEAD,
    ["c1", "A", "A", "", "KB1", "cghs", "", "", ""],
    ["c2", "B", "B", "", "KB2", "CGHS", "", "", ""],
    ["c3", "C", "C", "", "KB3", " Cghs ", "", "", ""]],
  "CRM Companies": [["id", "name", "industry", "createdAt"], ["CO_X", "CGHS", "Panel", ""]]
});
run(bk, "backfill", "YES");
eq("three spellings of one panel all reach the one existing company",
   tab(bk, "CRM Contacts").slice(1).map(r => r[8]), ["CO_X", "CO_X", "CO_X"]);
eq("and no new company is made", tab(bk, "CRM Companies").length, 2);

bk = book({
  "CRM Contacts": [CHEAD, ["c1", "A", "A", "", "KB1", "ECHS", "", "", ""],
                          ["c2", "B", "B", "", "KB2", "echs", "", "", ""]],
  "CRM Companies": [["id", "name", "industry", "createdAt"]]
});
run(bk, "backfill", "YES");
eq("a brand-new panel spelled two ways still makes only one company",
   tab(bk, "CRM Companies").length, 2);
const ids = tab(bk, "CRM Contacts").slice(1).map(r => r[8]);
eq("and both patients go under it", ids[0], ids[1]);
ok("under an id shaped like the CRM's own", /^c[a-z0-9]+$/.test(String(ids[0])), ids[0]);

// ── a contacts tab that never had the column ─────────────────────────────
bk = book({
  "CRM Contacts": [["id", "firstName", "uhid", "panel"], ["c1", "A", "KB1", "CGHS"]],
  "CRM Companies": [["id", "name", "industry", "createdAt"], ["CO_1", "CGHS", "Panel", ""]]
});
out = run(bk, "backfill", "YES");
eq("a companyId column is added when there is none", tab(bk, "CRM Contacts")[0][4], "companyId");
eq("and the patient is filed in it", tab(bk, "CRM Contacts")[1][4], "CO_1");
ok("and it says it added one", /Added a companyId column/.test(out), out);

// ── a companies tab that does not exist yet ──────────────────────────────
bk = book({ "CRM Contacts": [CHEAD, ["c1", "A", "A", "", "KB1", "CGHS", "", "", ""]] });
run(bk, "backfill", "YES");
eq("a CRM Companies tab is made if the CRM has not made one",
   tab(bk, "CRM Companies")[0], ["id", "name", "industry", "createdAt"]);
eq("and the panel is in it", tab(bk, "CRM Companies")[1][1], "CGHS");

// ── nothing to work with ─────────────────────────────────────────────────
ok("a book with no CRM says so instead of failing",
   /No CRM Contacts tab/.test(run(book({}), "report")));
ok("an empty contacts tab says it is empty",
   /no contacts in the CRM yet/.test(run(book({ "CRM Contacts": [CHEAD] }), "report")));
ok("a CRM no panel patient has ever reached says so plainly",
   /No panel column/.test(run(book({ "CRM Contacts": [["id", "firstName"], ["c1", "A"]] }), "report")));

// ── the order it writes in ───────────────────────────────────────────────
// Companies before contacts: a run that stops in between leaves contacts
// unfiled, which running it again finishes. The other order would leave
// contacts pointing at a company that does not exist.
ok("companies are written before the contacts that point at them",
   GS.indexOf("var made = 0;") < GS.indexOf('p.contacts.headers.indexOf("companyId")'));
ok("it refuses to run until it is confirmed", /CONFIRM\).trim\(\).toUpperCase\(\) !== "YES"/.test(GS));
ok("it is for the main book, where the CRM lives", /MAIN PMS book/.test(GS));
ok("and it warns that the CRM overwrites these tabs wholesale",
   /saves a list by writing[\s\S]*whole copy back/.test(GS));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
