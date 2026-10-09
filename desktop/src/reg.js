'use strict';
/**
 * Registry access through reg.exe (no native modules).
 *   query(key, name)            -> {exists:false} | {exists:true, type:'REG_DWORD', value:1}
 *   set(key, name, type, value) -> true (throws HostError on failure)
 *   del(key, name)              -> true (a missing value counts as success)
 *   listSubkeys(key)            -> ['HKLM\\...\\{GUID}', ...]
 */
const { run } = require('./run');
const { HostError } = require('./errors');

const REG = 'reg.exe';
const TYPES = ['REG_SZ', 'REG_EXPAND_SZ', 'REG_MULTI_SZ', 'REG_DWORD', 'REG_QWORD', 'REG_BINARY', 'REG_NONE',
  'REG_DWORD_BIG_ENDIAN', 'REG_LINK', 'REG_RESOURCE_LIST', 'REG_FULL_RESOURCE_DESCRIPTOR', 'REG_RESOURCE_REQUIREMENTS_LIST'];
// Longest first so REG_DWORD_BIG_ENDIAN is not cut to REG_DWORD.
const TYPE_RE = new RegExp('^(.*?)[ \\t]+(' + TYPES.slice().sort((a, b) => b.length - a.length).join('|') + ')(?:[ \\t]+(.*))?$');

const ROOTS = {
  HKLM: 'HKEY_LOCAL_MACHINE', HKCU: 'HKEY_CURRENT_USER', HKCR: 'HKEY_CLASSES_ROOT', HKU: 'HKEY_USERS', HKCC: 'HKEY_CURRENT_CONFIG'
};
const SHORT = Object.fromEntries(Object.entries(ROOTS).map(([k, v]) => [v, k]));

/** 'HKEY_LOCAL_MACHINE\\X' | 'HKLM\\X' -> 'HKLM\\X' (backslashes, no trailing slash). */
function normKey(key) {
  let k = String(key || '').replace(/\//g, '\\').replace(/\\+$/, '').trim();
  const i = k.indexOf('\\');
  const root = (i < 0 ? k : k.slice(0, i)).toUpperCase();
  const rest = i < 0 ? '' : k.slice(i);
  if (SHORT[root]) return SHORT[root] + rest;
  if (ROOTS[root]) return root + rest;
  return k;
}

function isMachineKey(key) { return /^HKLM(\\|$)/.test(normKey(key)); }

function convertValue(type, raw) {
  const data = raw == null ? '' : raw;
  if (type === 'REG_DWORD' || type === 'REG_QWORD' || type === 'REG_DWORD_BIG_ENDIAN') {
    const t = data.trim();
    if (/^0x[0-9a-f]+$/i.test(t)) return Number(BigInt(t));
    if (/^\d+$/.test(t)) return Number(t);
    return t;
  }
  return data;
}

/**
 * Parse the text of `reg query <key> [/v name]`.
 * Returns {values:[{name,type,value}], subkeys:['HKLM\\...']}.
 * Tolerates tabs or any run of spaces between columns (localized builds differ) and CRLF.
 */
function parseQuery(text) {
  const values = [];
  const subkeys = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^HKEY_[A-Z_]+(\\|$)/i.test(line.trim()) && !/^[ \t]/.test(line)) {
      subkeys.push(normKey(line.trim()));
      continue;
    }
    if (!/^[ \t]/.test(line)) continue; // "ERROR: ..." and friends
    const m = TYPE_RE.exec(line.replace(/^[ \t]+/, ''));
    if (!m) continue;
    values.push({ name: m[1].trim(), type: m[2], value: convertValue(m[2], m[3] == null ? '' : m[3].replace(/\r$/, '')) });
  }
  return { values, subkeys };
}

/** The first header line names the queried key itself — not a subkey. */
function splitSubkeys(parsed, key) {
  const self = normKey(key).toLowerCase();
  return parsed.subkeys.filter((k) => k.toLowerCase() !== self && k.toLowerCase().startsWith(self + '\\'));
}

function isDefaultName(name) {
  return /^\(.+\)$/.test(name); // "(Default)", "(По умолчанию)"…
}

