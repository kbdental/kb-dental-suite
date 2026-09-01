// Checks the fix for: a multi-visit tooth's later save could silently blank
// out fields an earlier visit had already recorded (e.g. visit 1 fills
// anaesthesia + prep, visit 2 fills lab dates — visit 2 used to overwrite
// the whole top-level record with itself, wiping visit 1's answers), and a
// tooth returning for a second visit landed as a second look-alike row
// instead of continuing the first.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const from = html.indexOf('const CS_ITEMS_KEY');
const to = html.indexOf('// A clinical record sheet holds four teeth');
if (from < 0 || to < 0) { console.error('could not locate mergeClinicalSheet'); process.exit(1); }

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

function makeCtx(existingRecord) {
  const ctx = {
    api: async (action, params) => {
      if (action === 'getClinicalSheets') {
        return existingRecord ? { success: true, allTeeth: existingRecord } : { success: true, allTeeth: null };
      }
      throw new Error('unexpected api call: ' + action);
    },
    fmtDMY: () => '01/01/2026'
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(from, to) + ';this.mergeClinicalSheet = mergeClinicalSheet;', ctx);
  return ctx;
}

(async () => {
  // --- the reported scenario: visit 2 must not blank out visit 1's fields --
  {
    const existing = {
      anaType: 'Lignocaine', anaMethod: 'Block', labName: '—', sendDate: '—',
      teeth: [{ n: 1, tooth: '16', date: '20/08/2026' }]
    };
    const ctx = makeCtx(existing);
    const merged = await ctx.mergeClinicalSheet({
      uhid: 'AL0777', sheetType: 'Crown Bridge',
      allTeeth: {
        anaType: '—', anaMethod: '—', labName: 'Precision Labs', sendDate: '27/08/2026',
        teeth: [{ n: 1, tooth: '16', date: '27/08/2026' }]
      }
    });
    eq('visit 1 anaesthesia survives visit 2 leaving it blank', merged.anaType, 'Lignocaine');
    eq('visit 1 anaesthesia method survives too', merged.anaMethod, 'Block');
    eq('visit 2 lab name is picked up', merged.labName, 'Precision Labs');
    eq('visit 2 send date is picked up', merged.sendDate, '27/08/2026');
  }

  // --- a tooth returning for a second visit updates its row in place -------
  {
    const existing = { teeth: [
      { n: 1, tooth: '16', date: '20/08/2026' },
      { n: 2, tooth: '17', date: '20/08/2026' }
    ] };
    const ctx = makeCtx(existing);
    const merged = await ctx.mergeClinicalSheet({
      uhid: 'AL0777', sheetType: 'Crown Bridge',
      allTeeth: { teeth: [{ n: 1, tooth: '16', date: '27/08/2026' }] }
    });
    eq('still exactly two teeth, not three', merged.teeth.length, 2);
    eq('tooth 16 kept its position and its date was updated', merged.teeth[0],
      { n: 1, tooth: '16', date: '27/08/2026' });
    eq('tooth 17 untouched', merged.teeth[1], { n: 2, tooth: '17', date: '20/08/2026' });
  }

  // --- a genuinely new tooth still appends -----------------------------------
  {
    const existing = { teeth: [{ n: 1, tooth: '16', date: '20/08/2026' }] };
    const ctx = makeCtx(existing);
    const merged = await ctx.mergeClinicalSheet({
      uhid: 'AL0777', sheetType: 'Crown Bridge',
      allTeeth: { teeth: [{ n: 1, tooth: '24', date: '27/08/2026' }] }
    });
    eq('a new tooth is appended, not merged into the existing one',
      merged.teeth.map(t => t.tooth), ['16', '24']);
  }

  // --- implants identify by site, not by "tooth" -----------------------------
  {
    const existing = { osteoType: 'Flapless', implants: [{ n: 1, site: '46', brand: 'MIS' }] };
    const ctx = makeCtx(existing);
    const merged = await ctx.mergeClinicalSheet({
      uhid: 'AL0777', sheetType: 'Implant Surgery',
      allTeeth: { osteoType: '—', implants: [{ n: 1, site: '46', brand: '—', torque: 'T = 35 Ncm' }] }
    });
    eq('implant site 46 updated in place, not duplicated', merged.implants.length, 1);
    eq('brand kept from the first visit since the second left it blank', merged.implants[0].brand, 'MIS');
    eq('osteotomy type kept from the first visit', merged.osteoType, 'Flapless');
  }

  // --- an item with no identity at all still appends safely -----------------
  {
    const existing = { teeth: [{ n: 1, tooth: '16', date: '20/08/2026' }] };
    const ctx = makeCtx(existing);
    const merged = await ctx.mergeClinicalSheet({
      uhid: 'AL0777', sheetType: 'Crown Bridge',
      allTeeth: { teeth: [{ n: 1, tooth: '', date: '27/08/2026' }] }
    });
    eq('a row with no tooth selected yet does not collide with an existing one',
      merged.teeth.length, 2);
  }

  // --- re-saving the exact same visit is idempotent, not a duplicate --------
  {
    const existing = { anaType: 'Articaine', teeth: [{ n: 1, tooth: '16', date: '27/08/2026' }] };
    const ctx = makeCtx(existing);
    const merged = await ctx.mergeClinicalSheet({
      uhid: 'AL0777', sheetType: 'Crown Bridge',
      allTeeth: { anaType: 'Articaine', teeth: [{ n: 1, tooth: '16', date: '27/08/2026' }] }
    });
    eq('saving the same tooth twice does not create a duplicate row', merged.teeth.length, 1);
  }

  // --- no existing record at all (first save ever) ----------------------------
  {
    const ctx = makeCtx(null);
    const merged = await ctx.mergeClinicalSheet({
      uhid: 'AL0777', sheetType: 'Crown Bridge',
      allTeeth: { anaType: 'Articaine', teeth: [{ n: 1, tooth: '16', date: '' }] }
    });
    eq('first-ever save just becomes the record', merged.anaType, 'Articaine');
    eq('first-ever save dates the item', merged.teeth[0].date, '01/01/2026');
  }

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('MULTI-VISIT MERGE — LATEST NON-BLANK WINS, SAME TOOTH UPDATES IN PLACE');
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
})();
