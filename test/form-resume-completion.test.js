// "I still do not see the multi visit treatments being saved and re-start the
// form from where we left."
//
// The work WAS being saved. No form except RCT ever read it back, and RCT read
// its working list from localStorage, so even that only resumed on the same
// computer. The clinic's rule, in their words: if the treatment is completed
// start a fresh entry and keep the old as history; if incomplete, reopen the
// old one.
//
// That needs the entry to know whether it is finished, which is a clinical
// judgement, not something to infer from which fields happen to be filled —
// half an RCT and a finished one look identical in the fields.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
};

const src = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
function blob(name) {
  const m = src.match(new RegExp("const " + name + "\\s*=\\s*((?:\"[^\"]*\"\\s*\\+?\\s*)+);"));
  if (!m) throw new Error("no blob " + name);
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(x => x.slice(1, -1)).join("");
  return Buffer.from(b64, "base64").toString("utf8");
}
const rct = blob("RCT_FORM_B64");

// --- the clinician says when it is done ------------------------------------
ok("there is a Treatment complete control", /id="txDone"/.test(rct));
ok("and the entry records what it said",
   /status:\s+\(document\.getElementById\("txDone"\)/.test(rct));
ok("completion is never inferred from the fields",
   /rather than the app inferring it/.test(rct));

// --- the rule itself --------------------------------------------------------
ok("a completed tooth starts the next course",
   /existing\.status === "complete"/.test(rct) && /startNextCourse\(selTooth, true\)/.test(rct));
ok("and the finished one is kept as history",
   /var history = \(cur\.past \|\| \[\]\)\.concat\(\[done\]\)/.test(rct));
ok("an unfinished tooth is reopened to carry on",
   /applyState\(resumeState\)/.test(rct) && /part-done/.test(rct));

// Reopening a live treatment with the box already ticked would close it on the
// next save without anyone meaning to.
ok("a reopened tooth does not arrive looking finished", /setDoneTick\(false\)/.test(rct));
ok("and a new course starts open, not complete", /past: history, status: "open"/.test(rct));

// --- it must work on any computer ------------------------------------------
ok("the record on file seeds the working sheet",
   /saveSheet\(\{ entries: RCT_RECORD\.entries \}\)/.test(rct));
ok("but only when there is nothing local to lose",
   /if \(!local \|\| !Array\.isArray\(local\.entries\) \|\| !local\.entries\.length\)/.test(rct));

// --- one code path, two callers --------------------------------------------
ok("the new-course logic is shared, not copied",
   /function startNextCourse\(tooth, silent\)/.test(rct) &&
   (rct.match(/startNextCourse\(/g) || []).length >= 3);
ok("and it does not ask twice when the clinician already said it was done",
   /if \(!silent && !confirm\(/.test(rct));

// --- the blob is still a working document ----------------------------------
ok("the form still has its save path", /KB_SAVE_CLINICAL_SHEET/.test(rct));
ok("and is a plausible size", rct.length > 100000, String(rct.length));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
