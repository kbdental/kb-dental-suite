// "give a format which would contain all the observation recorded and
//  investigation asked, diagnosis given and any plan advised"
//
// The four care plan pages are the full record: every finding the clinic
// examines, answered or not, across four sheets. That is what you file. It
// is not what you read at the start of the next visit, and it is not what
// you hand a patient or another dentist.
//
// One page of what was actually FOUND. Five rows, in the order a case is
// thought through: what they came with, what was seen, what was asked for,
// what it was called, what was advised.
//
// The whole thing turns on one filter. An untouched finding sits at
// healthy:false with no observation written -- "nobody looked", not
// "something is wrong". Print those and the Observations row becomes every
// row of the examination, which is the full record again and no summary at
// all. That is the test this file exists for.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; } else {
    fail++;
    console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + String(detail).slice(0, 400) : ''));
  }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

const a = html.indexOf('  function buildCPSummaryHTML() {');
ok('there is a summary builder at all', a > 0);
const src = html.slice(a, html.indexOf('\n  }\n', a) + 4);

const EXAM = {
  'Extra-Oral Check': [
    { finding: 'Jaw joints', kind: 'healthy', key: 'jawJoints' },
    { finding: 'Lymph nodes', kind: 'healthy', key: 'lymphNodes' },
    { finding: 'Facial asymmetry', kind: 'present', key: 'facialAsymmetry' }
  ],
  'Intra-Oral Check': [{ finding: 'Buccal mucosa', kind: 'healthy', key: 'buccalMucosa' }],
  'Gum Assessment': [{ finding: 'Gingival recession', kind: 'present', key: 'recession' }],
  'Wasting Disease': [{ finding: 'Attrition', kind: 'present', key: 'attrition' }],
  'Parafunctional Habits': [{ finding: 'Clenching note', kind: 'text', key: 'clenchNote' }],
  'Investigations Required': [
    { finding: 'IOPA', kind: 'check', key: 'iopa' },
    { finding: 'OPG', kind: 'check', key: 'opg' },
    { finding: 'Lateral Cephalogram', kind: 'check', key: 'latCeph' },
    { finding: 'MRI', kind: 'check', key: 'mri' }
  ],
  'Post Radiograph Findings': []
};

