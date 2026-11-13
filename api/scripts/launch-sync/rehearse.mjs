// Private source capture and reconciliation against a NEW isolated database copy.
// Never changes the source DB, Sheets, running app, or shared test database.
import {readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {SheetsSource, digest, registrationInventory, tableRows} from './source.mjs';
import {sourceSummary} from './compare.mjs';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const privateRoot = join(apiRoot, '.organization-demo-runtime', 'launch-sync');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
export const validCopyName = value => /^kb_launch_sync_test_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/.test(value);

function privateDirectory(path) {
  mkdirSync(path, {recursive: true, mode: 0o700});
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {encoding: 'utf8', windowsHide: true}).match(/S-1-[0-9-]+/)?.[0];
    if (!sid) throw new Error('Cannot determine current Windows user');
    execFileSync('icacls', [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], {stdio: 'ignore', windowsHide: true});
  }
}

async function fingerprint(client) {
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result = {};
  for (const {tablename} of tables) {
    // Compare in the server: no patient values or per-patient hashes leave SQL.
    const row = (await client.query(`SELECT count(*)::int AS rows,
      md5(coalesce(string_agg(h,'' ORDER BY h),'')) AS checksum
      FROM (SELECT md5(row_to_json(t)::text) AS h FROM public.${quote(tablename)} t) s`)).rows[0];
    result[tablename] = row;
  }
  return result;
}

