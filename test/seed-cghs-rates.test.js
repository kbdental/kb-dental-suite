// The clinic supplied a finished rate card, so nobody should have to retype or
// paste it. seed-cghs-rates.gs carries all 117 codes and writes them in one
// run. That makes the script itself the thing that can be wrong, so it is
// checked against the source it was generated from: every code, every rupee.
const fs = require("fs");
const path = require("path");
const GS = fs.readFileSync(path.resolve(__dirname, "../apps-script/maintenance/seed-cghs-rates.gs"), "utf8");
const PASTE = fs.readFileSync(path.resolve(__dirname, "../reference/CGHS-rates-paste.txt"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

const rates = new Function(GS.slice(GS.indexOf("var CGHS_RATES = ["),
                                    GS.indexOf("];", GS.indexOf("var CGHS_RATES = [")) + 2) +
                           "\nreturn CGHS_RATES;")();

// reference/CGHS-rates-paste.txt was generated from the same spreadsheet, so it
// is an independent transcription to compare against.
const want = PASTE.trim().split(/\n/).map(l => {
  const p = l.split("\t");
  return { code: p[0], procedure: p[1], classification: p[2], rate: Number(p[3]) };
});

eq("the script holds every row of the card", rates.length, want.length);
eq("and that is 117", rates.length, 117);

let badCode = 0, badRate = 0, badProc = 0;
want.forEach((w, i) => {
  const r = rates[i] || [];
  if (r[0] !== w.code) badCode++;
  if (Number(r[3]) !== w.rate) badRate++;
  if (r[1] !== w.procedure) badProc++;
});
eq("every code matches the source", badCode, 0);
eq("every rupee matches the source", badRate, 0);
eq("every procedure name matches the source", badProc, 0);

// Spot checks a human can verify against the sheet by eye.
const by = c => rates.find(r => r[0] === c);
eq("CN001 Consultation OPD is 350", by("CN001")[3], 350);
eq("DP002 Scaling is 1000", by("DP002")[3], 1000);
eq("DP030 RCT single-rooted is 2000", by("DP030")[3], 2000);
eq("DP111 is the top of the card at 45000", by("DP111")[3], 45000);

eq("no code appears twice", new Set(rates.map(r => r[0])).size, rates.length);
ok("every row has a code, a name and a rate",
   rates.every(r => r[0] && r[1] && typeof r[3] === "number" && r[3] > 0));

// The safety rules the script is built on.
ok("it refuses to run until it is confirmed", /CONFIRM !== "YES"/.test(GS));
ok("it keeps other panels' rows", /!== CGHS_PANEL\.toUpperCase\(\)/.test(GS));
ok("and writes in one go rather than row by row", /setValues\(out\)/.test(GS));
ok("it is for the main book, where the masters live", /MAIN PMS book/.test(GS));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
