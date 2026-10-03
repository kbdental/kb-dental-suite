// A rate card is not a one-off import. CGHS revises a handful of rates at a
// time, and re-pasting a whole card to change one figure invites a mistake in
// the other 116 — so the panel list is edited in place like the normal fee
// schedule beside it: add, edit, remove.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../index.html", "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
};

const a = src.indexOf("function PanelFeeEditor(");
const b = src.indexOf("\nfunction MasterPasswordChanger(");
ok("the panel fee editor is there", a > 0 && b > a);
const ed = src.slice(a, b);

ok("a rate can be added", /\+ Add a rate/.test(ed));
ok("an existing rate can be edited", /"Edit"\)/.test(ed));
ok("and removed", /"Remove"\)/.test(ed));
ok("rows can be searched, so a hundred of them stay usable",
   /Search code or procedure/.test(ed));

// Every change goes through the same save as the paste import, so one panel's
// edit can never touch another panel's rates.
ok("adding saves through savePanelRates", /save\(at >= 0 \?/.test(ed));
ok("editing saves the whole list back", /save\(rows\.map\(\(x, idx\) => idx === i/.test(ed));
ok("removing saves the list without that row", /save\(rows\.filter\(\(_, idx\) => idx !== i\)\)/.test(ed));

// Two rows with the same code would make a claim line ambiguous.
ok("adding a code that already exists replaces it rather than duplicating",
   /rows\.findIndex\(r => String\(r\.code\)\.toUpperCase\(\) === code\)/.test(ed));
ok("codes are stored uppercased, so DP030 and dp030 are one rate",
   (ed.match(/code:draft\.code\.trim\(\)\.toUpperCase\(\)/g) || []).length >= 1 &&
   /const code = draft\.code\.trim\(\)\.toUpperCase\(\)/.test(ed));

// A rate that cannot be claimed is worse than none.
ok("a row with no code or no rate cannot be saved",
   (ed.match(/disabled:!draft\.code\.trim\(\) \|\| !draft\.rate/g) || []).length === 2);
ok("the rate field takes digits only", /replace\(\/\[\^0-9\]\/g, ""\)/.test(ed));

// Deleting a rate silently would leave a claim line that cannot be billed.
ok("removing asks first", /window\.confirm/.test(ed));
ok("and names the code it is about to remove", /"Remove " \+ r\.code/.test(ed));

<<<<<<< HEAD
// The action buttons wrapped onto two lines in a 130px column, which made all
// 117 rows taller for no reason.
ok("the actions column is wide enough for both buttons", /width:170/.test(ed));
ok("and each pair is kept on one line",
   (ed.match(/whiteSpace:"nowrap"/g) || []).length === 3);

=======
>>>>>>> origin/main
console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
