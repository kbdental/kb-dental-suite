// "replace the Clinical note template with the one in this sheet and they be
//  called a Type 1 (concise) and Type 2 (Comprehensive)"
//  ... "They should be replaced with Templates according to Plan"
//
// So a clinical note belongs to a TREATMENT ON THE PLAN, not to a situation
// somebody thinks of at the chair, and each treatment carries its note in
// two lengths. Two plans, because the names differ: the clinic's own
// treatments and the CGHS rate card's.
//
// The thing that must not break: eighteen work-done forms and the CGHS
// prescription already ask for {situation, text, category}. They are base64
// blobs, and rebuilding a dropdown eighteen times is eighteen chances to
// break a form that was working. So they keep getting exactly that shape,
// derived from the plan.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── the clinic's own plan ───────────────────────────────────────────────
const SEED = vm.runInNewContext(
  html.slice(html.indexOf('const CLINICAL_NOTE_PLAN_SEED = ['),
             html.indexOf('\n];', html.indexOf('const CLINICAL_NOTE_PLAN_SEED = [')) + 3)
  + '\nCLINICAL_NOTE_PLAN_SEED');
const CATS = vm.runInNewContext(
  html.slice(html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = ['),
             html.indexOf(';', html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')))
  + '\nCLINICAL_TEMPLATE_CATEGORIES');

eq('every treatment the clinic sent is there', SEED.length, 277);
eq('on the two plans', [SEED.filter(r => r[0] === 'Normal').length,
                        SEED.filter(r => r[0] === 'CGHS').length], [156, 121]);
ok('each row is plan, treatment, department, templates, Type 1, Type 2',
   SEED.every(r => r.length === 6 && r.every(x => typeof x === 'string')),
   JSON.stringify(SEED.find(r => r.length !== 6 || r.some(x => typeof x !== 'string'))));
ok('no treatment is nameless', SEED.every(r => r[1].trim()),
   JSON.stringify(SEED.find(r => !r[1].trim())));
ok('and none is left without a concise note', SEED.every(r => r[4].trim()),
   JSON.stringify((SEED.find(r => !r[4].trim()) || []).slice(0, 2)));
ok('nor without the full one', SEED.every(r => r[5].trim()),
   JSON.stringify((SEED.find(r => !r[5].trim()) || []).slice(0, 2)));
// Type 2 is the longer one by definition; if a row had them the wrong way
// round the printed record would be the short one.
{
  const inverted = SEED.filter(r => r[5].length < r[4].length);
  eq('the comprehensive note is never shorter than the concise one',
     inverted.map(r => r[1]), []);
}
// Every department must be one the editor offers, or a note is filed under
// a heading nobody can pick again.
ok('every treatment falls under a department the editor offers',
   SEED.every(r => CATS.indexOf(r[2]) >= 0),
   JSON.stringify([...new Set(SEED.filter(r => CATS.indexOf(r[2]) < 0).map(r => r[2]))]));
// The sheet said "Restorations"; the clinic standardised on "Restoration"
// last week, and the Restoration form picks by that name.
ok('the department the sheet spelled differently was brought into line',
   SEED.some(r => r[2] === 'Restoration') && !SEED.some(r => r[2] === 'Restorations'));
{
  const forms = html.slice(html.indexOf('{ id:"rct",'), html.indexOf('{ id:"labLog",') + 500);
  const used = [];
  const re = /id:"(\w+)"[^\n]*?templateCategory:"([^"]*)"/g;
  let m;
  while ((m = re.exec(forms))) used.push({ form: m[1], cat: m[2] });
  const empty = used.filter(x => x.cat !== '*' && !SEED.some(r => r[2] === x.cat));
  eq('and every form has treatments to offer', empty.map(x => x.form + ':' + x.cat), []);
}

// ── the shape the eighteen forms already expect ─────────────────────────
{
  const src = gs.slice(gs.indexOf('// ── The plan, and the notes that go with it ─'),
                       gs.indexOf('function getPatientOutstanding(p) {'));
  ok('the backend code was found', /function clinicalTemplatesFromPlan_/.test(src), src.length);

  const sheets = {};
  const makeSheet = (name, rows) => ({
    name: name, _rows: (rows || []).map(r => r.slice()), _max: 26,
    getName() { return this.name; }, setName(n) { this.name = n; },
    getLastRow() { return this._rows.length; },
    getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
    getMaxColumns() { return this._max; },
    insertColumnsAfter(a, h) { this._max += h; },
    getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
    getRange(row, col, nr, nc) {
      const sh = this;
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const r = sh._rows[row - 1 + i] || [], v = [];
            for (let j = 0; j < nc; j++) v.push(r[col - 1 + j] === undefined ? '' : r[col - 1 + j]);
            out.push(v);
          }
          return out;
        },
        setValues: (vals) => {
          vals.forEach((v, i) => {
            while (sh._rows.length < row + i) sh._rows.push([]);
            v.forEach((x, j) => { sh._rows[row - 1 + i][col - 1 + j] = x; });
          });
        }
      };
    },
    appendRow(r) { this._rows.push(r.slice()); },
    clearContents() { this._rows = []; }
  });
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n, [])),
    _sheets: sheets
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    getSheet: (n) => sheets[n] || ss.insertSheet(n),
    ensureGridWidth_: (sh, n) => { if (n > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns()); },
    parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'not a list' }; } },
    CLINICAL_NOTE_SEED: [],
    Date, String, JSON, Math
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.getPlan = getClinicalNotePlan; this.savePlan = saveClinicalNotePlan;'
    + ' this.getTpl = getClinicalNoteTemplates;', ctx);

  eq('an empty plan reads as empty', ctx.getPlan(), { success: true, rows: [] });

  const ROWS = [
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT',
      templates: 'Access Opening → Working Length',
      type1: 'Access opening done wrt {tooth}.', type2: 'Access opening done wrt {tooth} under {anaesthesia}, irrigated with {irrigants}.' },
    { plan: 'CGHS', treatment: 'Root Canal Treatment - Anterior', category: 'RCT',
      templates: 'Access Opening', type1: 'RCT started wrt {tooth}.', type2: 'RCT started wrt {tooth}, working length recorded.' },
    { plan: 'Normal', treatment: 'Consultation', category: 'General / Consultation',
      templates: 'Consultation', type1: 'Consultation for {complaint}.', type2: '' }
  ];
  eq('a plan is accepted', ctx.savePlan({ rows: JSON.stringify(ROWS) }), { success: true, saved: 3 });
  eq('and comes back as it went in', ctx.getPlan().rows, ROWS);
  eq('under its own headings', sheets['Clinical Note Plan']._rows[0],
     ['Plan', 'Plan Treatment', 'Category', 'Templates', 'Type 1 (Concise)', 'Type 2 (Comprehensive)', 'Updated At']);
  // Written in one block: 277 rows appended one at a time times the request out.
  ok('the rows go in one block, not one call each',
     /sh\.getRange\(2, 1, block\.length, CLINICAL_PLAN_HEADERS\.length\)\.setValues\(block\)/.test(src));

  // The derived list: two records per treatment, each saying which it is.
  const tpl = ctx.getTpl();
  eq('the templates are derived from the plan', tpl.source, 'plan');
  eq('two records per treatment, bar the one with no full note', tpl.templates.length, 5);
  // Field by field: the order the keys land in is not the point.
  eq('the concise one comes first, and says so',
     [tpl.templates[0].situation, tpl.templates[0].category, tpl.templates[0].text],
     ['RCT - Access Open · Type 1 (Concise)', 'RCT', 'Access opening done wrt {tooth}.']);
  eq('the full one follows it', tpl.templates[1].situation,
     'RCT - Access Open · Type 2 (Comprehensive)');
  eq('an empty Type 2 is not offered as a blank template',
     tpl.templates.filter(t => t.situation.indexOf('Consultation') === 0).map(t => t.situation),
     ['Consultation · Type 1 (Concise)']);
  eq('the department rides along, because the forms filter on it',
     [...new Set(tpl.templates.map(t => t.category))].sort(),
     ['General / Consultation', 'RCT']);
  // Both plans' treatments are offered: a CGHS case is worked in the same forms.
  ok('a CGHS plan treatment is offered too',
     tpl.templates.some(t => t.situation.indexOf('Root Canal Treatment - Anterior') === 0));

  // An emptied plan falls back rather than leaving the forms with nothing.
  ctx.savePlan({ rows: JSON.stringify([]) });
  eq('with the plan emptied it falls back to the older sheet', ctx.getTpl().source, undefined);
  eq('rubbish is refused', ctx.savePlan({ rows: 'not json' }).success, false);

  ok('both actions are routed',
     /case "getClinicalNotePlan":\s+return getClinicalNotePlan\(\);/.test(gs) &&
     /case "saveClinicalNotePlan":\s+return saveClinicalNotePlan\(p\);/.test(gs));
  ok('the backend that does this is there to deploy',
     (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [, ''])[1] >= '2026-11-08a',
     (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [])[1]);
}

