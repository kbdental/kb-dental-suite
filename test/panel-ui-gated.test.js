// The panel screens exist in full, but nothing behind them can save yet: there
// is no panel book and no panel fee schedule. A front desk that can pick
// "Panel" and then go nowhere is worse than one that never offers it, so the
// screens stay dark until the saving half is real. This pins that gate, and
// pins it to the registration form rather than to a comment, so flipping it on
// by accident shows up here rather than at the counter.
var fs = require("fs");
var src = fs.readFileSync(__dirname + "/../index.html", "utf8");
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name); }
}

ok("the gate exists", /PANEL_UI_READY\s*=\s*(true|false)/.test(src));
ok("and it is on", /PANEL_UI_READY\s*=\s*true/.test(src));
ok("registration still starts from the flag, not a hardcoded type",
   /useState\(PANEL_UI_READY \? "" : "normal"\)/.test(src));
ok("the type screen is reachable",
   src.indexOf('if (step === 0 && !patientType)') !== -1);
ok("and the panel fields with it",
   src.indexOf('qField("Panel *", "panel"') !== -1 &&
   src.indexOf('qField("Card ID *", "cardId"') !== -1);

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
