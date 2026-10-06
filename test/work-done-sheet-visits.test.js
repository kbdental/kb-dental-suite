// "Everywhere there is a date change it needs to be recorded before the
// treatment performed for that date."
//
// The sheet could not do that. mapRCTData built one visit per tooth, and
// mergeVisits then flattened whatever visits existed into a single column with
// the last visit's date on it — so a tooth treated across three appointments
// printed as though access opening, obturation and restoration all happened on
// the final day. Columns are now one per visit, each dated.
//
// This runs the real builders, so the HTML asserted on is the HTML that prints.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + String(detail).slice(0, 300) : "")); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

function slice(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("could not slice " + from);
  return src.slice(a, b);
}
// Marker slicing walked past the end of short functions and swallowed whatever
// followed, so a declaration is taken by matching its braces instead.
function decl(start) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error("no " + start);
  let d = 0, i = src.indexOf("{", a);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(a, j + 1); }
  }
  throw new Error("unbalanced " + start);
}
// One contiguous region: the stylesheet, the page header, the sheet builders
// and the RCT mapper, exactly as they sit in the file. Taking them whole means
// the HTML asserted on below is the HTML that actually prints.
const code =
  decl("function fmtDMY(input) {") + "\n" +
  slice("// Orientation follows the content.", "function mapImplantSurgeryData") +
  "\nreturn { buildRCTSheetHTML, mapRCTData, rctVisitRows, visitColumns, chunkTeeth };";

const api = new Function("window", "CLINIC_TZ", code)({ LOGO_B64: "x" }, "Asia/Kolkata");

const PAT = { uhid: "AL1001", name: "Test Patient" };
const ENTRIES = { entries: [{
  tooth: "36", course: 1, status: "open",
  doctor: "Dr. Viveyk", date: "2026-09-01",
  visits: [
    { date: "2026-09-01", status: "open",     raw: { access: "Completed / Vital", canals: "3 (MB, ML, D)" } },
    { date: "2026-09-18", status: "open",     raw: { obtuCS: "Complete", mcSz: "F2" } },
    { date: "2026-10-05", status: "complete", raw: { rest: "Ivoclar", crown: "Advised" } },
  ],
}] };

const teeth = api.mapRCTData(ENTRIES);
eq("three visits become three columns", teeth[0].visits.length, 3);
eq("and they stay on one tooth", teeth.length, 1);

const html = api.buildRCTSheetHTML(PAT, teeth, "");

// The heart of the request: each date on the work it belongs to.
["01/09/2026", "18/09/2026", "05/10/2026"].forEach(d =>
  ok("the sheet carries " + d, html.indexOf(d) >= 0));

// Each visit's work must sit under its own date, not be smeared across all.
// "<thead" also starts with "<th", so match a real cell: a tag followed by a
// space or a close bracket.
const cols = (html.match(/<th[ >]/g) || []).length;
ok("there is a column per visit plus the label column", cols === 4, String(cols));
ok("the first visit's canal count is printed", /3 \(MB, ML, D\)/.test(html));
ok("the second visit's master cone is printed", /F2/.test(html));
ok("the third visit's restoration is printed", /Ivoclar/.test(html));

// The fields added with the complete/carry-on rule.
ok("the sheet says which course the visit belonged to", /Course of Treatment/.test(html));
ok("and whether the treatment was closed", /Treatment Status/.test(html) && /Treatment complete/.test(html));

// Empty padding columns were why one tooth wasted most of a page.
eq("a single visit makes a single column, not four padded ones",
   api.chunkTeeth([{ toothNo: "46", visits: [{ date: "2026-10-05" }] }])[0].length, 1);
ok("a sheet with no teeth still prints a blank form",
   api.chunkTeeth([]).length === 1);

// Orientation follows the content rather than always being landscape.
const narrow = api.buildRCTSheetHTML(PAT, api.mapRCTData({ entries: [{
  tooth: "46", date: "2026-10-05", visits: [{ date: "2026-10-05", raw: {} }] }] }), "");
ok("one dated column prints portrait, filling the page", /A4 portrait/.test(narrow));
ok("three print landscape, which needs the width", /A4 landscape/.test(html));

// An old record saved before visits were kept must still print.
const legacy = api.mapRCTData({ entries: [{ tooth: "11", date: "2026-05-02", ana: "Block" }] });
const legacyHtml = api.buildRCTSheetHTML(PAT, legacy, "");
ok("a record from before the visit log still prints", /02\/05\/2026/.test(legacyHtml));
ok("with its work on it", /Block/.test(legacyHtml));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