// ── the type suffix must not confuse the prescription matcher ───────────
{
  const ctx = { String, Array, Object };
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('const CGHS_TPL_STOP = ['),
                             html.indexOf('function CghsPrescription('))
    + '\nthis.pick = cghsTemplateFor;', ctx);
  const T = [
    { situation: 'Scaling · Type 1 (Concise)', text: 'Scaling done.' },
    { situation: 'Scaling · Type 2 (Comprehensive)', text: 'Full mouth scaling and polishing done.' },
    { situation: 'Flap Surgery · Type 1 (Concise)', text: 'Flap raised.' }
  ];
  // Left in, every name shares "type concise comprehensive" and the closest
  // template becomes whichever happened to come first.
  eq('the type is ignored when matching',
     (ctx.pick('Scaling', T) || {}).situation, 'Scaling · Type 1 (Concise)');
  eq('a rate-card name still finds its treatment',
     (ctx.pick('Flap Surgery- Per Tooth', T) || {}).situation, 'Flap Surgery · Type 1 (Concise)');
  eq('and the concise one wins the tie, which is what goes under a printed line',
     (ctx.pick('Scaling', T) || {}).text, 'Scaling done.');
  eq('something with no template still matches nothing', ctx.pick('Orthodontic Retainer', T), null);
}

