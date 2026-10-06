// "Should have all the parameters."
//
// A work-done sheet that quietly omits a field is worse than one that looks
// wrong: the clinician records something, the sheet prints without it, and
// nobody notices until the record is needed. Three gaps existed —
//
//   * Implant Surgery recorded the drill kit and sequence, graft brand, size
//     and quantity, membrane, mesh and three investigation notes, and printed
//     none of them;
//   * Implant Prosthetic recorded the coping and did not print it;
//   * Restoration recorded restoType, operator and remarks, and its sheet
//     listed a key the form does not use (restorationType) instead.
//
// This compares what each form SAVES against what its sheet PRINTS, so a field
// added to a form later and not to its sheet fails here rather than silently.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + String(detail).slice(0, 300) : "")); }
};

function blob(name) {
  const m = src.match(new RegExp("const " + name + "\\s*=\\s*((?:\"[^\"]*\"\\s*\\+?\\s*)+);"));
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(x => x.slice(1, -1)).join("");
  return Buffer.from(b64, "base64").toString("utf8");
}

// Identity and header fields belong in the sheet's header, not as rows.
const HEADER = new Set(["patientName", "pName", "pId", "age", "gender", "doctor",
                        "operator_is_header", "date", "toothSite", "uhid", "token"]);

// ── the forms that carry their own sheet (CR_CFG) ──────────────────────────
[["Implant Surgery", "IMP_SURGERY_B64"],
 ["Implant Prosthetic", "IMP_PROSTHETIC_B64"],
 ["Crown & Bridge", "CROWN_BRIDGE_B64"]].forEach(([label, name]) => {
  const h = blob(name);
  const cfg = JSON.parse(h.match(/var CR_CFG = (\{[\s\S]*?\});/)[1]);
  const printed = new Set(
    (cfg.itemFields || []).map(p => p[0]).concat((cfg.topFields || []).map(p => p[0])));
  const saved = new Set((h.match(/\b([a-zA-Z][a-zA-Z0-9_]{1,24})\s*:\s*(?:gv|v|val)\(/g) || [])
    .map(x => x.split(":")[0].trim()));
  const missing = [...saved].filter(k => !printed.has(k) && !HEADER.has(k)).sort();
  ok(label + ": every saved parameter is on the sheet", missing.length === 0, missing.join(", "));
  ok(label + ": and the sheet has a decent number of them", printed.size >= 15, String(printed.size));
});

// ── the forms whose sheet the parent builds (CLINICAL_SECTIONS) ────────────
function sectionKeys(name) {
  const i = src.indexOf("\n  " + name + ": [");
  const j = src.indexOf("\n  ],", i);
  return new Set((src.slice(i, j).match(/\{k:"(\w+)"/g) || []).map(x => x.slice(4, -1)));
}
[["Restoration", "restoration", "RESTORATION_FORM_B64"],
 ["Pedo", "pedo", "PEDO_FORM_B64"]].forEach(([label, section, name]) => {
  const h = blob(name);
  const printed = sectionKeys(section);
  const saved = new Set((h.match(/\b([a-zA-Z][a-zA-Z0-9_]{1,24})\s*:\s*(?:gv|al|v)\('/g) || [])
    .map(x => x.split(":")[0].trim()));
  const missing = [...saved].filter(k => !printed.has(k) && !HEADER.has(k)).sort();
  ok(label + ": every saved parameter is on the sheet", missing.length === 0, missing.join(", "));
});

// The specific fields that were missing, named so a regression says what broke.
const imps = blob("IMP_SURGERY_B64");
["drillKit", "drillSeq", "graftBrand", "graftSize", "graftQty",
 "membraneBrand", "meshBrand", "investOther"].forEach(k =>
  ok("Implant Surgery prints " + k, imps.indexOf('"' + k + '"') >= 0));
ok("Implant Prosthetic prints the coping", blob("IMP_PROSTHETIC_B64").indexOf('"coping"') >= 0);
["restoType", "operator", "remarks"].forEach(k =>
  ok("Restoration prints " + k, sectionKeys("restoration").has(k)));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
