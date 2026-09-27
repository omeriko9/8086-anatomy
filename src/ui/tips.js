// Tooltips: every control with a title (or data-tip) gets a small styled tip on hover
// and on keyboard focus. The title moves to data-tip so the browser does not show a
// second, slower tip.

const Tips = {
  init(doc) {
    const tip = doc.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    doc.body.appendChild(tip);
    let timer = 0, cur = null;
    const target = e => {
      const el = e.target && e.target.closest ? e.target.closest('[data-tip],[title]') : null;
      if (!el) return null;
      if (el.hasAttribute('title')) {
        const t = el.getAttribute('title');
        el.removeAttribute('title');
        if (t) el.dataset.tip = t;
      }
      return el.dataset.tip ? el : null;
    };
    const hide = () => { clearTimeout(timer); cur = null; tip.hidden = true; };
    const show = el => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const win = doc.defaultView, r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - t.width / 2;
      x = Math.max(8, Math.min(win.innerWidth - t.width - 8, x));
      let y = r.top - t.height - 8;
      tip.classList.toggle('below', y < 6);
      if (y < 6) y = r.bottom + 8;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    };
    const arm = (el, delay) => {
      if (el === cur) return;
      hide();
      cur = el;
      timer = setTimeout(() => { if (cur === el && el.isConnected) show(el); }, delay);
    };
    doc.addEventListener('pointerover', e => { if (e.pointerType === 'touch') return; const el = target(e); if (el) arm(el, 380); else if (cur && !cur.contains(e.target)) hide(); });
    doc.addEventListener('focusin', e => { const el = target(e); if (el && el.matches(':focus-visible')) arm(el, 150); });
    doc.addEventListener('focusout', hide);
    doc.addEventListener('pointerdown', hide, true);
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    doc.addEventListener('scroll', hide, true);
    // keep the text fresh when a control changes its tip while it shows
    new MutationObserver(() => { if (cur && !tip.hidden && cur.dataset.tip !== tip.textContent) show(cur); })
      .observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['data-tip'] });
  },
};
// Set the tooltip and the accessible name of a control together.
function setTip(el, text, label) {
  el.dataset.tip = text;
  el.removeAttribute('title');
  el.setAttribute('aria-label', label || text);
}
