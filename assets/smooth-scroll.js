/* smooth-scroll.js — Safari's keyboard scrolling, for every pane.
   ---------------------------------------------------------------------------
   A port of WebKit's keyboard-scroll physics (ScrollAnimationKeyboard.cpp,
   KeyboardScroll.h, macOS constants) so Space, arrows, Page Up/Down and
   Home/End glide and settle on a spring in every scroller — the page, and
   each two-pane split pane on its own.

     ↑ / ↓            tap: glide one line (40px) · hold: accelerate to
                      1000px/s in 0.2s, cruise, then the spring carries the
                      leftover momentum and settles
     Space / ⇧Space   the same, with a page as the step (the visible height
     PgDn / PgUp      less 40px of overlap, never less than 87.5% of it):
                      tap glides at least a page, hold accelerates
     Home / End       glide to the top / bottom (also ⌘↑ / ⌘↓ on a Mac)
   Key repeats are ignored while a key is held, as in WebKit.

   Which scroller moves: the one under the pointer, else the one that holds
   focus, else the last one clicked, else the page.
   Left alone: any control that uses these keys itself — text fields,
   sliders, radio groups, selects, contenteditable, tabs, listboxes — and
   Space on a button, link, checkbox or anything else Space activates. Any key with ⌥/⌃
   (and ⌘ except ⌘↑/⌘↓) passes through.
   Respects prefers-reduced-motion: the same steps, applied instantly.
   No init call — include before </body>. ~3KB. Exposes window.SmoothScroll.  */
