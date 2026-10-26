// Reads the shortlist carried after # in the link, then draws it. The listings never reach this server.
(async () => {
  const m = location.hash.match(/[#&]d=([A-Za-z0-9_-]+)/);
  const say = (t) => { const el = document.getElementById('msg'); if (el) el.textContent = t; };
  if (!m) { say('This link has no listings in it. Ask whoever sent it to share it again.'); return; }
  if (typeof DecompressionStream === 'undefined') { say('This browser is too old to open the shortlist. Update iOS or Chrome and tap the link again.'); return; }
  let D;
  try { D = await Share.decode(m[1]); } catch (e) { say('This link looks cut off. Ask whoever sent it to copy it again.'); return; }
  const hash = location.hash;
  document.open(); document.write(Share.page(D)); document.close();
  // in-page jumps scroll instead of replacing the # that holds the listings
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#p"]'); if (!a) return;
    e.preventDefault(); const t = document.querySelector(a.getAttribute('href')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if (location.hash !== hash) history.replaceState(null, '', hash);
})();
