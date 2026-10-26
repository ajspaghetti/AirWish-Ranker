// Mobile share: packs up to 5 listings into a small object, renders a phone-first page from it (no JavaScript needed
// to read it, so it also works as a Messages attachment), encodes it into a link, and writes an SMS-friendly text.
(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (x) => (x == null ? '' : '$' + Math.round(+x).toLocaleString('en-US'));
  const PHOTO = 'https://a0.muscache.com/im/pictures/';
  const CAT = [['loc', 'Location', '#4FC1B0'], ['space', 'Space & sleep', '#E58E73'], ['comfort', 'Comfort', '#7DB2E8'], ['outdoor', 'Outdoor & views', '#E8C26A'], ['trust', 'Reviews & trust', '#B7A3F0'], ['value', 'Value', '#7BD88F']];
  const short = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trim() + '…' : String(s));
  const fmtDate = (s) => { if (!s) return ''; const d = new Date(s + 'T12:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

  // res = Scorer.score output, list = Model records, idxs = listing indexes in share order
  function pack(res, list, idxs, meta, board) {
    const L0 = list[idxs[0]] || {};
    return {
      v: 1, n: meta.name || 'Wishlist', d: [L0.check_in || '', L0.check_out || ''], a: meta.adults || L0.adults || 1, by: meta.me || '', of: list.length, b: board || 'overall',
      at: new Date().toISOString().slice(0, 10),
      x: idxs.slice(0, 5).map((i) => {
        const L = list[i], g = L.geo || {}, s = L.sleep;
        const c = {}; CAT.forEach(([k]) => { if (res.C[k][i] != null) c[k] = Math.round(res.C[k][i]); });
        return {
          i: L.id, n: L.name || L.property_type + ' in ' + L.town, t: L.town, ty: L.property_type,
          p: L.cover && L.cover.startsWith(PHOTO) ? L.cover.slice(PHOTO.length).replace(/\?.*$/, '') : L.cover || '',
          r: res.R.overall[i], s: res.O[i] != null ? Math.round(res.O[i]) : null, c,
          pp: L.ppan != null ? Math.round(L.ppan) : null, tot: L.price, ra: L.rating, rc: L.reviews,
          sl: (s.studio ? 'Studio' : s.bedrooms != null ? s.bedrooms + ' BR' : '') + (s.summary ? ' · ' + s.summary : ''), ba: L.baths,
          tr: g.transit ? g.transit.min + ' min ' + (g.transit.kind || 'transit') : '', ce: g.center ? g.center.min + ' min to ' + (g.center.name || 'center') : '',
          sea: g.sea && g.sea.src !== 'beyond' ? g.sea.min : null,
          pr: res.pros[i].slice(0, 4), co: res.cons[i].slice(0, 3).map((x) => x.replace(/ \(.*\)$/, '')),
          tg: res.shown[i].filter((t) => t.pol >= 0 && !res.pros[i].includes(t.label)).slice(0, 10).map((t) => t.label),
          vo: L.votes,
        };
      }),
    };
  }
  const photoUrl = (p, w = 720) => (!p ? '' : /^https?:/.test(p) ? p : PHOTO + p + '?im_w=' + w);
  const listingUrl = (D, x) => 'https://www.airbnb.com/rooms/' + x.i + '?adults=' + D.a + (D.d[0] ? '&check_in=' + D.d[0] + '&check_out=' + D.d[1] : '');

  // A complete, self-contained HTML document. photos: optional {listingId: dataURL} to embed images.
  function page(D, photos = {}) {
    const nights = D.d[0] && D.d[1] ? Math.max(1, Math.round((new Date(D.d[1]) - new Date(D.d[0])) / 864e5)) : null;
    const title = (D.by ? D.by + "'s " : '') + (D.x.length === 5 ? 'top 5' : D.x.length + ' picks') + ' · ' + D.n;
    const cards = D.x.map((x, k) => {
      const img = photos[x.i] || photoUrl(x.p);
      const facts = [
        ['Per adult per night', x.pp != null ? money(x.pp) : 'n/a', x.tot ? money(x.tot) + ' total' : ''],
        ['Rating', x.ra != null ? '★ ' + (+x.ra).toFixed(2) : 'New', (x.rc || 0) + ' reviews'],
        ['Sleeping', x.sl || 'n/a', x.ba != null ? x.ba + ' bath' + (x.ba === 1 ? '' : 's') : ''],
        ['Getting around', x.tr || 'n/a', x.ce || (x.sea != null ? x.sea + ' min to the sea' : '')],
      ];
      const votes = Object.entries(x.vo || {}).map(([w, v]) => '<span class="vote ' + (v === 'Yes' ? 'y' : 'n') + '">' + esc(w) + ': ' + esc(v) + '</span>').join('');
      return '<article class="card" id="p' + (k + 1) + '">' +
        '<div class="ph">' + (img ? '<img src="' + esc(img) + '" alt="">' : '') + '<span class="rk">' + (k + 1) + '</span>' + (x.s != null ? '<span class="sc"><b>' + x.s + '</b><small>score</small></span>' : '') + '</div>' +
        '<div class="bd"><h2>' + esc(x.n) + '</h2><div class="sub">' + esc(x.t) + (x.ty ? ' · ' + esc(x.ty) : '') + (x.r ? ' · #' + x.r + ' of ' + D.of : '') + '</div>' +
        '<div class="facts">' + facts.map(([l, v, s]) => '<div><span>' + esc(l) + '</span><b>' + esc(v) + '</b><small>' + esc(s) + '</small></div>').join('') + '</div>' +
        (x.pr.length || x.co.length ? '<div class="pills">' + x.pr.map((t) => '<span class="pos">' + esc(t) + '</span>').join('') + x.co.map((t) => '<span class="neg">' + esc(t) + '</span>').join('') + '</div>' : '') +
        (votes ? '<div class="votes">' + votes + '</div>' : '') +
        '<a class="btn" href="' + esc(listingUrl(D, x)) + '">Open on Airbnb</a>' +
        '<details><summary>Score breakdown and more</summary><div class="bars">' +
          CAT.filter(([c]) => x.c[c] != null).map(([c, l, col]) => '<div class="bar"><span>' + l + '</span><i><em style="width:' + x.c[c] + '%;background:' + col + '"></em></i><b>' + x.c[c] + '</b></div>').join('') + '</div>' +
          (x.tg.length ? '<div class="pills more">' + x.tg.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>' : '') + '</details>' +
        '</div></article>';
    }).join('');
    const cmpRows = [['Price', (x) => (x.pp != null ? money(x.pp) : '')], ['Rating', (x) => (x.ra != null ? (+x.ra).toFixed(2) : 'New')], ['Score', (x) => x.s ?? ''], ['Sleeping', (x) => x.sl.split(' · ')[0] || ''], ['Transit', (x) => x.tr.replace(/ min.*/, ' min')]];
    const compare = '<details class="cmp" open><summary>Side by side</summary><div class="tw"><table><tr><th></th>' + D.x.map((x, k) => '<th><a href="#p' + (k + 1) + '">' + (k + 1) + '. ' + esc(short(x.n, 16)) + '</a></th>').join('') + '</tr>' +
      cmpRows.map(([l, f]) => '<tr><td>' + l + '</td>' + D.x.map((x) => '<td>' + esc(f(x)) + '</td>').join('') + '</tr>').join('') + '</table></div></details>';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
      '<meta name="color-scheme" content="dark"><title>' + esc(title) + '</title><meta property="og:title" content="' + esc(title) + '">' +
      '<meta property="og:description" content="' + esc(D.x.map((x, k) => (k + 1) + '. ' + x.n).join(' · ').slice(0, 190)) + '">' +
      '<style>' + CSS + '</style></head><body><header><div class="h1">' + esc(D.n) + '</div><div class="meta">' + esc([fmtDate(D.d[0]) && fmtDate(D.d[0]) + ' to ' + fmtDate(D.d[1]), nights ? nights + ' night' + (nights > 1 ? 's' : '') : '', D.a + ' adults'].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="meta">' + esc((D.by ? D.by + "'s " : '') + (D.x.length === 5 ? 'top 5' : D.x.length + ' picks') + ' of ' + D.of + ' listings') + '</div>' +
      '</header><nav>' + D.x.map((x, k) => '<a href="#p' + (k + 1) + '">' + (k + 1) + '. ' + esc(short(x.n, 22)) + '</a>').join('') + '</nav><main>' + compare + cards + '</main>' +
      '<footer>Scores run 0 to 100 and compare listings within this wishlist (50 is its average). Prices are for the dates above. Made with AirWish Ranker · map data © OpenStreetMap contributors.</footer></body></html>';
  }
  const CSS = [
    ':root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;background:#0F1B26;color:#F3EEE6;font:16px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,Roboto,system-ui,sans-serif;-webkit-text-size-adjust:100%}',
    'header{background:#E8C26A;color:#0F1B26;padding:calc(14px + env(safe-area-inset-top)) 16px 6px}.h1{font-size:20px;font-weight:800;line-height:1.2}.meta{font-size:13px;margin-top:2px}',
    'nav{position:sticky;top:0;z-index:2;background:#E8C26A;display:flex;gap:6px;overflow-x:auto;padding:6px 16px 10px;scrollbar-width:none;box-shadow:0 6px 12px rgba(0,0,0,.25)}nav::-webkit-scrollbar{display:none}nav a{flex:0 0 auto;font-size:13px;font-weight:600;color:#0F1B26;background:rgba(15,27,38,.12);border-radius:999px;padding:6px 11px;text-decoration:none;white-space:nowrap}',
    'main{padding:12px 12px 8px;max-width:640px;margin:0 auto}.card{background:#172736;border:1px solid #2C4258;border-radius:16px;overflow:hidden;margin:0 0 16px;scroll-margin-top:60px}',
    '.ph{position:relative;aspect-ratio:16/10;background:#1E3245}.ph img{width:100%;height:100%;object-fit:cover;display:block}.rk{position:absolute;left:10px;top:10px;background:#F28DB2;color:#0F1B26;font-weight:800;border-radius:999px;min-width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:17px}',
    '.sc{position:absolute;right:10px;top:10px;background:rgba(15,27,38,.85);border-radius:12px;padding:4px 10px;text-align:center;line-height:1.05}.sc b{display:block;font-size:22px}.sc small{font-size:10px;color:#A9B8C6;text-transform:uppercase;letter-spacing:.05em}',
    '.bd{padding:12px 14px 14px}h2{font-size:18px;margin:0;line-height:1.25}.sub{color:#A9B8C6;font-size:13px;margin-top:3px}',
    '.facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.facts div{background:#1E3245;border-radius:10px;padding:8px 10px}.facts span{display:block;font-size:11px;color:#A9B8C6;text-transform:uppercase;letter-spacing:.04em}.facts b{display:block;font-size:15px;margin-top:2px}.facts small{display:block;font-size:12px;color:#A9B8C6}',
    '.pills{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 10px}.pills span{font-size:12.5px;padding:3px 9px;border-radius:999px;background:#22374B;border:1px solid #2C4258}.pills .pos{background:#16301F;border-color:#2F6B43;color:#A6E8B5}.pills .neg{background:#3A1C1C;border-color:#7A3434;color:#F7B0B0}',
    '.votes{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.vote{font-size:12.5px;padding:3px 9px;border-radius:8px;background:#1E3245}.vote.y{color:#A6E8B5}.vote.n{color:#F7B0B0}',
    '.btn{display:block;text-align:center;background:#F28DB2;color:#0F1B26;font-weight:800;text-decoration:none;border-radius:12px;padding:13px;font-size:16px}',
    'details{margin-top:10px}summary{cursor:pointer;color:#E8C26A;font-weight:600;font-size:14px;padding:6px 0;list-style-position:inside}.bars{margin-top:6px}.bar{display:grid;grid-template-columns:118px 1fr 30px;gap:8px;align-items:center;font-size:13px;margin:5px 0}.bar i{height:8px;background:#2C4258;border-radius:4px;overflow:hidden;display:block}.bar em{display:block;height:100%}.bar b{text-align:right}',
    '.pills.more span{color:#D5DEE6}.cmp{background:#172736;border:1px solid #2C4258;border-radius:16px;padding:6px 12px 10px;margin:0 0 16px}.tw{overflow-x:auto}table{border-collapse:collapse;font-size:13px;min-width:100%}th,td{padding:6px 8px;text-align:left;white-space:nowrap;border-bottom:1px solid #22374B}th a{color:#F3EEE6;text-decoration:none}td:first-child{color:#A9B8C6}',
    'footer{color:#A9B8C6;font-size:12px;padding:6px 16px calc(24px + env(safe-area-inset-bottom));max-width:640px;margin:0 auto}a{color:#F3EEE6}',
  ].join('');

  // Plain text for SMS or iMessage: one short block per listing with its Airbnb link.
  function text(D) {
    const head = D.n + (D.d[0] ? ' · ' + fmtDate(D.d[0]) + ' to ' + fmtDate(D.d[1]) : '') + ' · ' + D.a + ' adults';
    const lines = [head, (D.by ? D.by + "'s " : '') + (D.x.length === 5 ? 'top 5' : D.x.length + ' picks') + ':', ''];
    D.x.forEach((x, k) => {
      lines.push((k + 1) + '. ' + x.n + ' (' + x.t + ')');
      lines.push([x.pp != null ? money(x.pp) + '/adult/night' : '', x.ra != null ? (+x.ra).toFixed(2) + '★ (' + x.rc + ')' : 'new', x.sl.split(' · ')[0], x.tr].filter(Boolean).join(' · '));
      if (x.pr.length) lines.push('+ ' + x.pr.slice(0, 3).join(', '));
      if (x.co.length) lines.push('− ' + x.co.slice(0, 2).join(', '));
      lines.push('https://www.airbnb.com/rooms/' + x.i, '');
    });
    return lines.join('\n').trim();
  }

  // Link payload: deflate + base64url, carried after # so it never reaches the host server.
  const b64u = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; };
  async function pipe(bytes, stream) { const r = new Blob([bytes]).stream().pipeThrough(stream); return new Uint8Array(await new Response(r).arrayBuffer()); }
  async function encode(D) { return b64u(await pipe(new TextEncoder().encode(JSON.stringify(D)), new CompressionStream('deflate-raw'))); }
  async function decode(s) { return JSON.parse(new TextDecoder().decode(await pipe(unb64u(s), new DecompressionStream('deflate-raw')))); }

  const api = { pack, page, text, encode, decode, photoUrl, listingUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Share = api;
})(typeof window !== 'undefined' ? window : globalThis);
