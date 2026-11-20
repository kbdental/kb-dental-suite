// "the age and gender are not coming automatically in prescription and
//  also check the doctor name even after we have entered earlier"
//
// Three separate faults behind one complaint, and each needed its own
// cause finding:
//
//   age     A loaded patient carries a DATE OF BIRTH. There is no `age`
//           on it and never was, so the pad was sent "" every time and
//           the form -- which only writes a value when it is given one --
//           left the box empty. Every prescription ever printed had no
//           age on it.
//
//   gender  The box is a <select>. Assigning a value that is not one of
//           its options selects NOTHING, so the box goes blank. The sheet
//           holds what has been typed into it over the years: "Male"
//           worked, "male" and "M" printed nothing at all.
//
//   doctor  The patient push wrote getDoctors()[0] -- the first name in
//           the master list -- into the box. The doctor path that follows
//           reads any value already there as a choice somebody made, and
//           keeps it. So the treating doctor was overwritten by whoever
//           happened to be first, on every pad.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const checks = [];
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail });
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

// ── the three causes, at the source ────────────────────────────────────
const RX = html.slice(html.indexOf('function Prescription({ globalPat }) {'),
                      html.indexOf('// ── Finance —'));
ok('the age is worked out from the date of birth the patient actually has',
   /age: calcAge\(globalPat\.dob \|\| globalPat\.DOB\) \|\| ""/.test(RX));
ok('and the patient push no longer names a doctor at all',
   !/doctor: getDoctors\(\)\[0\]/.test(RX), (RX.match(/doctor:.*/) || [])[0]);
ok('the pad follows the patient, not just the first one it opened on',
   /sendPatientToForm\(\);\s*\n\s*sendDoctorsToForm\(globalPat\.uhid\);/.test(RX));

const FORM = (() => {
  const a = html.indexOf('const PRESCRIPTION_FORM_B64 =');
  return Buffer.from(html.slice(a, html.indexOf(';\n', a) + 1)
    .match(/"([A-Za-z0-9+/=]*)"/g).map(s => s.slice(1, -1)).join(''), 'base64').toString('utf8');
})();
ok('the gender is matched against the options the box has',
   /function setGenderValue\(v\)\{/.test(FORM));
ok('and the form ignores a doctor sent with the patient',
   /d\.doctor is ignored/.test(FORM) && !/if \(d\.doctor\) sv\('pDoc'/.test(FORM));

// ── and in the running app ─────────────────────────────────────────────
const LOCAL = {
  'react/18.2.0/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom/18.2.0/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js'
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const errors = [];

  const open = async (pat) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on('pageerror', e => errors.push(String((e && e.message) || e)));
    await page.route('**cdnjs.cloudflare.com/**', r => {
      const u = r.request().url();
      const h = Object.keys(LOCAL).find(k => u.indexOf(k) >= 0);
      return r.fulfill({ status: 200, contentType: 'application/javascript',
        body: h ? fs.readFileSync(path.join(REPO, LOCAL[h]), 'utf8') : '/* */' });
    });
    await page.route('**script.google.com/**', r => {
      const body = r.request().postData() || r.request().url();
      let out = { success: true };
      // Manika is FIRST in the master list...
      if (/getDoctor/.test(body)) out = { success: true,
        doctors: [{ name: 'Dr. Manika Mittel' }, { name: 'Dr. Viveyk Mittel' }],
        rows: [{ name: 'Dr. Manika Mittel' }, { name: 'Dr. Viveyk Mittel' }] };
      // ...but this patient is being seen today by Viveyk.
      if (/getAppointments/.test(body)) out = { success: true, appointments: [
        { uhid: 'AH0713', doctor: 'Dr. Viveyk Mittel', status: 'Engaged',
          time: '10:00', checkinTime: '09:55', engagedTime: '10:02' }] };
      if (/getTreatmentProgress|getMedicine|getClinicProfile|getMasterList/.test(body))
        out = { success: true, entries: [], medicines: [], profile: {}, list: [] };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    });
    await page.goto('file://' + path.join(REPO, 'index.html'));
    await page.waitForTimeout(2300);
    await page.evaluate((p) => {
      window.KB_DOCTORS = ['Dr. Manika Mittel', 'Dr. Viveyk Mittel'];
      ReactDOM.render(React.createElement(Prescription, { globalPat: p }),
        document.getElementById('root'));
    }, pat);
    await page.waitForTimeout(3200);
    const fr = page.frames().find(f => f !== page.mainFrame());
    const got = fr ? await fr.evaluate(() => ({
      name: (document.getElementById('pName') || {}).value,
      age: (document.getElementById('pAge') || {}).value,
      gender: (document.getElementById('pGender') || {}).value,
      doctor: (document.getElementById('pDoc') || {}).value
    })) : null;
    await page.close();
    return got;
  };

  const PAT = { uhid: 'AH0713', name: 'Altaf Ahmed Sikunder', dob: '03/04/1972', gender: 'Male' };

  {
    const g = await open(PAT);
    eq('the patient reaches the pad', [g.name], ['Altaf Ahmed Sikunder']);
    // Worked out from the date of birth, because that is all there is.
    ok('the age is filled in', /^\d{1,3}$/.test(String(g.age)), g.age);
    eq('the gender with it', g.gender, 'Male');
    // The point: Manika is first in the list, Viveyk is treating today.
    eq('and the doctor is the one treating, not the first on the list',
       g.doctor, 'Dr. Viveyk Mittel');
  }

  // Whatever spelling the sheet happens to hold.
  for (const [stored, want] of [['male', 'Male'], ['M', 'Male'],
                                ['FEMALE', 'Female'], ['female', 'Female']]) {
    const g = await open(Object.assign({}, PAT, { gender: stored }));
    eq('a gender stored as "' + stored + '" still reaches the pad', g.gender, want);
  }
  // Nothing recorded stays nothing, rather than guessing at one.
  {
    const g = await open(Object.assign({}, PAT, { gender: '' }));
    eq('no gender recorded leaves the box alone', g.gender, '');
    ok('but the age is still there', /^\d{1,3}$/.test(String(g.age)), g.age);
  }
  // A patient with no date of birth cannot have an age, and must not get
  // a made-up one.
  {
    const g = await open({ uhid: 'AH0713', name: 'No Birthday', dob: '', gender: 'Male' });
    eq('no date of birth, no age invented', g.age, '');
    eq('and the rest still arrives', [g.name, g.gender], ['No Birthday', 'Male']);
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
