// "Even the RCT form filled is not reaching the google sheets please check
//  all the forms for reaching the google sheet" ... "the tab name is 'RCT'
//  only with rows in clinical records workbook"
//
// It was reaching Google Sheets. It was not reaching anything readable.
//
// RCT, Implant Surgery, Implant Prosthetic and Crown & Bridge save through
// saveClinicalSheets, which keeps ONE row per patient holding the entire
// course of treatment as JSON in a single cell, in a Clinical Sheets tab.
// The clinic opens the "RCT" tab -- the one with Tooth No., Visit Date,
// No. of Canals, Length Determination, the columns it set up -- and finds
// nothing new in it, ever. Code.gs said as much in its own comment: those
// flat tabs were "purely for pasting in historical records".
//
// The other fourteen forms were never affected: they save through
// saveScaling, savePathology and the rest, which write their flat tabs.
//
// So the same save now also writes the work out flat, one row per visit,
// into the tab the clinic reads. Two halves, both run here: the projection
// that turns a record into rows, and the backend that matches those rows
// onto whatever header the tab actually has.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const gs = fs.readFileSync(path.join(REPO, 'apps-script/out/Code.gs'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 400) : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

// ── the projection, run ─────────────────────────────────────────────────
const ctx = { String, Object, Array, JSON, console, RegExp };
vm.createContext(ctx);
vm.runInContext(
  cut('const CS_ITEM_ID_FIELD = {', '// ── Recovering a record that predates') +
  cut('const CS_FORM_BY_SHEET_TYPE = {', '// ── Read-only saved-record viewer') +
  '\nthis.flatten = csFlatRowsFromRecord; this.BY_TYPE = CS_FORM_BY_SHEET_TYPE;' +
  '\nthis.TABS = CS_RECORD_TAB; this.CFG = CS_FORM_CONFIG;', ctx);
const { flatten, BY_TYPE, TABS } = ctx;

eq('the four forms that save as JSON are the four named here',
   Object.keys(BY_TYPE).sort(), ['Crown Bridge', 'Implant Prosthetic', 'Implant Surgery', 'RCT']);

// A real RCT record: one tooth, two visits, and an earlier course on the
// same tooth -- the shape a retreatment leaves behind.
const RCT_RECORD = {
  pName: 'Shiv Kumar', pId: 'AL1102', doctor: 'Dr. A. Sharma', age: '41', gender: 'Male',
  entries: [{
    tooth: '27', ana: 'Lignocaine (Infiltration)', rd: 'No',
    past: [{ tooth: '27', date: '2024-02-11', ana: 'Lignocaine', access: 'Completed',
             canals: '3 (MB, DB, P)' }],
    wlCanals: { MB: '17mm [25/04]', DB: '17mm [25/04]', P: '20mm [20/06]' },
    visits: [
      { date: '2026-11-05', access: 'Completed', canals: '3 (MB, DB, P)',
        instr: 'Rotary NiTi', doctor: 'Dr. A. Sharma' },
      { date: '2026-11-10', irrig: 'NaOCl 3%, Chlorhexidine 2%', temp: 'Cavit',
        rest: 'Composite: Ivoclar', doctor: 'Dr. A. Sharma' }
    ]
  }]
};

const out = flatten('rct', RCT_RECORD);
ok('an RCT record turns into rows', !!out, String(out));
eq('for the tab the clinic actually reads', out.tabName, 'RCT');
// One row per visit, not one per patient. That is the whole difference.
eq('one row per visit, the earlier course included', out.rows.length, 3);
eq('keyed so a re-save corrects a row instead of adding one',
   out.keyColumns, ['UHID', 'Visit Date', 'Tooth No.']);

