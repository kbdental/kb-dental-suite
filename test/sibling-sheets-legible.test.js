// Implant Surgery, Implant Prosthetic and Crown & Bridge print their work-done
// sheets through the same renderClinRec, and it carried the two faults the
// clinic reported on the RCT sheet:
//
//   * a fixed four columns padded with blanks, so one implant printed as a
//     narrow column beside three empty ones and wasted most of the page;
//   * the table set in 9.5px and then the whole sheet shrunk to 81%, printing
//     at roughly 7.7px.
//
// This checks all three blobs, because they are three separate copies of that
// code and a fix applied to two of them is a fix that will drift.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + String(detail).slice(0, 200) : "")); }
};

function blob(name) {
  const m = src.match(new RegExp("const " + name + "\\s*=\\s*((?:\"[^\"]*\"\\s*\\+?\\s*)+);"));
  if (!m) throw new Error("no blob " + name);
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(x => x.slice(1, -1)).join("");
  return Buffer.from(b64, "base64").toString("utf8");
}

const FORMS = [
  ["Implant Surgery",   "IMP_SURGERY_B64"],
  ["Implant Prosthetic","IMP_PROSTHETIC_B64"],
  ["Crown & Bridge",    "CROWN_BRIDGE_B64"],
];

FORMS.forEach(([label, name]) => {
  const h = blob(name);

  ok(label + ": the sheet is no longer shrunk to 81%", !/zoom:0\.81/.test(h));
  // 9.5px survives on the on-screen form labels, which is fine — those are
  // read at a screen, not across a desk. What must not survive is 9.5px in the
  // printed sheet's own markup.
  ok(label + ": the sheet's table is not set in 9.5px",
     !/vertical-align:top;font-size:9\.5px/.test(h));
  ok(label + ": nor its patient row",
     !/border-bottom:none;font-size:9\.5px/.test(h));
  ok(label + ": cells are at a readable size", h.indexOf("font-size:12.5px") >= 0);

  // Four columns, as the clinic's paper form has. The blank ones are ruled
  // space to write in, which is how the pad is used — removing them was my
  // misreading of "a lot of page is empty", which meant the wasted lower page
  // and the tiny type, not the columns.
  ok(label + ": four columns to a sheet, padded as the paper form is",
     /while\(g\.length<PER\) g\.push\(null\);/.test(h));
  ok(label + ": a fifth item starts another sheet rather than being dropped",
     /for\(var gi=0; gi<items\.length; gi\+=PER\)/.test(h));
  ok(label + ": an empty record still prints a blank four-column sheet",
     /groups=\[\[null,null,null,null\]\]/.test(h));

  ok(label + ": section bars span the column count",
     /colspan="'\+\(group\.length\+1\)\+'"/.test(h));
  ok(label + ": and the columns are declared to match",
     /for\(var ci=0;ci<group\.length;ci\+\+\) colTags\+='<col>';/.test(h));

  // The clinic calls this the work done sheet, so the app does too.
  ok(label + ": the tab is called Work Done Sheet", /Work Done Sheet/.test(h));
  ok(label + ": and nothing still says Clinical Record", h.indexOf("Clinical Record") === -1);

  // The blob must still be a working document, not just one that matches.
  ok(label + ": still saves to the patient record", /KB_SAVE_CLINICAL_SHEET/.test(h));
  ok(label + ": and is a plausible size", h.length > 60000, String(h.length));
});

// The RCT sheet was fixed first and must not have regressed.
const rct = blob("RCT_FORM_B64");
ok("RCT: still unshrunk", !/zoom:0\.81/.test(rct));
ok("RCT: still one column per visit", /One column per VISIT/.test(rct));
ok("RCT: four columns to a sheet", /var nCols = 4;/.test(rct));
ok("RCT: a fifth visit starts another sheet",
   /for \(var gi = 0; gi < cols\.length; gi \+= nCols\) groups\.push/.test(rct));
ok("RCT: the tab is called Work Done Sheet", /Work Done Sheet/.test(rct));
ok("RCT: and nothing still says Clinical Record", rct.indexOf("Clinical Record") === -1);

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
