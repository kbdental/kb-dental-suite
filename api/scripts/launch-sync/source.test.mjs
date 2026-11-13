// These tests use Node's runner and fake Google responses. No shared test DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {SheetsSource, quoteTab, tableRows, registrationInventory, digest} from './source.mjs';
import {validCopyName} from './rehearse.mjs';
import {sourceIdentities, dayOnly, registerCollisions} from './compare.mjs';

test('preserves all source cells, duplicates, zeros and row positions', () => {
  const rows = [['UHID', 'Name', 'Notes', 'Notes', ''], ['TEST-A', 'Example One', 'original', 'second', 0], [], ['TEST-B', 'Example Two']];
  const tab = {rows};
  const parsed = tableRows(tab);
  assert.deepEqual(parsed.map(row => row.row), [2, 4]);
  assert.deepEqual(rows[1], ['TEST-A', 'Example One', 'original', 'second', 0]);
  assert.throws(() => parsed[0].get(['Notes']), /Ambiguous source headers/);
  assert.equal(parsed[0].get(['Name']), 'Example One');
  assert.notEqual(digest(rows), digest([rows[0], rows[1].slice(0, 4)]));
});

test('matches heading aliases and keeps all re-registrations for review', () => {
  const result = registrationInventory([
    {id: 'main', tabs: [{title: 'Registrations', rows: [['Registration ID', 'Full Name'], ['test-a', 'Example One'], ['', 'Unknown Example']]}]},
    {id: 'panel', tabs: [{title: 'Registrations', rows: [['UHID', 'Name'], ['TEST-A', 'Example One Later'], ['TEST-B', '']]}]}
  ]);
  assert.deepEqual(result.summary, {registrationRows: 4, uniqueSourceIdentifiers: 2,
    missingIdentifier: 1, missingName: 1, repeatedIdentifiers: 1});
  assert.equal(result.identities.get('TEST-A').length, 2);
});

test('only generated sandbox names pass the target guard', () => {
  assert.equal(validCopyName('kb_launch_sync_test_20261107_010203_a1b2c3'), true);
  for (const name of ['kb_pms', 'kb_pms_test', 'kb_realdata_review', 'kb_launch_sync_test_', 'kb_launch_sync_test_20261107_010203_a1b2c3;DROP DATABASE x']) {
    assert.equal(validCopyName(name), false);
  }
  assert.equal(quoteTab("Doctor's Notes"), "'Doctor''s Notes'");
});

test('historical and clinical-only patients count as source-backed, not database extras', () => {
  const result = sourceIdentities([
    {role: 'historical-registration', tabs: [{title: 'Registration Form', rows: [['Registration ID', 'Full Name'], ['TEST-A', 'Example One']]},
      {title: 'Derived', rows: [['Registration ID', 'Full Name'], ['TEST-NOT-REAL', 'Formula Copy']]}]},
    {role: 'clinical', tabs: [{title: 'Restoration', rows: [['UHID No.', 'Name of Patient'], ['TEST-B', 'Example Two']]}]}
  ]);
  assert.deepEqual([...result.keys()], ['TEST-A', 'TEST-B']);
});

test('finance-only and CRM-only patient references also count as source-backed', () => {
  const result = sourceIdentities([
    {role: 'finance', tabs: [{title: 'Patient Fee Receipt', rows: [["UHID", "Patient's Name"], ['TEST-F', 'Example Finance']]}]},
    {role: 'main', tabs: [{title: 'CRM Contacts', rows: [['uhid', 'firstName', 'lastName'], ['TEST-C', 'Example', 'Contact']]}]}
  ]);
  assert.ok(result.has('TEST-F'));
  assert.ok(result.has('TEST-C'));
});

test('date preview refuses ambiguous and impossible dates', () => {
  assert.equal(dayOnly('2026-11-07T10:00:00+05:30'), '2026-11-07');
  assert.equal(dayOnly('25/10/2026 10:00:00'), '2026-10-25');
  assert.equal(dayOnly('10/25/2026 10:00:00'), '2026-10-25');
  assert.equal(dayOnly('07/11/2026'), null);
  assert.equal(dayOnly('31/02/2026'), null);
  assert.equal(dayOnly(46333.75), '2026-11-07');
});

test('flags different same-patient/day rows that the current schema cannot retain independently', () => {
  const result = registerCollisions([{role: 'main', tabs: [{title: 'Daily Register', rows: [
    ['UHID', 'Timestamp', 'Work Done'], ['TEST-A', '2026-11-07', 'First fictional procedure'],
    ['TEST-A', '2026-11-07', 'Second fictional procedure']
  ]}]}]);
  assert.equal(result.repeatedPatientDayGroups, 1);
  assert.equal(result.repeatedGroupsWithDifferentRows, 1);
});

function fakeClient(t, replies) {
  const folder = mkdtempSync(join(tmpdir(), 'kb-sync-source-test-'));
  t.after(() => rmSync(folder, {recursive: true, force: true}));
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const file = join(folder, 'fake.json');
  writeFileSync(file, JSON.stringify({type: 'service_account', client_email: 'fictional@example.invalid', private_key: privateKey.export({type: 'pkcs8', format: 'pem'})}));
  const urls = [];
  const client = new SheetsSource(file, {delay: async () => {}, fetch: async (url, options) => {
    urls.push(url);
    assert.equal(options.method ?? 'GET', url.includes('oauth2.googleapis.com') ? 'POST' : 'GET');
    const reply = replies.shift();
    assert.ok(reply, 'Unexpected request');
    return {ok: reply.status === undefined || reply.status < 400, status: reply.status ?? 200, json: async () => reply.body};
  }});
  return {client, urls};
}

test('read-only capture rejects a workbook edited during the read', async t => {
  const {client} = fakeClient(t, [
    {body: {access_token: 'fake-token', expires_in: 3600}},
    {body: {version: '1'}},
    {body: {properties: {title: 'Fictional', locale: 'en_IN', timeZone: 'Asia/Kolkata'}, sheets: [{properties: {sheetId: 1, title: 'Registrations'}}]}},
    {body: {valueRanges: [{values: [['UHID', 'Name'], ['TEST-A', 'Example One']]}]}},
    {body: {valueRanges: [{values: [['UHID', 'Name'], ['TEST-A', 'Example One']]}]}},
    {body: {version: '2'}}
  ]);
  await assert.rejects(client.capture('fake-id'), error => error.status === 409);
});

test('discovery follows pagination and rate-limit retries', async t => {
  const {client, urls} = fakeClient(t, [
    {body: {access_token: 'fake-token', expires_in: 3600}},
    {status: 429, body: {error: {errors: [{reason: 'rateLimitExceeded'}]}}},
    {body: {files: [{id: 'a'}], nextPageToken: 'page-two'}},
    {body: {files: [{id: 'b'}]}}
  ]);
  assert.deepEqual(await client.discover(), [{id: 'a'}, {id: 'b'}]);
  assert.ok(urls[3].includes('pageToken=page-two'));
});

test('errors redact Google messages that could contain patient identifiers', async t => {
  const {client} = fakeClient(t, [
    {body: {access_token: 'fake-token', expires_in: 3600}},
    {status: 403, body: {error: {message: 'PRIVATE SOURCE VALUE', errors: [{reason: 'accessNotConfigured'}]}}}
  ]);
  await assert.rejects(client.version('fake-id'), error => !error.message.includes('PRIVATE SOURCE VALUE') && error.status === 403);
});
