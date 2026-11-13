// Read-only Google Sheets capture. Credentials and source values never enter logs.
import {createSign, createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const quoteTab = title => "'" + title.replaceAll("'", "''") + "'";

export class SourceError extends Error {
  constructor(stage, status, reason = '') {
    super(`${stage} failed (${status}${reason ? ': ' + reason : ''})`);
    this.stage = stage;
    this.status = status;
  }
}

export class SheetsSource {
  constructor(credentialFile, options = {}) {
    this.credential = JSON.parse(readFileSync(credentialFile, 'utf8'));
    if (this.credential.type !== 'service_account' || !this.credential.client_email || !this.credential.private_key) {
      throw new Error('Expected a service-account JSON credential');
    }
    this.fetch = options.fetch ?? fetch;
    this.delay = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.token = null;
  }

  async accessToken() {
    if (this.token && this.token.expires > Date.now() + 60000) return this.token.value;
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = encode({alg: 'RS256', typ: 'JWT'});
    const claims = encode({iss: this.credential.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600});
    const unsigned = `${head}.${claims}`;
    const assertion = unsigned + '.' + createSign('RSA-SHA256').update(unsigned).sign(this.credential.private_key).toString('base64url');
    const response = await this.fetch('https://oauth2.googleapis.com/token', {method: 'POST',
      body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}),
      signal: AbortSignal.timeout(30000)});
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new SourceError('Google authentication', response.status);
    this.token = {value: result.access_token, expires: Date.now() + result.expires_in * 1000};
    return this.token.value;
  }

  async get(url, stage) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await this.fetch(url, {headers: {authorization: `Bearer ${await this.accessToken()}`},
        signal: AbortSignal.timeout(60000)});
      const result = await response.json();
      if (response.ok) return result;
      if (response.status === 401) this.token = null;
      const retry = response.status === 401 || response.status === 429 || response.status >= 500;
      if (!retry || attempt === 4) {
        // Google's error messages can contain source identifiers; never log them.
        throw new SourceError(stage, response.status, result.error?.errors?.[0]?.reason ?? '');
      }
      await this.delay(Math.min(30000, 1000 * 2 ** attempt));
    }
  }

  async discover() {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({q: "trashed=false and mimeType='application/vnd.google-apps.spreadsheet'",
        fields: 'files(id,name,version,modifiedTime),nextPageToken', pageSize: '100',
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true'});
      if (pageToken) params.set('pageToken', pageToken);
      const result = await this.get('https://www.googleapis.com/drive/v3/files?' + params, 'Workbook discovery');
      files.push(...result.files);
      pageToken = result.nextPageToken;
    } while (pageToken);
    return files;
  }

  async version(id) {
    return this.get('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id)
      + '?fields=id,version,modifiedTime&supportsAllDrives=true', 'Workbook version');
  }

  async capture(id) {
    const before = await this.version(id);
    const metadata = await this.get('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id)
      + '?fields=spreadsheetId,properties(title,locale,timeZone),sheets.properties', 'Workbook metadata');
    const tabs = [];
    for (let start = 0; start < metadata.sheets.length; start += 8) {
      const selected = metadata.sheets.slice(start, start + 8);
      const params = new URLSearchParams({valueRenderOption: 'FORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING'});
      for (const sheet of selected) params.append('ranges', quoteTab(sheet.properties.title));
      const values = await this.get('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id)
        + '/values:batchGet?' + params, 'Workbook values');
      params.set('valueRenderOption', 'UNFORMATTED_VALUE');
      params.set('dateTimeRenderOption', 'SERIAL_NUMBER');
      const raw = await this.get('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id)
        + '/values:batchGet?' + params, 'Raw workbook values');
      if (values.valueRanges?.length !== selected.length || raw.valueRanges?.length !== selected.length) throw new Error('Incomplete workbook response');
      for (let i = 0; i < selected.length; i++) {
        const properties = selected[i].properties;
        const rows = values.valueRanges[i].values ?? [];
        const rawRows = raw.valueRanges[i].values ?? [];
        tabs.push({id: properties.sheetId, title: properties.title, sheetType: properties.sheetType,
          hidden: !!properties.hidden, rows, rawRows, hash: digest({rows, rawRows})});
      }
    }
    const after = await this.version(id);
    if (String(before.version) !== String(after.version)) throw new SourceError('Workbook changed during capture; retry later', 409);
    return {id, title: metadata.properties.title, locale: metadata.properties.locale,
      timeZone: metadata.properties.timeZone, version: after.version, modifiedTime: after.modifiedTime, tabs};
  }
}

export function tableRows(tab) {
  const headers = (tab.rows[0] ?? []).map(value => String(value ?? '').trim());
  const normalized = headers.map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const lookup = (cells, aliases, asText) => {
      for (const alias of aliases) {
        const key = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
        const indexes = normalized.flatMap((header, index) => header === key ? [index] : []);
        if (indexes.length > 1) throw new Error('Ambiguous source headers');
        if (indexes.length) return asText ? String(cells[indexes[0]] ?? '').trim() : cells[indexes[0]] ?? '';
      }
      return '';
  };
  return tab.rows.slice(1).map((cells, i) => ({row: i + 2, cells,
    get: aliases => lookup(cells, aliases, true),
    getRaw: aliases => lookup(tab.rawRows?.[i + 1] ?? cells, aliases, false)
  })).filter(row => row.cells.some(value => value !== '' && value !== null));
}

// Patient identities are for comparison only. No date, classification or identity
// is invented, and duplicate registrations stay available in the captured rows.
export function registrationInventory(workbooks) {
  const identities = new Map();
  let rows = 0, missingIdentifier = 0, missingName = 0;
  for (const book of workbooks) {
    const tab = book.tabs.find(value => value.title === 'Registrations');
    if (!tab) continue;
    for (const row of tableRows(tab)) {
      rows++;
      const uhid = row.get(['UHID', 'Registration ID', 'Unique Health Identification Number']).toUpperCase();
      const name = row.get(['Name', 'Patient Name', 'Full Name']);
      if (!uhid) { missingIdentifier++; continue; }
      if (!name) missingName++;
      if (!identities.has(uhid)) identities.set(uhid, []);
      identities.get(uhid).push({book: book.id, row: row.row, name});
    }
  }
  return {identities, summary: {registrationRows: rows, uniqueSourceIdentifiers: identities.size,
    missingIdentifier, missingName, repeatedIdentifiers: [...identities.values()].filter(rows => rows.length > 1).length}};
}
