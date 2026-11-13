import test from 'node:test';
import assert from 'node:assert/strict';
import {checkLiveAuthentication, staticTarget, patchPublishedLogin, createBridge} from './sheets-bridge.mjs';

const oldLogin = `function handleAuthFailure(res) {
  if (res && res.success === false && res.authRequired) {
    setSessionToken("");
  }
}
return handleAuthFailure(sayIfBackendIsOld(await r.json()));
    const chunk = queue.slice(i, i + KB_BATCH_MAX);
          else q.resolve(handleAuthFailure(r));`;

test('bridge applies only the checked login-race patch and accepts its own result', () => {
  const patched = patchPublishedLogin(oldLogin);
  assert.ok(patched.includes('requestToken !== getSessionToken()'));
  assert.ok(patched.includes('handleAuthFailure(r, requestToken)'));
  assert.equal(patchPublishedLogin(patched), patched);
});

test('bridge refuses a partial or unexpected published login implementation', () => {
  assert.throws(() => patchPublishedLogin(oldLogin.replace('handleAuthFailure(r)', 'unexpected(r)')), /Published login implementation changed/);
});

test('bridge also corrects the published page treating successful authStatus as a rejection', () => {
  const published = oldLogin.replace('res && res.success === false && res.authRequired', 'res && res.authRequired');
  const patched = patchPublishedLogin(published);
  assert.ok(patched.includes('res && res.success === false && res.authRequired'));
});

function fakeSource(auth) {
  let request = 0;
  return async (url, options) => {
    if (request++ === 0) return {ok: true, text: async () =>
      oldLogin + '\nhttps://script.google.com/macros/s/fictional-main/exec https://script.google.com/macros/s/fictional-panel/exec'};
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(new URL(url).searchParams.get('action'), 'authStatus');
    assert.equal(options.body, undefined);
    const result = auth.shift();
    return {ok: true, json: async () => result};
  };
}

test('bridge refuses disabled main or panel authentication', async () => {
  const result = await checkLiveAuthentication(fakeSource([
    {success: true, authRequired: false, passwordSet: true},
    {success: true, authRequired: true, passwordSet: true}
  ]));
  assert.equal(result.ready, false);
});

test('bridge refuses a missing panel password', async () => {
  const result = await checkLiveAuthentication(fakeSource([
    {success: true, authRequired: true, passwordSet: true},
    {success: true, authRequired: true, passwordSet: false}
  ]));
  assert.equal(result.ready, false);
});

test('bridge accepts both protected live backends', async () => {
  const result = await checkLiveAuthentication(fakeSource([
    {success: true, authRequired: true, passwordSet: true},
    {success: true, authRequired: true, passwordSet: true}
  ]));
  assert.equal(result.ready, true);
});

test('static proxy is restricted to the published site and never local files', () => {
  assert.equal(staticTarget('/register.html?clinic=empanelled').href,
    'https://kbdental.github.io/kb-dental-suite/register.html?clinic=empanelled');
  assert.equal(staticTarget('/../../private.json').href, 'https://kbdental.github.io/kb-dental-suite/private.json');
  assert.equal(staticTarget('/%252e%252e/private.json').origin, 'https://kbdental.github.io');
  assert.equal(staticTarget('https://example.invalid/private.json').origin, 'https://kbdental.github.io');
});

test('HTTP bridge serves the corrected page and never forwards a POST or credentials', async t => {
  const forwarded = [];
  const server = createBridge(async (url, options) => {
    forwarded.push({url: String(url), options});
    return new Response(oldLogin, {status: 200, headers: {'content-type': 'text/html'}});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const page = await fetch(url, {headers: {authorization: 'fictional-secret', cookie: 'fictional-cookie'}});
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-kb-bridge-mode'), 'live-sheets-login-fix');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.ok((await page.text()).includes('requestToken !== getSessionToken()'));
  assert.equal(forwarded[0].options.headers, undefined);
  const rejected = await fetch(url, {method: 'POST', body: '{"action":"fictional-write"}'});
  assert.equal(rejected.status, 405);
  assert.equal(forwarded.length, 1);
});
