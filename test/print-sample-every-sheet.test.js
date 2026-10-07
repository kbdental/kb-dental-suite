// "Give a demo tab for all." A printed layout cannot be judged against an
// empty sheet, and finding a real patient whose record happens to have four
// visits on it is not a reasonable way to check a page fits.
//
// Restoration and Pedo print from the PARENT app, not from their own forms, so
// a sample button inside those forms would have shown nothing. One sample on
// the sheets screen covers all six.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + String(detail).slice(0, 240) : "")); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

function slice(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("could not slice " + from);
  return src.slice(a, b);
}
function decl(start) {
  const a = src.indexOf(start);
  let d = 0;
  for (let j = src.indexOf("{", a); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(a, j + 1); }
  }
  throw new Error("unbalanced " + start);
}

const api = new Function(
  decl("const CLINICAL_SECTIONS = {") + ";\n" +
  decl("function sampleTeethFor(tabId) {") + "\nreturn { sampleTeethFor, CLINICAL_SECTIONS };")();

const TABS = ["rct", "implant_surgery", "implant_prosthetic", "crown_bridge", "restoration", "pedo"];

TABS.forEach(tab => {
  const teeth = api.sampleTeethFor(tab);
  eq(tab + ": the sample is one tooth", teeth.length, 1);
  eq(tab + ": with four dated visits, as the form has four columns",
     teeth[0].visits.length, 4);
  ok(tab + ": every visit is dated",
     teeth[0].visits.every(v => /^\d{2}\/\d{2}\/\d{4}$/.test(v.date)),
     JSON.stringify(teeth[0].visits.map(v => v.date)));

  // The point: a parameter added to a sheet must show up in its sample without
  // anyone remembering to update a hand-written example.
  const keys = new Set();
  (api.CLINICAL_SECTIONS[tab] || []).forEach(s => s.fields.forEach(f => keys.add(f.k)));
  const filled = teeth[0].visits[0];
  const blank = [...keys].filter(k => !filled[k]);
  ok(tab + ": every parameter on the sheet is filled in the sample",
     blank.length === 0, blank.join(", "));
  ok(tab + ": and the sheet has parameters at all", keys.size > 0, String(keys.size));
});

// A field with options should read like a real record, not filler.
const rct = api.sampleTeethFor("rct")[0].visits[0];
ok("a field with options uses one of them", rct.rubberDam === "Yes" || rct.rubberDam === "No",
   String(rct.rubberDam));

// The button, and the two things that would make it dangerous.
const screen = slice("function ClinicalSheets(", "\nfunction printSheetRecord");
ok("the sheets screen has a Print Sample button", /"Print Sample"/.test(screen));
ok("it is available without a patient loaded",
   !/pat&&[^,]*"Print Sample"/.test(screen));
ok("the sample never borrows a real patient's name",
   /SAMPLE \\u2014 not a patient/.test(screen) || /SAMPLE — not a patient/.test(screen));
ok("and nothing is written anywhere",
   !/api\("save/.test(slice('onClick:()=>printSheet(sampleTeethFor(tab), true)', '"Print Sample"')));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
