'use strict';
/**
 * Minimal parser for Valve's text KeyValues (VDF/ACF): "key" "value" pairs and "key" { ... } blocks.
 * Handles \\ \" \n \t escapes, // comments, unquoted tokens and [$CONDITIONAL] suffixes.
 * Keys keep their original case; lookups should use get(obj, key) which ignores case.
 */
function tokenize(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '{' || c === '}') { out.push(c); i++; continue; }
    if (c === '[') { while (i < s.length && s[i] !== ']') i++; i++; continue; } // conditionals
    if (c === '"') {
      let v = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1];
          v += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          i += 2;
        } else v += s[i++];
      }
      i++;
      out.push({ v });
      continue;
    }
    let v = '';
    while (i < s.length && !/[\s{}"]/.test(s[i])) v += s[i++];
    out.push({ v });
  }
  return out;
}

function parse(text) {
  const toks = tokenize(text);
  let p = 0;
  function block() {
    const obj = {};
    while (p < toks.length) {
      const t = toks[p++];
      if (t === '}') return obj;
      if (t === '{') continue; // stray brace
      const key = t.v;
      const next = toks[p];
      if (next === '{') { p++; obj[key] = block(); }
      else if (next && typeof next === 'object') { p++; obj[key] = next.v; }
      else obj[key] = '';
    }
    return obj;
  }
  return block();
}

/** Case-insensitive property lookup. */
function get(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  const low = String(key).toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === low) return obj[k];
  return undefined;
}

module.exports = { parse, get, tokenize };
