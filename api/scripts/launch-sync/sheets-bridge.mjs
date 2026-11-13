// Transitional URL for the existing published, Sheets-backed website.
// Proxies public static assets only; never serves the local checkout or database.
import http from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const site = new URL('https://kbdental.github.io/kb-dental-suite/');

// Keep this bridge on the published frontend, with only the reproduced login
// race corrected. Refuse to patch if the upstream implementation has drifted.
export function patchPublishedLogin(html) {
  html = html.replaceAll('\r\n', '\n');
  const legacyHeader = html.includes('function handleAuthFailure(res) {\n  if (res && res.authRequired) {')
    ? 'function handleAuthFailure(res) {\n  if (res && res.authRequired) {'
    : 'function handleAuthFailure(res) {\n  if (res && res.success === false && res.authRequired) {';
  const changes = [
    [legacyHeader,
      'function handleAuthFailure(res, requestToken) {\n  if (res && res.success === false && res.authRequired) {\n    if (arguments.length > 1 && requestToken !== getSessionToken()) return res;'],
    ['return handleAuthFailure(sayIfBackendIsOld(await r.json()));',
      'return handleAuthFailure(sayIfBackendIsOld(await r.json()), tok);'],
    ['    const chunk = queue.slice(i, i + KB_BATCH_MAX);',
      '    const chunk = queue.slice(i, i + KB_BATCH_MAX);\n    const requestToken = getSessionToken();'],
    ['else q.resolve(handleAuthFailure(r));', 'else q.resolve(handleAuthFailure(r, requestToken));']
  ];
  const count = text => html.split(text).length - 1;
  if (html.includes('function handleAuthFailure(res, requestToken) {')) {
    if (!changes.every(([, replacement]) => count(replacement) === 1)) throw new Error('Published login implementation changed');
    return html;
  }
  for (const [original] of changes) {
    if (count(original) !== 1) throw new Error('Published login implementation changed');
  }
  for (const [original, replacement] of changes) html = html.replace(original, replacement);
  return html;
}

export async function checkLiveAuthentication(fetcher = fetch) {
  const page = await fetcher(site, {signal: AbortSignal.timeout(30000)});
  if (!page.ok) throw new Error('Published site is unavailable');
  const html = await page.text();
  patchPublishedLogin(html);
  const endpoints = [...new Set(html.match(/https:\/\/script[.]google[.]com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g) ?? [])];
  if (endpoints.length !== 2) throw new Error('Expected main and empanelled backends; published configuration needs review');
  const checks = [];
  for (let index = 0; index < endpoints.length; index++) {
    const response = await fetcher(endpoints[index] + '?action=authStatus', {signal: AbortSignal.timeout(30000)});
    const result = await response.json();
    checks.push({instance: index + 1, reachable: response.ok && result.success === true,
      authenticationRequired: result.authRequired === true, passwordConfigured: result.passwordSet === true});
  }
  return {ready: checks.every(check => check.reachable && check.authenticationRequired && check.passwordConfigured), loginPatchVerified: true, checks};
}

export function staticTarget(requestUrl) {
  const incoming = new URL(requestUrl, 'http://127.0.0.1');
  const target = new URL('.' + incoming.pathname + incoming.search, site);
  if (target.origin !== site.origin || !target.pathname.startsWith(site.pathname)) return null;
  return target;
}

export function createBridge(fetcher = fetch) {
  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, {Allow: 'GET, HEAD'}).end();
      return;
    }
    try {
      const target = staticTarget(request.url ?? '/');
      if (!target) { response.writeHead(404).end(); return; }
      const upstream = await fetcher(target, {method: request.method, redirect: 'manual', signal: AbortSignal.timeout(30000)});
      // No cookies, staff tokens or request headers are forwarded to GitHub.
      // Redirects cannot send the proxy to another origin or backend endpoint.
      if (upstream.status >= 300 && upstream.status < 400) { response.writeHead(502).end('Unexpected asset redirect'); return; }
      const contentType = upstream.headers.get('content-type');
      if (contentType) response.setHeader('Content-Type', contentType);
      let body;
      if (request.method !== 'HEAD') {
        const mainPage = target.pathname === site.pathname || target.pathname === site.pathname + 'index.html';
        if (mainPage && upstream.ok) {
          body = Buffer.from(patchPublishedLogin(await upstream.text()));
          response.setHeader('X-KB-Bridge-Mode', 'live-sheets-login-fix');
        } else body = Buffer.from(await upstream.arrayBuffer());
      }
      response.writeHead(upstream.status);
      response.end(body);
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end('The published website is temporarily unavailable.');
    }
  });
}

export async function main(args = process.argv.slice(2)) {
  const authentication = await checkLiveAuthentication();
  console.log(JSON.stringify({mode: 'sheets-backed-bridge', ...authentication}));
  if (!authentication.ready) {
    console.error('Bridge not started. Both Apps Script projects need REQUIRE_AUTH=true and an app password.');
    process.exitCode = 1;
    return;
  }
  if (args.includes('--check')) return;
  const server = createBridge();
  server.listen(8310, '127.0.0.1', () => console.log('Sheets-backed bridge listening on loopback port 8310. No database imports or writes enabled.'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Bridge preflight failed; no website published.'); process.exitCode = 1; });
}
