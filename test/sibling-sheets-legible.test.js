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

  ok(label + ": columns are no longer padded with blanks",
     h.indexOf("while(g.length<PER) g.push(null);") === -1);
  ok(label + ": a group holds only the items it has",
     /groups\.push\(items\.slice\(gi,gi\+PER\)\);/.test(h));
  ok(label + ": an empty record still prints a blank sheet",
     /if\(!groups\.length\) groups=\[\[null\]\];/.test(h));

  ok(label + ": section bars span the real column count",
     /colspan="'\+\(group\.length\+1\)\+'"/.test(h));
  ok(label + ": and the columns are declared to match",
     /for\(var ci=0;ci<group\.length;ci\+\+\) colTags\+='<col>';/.test(h));

  // The blob must still be a working document, not just one that matches.
  ok(label + ": still saves to the patient record", /KB_SAVE_CLINICAL_SHEET/.test(h));
  ok(label + ": and is a plausible size", h.length > 60000, String(h.length));
});

// The RCT sheet was fixed first and must not have regressed.
const rct = blob("RCT_FORM_B64");
ok("RCT: still unshrunk", !/zoom:0\.81/.test(rct));
ok("RCT: still one column per visit", /One column per VISIT/.test(rct));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
