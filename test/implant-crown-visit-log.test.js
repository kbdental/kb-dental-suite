// Implant Surgery, Implant Prosthetic and Crown & Bridge kept ONE row per
// implant site or crown unit. A second appointment on the same site merged
// into that row, field by field, "latest non-blank wins" — so surgery, suture
// removal and review all ended up reading as one day's work, under whichever
// date the merge happened to keep.
//
// RCT solved this with a visit log. These three save through one place —
// mergeClinicalSheet — so the log belongs there rather than in three forms.
//
// The record already had a top-level `visits` array, but it records only WHICH
// fields changed on a date — names, not values — so it can tell you something
// happened and not what. The log added here sits on each site and carries the
// values, which is what a printed column needs. Both are kept.
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

function decl(start) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error("no " + start);
  let d = 0;
  for (let j = src.indexOf("{", a); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(a, j + 1); }
  }
  throw new Error("unbalanced " + start);
}

// The record the fake backend holds, so a second save sees the first.
let stored = null;
const api = (action, p) =>
  Promise.resolve(action === "getClinicalSheets"
    ? { success: true, allTeeth: stored }
    : { success: true });

const env = {
  api,
  fmtDMY: () => "07/10/2026",
  csBlank: v => !v || String(v).trim() === "" || String(v).trim() === "—",
};
const code =
  decl("const CS_VISIT_SKIP = ") + ";\n" +
  decl("const CS_ITEMS_KEY = {") + ";\n" +
  decl("const CS_ITEM_ID_FIELD = {") + ";\n" +
  decl("function csMergeFields(oldObj, newObj) {") + "\n" +
  decl("function csChangedFields(oldObj, newObj) {") + "\n" +
  decl("function csAppendVisit(prevVisits, entry) {") + "\n" +
  decl("async function mergeClinicalSheet(d) {") +
  "\nreturn mergeClinicalSheet;";
const mergeClinicalSheet = new Function(...Object.keys(env), code)(...Object.values(env));

(async () => {
  // Three appointments on implant site 46.
  const save = async fields => {
    stored = await mergeClinicalSheet({
      uhid: "AL1001", sheetType: "Implant Surgery",
      allTeeth: { ...fields.top, implants: [fields.item] },
    });
    return stored;
  };

  await save({ top: { anaType: "Block" },
               item: { site: "46", date: "01/09/2026", torque: "35 Ncm" } });
  await save({ top: { invest: "OPG" },
               item: { site: "46", date: "18/09/2026", coverType: "Healing abutment" } });
  const rec = await save({ top: {},
               item: { site: "46", date: "05/10/2026", provType: "Temporary crown" } });

  eq("the site is still one row", rec.implants.length, 1);
  eq("with three visits logged against it", rec.implants[0].visits.length, 3);
  eq("in the order they were done",
     rec.implants[0].visits.map(v => v.date),
     ["01/09/2026", "18/09/2026", "05/10/2026"]);

  // The point: each visit keeps what was recorded on it.
  const v = rec.implants[0].visits;
  eq("the first visit keeps its torque", v[0].torque, "35 Ncm");
  eq("the second keeps its cover", v[1].coverType, "Healing abutment");
  eq("the third keeps its provisional", v[2].provType, "Temporary crown");
  ok("and the first visit does not acquire the third's work", !v[0].provType, v[0].provType);

  // Top-level answers belong to the visit, not to the site — the merge
  // flattens them to "latest wins", so the log has to carry them.
  eq("the anaesthesia is logged on the visit it was given", v[0].anaType, "Block");
  eq("and the investigation on its own visit", v[1].invest, "OPG");

  // A typo fixed ten minutes later is not an appointment.
  await save({ top: {}, item: { site: "46", date: "05/10/2026", provType: "Temporary bridge" } });
  eq("a second save on the same date corrects that visit", stored.implants[0].visits.length, 3);
  eq("and it is the correction that is kept",
     stored.implants[0].visits[2].provType, "Temporary bridge");

  // A different site is its own row with its own log.
  await save({ top: {}, item: { site: "36", date: "05/10/2026", torque: "40 Ncm" } });
  eq("a second site is a second row", stored.implants.length, 2);
  eq("with a log of its own", stored.implants[1].visits.length, 1);
  eq("and site 46 is untouched", stored.implants[0].visits.length, 3);

  // The date the site was started on is still the row's date.
  eq("the row keeps the date treatment began", stored.implants[0].date, "01/09/2026");

  // Every form must print those visits as columns.
  [["Implant Surgery", "IMP_SURGERY_B64"],
   ["Implant Prosthetic", "IMP_PROSTHETIC_B64"],
   ["Crown & Bridge", "CROWN_BRIDGE_B64"]].forEach(([label, name]) => {
    const m = src.match(new RegExp("const " + name + "\\s*=\\s*((?:\"[^\"]*\"\\s*\\+?\\s*)+);"));
    const h = Buffer.from((m[1].match(/"([^"]*)"/g) || []).map(x => x.slice(1, -1)).join(""), "base64").toString("utf8");
    ok(label + ": prints one column per visit", /One column per VISIT/.test(h));
    ok(label + ": an older record without a log still prints",
       /var log=\(it\.visits&&it\.visits\.length\)\?it\.visits:\[it\];/.test(h));
    ok(label + ": and every column is dated", /DATE<\/b>'|dr\('DATE'/.test(h));
  });

  console.log("==============================================================================");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("==============================================================================");
  process.exit(fail ? 1 : 0);
})();
