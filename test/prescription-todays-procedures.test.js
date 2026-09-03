// The Prescription pad auto-fills "today's procedure" from the Daily Register.
// It used to read `treatmentRendered || workDone`, but Procedure Done is a
// REQUIRED field in the register, so treatmentRendered is always set and the
// Work Done text could never appear. The tooth number was never carried over
// at all. These checks pin all three onto the pad.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'kbpresc-'));

function extract() {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const m = /const PRESCRIPTION_FORM_B64\s*=\s*([\s\S]*?);\n/.exec(html);
  if (!m) throw new Error('PRESCRIPTION_FORM_B64 not found in index.html');
  const b64 = (m[1].match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1)).join('');
  const p = path.join(OUT, 'prescription.html');
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });

(async () => {
  const file = extract();
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.goto('file://' + file);
  await page.waitForTimeout(200);

  const send = procedures => page.evaluate(procs => {
    window.postMessage({ type: 'KB_TODAYS_PROCEDURES', procedures: procs }, '*');
  }, procedures);
  const readText = () => page.evaluate(() => document.getElementById('procedureText').value);
  const readHint = () => page.evaluate(() => document.getElementById('todaysProcHint').textContent);
  const reset = () => page.evaluate(() => {
    const ta = document.getElementById('procedureText');
    ta.value = '';
    delete ta.dataset.touched;
  });

  // --- the reported bug: Work Done and Tooth No. both reach the pad ---------
  await send([{ treatmentRendered: 'RCT - BMP', toothNo: '36, 37', workDone: '4 canals MB & ML-21mm' }]);
  await page.waitForTimeout(120);
  let txt = await readText();
  ok('procedure done appears', txt.includes('RCT - BMP'), txt);
  ok('WORK DONE appears (regression: was swallowed by ||)', txt.includes('4 canals MB & ML-21mm'), txt);
  ok('TOOTH NO. appears (regression: was never carried over)', txt.includes('36, 37'), txt);

  // --- a register row with no tooth recorded still reads cleanly -----------
  await reset();
  await send([{ treatmentRendered: 'Consultation', toothNo: '', workDone: 'Advised surgical extraction 48' }]);
  await page.waitForTimeout(120);
  txt = await readText();
  ok('no tooth -> no empty "(Tooth )" fragment', !/\(Tooth\s*\)/.test(txt), txt);
  ok('work done still shown without a tooth', txt.includes('Advised surgical extraction 48'), txt);

  // --- older rows repeat the procedure in Work Done: do not print it twice --
  await reset();
  await send([{ treatmentRendered: 'Scaling', toothNo: '', workDone: 'Scaling' }]);
  await page.waitForTimeout(120);
  txt = await readText();
  ok('identical procedure/work done is not duplicated', txt === 'Scaling', txt);

  // --- several entries in one day are joined -------------------------------
  await reset();
  await send([
    { treatmentRendered: 'Consultation', toothNo: '', workDone: 'Examined' },
    { treatmentRendered: 'X-Ray', toothNo: '46', workDone: 'RVG taken' },
  ]);
  await page.waitForTimeout(120);
  txt = await readText();
  ok('multiple entries joined with ;', txt.split(';').length === 2, txt);
  ok('second entry keeps its tooth', txt.includes('46'), txt);

  // --- what the doctor typed is never overwritten --------------------------
  await reset();
  await page.evaluate(() => {
    const ta = document.getElementById('procedureText');
    ta.value = 'hand written by doctor';
    ta.dataset.touched = '1';
  });
  await send([{ treatmentRendered: 'RCT', toothNo: '11', workDone: 'obturation' }]);
  await page.waitForTimeout(120);
  txt = await readText();
  ok('a touched field is left alone', txt === 'hand written by doctor', txt);

  // --- nothing logged today ------------------------------------------------
  await reset();
  await send([]);
  await page.waitForTimeout(120);
  ok('empty list shows the "type it in" hint', (await readHint()).includes('No procedure logged'), await readHint());

  ok('no uncaught page errors', errors.length === 0, errors.join(' | '));

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log("PRESCRIPTION — TODAY'S PROCEDURE CARRIES PROCEDURE + TOOTH + WORK DONE");
  console.log('='.repeat(78));
  for (const c of checks) {
    c.ok ? pass++ : fail++;
    console.log((c.ok ? '  PASS  ' : '  FAIL  ') + c.name +
      (c.ok ? '' : `\n          got ${JSON.stringify(c.got)}`));
  }
  console.log('='.repeat(78));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(78) + '\n');
  process.exit(fail ? 1 : 0);
})();