// ── the screen ──────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e)));
  await page.setContent('<body style="margin:0;padding:16px;font-family:system-ui"><div id="root"></div></body>');
  for (const f of ['node_modules/react/umd/react.production.min.js',
                   'node_modules/react-dom/umd/react-dom.production.min.js'])
    await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });
  await page.addScriptTag({ content: `
    const T="#0078B4", BORDER="#e5e5e0", BGS="#f5f5f0";
    const inp={padding:"6px 10px",fontSize:14,border:"1px solid #e5e5e0",borderRadius:6,
               background:"#fff",color:"#1a1a1a",boxSizing:"border-box",fontFamily:"inherit"};
    const CLINICAL_TEMPLATE_CATEGORIES = ${JSON.stringify(CATS)};
    window.__saved = null;
    window.confirm = () => true;
  ` });
  await page.addScriptTag({ content:
    html.slice(html.indexOf('const CLINICAL_PLAN_NAMES = ['),
               html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')) });

  const SMALL = [
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT', templates: 'Access Opening',
      type1: 'Access opening done wrt {tooth}.', type2: 'Access opening done wrt {tooth} under {anaesthesia}.' },
    { plan: 'Normal', treatment: 'Consultation', category: 'General / Consultation', templates: 'Consultation',
      type1: 'Consultation for {complaint}.', type2: 'Patient reported with c/o {complaint}.' },
    { plan: 'CGHS', treatment: 'Flap Surgery- Per Tooth', category: 'Periodontics', templates: 'Flap Surgery',
      type1: 'Flap raised wrt {tooth}.', type2: 'Flap raised wrt {tooth} under {anaesthesia}.' }
  ];
  const mount = async (rows) => {
    await page.evaluate((rows) => {
      window.__saved = null;
      const root = document.getElementById('root');
      ReactDOM.render(null, root);
      ReactDOM.render(React.createElement(ClinicalNotePlanEditor, {
        key: String(Math.random()), rows: rows, saving: false,
        seed: window.__seed, onSave: (next) => { window.__saved = next; }
      }), root);
    }, rows);
    await page.waitForTimeout(110);
  };
  await page.evaluate((seed) => { window.__seed = seed; }, SEED.slice(0, 20));
  const text = () => page.$eval('#root', el => el.innerText.replace(/\s+/g, ' ').trim());
  const saved = () => page.evaluate(() => window.__saved);
  const button = (re) => page.evaluateHandle((src) => {
    const rx = new RegExp(src, 'i');
    return [...document.querySelectorAll('button')].find(b => rx.test(b.innerText)) || null;
  }, re);

  // Nothing loaded: it offers the clinic's plan rather than an empty screen.
  await mount([]);
  let t = await text();
  ok('with nothing loaded it says so', /No clinical note plan yet/.test(t), t);
  ok('and offers to put the clinic\'s plan in', /Load the clinic's plan \(20 treatments\)/.test(t), t);
  await (await button("Load the clinic's plan")).asElement().click();
  await page.waitForTimeout(110);
  let out = await saved();
  eq('the button loads it as rows, not as arrays', out.length, 20);
  eq('with the fields the sheet expects', Object.keys(out[0]).sort(),
     ['category', 'plan', 'templates', 'treatment', 'type1', 'type2']);

  // The two plans, kept apart.
  await mount(SMALL);
  t = await text();
  ok('both plans are offered with their counts', /Normal . 2/.test(t) && /CGHS . 1/.test(t), t);
  ok('the normal plan is shown first', /RCT - Access Open/.test(t) && !/Flap Surgery/.test(t), t);
  ok('and the concise note is on the row, so the list is readable at a glance',
     /Access opening done wrt \{tooth\}\./.test(t), t);
  await (await button('CGHS')).asElement().click();
  await page.waitForTimeout(110);
  t = await text();
  ok('switching plan shows the other one', /Flap Surgery- Per Tooth/.test(t) && !/RCT - Access Open/.test(t), t);

  // Searching, which is the only way through 156 of them.
  await mount(SMALL);
  await page.locator('input').first().fill('complaint');
  await page.waitForTimeout(110);
  t = await text();
  ok('search looks inside the note, not just the name',
     /Consultation/.test(t) && !/RCT - Access Open/.test(t), t);
  ok('and says how many it is showing', /1 of 2 shown/.test(t), t);

  // Editing: both lengths, and the edit lands on the right row.
  await mount(SMALL);
  // The clickable part is the header row, and the treatment name is a span
  // inside it. Clicking the outermost div that merely CONTAINS the name
  // picks up the whole list and opens nothing.
  await page.evaluate(() => {
    const name = [...document.querySelectorAll('span')]
      .find(sp => sp.textContent.trim() === 'Consultation');
    name.parentElement.click();
  });
  await page.waitForTimeout(110);
  const areas = await page.locator('textarea').count();
  eq('a row opens with a box for each length', areas, 2);
  await page.locator('textarea').nth(1).fill('Rewritten full record.');
  await (await button('^Save$')).asElement().click();
  await page.waitForTimeout(110);
  out = await saved();
  eq('the edit is saved on the row it was opened from',
     out.map(r => r.type2),
     ['Access opening done wrt {tooth} under {anaesthesia}.', 'Rewritten full record.',
      'Flap raised wrt {tooth} under {anaesthesia}.']);
  eq('and nothing else about that row moved', out[1].treatment, 'Consultation');
  eq('the other plan is untouched', out[2].plan, 'CGHS');

  // The notation the clinic wrote the notes in.
  await mount(SMALL);
  await page.evaluate(() => {
    [...document.querySelectorAll('span')]
      .find(s => /What do the brackets mean/.test(s.innerText)).click();
  });
  await page.waitForTimeout(110);
  t = await text();
  ok('the notation can be read on the screen',
     /optional . dropped when its field is blank/.test(t), t);

  eq('nothing threw', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  checks.forEach(c => {
    if (c.ok) pass++;
    else {
      fail++;
      console.log('  FAIL  ' + c.name +
        (c.want !== undefined ? '\n          got ' + JSON.stringify(c.got) + ', wanted ' + JSON.stringify(c.want)
         : c.got !== undefined ? '\n          ' + String(c.got).slice(0, 300) : ''));
    }
  });
  console.log('  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
