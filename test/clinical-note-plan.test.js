// "replace the Clinical note template with the one in this sheet and they be
//  called a Type 1 (concise) and Type 2 (Comprehensive)"
//  ... "They should be replaced with Templates according to Plan"
//
// Then: "The Plan tab needs to be separate ... and push the plan from the
//  sheet to plan and also Plan CGHS"
//
// So THREE things, kept apart:
//   the TEMPLATES  156, one per procedure, each in two lengths
//   the PLAN       277 treatments -- 156 the clinic's own, 121 CGHS -- each
//                  naming the templates it is made of
//
// They were briefly one store keyed by plan treatment. That duplicated
// every note once per plan item that used it, so a template corrected in
// one place stayed wrong in the others. A plan item refers to templates BY
// NAME, and all 364 references resolve, which is what makes the split safe.
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

// ── the clinic's own templates and plan ─────────────────────────────────
const read = (constName) => vm.runInNewContext(
  html.slice(html.indexOf('const ' + constName + ' = ['),
             html.indexOf('\n];', html.indexOf('const ' + constName + ' = [')) + 3)
  + '\n' + constName);

const TPL = read('CLINICAL_NOTE_TEMPLATE_SEED');
const PLAN = read('CLINICAL_NOTE_PLAN_SEED');
const CATS = vm.runInNewContext(
  html.slice(html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = ['),
             html.indexOf(';', html.indexOf('const CLINICAL_TEMPLATE_CATEGORIES = [')))
  + '\nCLINICAL_TEMPLATE_CATEGORIES');

eq('every template the clinic wrote is there', TPL.length, 156);
ok('each is department, template, Type 1, Type 2',
   TPL.every(r => r.length === 4 && r.every(x => typeof x === 'string' && x.trim())),
   JSON.stringify((TPL.find(r => r.length !== 4 || r.some(x => typeof x !== 'string' || !x.trim())) || []).slice(0, 2)));
eq('no two templates share a name', TPL.length, new Set(TPL.map(r => r[1])).size);
// Type 2 is the longer one by definition. The wrong way round and the full
// record would print as the short one.
eq('the comprehensive note is never shorter than the concise one',
   TPL.filter(r => r[3].length < r[2].length).map(r => r[1]), []);
ok('every template falls under a department the editor offers',
   TPL.every(r => CATS.indexOf(r[0]) >= 0),
   JSON.stringify([...new Set(TPL.filter(r => CATS.indexOf(r[0]) < 0).map(r => r[0]))]));
// The sheet said "Restorations"; the clinic standardised on "Restoration"
// last week and the Restoration form picks by that name.
ok('the department the sheet spelled differently was brought into line',
   TPL.some(r => r[0] === 'Restoration') && !TPL.some(r => r[0] === 'Restorations'));

eq('every plan treatment is there', PLAN.length, 277);
eq('on the two plans', [PLAN.filter(r => r[0] === 'Normal').length,
                        PLAN.filter(r => r[0] === 'CGHS').length], [156, 121]);
ok('each is plan, treatment, department, templates',
   PLAN.every(r => r.length === 4 && r[1].trim() && r[2].trim() && r[3].trim()),
   JSON.stringify((PLAN.find(r => r.length !== 4 || !(r[1].trim() && r[2].trim() && r[3].trim())) || []).slice(0, 3)));
ok('and the plan carries no copy of the note text',
   PLAN.every(r => r.length === 4), 'a plan row is wider than four columns');

// ── the references, resolved the way the screen resolves them ───────────
{
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(html.slice(html.indexOf('function clinicalTemplateRefs(cell) {'),
                             html.indexOf('const KB_CLIN_LBL'))
    + '\nthis.refs = clinicalTemplateRefs;', ctx);
  const refs = ctx.refs;

  eq('one template is one reference', refs('Consultation'), ['Consultation']);
  eq('an arrow means one after another',
     refs('Access Opening → Working Length'), ['Access Opening', 'Working Length']);
  eq('"or" means a choice',
     refs('Composite – Posterior / or Composite – Anterior'),
     ['Composite – Posterior', 'Composite – Anterior']);
  // The one that must not be split: a bare slash is part of the NAME.
  eq('a slash inside a name is left alone',
     refs('Denture Addition (Tooth / Clasp)'), ['Denture Addition (Tooth / Clasp)']);
  eq('nothing named is no references', refs(''), []);
  eq('and neither is nothing at all', refs(undefined), []);

  // Every reference in the clinic's plan must name a template that exists,
  // or that plan treatment writes nothing and the screen is the only place
  // it would ever show.
  const names = new Set(TPL.map(r => r[1]));
  const dangling = [];
  PLAN.forEach(r => refs(r[3]).forEach(n => { if (!names.has(n)) dangling.push(r[1] + ' → ' + n); }));
  eq('every reference in the plan resolves to a template', dangling, []);
  eq('and there are plenty of them to get wrong',
     PLAN.reduce((n, r) => n + refs(r[3]).length, 0), 364);
}

// ── two stores, run ─────────────────────────────────────────────────────
{
  const src = gs.slice(gs.indexOf('// ── Three things, kept apart ─'),
                       gs.indexOf('function getPatientOutstanding(p) {'));
  ok('the backend code was found', /function clinicalTemplatesFlat_/.test(src), src.length);

  const sheets = {};
  const makeSheet = (name) => ({
    name: name, _rows: [], _max: 26,
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
  const ss = { getSheetByName: (n) => sheets[n] || null,
               insertSheet: (n) => (sheets[n] = makeSheet(n)), _sheets: sheets };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    getSheet: (n) => sheets[n] || ss.insertSheet(n),
    ensureGridWidth_: (sh, n) => { if (n > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns()); },
    parseList_: (v) => { try { return JSON.parse(v); } catch (e) { return { __bad: 'not a list' }; } },
    CLINICAL_NOTE_SEED: [],
    Date, String, JSON, Math
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.getLib = getClinicalNoteTemplateLib; this.saveLib = saveClinicalNoteTemplateLib;'
    + ' this.getPlan = getClinicalNotePlan; this.savePlan = saveClinicalNotePlan;'
    + ' this.getTpl = getClinicalNoteTemplates;', ctx);

  eq('an empty library reads as empty', ctx.getLib(), { success: true, rows: [] });
  eq('an empty plan reads as empty', ctx.getPlan(), { success: true, rows: [] });

  const LIB = [
    { category: 'RCT', template: 'Access Opening', type1: 'Access opening done wrt {tooth}.',
      type2: 'Access opening done wrt {tooth} under {anaesthesia}.' },
    { category: 'RCT', template: 'Working Length', type1: 'WL recorded wrt {tooth}.', type2: '' },
    { category: 'Periodontics', template: 'Flap Surgery', type1: 'Flap raised wrt {tooth}.',
      type2: 'Flap raised wrt {tooth} under {anaesthesia}, sutured.' }
  ];
  const ROWS = [
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT',
      templates: 'Access Opening → Working Length' },
    { plan: 'CGHS', treatment: 'Flap Surgery- Per Tooth', category: 'Periodontics',
      templates: 'Flap Surgery' }
  ];
  eq('the library is accepted', ctx.saveLib({ rows: JSON.stringify(LIB) }), { success: true, saved: 3 });
  eq('and comes back as it went in', ctx.getLib().rows, LIB);
  eq('the plan is accepted', ctx.savePlan({ rows: JSON.stringify(ROWS) }), { success: true, saved: 2 });
  eq('and comes back as it went in', ctx.getPlan().rows, ROWS);

  // The thing that was actually broken: two tables answering to one name.
  // Each read found the other's heading row, moved that sheet aside and made
  // a fresh one, so two tabs were shuffled on every single read.
  eq('they are separate sheets', Object.keys(sheets).sort(),
     ['Clinical Note Plan', 'Clinical Templates (Type 1 & 2)']);
  eq('and neither is the older table\'s name',
     Object.keys(sheets).indexOf('Clinical Note Templates'), -1);
  const before = JSON.stringify(sheets);
  ctx.getTpl(); ctx.getTpl(); ctx.getTpl();
  eq('reading three times renames nothing and writes nothing',
     JSON.stringify(sheets), before);

  eq('the library has its own headings', sheets['Clinical Templates (Type 1 & 2)']._rows[0],
     ['Category', 'Template', 'Type 1 (Concise)', 'Type 2 (Comprehensive)', 'Updated At']);
  eq('and the plan has its own', sheets['Clinical Note Plan']._rows[0],
     ['Plan', 'Plan Treatment', 'Category', 'Templates', 'Updated At']);
  ok('each goes in one block, not one call per row',
     /sh\.getRange\(2, 1, block\.length, CLINICAL_TPL_LIB_HEADERS\.length\)\.setValues\(block\)/.test(src) &&
     /sh\.getRange\(2, 1, block\.length, CLINICAL_PLAN_HEADERS\.length\)\.setValues\(block\)/.test(src));

  // ── the shape the eighteen forms already expect ──────────────────────
  const flat = ctx.getTpl();
  eq('the templates come from the library', flat.source, 'library');
  eq('two records per template, bar the one with no full note', flat.templates.length, 5);
  eq('the concise one comes first, and says so',
     [flat.templates[0].situation, flat.templates[0].category, flat.templates[0].text],
     ['Access Opening · Type 1 (Concise)', 'RCT', 'Access opening done wrt {tooth}.']);
  eq('the full one follows it', flat.templates[1].situation,
     'Access Opening · Type 2 (Comprehensive)');
  eq('an empty Type 2 is not offered as a blank template',
     flat.templates.filter(t => t.situation.indexOf('Working Length') === 0).map(t => t.situation),
     ['Working Length · Type 1 (Concise)']);
  eq('the department rides along, because the forms filter on it',
     [...new Set(flat.templates.map(t => t.category))].sort(), ['Periodontics', 'RCT']);
  // The plan is NOT what the forms are fed: it carries no note text.
  ok('the forms are fed the library, not the plan',
     /function clinicalTemplatesFlat_[\s\S]{0,400}getClinicalNoteTemplatesV3_\(\)/.test(src));

  ctx.saveLib({ rows: JSON.stringify([]) });
  eq('with the library emptied it falls back rather than leaving forms blank',
     ctx.getTpl().source, undefined);
  eq('rubbish is refused by both', [ctx.saveLib({ rows: 'x' }).success,
                                    ctx.savePlan({ rows: 'x' }).success], [false, false]);

  ok('all four actions are routed',
     /case "getClinicalNotePlan":/.test(gs) && /case "saveClinicalNotePlan":/.test(gs) &&
     /case "getClinicalNoteTemplateLib":/.test(gs) && /case "saveClinicalNoteTemplateLib":/.test(gs));
  ok('the backend that does this is there to deploy',
     (/var BACKEND_BUILD = "([^"]+)"/.exec(gs) || [, ''])[1] >= '2026-11-08b',
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
  eq('the type is ignored when matching',
     (ctx.pick('Scaling', T) || {}).situation, 'Scaling · Type 1 (Concise)');
  eq('a rate-card name still finds its treatment',
     (ctx.pick('Flap Surgery- Per Tooth', T) || {}).situation, 'Flap Surgery · Type 1 (Concise)');
  eq('and the concise one wins the tie, which is what goes under a printed line',
     (ctx.pick('Scaling', T) || {}).text, 'Scaling done.');
  eq('something with no template still matches nothing', ctx.pick('Orthodontic Retainer', T), null);
}

// ── the two screens ─────────────────────────────────────────────────────
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

  const LIB = [
    { category: 'RCT', template: 'Access Opening', type1: 'Access opening done wrt {tooth}.',
      type2: 'Access opening done wrt {tooth} under {anaesthesia}.' },
    { category: 'RCT', template: 'Working Length', type1: 'WL recorded wrt {tooth}.',
      type2: 'Working length recorded wrt {tooth} using {method}.' },
    { category: 'Periodontics', template: 'Flap Surgery', type1: 'Flap raised wrt {tooth}.',
      type2: 'Flap raised wrt {tooth} under {anaesthesia}.' }
  ];
  const ROWS = [
    { plan: 'Normal', treatment: 'RCT - Access Open', category: 'RCT',
      templates: 'Access Opening → Working Length' },
    { plan: 'Normal', treatment: 'Consultation', category: 'General / Consultation',
      templates: 'Nothing By That Name' },
    { plan: 'CGHS', treatment: 'Flap Surgery- Per Tooth', category: 'Periodontics',
      templates: 'Flap Surgery' }
  ];

  const mount = async (component, props) => {
    await page.evaluate(({ component, props }) => {
      window.__saved = null;
      const root = document.getElementById('root');
      ReactDOM.render(null, root);
      ReactDOM.render(React.createElement(window[component] || eval(component), {
        key: String(Math.random()), ...props, saving: false,
        onSave: (next) => { window.__saved = next; }
      }), root);
    }, { component, props });
    await page.waitForTimeout(110);
  };
  const text = () => page.$eval('#root', el => el.innerText.replace(/\s+/g, ' ').trim());
  const saved = () => page.evaluate(() => window.__saved);
  const button = (re) => page.evaluateHandle((src) => {
    const rx = new RegExp(src, 'i');
    return [...document.querySelectorAll('button')].find(b => rx.test(b.innerText)) || null;
  }, re);

  // ── the template library ──────────────────────────────────────────────
  await mount('ClinicalTemplateLibEditor', { rows: [], seed: TPL.slice(0, 12) });
  let t = await text();
  ok('an empty library offers the clinic\'s templates',
     /No clinical note templates yet/.test(t) && /Load the clinic's templates \(12\)/.test(t), t);
  await (await button("Load the clinic's templates")).asElement().click();
  await page.waitForTimeout(110);
  let out = await saved();
  eq('loaded as rows, not arrays', Object.keys(out[0]).sort(),
     ['category', 'template', 'type1', 'type2']);
  eq('all of them', out.length, 12);

  await mount('ClinicalTemplateLibEditor', { rows: LIB, seed: TPL });
  t = await text();
  ok('it counts the templates', /3 templates\./.test(t), t);
  ok('and shows the concise note on the row', /Access opening done wrt \{tooth\}\./.test(t), t);
  await page.evaluate(() => {
    [...document.querySelectorAll('span')].find(sp => sp.textContent.trim() === 'Working Length')
      .parentElement.click();
  });
  await page.waitForTimeout(110);
  eq('a row opens with a box for each length', await page.locator('textarea').count(), 2);
  await page.locator('textarea').nth(1).fill('Rewritten full record.');
  await (await button('^Save$')).asElement().click();
  await page.waitForTimeout(110);
  out = await saved();
  eq('the edit lands on the row it was opened from',
     out.map(r => r.type2),
     ['Access opening done wrt {tooth} under {anaesthesia}.', 'Rewritten full record.',
      'Flap raised wrt {tooth} under {anaesthesia}.']);

  // ── the plan ──────────────────────────────────────────────────────────
  await mount('ClinicalPlanEditor', { rows: [], templates: LIB, seed: PLAN.slice(0, 9) });
  t = await text();
  ok('an empty plan offers the clinic\'s plan', /Load the clinic's plan \(9 treatments\)/.test(t), t);

  await mount('ClinicalPlanEditor', { rows: ROWS, templates: LIB, seed: PLAN });
  t = await text();
  ok('both plans are offered, under the names the clinic uses',
     /Plan . 2/.test(t) && /Plan CGHS . 1/.test(t), t);
  ok('the normal plan is shown first',
     /RCT - Access Open/.test(t) && !/Flap Surgery- Per Tooth/.test(t), t);
  // The point of handing it the library: you see what the plan item writes.
  ok('each plan treatment shows the note it will write',
     /Access Opening Access opening done wrt \{tooth\}\./.test(t)
     && /Working Length WL recorded wrt \{tooth\}\./.test(t), t);
  // And the one that nothing else on the screen would reveal.
  ok('a template name that matches nothing is called out',
     /No template of that name in the library\./.test(t), t);
  ok('the screen says where the notes themselves live',
     /The notes live under Clinical Note Templates/.test(t), t);

  await (await button('Plan CGHS')).asElement().click();
  await page.waitForTimeout(110);
  t = await text();
  ok('switching plan shows the other one',
     /Flap Surgery- Per Tooth/.test(t) && !/RCT - Access Open/.test(t), t);
  ok('and resolves its templates too', /Flap raised wrt \{tooth\}\./.test(t), t);

  await mount('ClinicalPlanEditor', { rows: ROWS, templates: LIB, seed: PLAN });
  await page.locator('input').first().fill('access');
  await page.waitForTimeout(110);
  t = await text();
  // Counted by row, not by looking for the word: "General / Consultation"
  // is an option in the department dropdown and is on the page either way.
  const rowNames = await page.$$eval('span', els =>
    els.filter(e => e.style && e.style.fontWeight === '700' && e.style.fontSize === '13.5px')
       .map(e => e.textContent.trim()));
  ok('search narrows the plan', /1 of 2 shown/.test(t), t);
  eq('to the one row that matches', rowNames, ['RCT - Access Open']);

  await mount('ClinicalPlanEditor', { rows: ROWS, templates: LIB, seed: PLAN });
  await page.evaluate(() => {
    [...document.querySelectorAll('span')].find(sp => sp.textContent.trim() === 'Consultation')
      .parentElement.click();
  });
  await page.waitForTimeout(110);
  const inputs = await page.locator('input').count();
  ok('a plan row opens for editing', inputs >= 3, String(inputs));
  eq('and it has no note boxes, because the notes are not kept here',
     await page.locator('textarea').count(), 0);

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
