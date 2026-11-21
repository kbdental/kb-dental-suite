// "how many prompts you would require to let the age and gender come
//  automatically in the prescription"
//
// A fair question after two goes at it. Both were aimed at the wrong
// thing.
//
// The pad is an iframe. The app posts it a KB_PATIENT message and the pad
// fills its boxes from that. Round one added `age` and `gender` to the
// message; round two found a SECOND pad doing the same and fixed that one
// too. Both were right, and neither helped, because the fault is one step
// further back: the message is built from `globalPat`, and `globalPat` is
// whatever the screen that opened the patient had to hand.
//
//   Patient Search  -> uhid, name, dob, gender, mobile
//   Clinical sheets -> uhid, name, dob          (no gender, ever)
//   Day sheet's "no record saved" warning -> uhid, name
//
// All three are a valid patient as far as the app is concerned. So the
// same patient opened one way printed an age and opened another way did
// not, and nothing on screen said why.
//
// The registration has both. The pads now ask it, and this test proves it
// end to end: the REAL prescription form, in an iframe, handed the kind of
// thin record the day sheet produces -- and the age and the gender appear
// in its own boxes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b, html.indexOf(a)));

// ── asked in one place, used in all three ──────────────────────────────
ok('there is one way to top a patient up, not three',
   /function useFullPatient\(globalPat\) \{/.test(html));
ok('it reads the registration', /api\("getPatient", \{ uhid \}\)/.test(html));
ok('and a blank in the register never wipes what the screen already had',
   /if \(v !== undefined && v !== null && String\(v\)\.trim\(\) !== ""\) out\[k\] = v;/.test(html));
ok('the prescription pad uses it', /const fullPat = useFullPatient\(globalPat\);[\s\S]{0,4000}?function Prescription/.test(html)
   || /function Prescription\(\{ globalPat \}\) \{[\s\S]{0,400}?const fullPat = useFullPatient\(globalPat\);/.test(html));
ok('the clinical record forms use it',
   /function ClinicalRecords\(\{ globalPat, setGlobalPat \}\) \{[\s\S]{0,2000}?const fullPat = useFullPatient\(globalPat\);/.test(html));
ok('and the panel screens, which kept their own copy of the same idea',
   /const pat = useFullPatient\(globalPat\);/.test(html)
   && !/const \[full, setFull\] = React\.useState\(null\);[\s\S]{0,600}?setNotePlan/.test(html));
// Keyed on the UHID alone, the resend never fired when the register
// answered a moment later -- which is the whole point of asking it.
ok('the pad is told again when the register answers',
   /fullPat \? String\(fullPat\.dob \|\| fullPat\.DOB \|\| fullPat\.age \|\| ""\) : ""/.test(html));

// ── the real form, in an iframe, handed a thin record ──────────────────
const FORM = (() => {
  const ctx = { atob: (b) => Buffer.from(b, 'base64').toString('binary'),
                Uint8Array, TextDecoder, console, String, Object, Array };
  vm.createContext(ctx);
  const a = html.indexOf('const PRESCRIPTION_FORM_B64 =');
  vm.runInContext(html.slice(a, html.indexOf(';\n', a) + 1)
    + html.slice(html.indexOf('function b64decode('), html.indexOf('function getCRMUrl('))
    + '\nthis.out = b64decode(PRESCRIPTION_FORM_B64);', ctx);
  return ctx.out;
})();

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0"><div id="root"></div></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const errors = [];

  // One origin for the harness and the form, so the test can read inside
  // the iframe the way the pad's own code writes into it.
  const serve = async (page) => {
    await page.route('http://kb.test/**', (route) => {
      const u = route.request().url();
      if (/rx-form\.html$/.test(u)) return route.fulfill({ contentType: 'text/html', body: FORM });
      return route.fulfill({ contentType: 'text/html', body: HARNESS });
    });
  };

  // `register` is what getPatient answers with; null means it never does.
  const run = async (globalPat, register) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', e => errors.push(String((e && e.message) || e)));
    await serve(page);
    await page.goto('http://kb.test/harness.html');
    for (const f of ['node_modules/react/umd/react.production.min.js',
                     'node_modules/react-dom/umd/react-dom.production.min.js'])
      await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, f), 'utf8') });

    await page.addScriptTag({ content: `
      const T="#0078B4", BORDER="#e5e5e0", BGS="#f5f5f0";
      window.__register = ${JSON.stringify(register)};
      const api = (action, p) => {
        if (action === "getPatient")
          return Promise.resolve(window.__register
            ? { success:true, patient: window.__register } : { success:false });
        if (action === "getTreatmentProgress") return Promise.resolve({ success:true, entries:[] });
        return Promise.resolve({ success:true });
      };
      const getDoctors = () => Promise.resolve([]);
      const treatingDoctorFor = () => Promise.resolve("");
      const useHindiOut = () => [false, () => {}];
      const hindiOf = (x) => x, hindiNote = (x) => x;
      const ClinicHeader = () => null;
      const getPrescriptionFormUrl = () => "http://kb.test/rx-form.html";
    ` });
    await page.addScriptTag({ content: cut('function calcAge(dob, today) {', 'function togArr(') });
    await page.addScriptTag({ content: cut('function toISODate(d) {', '\nfunction ') });
    await page.addScriptTag({ content: cut('function useFullPatient(globalPat) {', 'function usePadMargins()') });
    await page.addScriptTag({ content: cut('function Prescription({ globalPat }) {', '\n// ── Finance —') });

    await page.evaluate((gp) => {
      ReactDOM.createRoot(document.getElementById('root'))
        .render(React.createElement(Prescription, { globalPat: gp }));
    }, globalPat);
    // The iframe loads, the register answers, the pad re-sends.
    await page.waitForTimeout(1200);
    const out = await page.evaluate(() => {
      const f = document.querySelector('iframe');
      const d = f && f.contentDocument;
      if (!d) return null;
      const v = (id) => { const el = d.getElementById(id); return el ? String(el.value || '') : null; };
      return { name: v('pName'), uhid: v('pId'), age: v('pAge'), gender: v('pGender') };
    });
    await page.close();
    return out;
  };

  // The day sheet's warning hands over exactly this much, and nothing on
  // the pad can tell that it is not a whole patient.
  const THIN = { uhid: 'AB1114', name: 'Mamta Dhembla' };
  const REG = { name: 'Mamta Dhembla', dob: '14/05/1979', gender: 'Female',
                mobile: '9810000000', address: 'Dilshad Garden' };
  const thisYear = new Date();
  const want = String(thisYear.getFullYear() - 1979 -
    ((thisYear.getMonth() + 1 < 5 || (thisYear.getMonth() + 1 === 5 && thisYear.getDate() < 14)) ? 1 : 0));

  {
    const r = await run(THIN, REG);
    eq('the name still arrives, as it always did', r && r.name, 'Mamta Dhembla');
    eq('and the UHID', r && r.uhid, 'AB1114');
    eq('the age is on the pad, off a record that never carried one', r && r.age, want);
    eq('and so is the gender', r && r.gender, 'Female');
  }

  // A patient opened through Patient Search already has both. The top-up
  // must not disturb that, or this trades one blank pad for another.
  {
    const r = await run({ uhid: 'AB1114', name: 'Mamta Dhembla', dob: '14/05/1979', gender: 'Female' }, REG);
    eq('a record that already had them is unchanged', [r && r.age, r && r.gender], [want, 'Female']);
  }

  // The register not answering is the state the pad is in for the first
  // second of every visit, and after a sheet read fails.
  {
    const r = await run({ uhid: 'AB1114', name: 'Mamta Dhembla', dob: '14/05/1979', gender: 'Male' }, null);
    eq('with no answer from the register the screen\'s own record is used',
       [r && r.name, r && r.age, r && r.gender], ['Mamta Dhembla', want, 'Male']);
  }
  {
    const r = await run(THIN, null);
    eq('and a thin record with nothing to fall back on still opens the pad',
       [r && r.name, r && r.age, r && r.gender], ['Mamta Dhembla', '', '']);
  }

  eq('nothing threw', errors, []);
  await browser.close();

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
})();
