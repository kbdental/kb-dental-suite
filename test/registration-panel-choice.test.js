// Registration now asks ONE thing first: normal patient, or panel patient.
// It decides which book the registration is written to and which form
// follows, so it has to come before anything is typed — asking later would
// mean re-routing a record that had already been saved to the wrong book.
//
// The panel registration form itself is not built yet. Until it is, choosing
// a panel must STOP rather than fall through to the normal form, because that
// form saves to the main book.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const GS = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// --- the choice comes before anything is typed ----------------------------
ok('registration asks normal or panel first',
  /step === 0 && !patientType/.test(html));
ok('with both choices on screen',
  /"Normal Patient"/.test(html) && /"Panel Patient"/.test(html));
// The screens are guarded in this order, and order is the whole point: the
// type screen must be reachable before the panel screen, and the panel screen
// before the form.
const iType = html.indexOf('step === 0 && !patientType');
const iPanel = html.indexOf('step === 0 && patientType === "panel" && !panel');
const iStop = html.indexOf('step === 0 && patientType === "panel" && panel');
const iForm = html.indexOf('if (step === 0) return /*#__PURE__*/React.createElement');
ok('the type screen is checked first', iType > 0 && iType < iPanel, [iType, iPanel]);
ok('then which panel', iPanel > 0 && iPanel < iStop, [iPanel, iStop]);
ok('and the normal form is last', iStop > 0 && iStop < iForm, [iStop, iForm]);

// --- a panel patient must never reach the normal form ---------------------
// This is the one that matters. The normal form writes to the main book.
const stop = html.slice(iStop, iForm);
ok('choosing a panel stops rather than continuing',
  /registration form is not ready yet/.test(stop), stop.slice(0, 120));
ok('and says plainly that nothing was saved',
  /Nothing has been saved/.test(stop));
ok('it offers a way back to the panel list', /Choose a different panel/.test(stop));
ok('and an honest way to see the patient today', /Register as Normal instead/.test(stop));
// No save of any kind may happen on that screen.
eq('no registration is saved from the panel screen',
  /api\("saveRegistration"|quickRegister\(\)/.test(stop), false);

// --- the panel list is the clinic's own, not the developer's --------------
ok('the panel list is loaded from the backend',
  /api\("getPanelsList"\)/.test(html));
ok('there is a built-in fallback for an older backend',
  /const DEFAULT_PANELS = /.test(html));
const fallback = /const DEFAULT_PANELS = \[([^\]]+)\]/.exec(html)[1];
['CGHS', 'DGHS', 'BSES', 'DJB', 'MCD', 'Delhi Police'].forEach(p =>
  ok('the fallback includes ' + p, fallback.indexOf('"' + p + '"') >= 0, fallback));
ok('the fallback is only used when the backend gives nothing',
  /if \(res && res\.success && \(res\.panels \|\| \[\]\)\.length\) setPanels\(res\.panels\)/.test(html));

// --- and the clinic can edit it, without a developer ----------------------
ok('Master has a Panels tab', /\{ id:"panels",\s*label:"Panels" \}/.test(html));
ok('it uses the same list editor as the other lists',
  /panels: \(\) => React\.createElement\(SimpleListEditor/.test(html));
ok('adding a panel saves it', /api\("savePanelsList"/.test(html));
ok('the panels load with the other Master lists in one request',
  /"getImplantBrandsList", "getPanelsList"/.test(html));

// --- the backend end ------------------------------------------------------
ok('Code.gs serves the panel list', /case "getPanelsList":\s*return getPanelsList\(\);/.test(GS));
ok('and saves it', /case "savePanelsList":\s*return savePanelsList\(p\);/.test(GS));
ok('from a tab the clinic can see', /getSheet\("Panels"\)/.test(GS));
// A blank row typed by accident must not become a panel called "".
ok('blank entries are not stored',
  /arr\.forEach\(function \(m\) \{ if \(String\(m \|\| ""\)\.trim\(\)\)/.test(GS));

let pass = 0, fail = 0;
console.log('\n' + '='.repeat(78));
console.log('NORMAL OR PANEL, ASKED FIRST');
console.log('='.repeat(78));
for (const c of checks) {
  c.ok ? pass++ : fail++;
  console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
    (c.ok ? '' : `\n          expected ${JSON.stringify(c.want)}, got ${JSON.stringify(c.got)}`));
}
console.log('='.repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(78) + '\n');
process.exit(fail ? 1 : 0);