const r = out.rows[1];     // the first visit of the current course
eq('the patient is on every row', r['UHID'], 'AL1102');
eq('by name', r['Patient Name'], 'Shiv Kumar');
eq('the tooth goes in the clinic\'s own column', r['Tooth No.'], '27');
eq('and the date in its own', r['Visit Date'], '2026-11-05');
eq('the doctor who did it', r['Doctor'], 'Dr. A. Sharma');
eq('what was done that day', r['No. of Canals'], '3 (MB, DB, P)');
eq('under the label the tab uses', r['Access Cavity Prep\'n & Pulp Extirpation'], 'Completed');
// The case-wide answers belong on every visit: a row carrying only what
// changed that day cannot be read on its own.
eq('and the answers that hold for the whole case', r['Anaesthesia'], 'Lignocaine (Infiltration)');
eq('including the ones that are plainly No', r['Rubber Dam'], 'No');
// The per-canal lengths are an object in the record; the tab has one column.
ok('the working lengths are flattened into their column',
   /MB: 17mm \[25\/04\]/.test(r['Length Determination'] || '') &&
   /P: 20mm \[20\/06\]/.test(r['Length Determination'] || ''), r['Length Determination']);
// An earlier course is its own visits, not part of this one.
eq('the earlier course keeps its own date', out.rows[0]['Visit Date'], '2024-02-11');
eq('and does not borrow this course\'s findings', out.rows[0]['Irrigant Used'], undefined);

eq('a record with nothing in it produces no rows', flatten('rct', { entries: [] }), null);
eq('nor does a form that does not save this way', flatten('scaling', RCT_RECORD), null);
eq('nor no record at all', flatten('rct', null), null);

// The other three save the same way and must project too.
['imp_surgery', 'imp_prosth', 'crown'].forEach(id => {
  const cfg = ctx.CFG[id];
  const rec = { pName: 'Shiv Kumar', pId: 'AL1102', doctor: 'Dr. A. Sharma' };
  rec[cfg.topFields[0][0]] = 'case-wide answer';
  rec[cfg.itemsKey] = [{ site: '46', tooth: '46', date: '2026-11-05',
                         visits: [{ date: '2026-11-05', doctor: 'Dr. A. Sharma' }] }];
  const o = flatten(id, rec);
  ok(id + ': projects into rows', !!o && o.rows.length === 1, JSON.stringify(o));
  if (!o) return;
  eq(id + ': into its own tab', o.tabName, TABS[id].tab);
  eq(id + ': with the site in the tab\'s column', o.rows[0][TABS[id].col], '46');
  eq(id + ': and the case-wide answer on the row',
     o.rows[0][cfg.topFields[0][1]], 'case-wide answer');
});

// ── the backend writer, run ─────────────────────────────────────────────
const makeSheet = (headers) => ({
  _rows: headers ? [headers.slice()] : [], _max: Math.max(26, (headers || []).length),
  getLastRow() { return this._rows.length; },
  getMaxColumns() { return this._max; },
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); },
  insertColumnsAfter(a, n) { this._max += n; },
  getDataRange() { const r = this._rows; return { getValues: () => r.map(x => x.slice()) }; },
  getRange(row, col, nr, nc) {
    const sh = this;
    return { setValues: (vals) => { vals.forEach((v, i) => {
      while (sh._rows.length < row + i) sh._rows.push([]);
      v.forEach((x, j) => { sh._rows[row - 1 + i][col - 1 + j] = x; });
    }); }, getValues: () => [] };
  },
  appendRow(r) { this._rows.push(r.slice()); },
  clearContents() { this._rows = []; }
});

const fn = (name) => {
  const a = gs.indexOf('function ' + name + '(');
  return gs.slice(a, gs.indexOf('\n}', a) + 2) + '\n';
};
const sheets = {};
const back = {
  getClinicalSheet: (n) => sheets[n] || (sheets[n] = makeSheet(null)),
  ensureGridWidth_: () => {},
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  String, Object, Array, JSON, Date, console
};
vm.createContext(back);
vm.runInContext(fn('appendClinicalRecordRows') + '\nthis.append = appendClinicalRecordRows;', back);

// The clinic's own header, in the clinic's own order.
const RCT_HEADERS = ['UHID', 'Patient Name', 'Age', 'Gender', 'Tooth No.', 'Visit Date', 'Doctor',
  'Anaesthesia', 'Rubber Dam', 'Access Cavity Prep\'n and Pulp Extirpation', 'No. of Canals',
  'Length Determination', 'Irrigant Used', 'Temporary Dressing', 'Post Endo. Restoration: Composite / Post Core'];
