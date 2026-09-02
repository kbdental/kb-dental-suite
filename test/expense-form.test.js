// Checks the standalone Expense Entry page (expense.html) — the same form
// as the in-app Finance > Payments > Expense tab (FinanceExpenseSubTab),
// reachable on its own without opening the full clinical suite.
//
// Covers: the staff login gate (reusing the same staffLogin/authStatus
// session-token mechanism the main app uses, since saveExpense etc. carry
// real financial data and are not in the backend's PUBLIC_ACTIONS list),
// the form fields matching the in-app version field-for-field, adding a
// new payer/category inline, saving an expense, and the expense log/total.

const { chromium } = require('playwright');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

const checks = [];
const eq = (name, got, want) => checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, got: detail, want: 'truthy' });

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  let savedExpense = null;
  const employeesStore = { employees: [{ name: 'Reception Staff', phone: '', email: '', role: '' }] };
  const categoriesStore = { categories: ['Rent', 'Supplies'] };

  await page.route('https://script.google.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');
    let body = { success: true };
    if (action === 'authStatus') {
      // Auth IS required, and this session has no valid token yet — forces
      // the login screen to show, same as a real REQUIRE_AUTH=true deploy.
      const tok = url.searchParams.get('token');
      body = { success: true, authRequired: true, valid: tok === 'test-token-123' };
    } else if (action === 'staffLogin') {
      const pw = url.searchParams.get('password');
      body = pw === 'clinicpw' ? { success: true, token: 'test-token-123' } : { success: false, error: 'Wrong password' };
    } else if (action === 'getEmployeesList') body = { success: true, employees: employeesStore.employees };
    else if (action === 'getExpenseCategoriesList') body = { success: true, categories: categoriesStore.categories };
    else if (action === 'getPaymentModesList') body = { success: true, modes: ['Cash', 'UPI'] };
    else if (action === 'getExpenses') body = { success: true, expenses: savedExpense ? [savedExpense] : [] };
    else if (action === 'saveExpense') {
      const tok = url.searchParams.get('token');
      if (tok !== 'test-token-123') { body = { success: false, error: 'AUTH_REQUIRED', authRequired: true }; }
      else {
        savedExpense = {
          date: url.searchParams.get('date'), paidBy: url.searchParams.get('paidBy'),
          expenseName: url.searchParams.get('expenseName'), amount: Number(url.searchParams.get('amount')),
          mode: url.searchParams.get('mode'), remarks: url.searchParams.get('remarks')
        };
        body = { success: true, id: 'EXP-1' };
      }
    } else if (action === 'saveEmployeesList') {
      employeesStore.employees = JSON.parse(url.searchParams.get('employees'));
      body = { success: true };
    } else if (action === 'saveExpenseCategoriesList') {
      categoriesStore.categories = JSON.parse(url.searchParams.get('categories'));
      body = { success: true };
    } else body = { success: false, error: 'stub: not mocked: ' + action };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('file://' + path.join(REPO, 'expense.html'));
  await page.waitForSelector('#l-pw', { timeout: 10000 });

  // --- login gate ---------------------------------------------------------
  ok('login screen shown when auth is required and no valid token', await page.evaluate(() => document.body.textContent.includes('Staff Sign In')));
  await page.fill('#l-pw', 'wrongpw');
  await page.click('#l-go');
  await page.waitForFunction(() => document.body.textContent.includes('Wrong password'), { timeout: 10000 });
  ok('wrong password shows an error, stays on login', await page.evaluate(() => document.body.textContent.includes('Wrong password')));

  await page.fill('#l-pw', 'clinicpw');
  await page.click('#l-go');
  await page.waitForFunction(() => document.body.textContent.includes('Record an Expense'), { timeout: 10000 });
  ok('correct password reaches the expense form', await page.evaluate(() => document.body.textContent.includes('Record an Expense')));
  await page.waitForSelector('#f-paidby', { timeout: 10000 });

  // --- fields match the in-app FinanceExpenseSubTab -----------------------
  const bodyText = await page.evaluate(() => document.body.textContent);
  ok('has "Date of Expense" field', bodyText.includes('Date of Expense'));
  ok('has "Payment Done By" field', bodyText.includes('Payment Done By'));
  ok('has "Name of Expense" field', bodyText.includes('Name of Expense'));
  ok('has "Mode of Expense" field', bodyText.includes('Mode of Expense'));
  ok('has "Remarks (Detail of Expense)" field', bodyText.includes('Remarks (Detail of Expense)'));
  eq('Payment Done By is populated from getEmployeesList', await page.locator('#f-paidby option').allTextContents(),
    ['Select', 'Reception Staff']);
  eq('Name of Expense is populated from getExpenseCategoriesList', await page.locator('#f-expname option').allTextContents(),
    ['Select', 'Rent', 'Supplies']);

  // --- add a new payer and a new category inline ---------------------------
  await page.click('#f-newpayer-open');
  await page.fill('#f-newpayer', 'Dr. Mittel');
  await page.click('#f-newpayer-add');
  await page.waitForTimeout(200);
  eq('new payer becomes the selected value', await page.evaluate(() => document.getElementById('f-paidby').value), 'Dr. Mittel');

  await page.click('#f-newcat-open');
  await page.fill('#f-newcat', 'Lab Fees');
  await page.click('#f-newcat-add');
  await page.waitForTimeout(200);
  eq('new category becomes the selected value', await page.evaluate(() => document.getElementById('f-expname').value), 'Lab Fees');

  // --- required-field validation -------------------------------------------
  await page.click('#f-save');
  await page.waitForTimeout(200);
  ok('amount required — save blocked, no request sent yet', savedExpense === null);

  // --- fill and save --------------------------------------------------------
  await page.fill('#f-amount', '1500');
  await page.selectOption('#f-mode', 'Cash');
  await page.fill('#f-remarks', 'Monthly lab invoice');
  await page.click('#f-save');
  await page.waitForTimeout(400);

  ok('save succeeded (green confirmation shown)', await page.evaluate(() => document.body.textContent.includes('Saved!')));
  ok('saveExpense actually reached the backend with the right values', !!savedExpense);
  eq('saved paidBy', savedExpense && savedExpense.paidBy, 'Dr. Mittel');
  eq('saved expenseName', savedExpense && savedExpense.expenseName, 'Lab Fees');
  eq('saved amount', savedExpense && savedExpense.amount, 1500);
  eq('saved mode', savedExpense && savedExpense.mode, 'Cash');
  eq('saved remarks', savedExpense && savedExpense.remarks, 'Monthly lab invoice');

  // --- expense log reflects the save ---------------------------------------
  await page.waitForTimeout(300);
  const logText = await page.evaluate(() => document.body.textContent);
  ok('expense log shows the new entry', logText.includes('Lab Fees') && logText.includes('₹1,500'));
  ok('expense log shows a running total', logText.includes('1 expense') && logText.includes('Total'));

  eq('no uncaught page errors', errors, []);

  await browser.close();

  let pass = 0, fail = 0;
  console.log('\n' + '='.repeat(78));
  console.log('STANDALONE EXPENSE FORM (expense.html) — SAME AS THE IN-APP VERSION');
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
