// "I am really pissed off giving same instruction again and again with
//  actually no result"
//
// Fair. The CGHS prescription would not save. The clinic was told, three
// times, that Apps Script needed a NEW VERSION deployed and not just the
// file pasted -- and each time they did exactly that, and each time the
// pad still answered:
//
//   Could not save: this backend does not have "saveCghsPrescription" yet.
//
// It was never their deployment. saveCghsPrescription and
// listCghsPrescriptions were written, at the bottom of Code.gs, and no
// `case` was ever added to the dispatcher. The web app routes by an
// explicit switch, so an unrouted function cannot be called however many
// times it is deployed. The message the page printed was true -- that
// backend did not have the action -- and the remedy it gave was useless.
//
// The error message is what made it so expensive: it names a deployment
// step, so every failure looked like the clinic's fault, and the one
// check that would have settled it in a second was never run.
//
// This is that check. Every action the page asks for must have a route,
// and every route must reach a function that exists. It is cheap, it is
// exhaustive, and it fails loudly on the thing nobody thinks to look at.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script', 'out', 'Code.gs'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// Every api("name", …) the page makes, wherever it is written.
const calls = new Set();
for (const m of html.matchAll(/\bapi\(\s*"([A-Za-z0-9_]+)"/g)) calls.add(m[1]);
ok('the page was read for the actions it asks for', calls.size > 80, calls.size);

// Every `case "name":` in the dispatcher, and what it returns.
const routes = new Map();
for (const m of gs.matchAll(/case\s+"([A-Za-z0-9_]+)"\s*:\s*return\s+([A-Za-z0-9_]+)\s*\(/g))
  routes.set(m[1], m[2]);
for (const m of gs.matchAll(/case\s+"([A-Za-z0-9_]+)"\s*:/g))
  if (!routes.has(m[1])) routes.set(m[1], null);
ok('and the backend for the ones it answers', routes.size > 100, routes.size);

const fns = new Set();
for (const m of gs.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)) fns.add(m[1]);

// ── the check that was missing ─────────────────────────────────────────
// An action with no case falls through to `default`, which answers
// "Unknown action: X" -- and the page turns that into a note telling the
// clinic to redeploy. So this failing means the clinic is about to be
// sent on an errand that cannot help them.
const unrouted = [...calls].filter(a => !routes.has(a)).sort();
eq('every action the page calls is routed in the dispatcher', unrouted, []);

// The mirror of it: a case pointing at a function that was renamed or
// never written throws at run time instead, which reads as a backend
// error with no clue in it.
const dangling = [...routes].filter(([, f]) => f && !fns.has(f)).map(([c]) => c).sort();
eq('and every route reaches a function that exists', dangling, []);

// ── the two that caused this ───────────────────────────────────────────
ok('saveCghsPrescription is routed', routes.get('saveCghsPrescription') === 'saveCghsPrescription');
ok('listCghsPrescriptions is routed', routes.get('listCghsPrescriptions') === 'listCghsPrescriptions');
ok('both are written', fns.has('saveCghsPrescription') && fns.has('listCghsPrescriptions'));

// ── and the page asks for a backend new enough to have them ────────────
// The two builds are compared as text, so a page asking for more than the
// deployed backend reports is what puts the banner up. Bumping the
// backend without bumping what the page asks for means a clinic that
// never deploys is never told.
const want = (html.match(/const KB_BACKEND_BUILD_REQUIRED = "([^"]+)"/) || [])[1];
const have = (gs.match(/var BACKEND_BUILD = "([^"]+)"/) || [])[1];
ok('the page names the backend build it needs', /^\d{4}-\d{2}-\d{2}[a-z]?$/.test(want || ''), want);
ok('the backend names its own', /^\d{4}-\d{2}-\d{2}[a-z]?$/.test(have || ''), have);
ok('and the backend in this repo is new enough for the page shipped with it',
   want && have && have >= want, have + ' vs ' + want);

let pass = 0, fail = 0;
checks.forEach(c => {
  if (c.ok) pass++;
  else {
    fail++;
    console.log('  FAIL  ' + c.name +
      (c.want !== undefined ? '\n          got ' + JSON.stringify(c.got) + ', wanted ' + JSON.stringify(c.want)
       : c.got ? '\n          ' + c.got : ''));
  }
});
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
