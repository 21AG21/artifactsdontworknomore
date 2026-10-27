#!/usr/bin/env node
// Encrypt an artifact page with a code and write it as a locked page.
//
//   node tools/lock.mjs <source.html> [code]
//
// With no code, one is generated. Prints JSON: { id, code, path, link, plainLink }.
// The source file is never copied into the repo — only the encrypted payload is.
// Must match assets/locked.js: same normalisation, salt, iteration count and split.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SALT = 'artifactsdontworknomore/v1';
const ITER = 600000;
const SITE = 'https://artifactsdontworknomore.vercel.app';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const norm = (c) => c.trim().toLowerCase().replace(/\s+/g, '-');
const hex = (b) => Buffer.from(b).toString('hex');
const b64 = (b) => Buffer.from(b).toString('base64');

function makeCode() {
  // 3 groups of 4 from an unambiguous alphabet: ~62 bits, easy to read aloud.
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(r, (x) => abc[x % abc.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

const [src, given] = process.argv.slice(2);
if (!src) { console.error('usage: node tools/lock.mjs <source.html> [code]'); process.exit(2); }
const code = norm(given || makeCode());
if (code.length < 8) { console.error('code must be at least 8 characters'); process.exit(2); }

const enc = new TextEncoder();
const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITER, hash: 'SHA-256' }, base, 512));
const id = hex(bits.slice(0, 10));
const key = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const html = await readFile(src);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, html));

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Artifacts</title>
<link rel="stylesheet" href="/assets/minimono.css">
<style>
html,body{ overflow:auto; }
main{ padding:72px max(16px, 5vw); max-width:560px; display:flex; flex-direction:column; gap:16px; }
form{ display:flex; flex-direction:column; gap:12px; }
form[hidden], #msg[hidden], #ring[hidden]{ display:none; }
#code{ -webkit-appearance:none; appearance:none; width:100%; max-width:420px; font:inherit; font-size:16px; color:var(--ink);
  background:var(--wall); border:0; border-radius:10px; padding:10px 14px; }
#code::placeholder{ color:var(--muted); }
#msg{ margin:0; font-size:15px; font-weight:500; color:var(--ink); }
</style>
</head>
<body>
<main>
  <div class="loading" id="ring" hidden role="status" aria-label="Unlocking"></div>
  <form id="unlock" hidden autocomplete="off">
    <input id="code" type="text" placeholder="Code" aria-label="Code" spellcheck="false" autocapitalize="off">
  </form>
  <p id="msg" hidden>That code didn’t match.</p>
</main>
<script type="application/json" id="payload">${JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) })}</script>
<script src="/assets/locked.js"></script>
</body>
</html>
`;

const dir = path.join(ROOT, 'u', id);
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'index.html'), page);

console.log(JSON.stringify({
  id, code,
  path: `u/${id}/index.html`,
  link: `${SITE}/u/${id}/#${code}`,
  plainLink: `${SITE}/u/${id}/`,
}, null, 2));
