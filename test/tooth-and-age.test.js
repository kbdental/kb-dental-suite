// Two reported gaps.
//
// TOOTH: the prescription's printed "Treatments Done" table has a Teeth
// column, fed — like the saved prescription — from the form's Teeth box. The
// auto-fill from today's register wrote the tooth into the procedure text but
// never into that box, so the column printed "—".
//
// AGE: the backend sends a date of birth and never an age, yet every form,
// the prescription and the register prefill read patient.age — so Age was
// blank across the app unless typed. The two places that did compute one
// ignored whether the birthday had passed yet, and read a year too old for
// part of every year.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbtoothage-'));

const checks = [];
const eq = (name, got, want) =>
  checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

// ── AGE: the one calculation ────────────────────────────────────────────────
const a = html.indexOf('function calcAge(');
const calcAge = new Function(html.slice(a, html.indexOf('\n}\n', a) + 2) + ';return calcAge;')();
const T = new Date(2026, 8, 21);   // 21 Sep 2026
eq('dd/mm/yyyy, birthday still to come this year', calcAge('12/12/1943', T), '82');
eq('dd/mm/yyyy, birthday already passed', calcAge('22/01/2002', T), '24');
eq('birthday today counts', calcAge('21/09/2000', T), '26');
eq('birthday tomorrow does not yet', calcAge('22/09/2000', T), '25');
eq('single-digit day and month, dashes', calcAge('5-3-1990', T), '36');
eq('ISO yyyy-mm-dd', calcAge('1990-03-05', T), '36');
eq('a Date written out as text', calcAge('Tue Jan 22 2002 00:00:00 GMT+0530', T), '24');
eq('"Not Known" gives no age rather than a wrong one', calcAge('Not Known', T), '');
eq('blank gives none', calcAge('', T), '');
eq('a future date gives none', calcAge('31/12/2030', T), '');
eq('an impossible age gives none', calcAge('12/12/1843', T), '');

// ── AGE: every patient gets one, and no private copies remain ───────────────
const sgp = html.slice(html.indexOf('const setGlobalPat = p =>'), html.indexOf('const closePatientTab'));
ok('setGlobalPat fills age from the date of birth', /calcAge\(p\.dob/.test(sgp) && /age: a/.test(sgp), null);
ok('but never overwrites an age that was given', /!String\(p\.age \|\| ""\)\.trim\(\)/.test(sgp), null);
// A birthday-blind calculation subtracts years and stops there.
const blind = (html.match(/getFullYear\(\)\s*-\s*d\.getFullYear\(\)\s*;/g) || []).length +
              (html.match(/String\(new Date\(\)\.getFullYear\(\) - d\.getFullYear\(\)\)/g) || []).length;
eq('no birthday-blind age calculation is left in the app', blind, 0);

// ── TOOTH: register prefill carries a number ────────────────────────────────
{
  const from = html.indexOf('function clinicalSheetRegisterPrefill(');
  const fn = html.slice(from, html.indexOf('\n}\n', from) + 2);
  const prefill = new Function('CS_ITEMS_KEY', 'toISODate', fn + ';return clinicalSheetRegisterPrefill;')(
    { 'Crown Bridge': 'teeth', 'RCT': 'entries' }, () => '2026-09-21');
  eq('Crown & Bridge "Tooth 16" reaches the register as 16',
    prefill({ uhid: 'AL0777', sheetType: 'Crown Bridge', allTeeth: { teeth: [{ tooth: 'Tooth 16' }] } }).toothNo, '16');
  eq('a range stays a range',
    prefill({ uhid: 'AL0777', sheetType: 'Crown Bridge', allTeeth: { teeth: [{ tooth: '23–25' }] } }).toothNo, '23–25');
  eq('an unpicked "—" is not a tooth',
    prefill({ uhid: 'AL0777', sheetType: 'Crown Bridge', allTeeth: { teeth: [{ tooth: '—' }] } }).toothNo, '');
}

// ── TOOTH: the prescription's Teeth box ─────────────────────────────────────
(async () => {
  const m = /const PRESCRIPTION_FORM_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const file = path.join(OUT, 'rx.html');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));

  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];
  const fresh = async () => {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto('file://' + file);
    await page.waitForTimeout(300);
    return page;
  };
  const send = (page, procs) => page.evaluate(p => window.postMessage({ type: 'KB_TODAYS_PROCEDURES', procedures: p }, '*'), procs)
    .then(() => page.waitForTimeout(150));
  const teeth = page => page.evaluate(() => document.getElementById('teethText').value);

  let page = await fresh();
  await send(page, [{ treatmentRendered: 'RCT - BMP', toothNo: '36, 37', workDone: '4 canals' }]);
  eq('the register\'s tooth numbers fill the Teeth box', await teeth(page), '36, 37');
  ok('and still appear in the procedure text as before',
    (await page.evaluate(() => document.getElementById('procedureText').value)).includes('36, 37'), null);
  await page.close();

  // The real AE1110 entry: tooth column left empty, tooth written in Work Done.
  page = await fresh();
  await send(page, [{ treatmentRendered: 'Crown Provisional', toothNo: '', workDone: 'Provisional crown repaired wrt #24, #25, #27.' }]);
  eq('teeth written after "wrt" in Work Done are picked up', await teeth(page), '24, 25, 27');
  await page.close();

  // The real AG0120 entry: a wire size must not be read as a tooth.
  page = await fresh();
  await send(page, [{ treatmentRendered: '', toothNo: '', workDone: 'Bonding wrt 65,arch wire U 014 niti placed, religation in lower arch' }]);
  eq('only real FDI numbers after "wrt" count — the wire size is ignored', await teeth(page), '65');
  await page.close();

  page = await fresh();
  await send(page, [{ treatmentRendered: 'Consultation', toothNo: '', workDone: 'Advised surgical extraction 48' }]);
  eq('a number not introduced by "wrt" is not guessed at', await teeth(page), '');
  await page.close();

  page = await fresh();
  await send(page, [
    { treatmentRendered: 'X-Ray', toothNo: '46', workDone: 'RVG taken' },
    { treatmentRendered: 'RCT', toothNo: '46, 47', workDone: 'access opening' },
    { treatmentRendered: 'Crown', toothNo: 'Tooth 16', workDone: 'prep' },
  ]);
  eq('several entries are combined without repeats, "Tooth 16" read as 16', await teeth(page), '46, 47, 16');
  await page.close();

  page = await fresh();
  await page.evaluate(() => {
    const t = document.getElementById('teethText');
    t.value = '11'; t.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await send(page, [{ treatmentRendered: 'RCT', toothNo: '36', workDone: 'obturation' }]);
  eq('a Teeth box the doctor typed into is left alone', await teeth(page), '11');
  await page.close();

  eq('no uncaught page errors', errors, []);
  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('TOOTH NUMBER INTO THE PRESCRIPTION, AND AGE FROM DATE OF BIRTH');
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
