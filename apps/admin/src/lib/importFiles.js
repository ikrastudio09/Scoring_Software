// Turns an uploaded file into plain row objects for the auction import. Format conversion only:
// the server validates every value (never trust the browser).
//
//   JSON  [ {...} ]  or  { players: [...], teams: [...] }  or mongoexport line-delimited JSON
//   CSV   first row = headers (e.g. playerID, playerName, playerStatus, soldPoints, teamID ...)
//   XLSX  every sheet; a sheet named like "player"/"team" is used for that list

/** RFC 4180 CSV: quoted fields, escaped quotes, CRLF/LF, a BOM. Returns rows of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** Header row + data rows → objects. Empty cells are left out. */
export function toObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h ?? '').trim());
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => {
      const v = r[i];
      if (h && v !== undefined && v !== null && String(v).trim() !== '') o[h] = typeof v === 'string' ? v.trim() : v;
    });
    return o;
  });
}

function fromJson(text) {
  const t = text.trim();
  if (!t) return {};
  try {
    const data = JSON.parse(t);
    if (Array.isArray(data)) return { rows: data };
    if (data && typeof data === 'object') return { players: data.players, teams: data.teams, rows: data.players || data.teams ? undefined : [data] };
  } catch {
    // mongoexport default output: one JSON document per line
    return { rows: t.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) };
  }
  return {};
}

/**
 * Read one file. Returns { players?, teams?, rows? } — `rows` when the file holds a single list
 * whose kind is decided by the input it was dropped on.
 */
export async function readImportFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json') || name.endsWith('.ndjson')) return fromJson(await file.text());
  if (name.endsWith('.csv')) return { rows: toObjects(parseCsv(await file.text())) };
  if (name.endsWith('.xlsx')) {
    const { default: readXlsx } = await import('read-excel-file/universal');
    const sheets = await readXlsx(file);
    const out = {};
    for (const { sheet, data } of sheets) {
      const objs = toObjects(data);
      if (/team/i.test(sheet)) out.teams = [...(out.teams || []), ...objs];
      else if (/player/i.test(sheet)) out.players = [...(out.players || []), ...objs];
      else if (!out.rows) out.rows = objs;
    }
    return out;
  }
  throw new Error('Unsupported file type. Use .json, .csv or .xlsx');
}