const build = (over) => {
  const ctx = {
    String, Object, Array, Number, console,
    CP_EXAM_SECTIONS: ['Extra-Oral Check', 'Intra-Oral Check', 'Gum Assessment',
      'Wasting Disease', 'Parafunctional Habits', 'Investigations Required',
      'Post Radiograph Findings'],
    examExtra: [], TODAY: '01/04/2025', window: { LOGO_B64: '' },
    signatureLine: () => 'Dr. Manika Mittel',
    // The real wrapper, which is what puts the form number on the page.
    pH: () => '', pW: (body, fn) => body + '<div class="foot"><span>' + fn + '</span></div>',
    examIn: (sec) => EXAM[sec] || [],
    pat: { name: 'Ms Archana', uhid: 'AI0311' },
    p1: Object.assign({ chiefComplaint: '', affectedArea: '', duration: '', aggravating: '',
      extraOral: '', intraOral: '', provisionalDiagnosis: '', treatments: [] }, (over || {}).p1),
    p2: Object.assign({ inv: { anyOther: '' } }, (over || {}).p2),
    p3: Object.assign({ provisionalDiagnosis: '', medCorrelation: '', specialNotes: '',
      iopa: '', opg: '', latCeph: '', cbct: '', digScan: '' }, (over || {}).p3),
    p4: Object.assign({ rows: [] }, (over || {}).p4)
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.go = buildCPSummaryHTML;', ctx);
  return ctx.go();
};
// The cell that follows a given row label.
const cellOf = (out, label) => {
  const i = out.indexOf('>' + label + '</th><td>');
  if (i < 0) return null;
  const from = i + ('>' + label + '</th><td>').length;
  return out.slice(from, out.indexOf('</td></tr>', from));
};
const items = (out, label) => {
  const c = cellOf(out, label);
  if (c === null) return null;
  if (c.indexOf('<ul') < 0) return c.indexOf('&mdash;') >= 0 ? [] : [c];
  return (c.match(/<li[^>]*>([\s\S]*?)<\/li>/g) || [])
    .map(x => x.replace(/<li[^>]*>/, '').replace('</li>', ''));
};

// ── the filter the whole page depends on ───────────────────────────────
{
  // Nothing examined. Every "healthy" finding is sitting at its default.
  const out = build({ p2: {
    jawJoints: { healthy: false, observation: '' },
    lymphNodes: { healthy: false, observation: '' },
    buccalMucosa: { healthy: false, observation: '' },
    facialAsymmetry: { present: false, area: '' },
    recession: { present: false, area: '' },
    attrition: { present: false, area: '' },
    inv: { anyOther: '' }
  } });
  eq('a finding nobody touched is not an observation', items(out, 'Observations'), []);
  eq('and the row says so rather than being missing', cellOf(out, 'Observations').indexOf('&mdash;') >= 0, true);
  // An empty care plan still prints a page, not an error.
  ['Complaints', 'Observations', 'Investigations', 'Diagnosis', 'Plan Advised']
    .forEach(l => ok('an empty plan still prints the ' + l + ' row', cellOf(out, l) !== null));
}

// ── what was seen ──────────────────────────────────────────────────────
{
  const out = build({
    p1: { chiefComplaint: 'P/C of sensitivity in upper right back region',
          affectedArea: 'Upper right posterior', extraOral: 'No facial swelling.' },
    p2: {
      jawJoints: { healthy: true, observation: '' },            // examined, normal
      lymphNodes: { healthy: false, observation: '' },          // never examined
      buccalMucosa: { healthy: false, observation: 'Cheek bite on the left' },
      facialAsymmetry: { present: false, area: '' },
      recession: { present: true, area: 'Class 1 generalised' },
      attrition: { present: true, area: '' },
      clenchNote: 'Night guard discussed',
      missingTeeth: { present: true, area: '#36' },
      decayedTeeth: { present: true, area: '#18, #38' },
      crowns: { present: false, area: '' },
      otherFindings: '#45 in cross bite.',
      inv: { anyOther: '' }
    }
  });
  const obs = items(out, 'Observations');
  eq('what was found, and only that', obs, [
    'Buccal mucosa: Cheek bite on the left',
    'Gingival recession — Class 1 generalised',
    'Attrition',
    'Clenching note: Night guard discussed',
    'Decayed teeth — #18, #38',
    'Missing teeth — #36',
    'Extra oral: No facial swelling.',
    '#45 in cross bite.'
  ]);
  ok('a finding examined and found normal is not listed as a problem',
     obs.every(x => x.indexOf('Jaw joints') < 0), JSON.stringify(obs));
  ok('and one never examined is not listed either',
     obs.every(x => x.indexOf('Lymph nodes') < 0), JSON.stringify(obs));
  ok('a present finding with no area written still reaches the page',
     obs.indexOf('Attrition') >= 0, JSON.stringify(obs));

  eq('the complaint, with what was asked about it', items(out, 'Complaints'),
     ['P/C of sensitivity in upper right back region', 'Affected area: Upper right posterior']);
}

// ── what was asked for ─────────────────────────────────────────────────
// Written the way it is written by hand, not as a list of ticks.
{
  const inv = (on, extra) => items(build({ p2: Object.assign({ inv: Object.assign({ anyOther: '' }, on) }, extra || {}) }), 'Investigations');
  eq('two ticked reads as a sentence', inv({ opg: true, latCeph: true }),
     ['Advised OPG and Lateral Cephalogram.']);
  eq('one ticked too', inv({ opg: true }), ['Advised OPG.']);
  eq('three ticked keeps the commas and the final and',
     inv({ iopa: true, opg: true, latCeph: true }),
     ['Advised IOPA, OPG and Lateral Cephalogram.']);
  eq('none ticked asks for nothing', inv({}), []);
  eq('blood work comes with what was asked of it',
     inv({ blood: true, bloodText: 'CBC, HbA1c' }), ['Blood examination — CBC, HbA1c.']);
  // Recorded since the field was added, and printed nowhere until now.
  eq('and the typed "any other investigation" is on the page at last',
     inv({ opg: true, anyOther: 'Pulp vitality test wrt 16.' }),
     ['Advised OPG.', 'Pulp vitality test wrt 16.']);
}
ok('that typed field now reaches the care plan sheet it belongs to as well',
   /Any Other Investigation<\/div><div class="val">\$\{p2\.inv\.anyOther\}/.test(html));

// ── what it was called, and what was advised ───────────────────────────
{
  eq('the diagnosis written on page 3 wins',
     items(build({ p1: { provisionalDiagnosis: 'Early caries' },
                   p3: { provisionalDiagnosis: 'Chronic generalised periodontitis' } }), 'Diagnosis'),
     ['Chronic generalised periodontitis']);
  eq('and page 1 answers when page 3 is blank',
     items(build({ p1: { provisionalDiagnosis: 'Early caries' } }), 'Diagnosis'), ['Early caries']);

  const out = build({
    p1: { treatments: [
      { option: 'Alignment of teeth', prognosis: 'Good', outcome: 'Corrected crowding', charges: '65,000' },
      { option: '', prognosis: '', outcome: '', charges: '' },
      { option: 'Replacement of #36' }
    ] },
    p3: { specialNotes: 'Advised alignment vs replacement.' },
    p4: { rows: [{ tooth: '36', procedure: 'Implant', details: 'after healing' },
                 { tooth: '', procedure: '', details: '' }] }
  });
  eq('every option advised, with the blank rows left out', items(out, 'Plan Advised'), [
    'Alignment of teeth · prognosis Good · Corrected crowding · ₹65,000',
    'Replacement of #36',
    '36 — Implant (after healing)',
    'Advised alignment vs replacement.'
  ]);
}

// ── it is a page, and it can be reached ────────────────────────────────
{
  const out = build({ p1: { chiefComplaint: 'Pain' } });
  ok('with the patient on it', out.indexOf('Ms Archana') >= 0 && out.indexOf('AI0311') >= 0);
  ok('and a form number of its own', out.indexOf('KBDC/FORMS/CS-01') >= 0);
  ok('and somewhere for the doctor to sign', out.indexOf('Signature of the Doctor') >= 0);
  // One item reads as a sentence; a list drawn round it is noise.
  eq('a single complaint is a sentence, not a one-item list',
     cellOf(out, 'Complaints'), 'Pain');
  // The cells carry whatever was typed into the care plan.
  eq('and what was typed is escaped',
     cellOf(build({ p1: { chiefComplaint: 'Pain <b>on</b> biting & cold' } }), 'Complaints'),
     'Pain &lt;b&gt;on&lt;/b&gt; biting &amp; cold');
}
ok('printing it is wired up', /which === "summary" \? buildCPSummaryHTML\(\)/.test(html));
eq('for the printer and the preview alike',
   (html.match(/which === "summary" \? buildCPSummaryHTML\(\)/g) || []).length, 2);
ok('and there is a button that asks for it',
   /onClick: \(\) => doPrint\("summary"\)/.test(html));

console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
