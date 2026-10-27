/* locked.js — code-locked artifacts.
   A code derives two things with PBKDF2 (same salt and count as tools/lock.mjs):
   the folder id (/u/<id>/) and the AES-GCM key that decrypts the page inside it.
   Nothing on the site lists locked pages, and their contents are only ever
   stored encrypted, so the repo being public doesn't expose them. */
(function () {
  var SALT = 'artifactsdontworknomore/v1';
  var ITER = 600000;
  var enc = new TextEncoder();

  function hex(bytes) {
    return Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function b64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function norm(code) { return code.trim().toLowerCase().replace(/\s+/g, '-'); }

  async function derive(code) {
    var base = await crypto.subtle.importKey('raw', enc.encode(norm(code)), 'PBKDF2', false, ['deriveBits']);
    var bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITER, hash: 'SHA-256' }, base, 512));
    var key = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['decrypt']);
    return { id: hex(bits.slice(0, 10)), key: key };
  }

  async function decrypt(payload, key) {
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(payload.iv) }, key, b64(payload.ct));
    return new TextDecoder().decode(pt);
  }

  function remember(id, code) { try { sessionStorage.setItem('adnm:code:' + id, norm(code)); } catch (e) {} }
  function recall(id) { try { return sessionStorage.getItem('adnm:code:' + id); } catch (e) { return null; } }

  window.ADNM = { derive: derive, remember: remember };

  /* On a locked page: unlock from this tab's remembered code, or ask for it. */
  var payloadEl = document.getElementById('payload');
  if (!payloadEl) return;
  var payload = JSON.parse(payloadEl.textContent);
  var form = document.getElementById('unlock');
  var input = document.getElementById('code');
  var msg = document.getElementById('msg');
  var ring = document.getElementById('ring');
  var id = location.pathname.split('/').filter(Boolean).pop();

  async function tryCode(code) {
    ring.hidden = false; msg.hidden = true;
    try {
      var d = await derive(code);
      if (d.id !== id) throw new Error('id');
      var html = await decrypt(payload, d.key);
      remember(id, code);
      document.open(); document.write(html); document.close();
      return true;
    } catch (e) {
      ring.hidden = true;
      return false;
    }
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!input.value.trim()) return;
    if (!(await tryCode(input.value))) { msg.hidden = false; input.select(); }
  });

  /* A shared link can carry the code after the # (never sent to the server). */
  var fromHash = decodeURIComponent(location.hash.slice(1));
  var saved = fromHash || recall(id);
  if (saved) { tryCode(saved).then(function (ok) { if (!ok) { form.hidden = false; input.focus(); } }); }
  else { form.hidden = false; input.focus(); }
})();