sheets['RCT'] = makeSheet(RCT_HEADERS);

let res = back.append({ tabName: 'RCT', rows: JSON.stringify(out.rows),
                        keyColumns: JSON.stringify(out.keyColumns) });
ok('the rows are written', res.success, JSON.stringify(res));
eq('all three of them', res.written, 3);
eq('and the tab now has them under its header', sheets['RCT']._rows.length, 4);

const at = (row, label) => sheets['RCT']._rows[row][RCT_HEADERS.indexOf(label)];
eq('the UHID is in the UHID column', at(2, 'UHID'), 'AL1102');
eq('the tooth in the tooth column', at(2, 'Tooth No.'), '27');
eq('the date in the date column', at(2, 'Visit Date'), '2026-11-05');
// The label the record uses has "&" where the tab has "and". Matching has to
// survive that, or the most important column on the sheet stays empty.
eq('a column whose wording differs slightly still matches',
   at(2, 'Access Cavity Prep\'n and Pulp Extirpation'), 'Completed');
eq('and the working lengths landed', /MB: 17mm/.test(String(at(2, 'Length Determination'))), true);

// Every save re-sends the whole record, so writing twice must not double it.
res = back.append({ tabName: 'RCT', rows: JSON.stringify(out.rows),
                    keyColumns: JSON.stringify(out.keyColumns) });
eq('saving the same visits again adds nothing', res.written, 0);
eq('it corrects the rows that are there', res.updated, 3);
eq('so the tab still holds three visits', sheets['RCT']._rows.length, 4);

// A corrected visit overwrites its own row rather than making a second one.
const fixed = JSON.parse(JSON.stringify(out.rows));
fixed[1]['No. of Canals'] = '4 (MB1, MB2, DB, P)';
back.append({ tabName: 'RCT', rows: JSON.stringify(fixed), keyColumns: JSON.stringify(out.keyColumns) });
eq('a correction lands on the same row', at(2, 'No. of Canals'), '4 (MB1, MB2, DB, P)');
eq('and adds no row', sheets['RCT']._rows.length, 4);

// A tab with no header cannot be written by column name, and guessing an
// order would scatter a clinical record across the wrong columns.
sheets['Empty Tab'] = makeSheet(null);
res = back.append({ tabName: 'Empty Tab', rows: JSON.stringify(out.rows) });
eq('a tab with no header row is refused, not guessed at', res.success, false);
ok('and says why', /no header row/.test(res.error || ''), res.error);

eq('no tab name is refused', back.append({ tabName: '', rows: '[]' }).success, false);
eq('bad JSON is refused rather than thrown', back.append({ tabName: 'RCT', rows: '{nope' }).success, false);
eq('nothing to write is not an error', back.append({ tabName: 'RCT', rows: '[]' }).success, true);
// A field the clinic has no column for is dropped, not forced in.
res = back.append({ tabName: 'RCT', keyColumns: JSON.stringify(out.keyColumns),
  rows: JSON.stringify([{ UHID: 'AL1102', 'Visit Date': '2026-12-01', 'Tooth No.': '36',
                          'A Column This Tab Does Not Have': 'ignored', 'No. of Canals': '2' }]) });
eq('an unknown column is dropped', res.written, 1);
eq('and what the tab does have is written', at(4, 'No. of Canals'), '2');

// ── and it is wired into the save ───────────────────────────────────────
const handler = cut('if (d.type === "KB_SAVE_CLINICAL_SHEET" && d.uhid) {', 'else if (d.type === "KB_SAVE_PDF"');
ok('the save writes the readable copy too', /appendClinicalRecordRows/.test(handler), '');
// The record is already safe by then; a failed copy must not tell the
// dentist the save failed.
ok('after the form has been told the record is saved',
   handler.indexOf('reply(') < handler.indexOf('appendClinicalRecordRows'), '');
ok('and a failure is said out loud, not only to the console',
   /setSheetCopyWarn/.test(handler), '');
ok('with the banner actually rendered', /sheetCopyWarn && /.test(html), '');
ok('the backend offers the action', /case "appendClinicalRecordRows":/.test(gs), '');

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