(function () {
  'use strict';
  if (window.SmoothScroll) return;

  /* WebKit macOS KeyboardScrollParameters */
  var MASS = 1, STIFF = 175, DAMP = 20, MAX_VEL_MULT = 25, TIME_TO_MAX = 0.2;
  var LINE = 40;                         /* Scrollbar::pixelsPerLineStep()          */
  var PAGE_MIN_FRACTION = 0.875;         /* Scrollbar::minFractionToStepWhenPaging  */
  var PAGE_OVERLAP = 40;                 /* Scrollbar::maxOverlapBetweenPages        */

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  var docEl = function () { return document.scrollingElement || document.documentElement; };

  function canScroll(el) {
    if (el === docEl()) return el.scrollHeight > el.clientHeight;
    var s = getComputedStyle(el), o = s.overflowY;
    return (o === 'auto' || o === 'scroll' || o === 'overlay') && el.scrollHeight > el.clientHeight + 1;
  }
  function scrollerFrom(node) {
    for (var el = node; el && el.nodeType === 1; el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      if (canScroll(el)) return el;
    }
    return canScroll(docEl()) ? docEl() : null;
  }

  var hovered = null, clicked = null;
  addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') hovered = e.target; }, { passive: true });
  addEventListener('pointerdown', function (e) { clicked = e.target; }, { passive: true });
  document.addEventListener('mouseleave', function () { hovered = null; });

  function pickScroller() {
    var a = document.activeElement;
    return (hovered && scrollerFrom(hovered)) ||
           (a && a !== document.body && scrollerFrom(a)) ||
           (clicked && scrollerFrom(clicked)) ||
           scrollerFrom(document.body);
  }

  // controls that use arrows / Page / Home / End themselves keep them
  function ownsKeys(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    var t = el.tagName;
    if (t === 'TEXTAREA' || t === 'SELECT') return true;
    if (t === 'INPUT') return !/^(button|submit|reset|checkbox|color|file|image)$/i.test(el.type);
    var r = el.getAttribute && el.getAttribute('role');
    return !!r && /^(slider|spinbutton|radio|radiogroup|tab|tablist|listbox|option|menu|menubar|menuitem|combobox|grid|tree|treeitem|textbox)$/.test(r);
  }
  function spaceActivates(el) {
    if (!el || el === document.body) return false;
    if (/^(BUTTON|A|SUMMARY|INPUT)$/.test(el.tagName)) return true;
    var r = el.getAttribute && el.getAttribute('role');
    return !!r && /^(button|link|tab|checkbox|radio|switch|menuitem|option|slider)$/.test(r);
  }

  /* One animator per scroller ------------------------------------------- */
  var anims = new WeakMap();
  function Anim(el) {
    this.el = el; this.pos = el.scrollTop; this.vel = 0;
    this.held = null; this.ideal = this.pos; this.minTravel = this.pos;
    this.raf = 0; this.last = 0;
  }
  Anim.prototype.max = function () { return this.el.scrollHeight - this.el.clientHeight; };
  Anim.prototype.sync = function () {
    // the user may have scrolled by wheel/trackpad since we last moved it
    if (!this.raf) { this.pos = this.el.scrollTop; this.ideal = this.pos; this.vel = 0; }
  };
  Anim.prototype.run = function () {
    if (this.raf) return;
    var self = this; this.last = performance.now();
    this.raf = requestAnimationFrame(function f(t) { self.step(t) ? (self.raf = requestAnimationFrame(f)) : (self.raf = 0); });
  };
  Anim.prototype.stop = function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.vel = 0; this.held = null; };
  Anim.prototype.write = function () {
    var max = this.max();
    if (this.pos <= 0 || this.pos >= max) {          // hit an edge: stop there, no overshoot
      this.pos = Math.min(Math.max(this.pos, 0), max);
      this.vel = 0; this.ideal = this.pos;
      this.el.scrollTop = this.pos;
      return false;
    }
    this.el.scrollTop = this.pos;
    return true;
  };
  /* ScrollAnimationKeyboard::animateScroll */
  Anim.prototype.step = function (t) {
    var dt = (t - this.last) / 1000; this.last = t;
    if (dt <= 0) return true;
    if (dt > 0.05) dt = 0.05;                          // a stalled frame shouldn't fling
    var force = 0, spring = true, ideal = this.ideal;
    if (this.held) {
      force = this.held.force; spring = false; ideal = this.pos;
      if (Math.abs(this.vel) >= Math.abs(this.held.maxVel)) force = 0;
    }
    var disp = this.pos - ideal;
    if (spring) force -= disp * STIFF + this.vel * DAMP;
    this.vel += force / MASS * dt;
    this.pos += this.vel * dt;
    var inside = this.write();
    if (spring && disp * (this.pos - ideal) < 0) { this.vel = 0; this.pos = ideal; this.el.scrollTop = ideal; }
    if (!inside && !this.held) return false;
    if (!this.held && this.vel * this.vel < 1 && Math.abs(this.pos - ideal) < 0.5) { this.vel = 0; return false; }
    return true;
  };
  /* startKeyboardScroll — velocity carries over, like WebKit */
  Anim.prototype.hold = function (dir, step) {
    var maxVel = step * MAX_VEL_MULT * dir;
    this.held = { dir: dir, maxVel: maxVel, force: maxVel * MASS / TIME_TO_MAX };
    this.minTravel = this.pos + step * dir;
    this.run();
  };
  /* stopKeyboardScrollAnimation */
  Anim.prototype.release = function () {
    if (!this.held) return;
    var d = Math.sqrt(this.vel * this.vel * MASS / STIFF) * (this.vel < 0 ? -1 : 1);
    var settle = this.pos + d;
    this.ideal = this.held.dir > 0 ? Math.max(settle, this.minTravel) : Math.min(settle, this.minTravel);
    this.ideal = Math.round(Math.min(Math.max(this.ideal, 0), this.max()));
    this.held = null;
    this.run();
  };
  /* a jump to a target (top / bottom, or the public API): spring there */
  Anim.prototype.to = function (target) {
    var base = this.raf && !this.held ? this.ideal : this.pos;
    if (typeof target === 'function') target = target(base);
    this.held = null;
    this.ideal = Math.round(Math.min(Math.max(target, 0), this.max()));
    this.run();
  };

  function anim(el) { var a = anims.get(el); if (!a) { a = new Anim(el); anims.set(el, a); } a.sync(); return a; }
  function pageStep(el) {
    var h = el === docEl() ? innerHeight : el.clientHeight;
    return Math.max(h * PAGE_MIN_FRACTION, h - PAGE_OVERLAP);
  }

  var heldKey = null, heldAnim = null;
  function releaseHeld() { if (heldAnim) heldAnim.release(); heldKey = heldAnim = null; }

  addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey) return;
    var k = e.key, cmdArrow = e.metaKey && (k === 'ArrowUp' || k === 'ArrowDown');
    if (e.metaKey && !cmdArrow) return;
    if (!/^( |ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(k)) return;
    var act = document.activeElement;
    if (ownsKeys(act)) return;
    if (k === ' ' && spaceActivates(act)) return;
    if ((k === 'ArrowUp' || k === 'ArrowDown') && e.shiftKey && !cmdArrow) return;   // leave selection alone

    var el = pickScroller(); if (!el) return;
    e.preventDefault();
    var edge = cmdArrow || k === 'Home' || k === 'End';
    if (!edge && (e.repeat || heldKey)) return;                // WebKit ignores repeats and other keys while one is held
    var a = anim(el), page = pageStep(el);

    if (reduce && reduce.matches) {                       // same steps, no animation
      a.stop();
      var dy = k === 'ArrowDown' ? LINE : k === 'ArrowUp' ? -LINE :
               (k === ' ' && !e.shiftKey) || k === 'PageDown' ? page : page * -1;
      if (k === 'Home' || (cmdArrow && k === 'ArrowUp')) el.scrollTop = 0;
      else if (k === 'End' || (cmdArrow && k === 'ArrowDown')) el.scrollTop = el.scrollHeight;
      else el.scrollTop += dy;
      return;
    }

    if (edge) {
      a.to(k === 'Home' || k === 'ArrowUp' ? 0 : a.max());
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      heldKey = k; heldAnim = a; a.hold(k === 'ArrowDown' ? 1 : -1, LINE);
    } else {
      heldKey = k; heldAnim = a;
      a.hold((k === ' ' && !e.shiftKey) || k === 'PageDown' ? 1 : -1, page);
    }
  });
  addEventListener('keyup', function (e) { if (e.key === heldKey) releaseHeld(); });
  addEventListener('blur', releaseHeld);
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseHeld(); });
  /* a wheel/trackpad scroll takes over from a gliding key scroll */
  addEventListener('wheel', function (e) {
    var el = scrollerFrom(e.target), a = el && anims.get(el);
    if (a && a.raf && !a.held) a.stop();
  }, { passive: true });

  window.SmoothScroll = {
    /* programmatic glide, e.g. SmoothScroll.to(pane, 0) to send a pane home */
    to: function (el, y) { anim(el || docEl()).to(y); },
    by: function (el, dy) { var a = anim(el || docEl()); a.to(function (b) { return b + dy; }); }
  };
})();