async function query(key, name) {
  const args = ['query', normKey(key)];
  if (name === '' || name == null) args.push('/ve'); else args.push('/v', name);
  const r = await run(REG, args, { timeout: 10000 });
  if (r.code === 1) return { exists: false };
  if (r.code !== 0) throw new HostError('FAILED', 'Не удалось прочитать реестр', r.stderr || r.stdout);
  const { values } = parseQuery(r.stdout);
  if (!values.length) return { exists: false };
  const want = String(name || '').toLowerCase();
  const hit = values.find((v) => (want ? v.name.toLowerCase() === want : isDefaultName(v.name))) || values[0];
  return { exists: true, type: hit.type, value: hit.value };
}

function dataArg(type, value) {
  if (type === 'REG_DWORD' || type === 'REG_QWORD') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) throw new HostError('FAILED', 'Неверное значение для реестра');
    return '0x' + BigInt(Math.trunc(n)).toString(16);
  }
  return String(value == null ? '' : value);
}

async function set(key, name, type, value) {
  const args = ['add', normKey(key)];
  if (name === '' || name == null) args.push('/ve'); else args.push('/v', name);
  args.push('/t', type || 'REG_SZ', '/d', dataArg(type, value), '/f');
  const r = await run(REG, args, { timeout: 10000 });
  if (r.code !== 0) {
    if (/denied|отказано/i.test(r.stderr + r.stdout)) {
      throw new HostError('NEEDS_ADMIN', 'Нужны права администратора');
    }
    throw new HostError('FAILED', 'Не удалось записать в реестр', r.stderr || r.stdout);
  }
  return true;
}

async function del(key, name) {
  const args = ['delete', normKey(key)];
  if (name === '' || name == null) args.push('/ve'); else args.push('/v', name);
  args.push('/f');
  const r = await run(REG, args, { timeout: 10000 });
  if (r.code === 0) return true;
  // Already absent -> nothing to do. reg.exe answers 1 for both "not found" and "denied", so check.
  if (/denied|отказано/i.test(r.stderr + r.stdout)) throw new HostError('NEEDS_ADMIN', 'Нужны права администратора');
  const still = await query(key, name).catch(() => ({ exists: true }));
  if (!still.exists) return true;
  throw new HostError('FAILED', 'Не удалось удалить значение из реестра', r.stderr || r.stdout);
}

/**
 * Parse `reg query <key> [/s]` into Map(lowercased key -> {key, values: {lowercased name: {name,type,value}}}).
 * Column-0 HKEY_ lines start a block; indented value lines belong to the latest block.
 */
function parseTree(text) {
  const map = new Map();
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^[ \t]/.test(line)) {
      if (/^HKEY_[A-Z_]+(\\|$)/i.test(line.trim())) {
        const k = normKey(line.trim());
        cur = map.get(k.toLowerCase());
        if (!cur) { cur = { key: k, values: {} }; map.set(k.toLowerCase(), cur); }
      } else cur = null; // "End of search", errors
      continue;
    }
    if (!cur) continue;
    const m = TYPE_RE.exec(line.replace(/^[ \t]+/, ''));
    if (!m) continue;
    const name = isDefaultName(m[1].trim()) ? '' : m[1].trim();
    cur.values[name.toLowerCase()] = { name, type: m[2], value: convertValue(m[2], m[3] == null ? '' : m[3].replace(/\r$/, '')) };
  }
  return map;
}

/** All values of one key: {exists:false} or {exists:true, values:{lowername:{name,type,value}}}. */
async function readKey(key) {
  const k = normKey(key);
  const r = await run(REG, ['query', k], { timeout: 10000 });
  if (r.code === 1) return { exists: false, values: {} };
  if (r.code !== 0) throw new HostError('FAILED', 'Не удалось прочитать реестр', r.stderr || r.stdout);
  const node = parseTree(r.stdout).get(k.toLowerCase());
  return { exists: true, values: node ? node.values : {} };
}

/** Key and every subkey with values (reg query /s): Map(lowercased key -> {key, values}). */
async function readTree(key) {
  const r = await run(REG, ['query', normKey(key), '/s'], { timeout: 15000 });
  if (r.code !== 0) return new Map();
  return parseTree(r.stdout);
}

async function listSubkeys(key) {
  const r = await run(REG, ['query', normKey(key)], { timeout: 10000 });
  if (r.code !== 0) return [];
  return splitSubkeys(parseQuery(r.stdout), key);
}

module.exports = { query, set, del, readKey, readTree, listSubkeys, parseQuery, parseTree, splitSubkeys, normKey, isMachineKey };