async function cloneReview() {
  const state = JSON.parse(readFileSync(join(apiRoot, '.organization-demo-runtime/realdata-review/state.json'), 'utf8'));
  const password = readFileSync(join(homedir(), '.kb-pms/postgres-superuser.txt'), 'utf8').trim();
  const adminConfig = {host: '127.0.0.1', port: 5432, user: 'postgres', password};
  const source = new pg.Client({...adminConfig, database: 'kb_realdata_review'});
  const admin = new pg.Client({...adminConfig, database: 'postgres'});
  const suffix = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const database = `kb_launch_sync_test_${suffix.slice(0, 8)}_${suffix.slice(8)}_${randomUUID().replaceAll('-', '').slice(0, 6)}`;
  if (!validCopyName(database)) throw new Error('Invalid isolated copy name');
  const marker = 'kb-launch-sync-test:' + randomUUID();
  const dump = join(privateRoot, database + '.dump');
  const bin = process.env.KB_PG_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
  const childEnv = {...process.env, PGHOST: adminConfig.host, PGPORT: '5432', PGUSER: 'postgres', PGPASSWORD: password};
  await source.connect();
  await admin.connect();
  try {
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actual = (await source.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0].marker;
    if (!actual || actual !== state.marker) throw new Error('Review source database marker mismatch');
    const before = await fingerprint(source);
    const snapshot = (await source.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    execFileSync(join(bin, 'pg_dump.exe'), ['--format=custom', '--no-owner', '--no-privileges',
      '--snapshot=' + snapshot, '--file=' + dump, 'kb_realdata_review'],
    {env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024});
    // Only CREATE a new uniquely named DB. Never replace or drop any database.
    await admin.query(`CREATE DATABASE ${quote(database)} OWNER postgres`);
    await admin.query(`REVOKE ALL ON DATABASE ${quote(database)} FROM PUBLIC`);
    await admin.query(`COMMENT ON DATABASE ${quote(database)} IS ${literal(marker)}`);
    execFileSync(join(bin, 'pg_restore.exe'), ['--exit-on-error', '--no-owner', '--no-privileges',
      '--clean', '--if-exists', '--dbname=' + database, dump],
    {env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024});
    const target = new pg.Client({...adminConfig, database});
    await target.connect();
    try {
      const after = await fingerprint(target);
      if (digest(before) !== digest(after)) throw new Error('Database copy verification failed');
      const sessions = (await target.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('sessions','org_sessions')")).rows;
      for (const {tablename} of sessions) await target.query(`DELETE FROM public.${quote(tablename)}`);
      await target.query('CREATE SCHEMA launch_sync');
      await target.query('REVOKE ALL ON SCHEMA launch_sync FROM PUBLIC');
      await target.query(`CREATE TABLE launch_sync.runs (
        id uuid PRIMARY KEY, started_at timestamptz NOT NULL, completed_at timestamptz,
        source_hash text, summary jsonb NOT NULL DEFAULT '{}'::jsonb)`);
      await target.query(`CREATE TABLE launch_sync.workbooks (
        run_id uuid NOT NULL REFERENCES launch_sync.runs(id), source_id text NOT NULL,
        source_role text NOT NULL, metadata jsonb NOT NULL, PRIMARY KEY(run_id,source_id))`);
      await target.query(`CREATE TABLE launch_sync.tabs (
        run_id uuid NOT NULL, source_id text NOT NULL, tab_id int NOT NULL,
        title text NOT NULL, content_hash text NOT NULL, cells jsonb NOT NULL, raw_cells jsonb NOT NULL,
        PRIMARY KEY(run_id,source_id,tab_id),
        FOREIGN KEY(run_id,source_id) REFERENCES launch_sync.workbooks(run_id,source_id))`);
      writeFileSync(join(privateRoot, 'copy-state.json'), JSON.stringify({database, marker,
        sourceDatabase: 'kb_realdata_review', sourceTablesVerified: Object.keys(before).length,
        sourceRowsVerified: Object.values(before).reduce((n, table) => n + table.rows, 0),
        createdAt: new Date().toISOString(), applicationTablesUpdated: false}, null, 2), {mode: 0o600});
    } finally { await target.end(); }
    await source.query('COMMIT');
    unlinkSync(dump);
    console.log(`Isolated database copied and verified: ${Object.keys(before).length} tables.`);
    return {database, marker, adminConfig};
  } finally {
    await source.end();
    await admin.end();
  }
}

function requiredSources(discovered) {
  const script = readFileSync(join(apiRoot, '../apps-script/out/Code.gs'), 'utf8');
  const fromScript = name => script.match(new RegExp('var ' + name + ' = "([^"]+)"'))?.[1];
  const clinical = discovered.filter(book => /clinical records/i.test(book.name));
  if (clinical.length !== 1) throw new Error('Need exactly one shared clinical-records workbook');
  const sources = [
    {role: 'main', id: fromScript('MAIN_PMS_SHEET_ID')},
    {role: 'finance', id: fromScript('FINANCE_SHEET_ID_DEFAULT')},
    {role: 'empanelled', id: fromScript('PANEL_PMS_SHEET_ID')},
    {role: 'clinical', id: clinical[0].id},
    {role: 'historical-registration', id: fromScript('OLD_REG_SHEET_ID')}
  ];
  if (sources.some(book => !book.id) || new Set(sources.map(book => book.id)).size !== sources.length) {
    throw new Error('Incomplete or ambiguous source inventory');
  }
  return sources;
}

async function captureSources(client, sources) {
  const baseline = new Map();
  for (const source of sources) baseline.set(source.id, (await client.version(source.id)).version);
  const books = [];
  for (const source of sources) {
    const book = {...await client.capture(source.id), role: source.role};
    books.push(book);
    console.log(`Read ${source.role}: ${book.tabs.length} tabs; ${book.tabs.reduce((n, tab) => n + tableRows(tab).length, 0)} data rows.`);
  }
  for (const source of sources) {
    if (String(baseline.get(source.id)) !== String((await client.version(source.id)).version)) {
      throw new Error('Source changed during the multi-workbook capture; retry in a quiet interval');
    }
  }
  return books;
}

async function analyzeCopy() {
  const copy = JSON.parse(readFileSync(join(privateRoot, 'copy-state.json'), 'utf8'));
  if (!validCopyName(copy.database)) throw new Error('Invalid isolated database target');
  const target = new pg.Client({host: '127.0.0.1', port: 5432, database: copy.database, user: 'postgres',
    password: readFileSync(join(homedir(), '.kb-pms/postgres-superuser.txt'), 'utf8').trim()});
  await target.connect();
  try {
    await target.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const marker = (await target.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0].marker;
    if (!copy.marker?.startsWith('kb-launch-sync-test:') || marker !== copy.marker) throw new Error('Test database marker mismatch');
    const runs = (await target.query('SELECT id,summary FROM launch_sync.runs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 2')).rows;
    if (!runs.length) throw new Error('No captured source run in test copy');
    const rows = (await target.query(`SELECT w.source_role,w.source_id,w.metadata,t.tab_id,t.title,t.cells,t.raw_cells
      FROM launch_sync.tabs t JOIN launch_sync.workbooks w USING(run_id,source_id)
      WHERE t.run_id=$1 ORDER BY w.source_role,t.tab_id`, [runs[0].id])).rows;
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.source_id)) grouped.set(row.source_id, {id: row.source_id, role: row.source_role, tabs: []});
      grouped.get(row.source_id).tabs.push({id: row.tab_id, title: row.title, rows: row.cells, rawRows: row.raw_cells});
    }
    const books = [...grouped.values()];
    const coverage = sourceSummary(books);
    const identifiers = new Set((await target.query('SELECT upper(uhid) AS uhid FROM public.patients WHERE deleted_at IS NULL')).rows.map(row => row.uhid));
    let displayedTabsChangedSincePreviousCapture = null;
    if (runs.length === 2) {
      displayedTabsChangedSincePreviousCapture = Number((await target.query(`SELECT count(*) AS n FROM launch_sync.tabs current
        LEFT JOIN launch_sync.tabs previous ON previous.run_id=$2 AND previous.source_id=current.source_id AND previous.tab_id=current.tab_id
        WHERE current.run_id=$1 AND current.cells IS DISTINCT FROM previous.cells`, [runs[0].id, runs[1].id])).rows[0].n);
    }
    const report = {...runs[0].summary, financeImportFromInclusive: '2024-04-01', sourceCoverage: coverage.summary,
      comparison: {...runs[0].summary.comparison,
        databaseIdentifiersPresentInExaminedSources: [...identifiers].filter(id => coverage.identities.has(id)).length,
        databaseIdentifiersAbsentFromExaminedSources: [...identifiers].filter(id => !coverage.identities.has(id)).length,
        sourceIdentifiersMissingFromDatabase: [...coverage.identities.keys()].filter(id => !identifiers.has(id)).length,
        displayedTabsChangedSincePreviousCapture}};
    // Old pre-finance/CRM coverage names must not survive in the current report.
    delete report.comparison.databaseIdentifiersPresentInAnyPatientOrCareSource;
    delete report.comparison.databaseIdentifiersAbsentFromAllPatientAndCareSources;
    // The first capture stored display cells only; adding raw cells changed the
    // capture hash format. Do not misreport that as 150 edited source tabs.
    delete report.comparison.changedTabs;
    delete report.comparison.unchangedTabs;
    await target.query('COMMIT');
    writeFileSync(join(privateRoot, 'latest-summary.json'), JSON.stringify(report, null, 2), {mode: 0o600});
    console.log(JSON.stringify(report));
  } finally { await target.end(); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--analyze-copy')) {
    privateDirectory(privateRoot);
    return analyzeCopy();
  }
  const credentialIndex = args.indexOf('--credentials');
  if (credentialIndex < 0 || !args[credentialIndex + 1]) {
    throw new Error('Usage: node scripts/launch-sync/rehearse.mjs --credentials <private JSON> [--apply-copy|--reuse-copy]');
  }
  if (args.includes('--apply-copy') && args.includes('--reuse-copy')) throw new Error('Choose create or reuse, not both');
  privateDirectory(privateRoot);
  const client = new SheetsSource(resolve(args[credentialIndex + 1]));
  const sources = requiredSources(await client.discover());
  const books = await captureSources(client, sources);
  const registration = registrationInventory(books.filter(book => ['main', 'empanelled'].includes(book.role)));
  const coverage = sourceSummary(books);
  const summary = {capturedAt: new Date().toISOString(), sourceAuthoritative: true,
    financeImportFromInclusive: '2024-04-01',
    sourceWorkbooks: books.length, tabs: books.reduce((n, book) => n + book.tabs.length, 0),
    dataRows: books.reduce((n, book) => n + book.tabs.reduce((n, tab) => n + tableRows(tab).length, 0), 0),
    registrations: registration.summary, sourceCoverage: coverage.summary,
    stagingOnly: true, applicationTablesUpdated: false, scheduleEnabled: false};
  if (!args.includes('--apply-copy') && !args.includes('--reuse-copy')) {
    writeFileSync(join(privateRoot, 'source-preview-summary.json'), JSON.stringify(summary, null, 2), {mode: 0o600});
    console.log(JSON.stringify(summary));
    return;
  }
  let copy;
  if (args.includes('--apply-copy')) {
    if (existsSync(join(privateRoot, 'copy-state.json'))) throw new Error('A test copy already exists; use --reuse-copy');
    copy = await cloneReview();
  } else {
    copy = JSON.parse(readFileSync(join(privateRoot, 'copy-state.json'), 'utf8'));
    if (!validCopyName(copy.database)) throw new Error('Invalid isolated database target');
    const runtimeFile=join(privateRoot,'runtime-state.json');
    const runtime=existsSync(runtimeFile)?JSON.parse(readFileSync(runtimeFile,'utf8')):null;
    copy.adminConfig = {host: '127.0.0.1', port: 5432, user: runtime?.complete?runtime.owner:'postgres',
      password: runtime?.complete?runtime.ownerPassword:readFileSync(join(homedir(), '.kb-pms/postgres-superuser.txt'), 'utf8').trim()};
  }
  const target = new pg.Client({...copy.adminConfig, database: copy.database});
  await target.connect();
  try {
    const marker = (await target.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0].marker;
    if (!copy.marker?.startsWith('kb-launch-sync-test:') || marker !== copy.marker) throw new Error('Test database marker mismatch');
    await target.query('BEGIN');
    const clinic=(await target.query("SELECT id FROM clinics WHERE code::text='kb-review'")).rows[0]?.id;
    const organization=(await target.query('SELECT id FROM org_identity')).rows[0]?.id;
    if(clinic&&organization)await target.query("SELECT set_config('app.clinic_id',$1,true),set_config('app.organization_id',$2,true)",[clinic,organization]);
    await target.query("ALTER TABLE launch_sync.tabs ADD COLUMN IF NOT EXISTS raw_cells jsonb NOT NULL DEFAULT '[]'::jsonb");
    const runId = randomUUID();
    await target.query('INSERT INTO launch_sync.runs(id,started_at) VALUES($1,$2)', [runId, summary.capturedAt]);
    const previousRun = (await target.query('SELECT id FROM launch_sync.runs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1')).rows[0]?.id;
    let unchangedTabs = 0, changedTabs = 0;
    for (const book of books) {
      await target.query('INSERT INTO launch_sync.workbooks(run_id,source_id,source_role,metadata) VALUES($1,$2,$3,$4)',
        [runId, book.id, book.role, JSON.stringify({title: book.title, locale: book.locale, timeZone: book.timeZone, version: book.version})]);
      for (const tab of book.tabs) {
        const previous = previousRun ? (await target.query('SELECT content_hash FROM launch_sync.tabs WHERE run_id=$1 AND source_id=$2 AND tab_id=$3', [previousRun, book.id, tab.id])).rows[0] : null;
        if (previous?.content_hash === tab.hash) unchangedTabs++; else changedTabs++;
        await target.query('INSERT INTO launch_sync.tabs(run_id,source_id,tab_id,title,content_hash,cells,raw_cells) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [runId, book.id, tab.id, tab.title, tab.hash, JSON.stringify(tab.rows), JSON.stringify(tab.rawRows)]);
      }
    }
    const existing = (await target.query('SELECT upper(uhid) AS uhid FROM public.patients WHERE deleted_at IS NULL')).rows;
    const currentIdentifiers = new Set(existing.map(row => row.uhid));
    const matched = [...registration.identities.keys()].filter(id => currentIdentifiers.has(id)).length;
    summary.comparison = {currentRegistrationIdentifiersMatched: matched,
      currentRegistrationIdentifiersMissingFromCopy: registration.identities.size - matched,
      databaseIdentifiersAbsentFromCurrentRegistrations: [...currentIdentifiers].filter(id => !registration.identities.has(id)).length,
      databaseIdentifiersPresentInExaminedSources: [...currentIdentifiers].filter(id => coverage.identities.has(id)).length,
      databaseIdentifiersAbsentFromExaminedSources: [...currentIdentifiers].filter(id => !coverage.identities.has(id)).length,
      sourceIdentifiersMissingFromDatabase: [...coverage.identities.keys()].filter(id => !currentIdentifiers.has(id)).length,
      identitiesStillNeedClassification: true,
      matchingCaptureHashes: unchangedTabs, newOrDifferentCaptureHashes: changedTabs, normalizedConversionReady: false};
    summary.database = copy.database;
    const sourceHash = digest(books.map(book => ({id: book.id, tabs: book.tabs.map(tab => ({id: tab.id, hash: tab.hash}))})));
    await target.query('UPDATE launch_sync.runs SET completed_at=now(),source_hash=$2,summary=$3 WHERE id=$1', [runId, sourceHash, JSON.stringify(summary)]);
    const staged = Number((await target.query('SELECT count(*) AS n FROM launch_sync.tabs WHERE run_id=$1', [runId])).rows[0].n);
    if (staged !== summary.tabs) throw new Error('Staged tab verification failed');
    await target.query('COMMIT');
    writeFileSync(join(privateRoot, 'latest-summary.json'), JSON.stringify(summary, null, 2), {mode: 0o600});
    console.log(JSON.stringify(summary));
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  } finally { await target.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Stack traces/driver errors can embed patient rows, SQL parameters or tokens.
    console.error(JSON.stringify({complete: false, error: error.name, code: error.code ?? null,
      stage: error.stage ?? null, status: error.status ?? null}));
    process.exitCode = 1;
  });
}
