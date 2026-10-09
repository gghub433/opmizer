'use strict';
/**
 * Test doubles: an in-memory Windows that answers reg.exe / powercfg.exe / ipconfig.exe the way the
 * real tools print (CRLF, 4-space columns, long root names). Plug in with run.setRunner(fake.runner).
 * (Also picked up by `node --test test/` as a file without tests — harmless.)
 */
const { normKey } = require('../src/reg');

const LONG = { HKLM: 'HKEY_LOCAL_MACHINE', HKCU: 'HKEY_CURRENT_USER' };

function fakeWindows(opts) {
  const o = opts || {};
  const keys = new Map(); // lower key -> {key, values: Map(lower name -> {name,type,value})}
  const calls = [];
  const power = {
    schemes: (o.schemes || [
      { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Balanced' },
      { guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'High performance' },
      { guid: 'a1841308-3541-4fab-bc81-f71556f20b4a', name: 'Power saver' }
    ]).map((s) => Object.assign({}, s)),
    active: o.active || '381b4222-f694-41f0-9685-ff5bb260df2e',
    lang: o.lang || 'en',
    nextGuid: o.nextGuid || 'd1e2f3a4-0000-4000-8000-00000000abcd',
    duplicateFails: !!o.duplicateFails
  };

  function ensure(k) {
    const n = normKey(k);
    let node = keys.get(n.toLowerCase());
    if (!node) { node = { key: n, values: new Map() }; keys.set(n.toLowerCase(), node); }
    return node;
  }
  function setValue(k, name, type, value) { ensure(k).values.set(name.toLowerCase(), { name, type, value }); }
  function getValue(k, name) {
    const node = keys.get(normKey(k).toLowerCase());
    const v = node && node.values.get(name.toLowerCase());
    return v ? v.value : undefined;
  }
  function hasValue(k, name) {
    const node = keys.get(normKey(k).toLowerCase());
    return !!(node && node.values.has(name.toLowerCase()));
  }
  for (const [k, vals] of Object.entries(o.registry || {})) {
    ensure(k);
    for (const [name, tv] of Object.entries(vals)) setValue(k, name, tv[0], tv[1]);
  }

  const longName = (k) => { const n = normKey(k); const i = n.indexOf('\\'); return LONG[n.slice(0, i)] + n.slice(i); };
  const fmt = (v) => '    ' + v.name + '    ' + v.type + '    ' +
    (v.type === 'REG_DWORD' ? '0x' + (Number(v.value) >>> 0).toString(16) : String(v.value));

  function regExe(args) {
    const [cmd, key, ...rest] = args;
    const node = keys.get(normKey(key).toLowerCase());
    const notFound = { code: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.\r\n' };
    if (cmd === 'query') {
      if (!node) return notFound;
      if (rest[0] === '/v') {
        const v = node.values.get(String(rest[1]).toLowerCase());
        if (!v) return notFound;
        return { code: 0, stdout: '\r\n' + longName(node.key) + '\r\n' + fmt(v) + '\r\n\r\n', stderr: '' };
      }
      const prefix = node.key.toLowerCase() + '\\';
      if (rest.includes('/s')) {
        let out = '\r\n';
        const all = [...keys.values()].filter((n) => n === node || n.key.toLowerCase().startsWith(prefix));
        for (const n of all) {
          out += longName(n.key) + '\r\n';
          for (const v of n.values.values()) out += fmt(v) + '\r\n';
          out += '\r\n';
        }
        return { code: 0, stdout: out, stderr: '' };
      }
      let out = '\r\n' + longName(node.key) + '\r\n';
      for (const v of node.values.values()) out += fmt(v) + '\r\n';
      out += '\r\n';
      for (const n of keys.values()) {
        const k = n.key.toLowerCase();
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes('\\')) out += longName(n.key) + '\r\n';
      }
      return { code: 0, stdout: out, stderr: '' };
    }
    if (cmd === 'add') {
      const name = rest[rest.indexOf('/v') + 1];
      const type = rest[rest.indexOf('/t') + 1];
      let data = rest[rest.indexOf('/d') + 1];
      if (type === 'REG_DWORD') data = Number(BigInt(data));
      setValue(key, name, type, data);
      return { code: 0, stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    if (cmd === 'delete') {
      const name = rest[rest.indexOf('/v') + 1];
      if (!node || !node.values.has(name.toLowerCase())) return notFound;
      node.values.delete(name.toLowerCase());
      return { code: 0, stdout: 'The operation completed successfully.\r\n', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'ERROR: Invalid syntax.' };
  }

  function schemeLine(s, mark) {
    const label = power.lang === 'ru' ? 'GUID схемы питания: ' : 'Power Scheme GUID: ';
    return label + s.guid + '  (' + s.name + ')' + (mark ? ' *' : '');
  }

  function powercfg(args) {
    const a = args.map((x) => String(x).toLowerCase());
    const find = (g) => power.schemes.find((s) => s.guid === String(g).toLowerCase());
    if (a[0] === '/getactivescheme') return { code: 0, stdout: schemeLine(find(power.active)) + '\r\n', stderr: '' };
    if (a[0] === '/list') {
      const head = power.lang === 'ru' ? '\r\nСуществующие схемы питания (* Активный)\r\n' : '\r\nExisting Power Schemes (* Active)\r\n';
      return {
        code: 0,
        stdout: head + '-----------------------------------\r\n' +
          power.schemes.map((s) => schemeLine(s, s.guid === power.active)).join('\r\n') + '\r\n',
        stderr: ''
      };
    }
    if (a[0] === '-duplicatescheme') {
      if (power.duplicateFails) return { code: 1, stdout: 'Invalid Parameters -- try "/?" for help\r\n', stderr: '' };
      const src = a[1];
      const name = src === 'e9a42b02-d5df-448d-aa00-03f14749eb61'
        ? (power.lang === 'ru' ? 'Максимальная производительность' : 'Ultimate Performance')
        : (find(src) || { name: 'Copy' }).name;
      const s = { guid: power.nextGuid, name };
      power.schemes.push(s);
      return { code: 0, stdout: schemeLine(s) + '\r\n', stderr: '' };
    }
    if (a[0] === '/setactive') {
      if (!find(a[1])) return { code: 1, stdout: 'The power scheme, subgroup or setting specified does not exist.\r\n', stderr: '' };
      power.active = a[1];
      return { code: 0, stdout: '', stderr: '' };
    }
    if (a[0] === '-delete') {
      if (a[1] === power.active) return { code: 1, stdout: 'Unable to delete the active scheme.\r\n', stderr: '' };
      power.schemes = power.schemes.filter((s) => s.guid !== a[1]);
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'bad' };
  }

  function runner(file, args) {
    calls.push([file, args]);
    if (/reg(\.exe)?$/i.test(file)) return regExe(args);
    if (/powercfg(\.exe)?$/i.test(file)) return powercfg(args);
    if (/ipconfig(\.exe)?$/i.test(file)) return { code: 0, stdout: 'Successfully flushed the DNS Resolver Cache.\r\n', stderr: '' };
    if (/powershell(\.exe)?$/i.test(file)) return { code: 0, stdout: '', stderr: '' };
    if (/tasklist(\.exe)?$/i.test(file)) return { code: 0, stdout: 'INFO: No tasks are running which match the specified criteria.\r\n', stderr: '' };
    return { code: -1, stdout: '', stderr: 'ENOENT ' + file };
  }

  return { runner, keys, calls, power, getValue, hasValue, setValue };
}

/** Minimal Store stand-in that keeps everything in memory. */
function memoryStore() {
  const data = { version: 1, tweaks: {}, power: null, games: {} };
  return {
    data,
    get: (k) => data[k],
    update(fn) { const r = fn(data); return r; },
    save() {}
  };
}

module.exports = { fakeWindows, memoryStore };
