/* minimono.js — the house style's behavior. Include before </body>; no init.
   1. Two panes or one. Full-screen shows both (left ¼ · right ¾). The page
      goes to one pane when the window isn't full-screen, or when the person
      hides the left pane (`, or the pane's own "Hide"). Hiding is
      remembered. Force the layout with <html data-layout="split|single">.
   2. In one-pane mode the "Menu" link (.menu-hint) is invisible until the
      pointer enters the top-left zone (left quarter, top sixth); clicking it,
      or `, opens the left pane as an overlay. Esc, a click outside, or
      choosing a row closes it. With no pointer (touch), the link stays shown.
      The overlay is the SAME .pane-l element, moved by a class — never a
      copy, never rebuilt — so its scroll position and selection survive.
   3. Safari: trackpad pinch-zoom is blocked; ⌘+ / ⌘− still work.          */
(function () {
  'use strict';
  var html = document.documentElement;
  var KEY = 'minimono:pane-hidden';
  var hidden = false;
  try { hidden = localStorage.getItem(KEY) === '1'; } catch (e) {}

  /* 1. Two panes or one ---------------------------------------------------- */
  function isFull() {
    var forced = html.getAttribute('data-layout');
    if (forced === 'split') return true;
    if (forced === 'single') return false;
    // Full-screen or maximized. At the top level, measure the window itself
    // (outerWidth): ⌘+ zoom shrinks innerWidth but not the window. Embedded
    // in a frame, the frame's own width is what's available.
    var top = true;
    try { top = window.top === window; } catch (e) { top = false; }
    var w = top && outerWidth > 0 ? outerWidth : innerWidth;
    return w >= screen.availWidth - 24;
  }
  function layout() {
    var windowed = !isFull();
    html.classList.toggle('is-windowed', windowed);
    var single = windowed || hidden;
    if (single !== html.classList.contains('is-single')) {
      if (!single) close(true);
      html.classList.toggle('is-single', single);
    }
  }
  function setHidden(v) {
    hidden = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {}
    close(true);
    layout();
  }
  var raf = 0;
  addEventListener('resize', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; layout(); }); });
  new MutationObserver(layout).observe(html, { attributes: true, attributeFilter: ['data-layout'] });

  /* 2. The overlay --------------------------------------------------------- */
  var lastFocus = null;
  function pane() { return document.querySelector('.pane-l'); }
  function typing(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type);
  }
  function single() { return html.classList.contains('is-single'); }
  function isOpen() { return html.classList.contains('menu-open'); }
  function open(keyboard) {
    if (!single() || isOpen()) return;
    html.classList.remove('hint-on');
    html.classList.add('menu-open');
    lastFocus = document.activeElement;
    if (keyboard) {                                   // keyboard: move focus in
      var p = pane(), cur = p && (p.querySelector('[aria-current="true"]') || p.querySelector('a,button,input,[tabindex]'));
      if (cur) cur.focus({ preventScroll: true });
    }
  }
  function close(silent) {
    if (!isOpen()) return;
    html.classList.remove('menu-open');
    var p = pane();
    if (!silent && lastFocus && lastFocus.focus && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
    else if (p && p.contains(document.activeElement)) document.activeElement.blur();
    lastFocus = null;
  }

  // the top-left zone: left quarter of the width, top sixth of the height.
  // Entering it shows the menu link; nothing opens until the link is clicked.
  function inZone(x, y) { return x <= innerWidth / 4 && y <= innerHeight / 6; }
  var hintTimer = 0;
  function hint(on) {
    clearTimeout(hintTimer);
    if (on) { html.classList.add('hint-on'); return; }
    hintTimer = setTimeout(function () { html.classList.remove('hint-on'); }, 200);
  }
  addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    hint(single() && !isOpen() && inZone(e.clientX, e.clientY));
  }, { passive: true });
  document.addEventListener('mouseleave', function () { hint(false); });

  addEventListener('keydown', function (e) {
    // ` (backtick) on its own — left alone while typing in a field
    if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(document.activeElement)) {
      e.preventDefault();
      if (html.classList.contains('is-windowed')) { isOpen() ? close() : open(true); }
      else setHidden(!hidden);                        // full-screen: hide, or dock it again
      return;
    }
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); close(); }
  });
  addEventListener('pointerdown', function (e) {
    if (!isOpen()) return;
    var p = pane();
    if (p && !p.contains(e.target) && !(e.target.closest && e.target.closest('.menu-hint'))) close();
  });
  addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement;
    if (t.closest('.menu-hint')) { e.preventDefault(); isOpen() ? close() : open(false); return; }
    if (t.closest('.pane-hide')) {                    // docked: "Hide" · hidden overlay: "Keep open"
      e.preventDefault(); setHidden(!hidden); return;
    }
    if (isOpen() && t.closest('.pane-l .row, .pane-l .mcq-nav a')) close();
  });

  /* Focus rings: only after Tab. Shift, arrows, Space and clicks never show one. */
  addEventListener('keydown', function (e) { if (e.key === 'Tab') html.classList.add('kbd-nav'); }, true);
  addEventListener('pointerdown', function () { html.classList.remove('kbd-nav'); }, true);

  /* 3. Safari pinch-zoom ---------------------------------------------------- */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });

  layout();
  window.Minimono = {
    open: function () { open(true); }, close: close,
    hide: function () { setHidden(true); }, show: function () { setHidden(false); },
    relayout: layout
  };
})();
