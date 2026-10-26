// AirWish Ranker results page: runs collection for one wishlist, then scores, filters, sorts, explains and shares it.
const qs = new URLSearchParams(location.search);
const WL = qs.get('wl');
const OPS = ['WishlistDetailPageDataQuery', 'StaysPdpSections', 'StaysPdpReviewsQuery', 'StaysPdpPoliciesQuery'];
const CAT_COLOR = { overall: '#F28DB2', loc: '#4FC1B0', space: '#E58E73', comfort: '#7DB2E8', outdoor: '#E8C26A', trust: '#B7A3F0', value: '#7BD88F', votes: '#F2C14E', budget: '#9FE0B0' };
const BOARDS = [['overall', 'Overall'], ['loc', 'Location'], ['space', 'Space & Sleep'], ['comfort', 'Comfort & Amenities'], ['outdoor', 'Outdoor & Views'], ['trust', 'Reviews & Trust'], ['value', 'Value'], ['budget', 'Budget']];
const SEG = ['#4FC1B0', '#E8C26A', '#7DB2E8', '#B7A3F0', '#E58E73', '#F28DB2', '#7BD88F', '#F2C14E', '#9AA9F0', '#E0A0D0'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'voter';
const money = (x) => (x == null || x === '' ? '' : '$' + Math.round(+x).toLocaleString('en-US'));
const f1 = (x) => (x == null ? '' : (Math.round(x * 10) / 10).toFixed(1));

let state = { meta: null, items: [], E: {}, err: {}, G: {}, ts: null, recipe: {}, probe: null, geoInfo: null };
let over = {};          // your settings: only what differs from the defaults, shared by every wishlist
let view = { board: 'overall', sort: { key: 'overall', dir: -1 }, q: '', must: [], excl: [], towns: [], num: {}, flags: {}, picks: [], open: null, filtersOpen: false };
let list = [], res = null, setTab = 'weights';

// ---------- storage ----------
const save = () => chrome.storage.local.set({ ['wl:' + WL]: state });
const saveView = () => chrome.storage.local.set({ ['view:' + WL]: { board: view.board, sort: view.sort, must: view.must, excl: view.excl, towns: view.towns, num: view.num, flags: view.flags, picks: view.picks } });
let overTimer = null;
const saveOver = () => { clearTimeout(overTimer); overTimer = setTimeout(() => chrome.storage.local.set({ 'settings:v3': over }), 250); };
async function loadOps() {
  const all = await chrome.storage.local.get(null);
  const ops = {}; OPS.forEach((o) => { if (all['op:' + o]) ops[o] = all['op:' + o]; });
  return { ops, key: all.apiKey || null };
}
const tabTok = async (tabId) => { const t = (await chrome.storage.local.get('tok:' + tabId))['tok:' + tabId]; return t ? t.csrf : null; };

// ---------- tabs and scripting ----------
async function waitComplete(tabId, ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const tb = await chrome.tabs.get(tabId); if (tb.status === 'complete' && tb.url && !tb.url.startsWith('about:')) return; } catch (e) { return; }
    await sleep(400);
  }
}
async function go(tabId, url, settle = 4000) { await chrome.tabs.update(tabId, { url }); await sleep(600); await waitComplete(tabId); await sleep(settle); }
async function exec(tabId, func, args = []) { const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args }); return r && r.result; }
async function inject(tabId) { await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['collector.js'] }); }
async function waitOps(names, ms) { const end = Date.now() + ms; for (;;) { const { ops } = await loadOps(); if (names.every((n) => ops[n])) return true; if (Date.now() > end) return false; await sleep(700); } }

// ---------- run steps UI ----------
const STEPS = [['learn', 'Learn Airbnb calls'], ['cards', 'Wishlist cards'], ['details', 'Listing details and reviews'], ['walk', 'Map and walking times'], ['score', 'Scores']];
function step(id, status, text, frac) {
  $('stepsPanel').hidden = false;
  let el = document.querySelector('.step[data-id="' + id + '"]');
  if (!el) {
    $('steps').innerHTML = STEPS.map(([k, t]) => '<div class="step" data-id="' + k + '"><div class="t">' + t + '</div><div class="s"></div><div class="bar"><i></i></div></div>').join('');
    el = document.querySelector('.step[data-id="' + id + '"]');
  }
  el.className = 'step ' + status;
  el.querySelector('.s').textContent = text || '';
  el.querySelector('.bar > i').style.width = Math.round(100 * (frac ?? (status === 'done' ? 1 : 0))) + '%';
}
const notice = (msg, err) => { $('notice').textContent = msg || ''; $('notice').className = 'notice' + (err ? ' err' : ''); };
const badge = async (t) => { try { await chrome.action.setBadgeText({ text: t || '' }); } catch (e) { /* no badge */ } };

// ---------- run ----------
async function run() {
  $('rerun').disabled = true; notice('');
  const complete = state.items.length && state.items.every((it) => state.E[it.listing_id] && state.E[it.listing_id].v === 2) && state.geoInfo;
  if (complete) { state.E = {}; state.G = {}; state.err = {}; state.geoInfo = null; } // a finished run starts fresh; an unfinished one resumes
  let worker;
  try {
    worker = (await chrome.tabs.create({ url: 'https://www.airbnb.com/wishlists/' + WL, active: false })).id;
    step('learn', 'run', 'Opening the wishlist in a background tab');
    await waitComplete(worker); await sleep(3500);
    if (!(await waitOps(['WishlistDetailPageDataQuery'], 15000))) throw new Error('Could not see the wishlist load. Make sure you are logged in to Airbnb, then click Re-run.');

    step('cards', 'run', 'Reading the wishlist');
    let { ops, key } = await loadOps();
    await inject(worker);
    const w = await exec(worker, async (cfg, id) => { try { ABW.init(cfg); const r = await ABW.wishlist(id); r.recipe = ABW.recipe; return r; } catch (e) { return { error: String(e.message || e) }; } }, [{ ops, key, csrf: await tabTok(worker) }, WL]);
    if (!w || w.error) throw new Error('Wishlist read failed: ' + (w && w.error));
    state.meta = w.meta; state.items = w.items; state.ts = Date.now(); state.recipe = Object.assign(state.recipe || {}, w.recipe || {}); save(); render();
    step('cards', 'done', w.items.length + ' listings' + (w.meta.hasNextPage ? ' (first page only)' : ''));

    const first = state.items[0];
    const q = '?adults=' + state.meta.adults + (first.check_in ? '&check_in=' + first.check_in + '&check_out=' + first.check_out : '');
    ({ ops } = await loadOps());
    if (!ops.StaysPdpSections || !ops.StaysPdpReviewsQuery || !ops.StaysPdpPoliciesQuery) {
      step('learn', 'run', 'Learning listing calls on one listing page');
      await go(worker, 'https://www.airbnb.com/rooms/' + first.listing_id + q, 5000);
      if (!(await waitOps(['StaysPdpReviewsQuery'], 2000))) await go(worker, 'https://www.airbnb.com/rooms/' + first.listing_id + '/reviews' + q, 5000);
      if (!(await waitOps(['StaysPdpReviewsQuery'], 2000))) await exec(worker, clickFirst, [['show all', 'reviews']]);
      if (!(await waitOps(['StaysPdpPoliciesQuery'], 2000))) {
        await go(worker, 'https://www.airbnb.com/rooms/' + first.listing_id + q, 4000);
        await exec(worker, clickFirst, [['cancellation', 'learn more', 'show more']]);
        await waitOps(['StaysPdpPoliciesQuery'], 4000);
      }
    }
    ({ ops, key } = await loadOps());
    const missing = ['StaysPdpSections', 'StaysPdpReviewsQuery'].filter((o) => !ops[o]);
    if (missing.length) {
      step('learn', 'fail', 'Missing: ' + missing.join(', '));
      throw new Error('Airbnb did not make the ' + missing.join(' and ') + ' call on its own. Open any listing from this wishlist in a normal tab, change the guest count once, click "Show all reviews", then click Re-run.');
    }
    step('learn', 'done', ops.StaysPdpPoliciesQuery ? 'All 4 calls learned' : '3 of 4 learned (cancellation optional)');

    let url = ''; try { url = (await chrome.tabs.get(worker)).url || ''; } catch (e) { url = ''; }
    if (!/^https:\/\/www\.airbnb\.com\//.test(url)) await go(worker, 'https://www.airbnb.com/rooms/' + first.listing_id + q, 2000);
    await collect(worker, { ops, key, csrf: await tabTok(worker) });
    await mapAll();
    step('score', 'done', 'Ranked ' + state.items.length + ' listings');
    state.ts = Date.now(); save(); render(); badge('');
  } catch (e) {
    notice(String(e.message || e), true); badge('!');
  } finally {
    if (worker) { try { await chrome.tabs.remove(worker); } catch (e) { /* already closed */ } }
    $('rerun').disabled = false;
  }
}

function clickFirst(words) {
  return (async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 14; i++) { window.scrollBy(0, 800); await pause(350); }
    const els = [...document.querySelectorAll('button, a, [role="button"]')];
    const txt = (b) => ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).toLowerCase();
    let hit = els.find((b) => words.every((w) => txt(b).includes(w.toLowerCase())));
    if (!hit) hit = els.find((b) => txt(b).includes(words[words.length - 1]) && /cancellation|reviews/.test(((b.closest('section, [data-section-id]') || {}).textContent || '').toLowerCase()));
    if (hit) { hit.scrollIntoView(); hit.click(); }
    await pause(3000);
    return !!hit;
  })();
}

async function collect(worker, cfg) {
  const total = state.items.length;
  const isDone = (id) => state.E[id] && state.E[id].v === 2;
  const doneIds = () => state.items.filter((it) => isDone(it.listing_id)).map((it) => it.listing_id);
  step('details', 'run', doneIds().length + ' of ' + total, doneIds().length / total);
  if (doneIds().length === total) { step('details', 'done', total + ' of ' + total); return; }
  const start = async (delay) => { await inject(worker); await exec(worker, (c, meta, items, done, d) => { ABW.init(c, meta); ABW.run(items, { delay: d, skip: done }); return true; }, [cfg, state.meta, state.items, doneIds(), delay]); };
  await start(700);
  let stalls = 0;
  for (;;) {
    await sleep(2500);
    let p;
    try { p = await exec(worker, () => (window.ABW ? ABW.progress() : null)); } catch (e) { p = null; }
    if (!p) {
      if (++stalls > 4) throw new Error('The background Airbnb tab stopped responding. Click Re-run to resume.');
      await start(900); continue;
    }
    const t = await exec(worker, () => ABW.take());
    if (t) { Object.assign(state.E, t.E); state.err = t.err; state.recipe = Object.assign(state.recipe || {}, t.recipe || {}); if (t.probe) state.probe = t.probe; if (Object.keys(t.E).length) save(); }
    const done = doneIds().length;
    step('details', 'run', done + ' of ' + total + (p.errors ? ' · ' + p.errors + ' errors' : ''), done / total);
    badge(Math.round((100 * done) / total) + '%');
    if (!p.running) break;
  }
  const errs = Object.values(state.err);
  if (errs.length && errs.filter((x) => /PersistedQuery|not learned/i.test(x)).length > errs.length / 2) {
    await chrome.storage.local.remove(['op:StaysPdpSections', 'op:StaysPdpReviewsQuery', 'op:StaysPdpPoliciesQuery']);
    throw new Error('Airbnb updated its site, so the learned calls expired. Click Re-run to learn them again.');
  }
  if (errs.length && errs.filter((x) => /HTTP 40[13]/.test(x)).length > errs.length / 2 && doneIds().length < total / 2) {
    step('details', 'fail', doneIds().length + ' of ' + total + ' · Airbnb refused ' + errs.length);
    throw new Error('Airbnb refused the listing requests (' + (errs[0].match(/HTTP \d+/) || ['HTTP 401'])[0] + '). Check that you are logged in to airbnb.com in this Chrome profile, then click Re-run. If it repeats, click Copy diagnostics and send it to Claude.');
  }
  step('details', errs.length ? 'fail' : 'done', doneIds().length + ' of ' + total + (errs.length ? ' · ' + errs.length + ' failed (Re-run retries them)' : ''));
}

async function mapAll() {
  const pts = state.items.map((it) => { const e = state.E[it.listing_id] || {}; return { id: it.listing_id, lat: +(it.lat || e.lat), lng: +(it.lng || e.lng) }; }).filter((p) => p.lat && p.lng);
  if (!pts.length) { step('walk', 'fail', 'No map pins on the cards'); return; }
  if (state.geoInfo && pts.every((p) => state.G[p.id] && state.G[p.id].v === 2)) { step('walk', 'done', 'Already mapped'); return; }
  step('walk', 'run', 'Loading map data around ' + pts.length + ' listings', 0.02);
  const r = await Geo.analyze(pts, { onProgress: (f, t) => step('walk', 'run', t, f), log: (m) => notice(m, true) });
  state.G = r.metrics; state.geoInfo = { tiles: r.tiles, layers: r.layers, at: Date.now() }; save();
  const routed = Object.values(r.metrics).filter((m) => m.transit && m.transit.src === 'routed').length;
  step('walk', Object.keys(r.metrics).length ? 'done' : 'fail', Object.keys(r.metrics).length + ' mapped · ' + routed + ' with routed walks (OpenStreetMap)');
}

// ---------- settings overrides ----------
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function defaultAt(path) {
  const p = path.split('.');
  if (p[0] === 'factors') { const f = Scorer.FACTORS.find((x) => x.id === p[1]); return p[2] === 'w' ? f.w : p[2] === 'on' ? true : false; }
  if (p[0] === 'tags') { const t = Tags.BY_ID[p[1]]; return p[2] === 'w' ? t.w : 'normal'; }
  return getPath(Scorer.DEFAULTS, path);
}
function prune(o) { Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) { prune(o[k]); if (!Object.keys(o[k]).length) delete o[k]; } }); }
function setOver(path, value) {
  const p = path.split('.'); let o = over;
  p.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null || Array.isArray(o[k])) o[k] = {}; o = o[k]; });
  if (JSON.stringify(value) === JSON.stringify(defaultAt(path))) delete o[p[p.length - 1]]; else o[p[p.length - 1]] = value;
  prune(over); saveOver(); render(); renderSettings();
}

// ---------- scoring and derived view data ----------
function rescore() {
  list = state.items.map((it) => Model.build(it, state.E[it.listing_id], state.G[it.listing_id], state.meta));
  res = list.length ? Scorer.score(list, over) : null;
}
const boardScore = (k, i) => (k === 'overall' ? res.O[i] : k === 'budget' ? res.B[i] : res.C[k] ? res.C[k][i] : null);
function sortVal(key, i) {
  const L = list[i], gg = L.geo || {};
  switch (key) {
    case 'name': return L.name.toLowerCase();
    case 'ppan': return L.ppan;
    case 'rating': return L.rating;
    case 'reviews': return L.reviews;
    case 'sleep': return L.sleep.spots + (L.sleep.bedrooms || 0) / 10;
    case 'transit': return gg.transit ? gg.transit.min : null;
    case 'flags': return res.fl[i].pr;
    case 'votes': return res.C.votes[i];
    default: return boardScore(key, i);
  }
}
function haystack(i) {
  const L = list[i], gg = L.geo || {};
  return [L.name, L.town, L.property_type, L.badge, L.sleep.summary, L.bath_type, L.cancellation, gg.transit && (gg.transit.kind + ' ' + gg.transit.name), gg.center && gg.center.name,
    ...res.shown[i].map((t) => t.label), ...Object.values(L.notes), ...Object.entries(L.votes).map(([k, v]) => k + ' ' + v)].join(' | ').toLowerCase();
}
function visible() {
  const toks = (view.q.toLowerCase().match(/"[^"]+"|\S+/g) || []).map((t) => t.replace(/"/g, ''));
  const n = view.num, fl = view.flags;
  return list.map((_, i) => i).filter((i) => {
    const L = list[i], gg = L.geo || {};
    if (!res.elig[i]) return false;
    if (fl.budgetOnly && !res.belig[i]) return false;
    if (view.towns.length && !view.towns.includes(L.town)) return false;
    if (n.maxPpan != null && (L.ppan == null || L.ppan > n.maxPpan)) return false;
    if (n.minRating != null && L.rating != null && L.rating < n.minRating) return false;
    if (n.minReviews != null && L.reviews < n.minReviews) return false;
    if (n.minBedrooms != null && (L.sleep.bedrooms ?? 0) < n.minBedrooms) return false;
    if (n.minRealCap != null && L.sleep.spots < n.minRealCap) return false;
    if (n.minBaths != null && (L.baths ?? 0) < n.minBaths) return false;
    if (n.maxTransit != null && (!gg.transit || gg.transit.min > n.maxTransit)) return false;
    if (n.maxCenter != null && (!gg.center || gg.center.min > n.maxCenter)) return false;
    const vs = Object.values(L.votes);
    if (fl.hideNo && vs.includes('No')) return false;
    if (fl.onlyYes && !vs.includes('Yes')) return false;
    if (fl.noRed && res.shown[i].some((t) => t.group === 'Red flags')) return false;
    if (view.must.some((id) => res.tagv[i][id] !== 1)) return false;
    if (view.excl.some((id) => res.tagv[i][id] === 1)) return false;
    if (toks.length) { const h = haystack(i); if (!toks.every((t) => h.includes(t))) return false; }
    return true;
  });
}

// ---------- render ----------
function render() {
  if (!state.meta) return;
  rescore();
  renderHeader();
  if (!res) return;
  $('main').hidden = false;
  renderBanner(); renderPreset(); renderTabs(); renderFilters(); renderTable(); renderFoot();
}
function renderHeader() {
  const m = state.meta; $('title').textContent = m.name || 'Wishlist';
  const it = state.items.find((x) => x.check_in) || {};
  $('meta').innerHTML = '<b>' + state.items.length + '</b> listings' + (it.check_in ? ' · ' + esc(it.check_in) + ' to ' + esc(it.check_out) : '') + ' · ' + m.adults + ' adults' +
    (m.voters && m.voters.length ? ' · voters: ' + m.voters.map(esc).join(', ') : '') + (state.ts ? ' · updated ' + new Date(state.ts).toLocaleString() : '');
}
function renderBanner() {
  const legacy = list.filter((L) => L.legacy).length, missing = list.filter((L) => !L.collected).length, unmapped = list.filter((L) => !L.mapped).length;
  const msgs = [];
  if (legacy) msgs.push(legacy + ' listings were collected by version 1, so beds, amenity tags, green flags and warnings are incomplete.');
  if (missing) msgs.push(missing + ' listings have no details yet.');
  if (unmapped) msgs.push(unmapped + ' listings have no map data yet, so most location factors are skipped for them.');
  $('banner').hidden = !msgs.length;
  $('banner').innerHTML = msgs.length ? esc(msgs.join(' ')) + ' Click <b>Re-run</b> to refresh them.' : '';
}
function renderPreset() {
  const S = res.S, cur = S.cats ? 'Custom' : S.preset;
  $('preset').innerHTML = Object.keys(Scorer.PRESETS).concat(S.cats ? ['Custom'] : []).map((p) => '<option' + (p === cur ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
}
function renderTabs() {
  $('tabs').innerHTML = BOARDS.map(([k, t]) => '<button data-k="' + k + '" class="' + (k === view.board ? 'on' : '') + '" style="' + (k === view.board ? 'background:' + CAT_COLOR[k] : '') + '">' + esc(t) + '</button>').join('');
  [...$('tabs').children].forEach((b) => b.addEventListener('click', () => { view.board = b.dataset.k; view.sort = { key: b.dataset.k, dir: -1 }; saveView(); render(); }));
  const S = res.S, pi = S.cats || Scorer.PRESETS[S.preset];
  let r;
  if (view.board === 'overall') r = (S.cats ? 'Custom' : S.preset) + ': ' + Scorer.CATS.map((c) => c.label + ' ' + pi[c.id] + '%').join(' · ') + (S.combine.balance ? ' · categories balanced so each weight is its real pull' : '');
  else if (view.board === 'budget') r = 'Value ' + S.budget.wPrice + '% · Overall ' + (100 - S.budget.wPrice) + '% · only listings rated ' + S.budget.minRating + '+ with a red-flag rate at or under ' + Math.round(100 * S.budget.maxRedRate) + '%';
  else r = Scorer.FACTORS.filter((f) => f.cat === view.board).map((f) => { const c = Object.assign({ on: true, w: f.w }, (S.factors || {})[f.id] || {}); return (c.on && c.w > 0 ? '' : '(off) ') + f.label + ' ' + c.w + (res.constant[f.id] ? ' (same for all, ignored)' : ''); }).join(' · ');
  $('recipe').textContent = r;
}
function renderFilters() {
  $('filters').hidden = !view.filtersOpen; $('filtersBtn').setAttribute('aria-expanded', String(view.filtersOpen));
  const nAct = view.must.length + view.excl.length + view.towns.length + Object.values(view.num).filter((x) => x != null).length + Object.values(view.flags).filter(Boolean).length;
  $('fCount').textContent = nAct ? String(nAct) : '';
  if (!view.filtersOpen) return;
  const towns = {}; list.forEach((L) => { if (L.town) towns[L.town] = (towns[L.town] || 0) + 1; });
  $('townRow').innerHTML = '<span class="muted">Towns</span> ' + Object.entries(towns).sort((a, b) => b[1] - a[1]).map(([t, n]) => '<button class="chip town' + (view.towns.includes(t) ? ' on' : '') + '" data-town="' + esc(t) + '">' + esc(t) + ' <span class="n">' + n + '</span></button>').join('');
  document.querySelectorAll('[data-num]').forEach((el) => { const v = view.num[el.dataset.num]; if (document.activeElement !== el) el.value = v == null ? '' : v; });
  document.querySelectorAll('[data-flag]').forEach((el) => { el.checked = !!view.flags[el.dataset.flag]; });
  const counts = {}; list.forEach((L, i) => { if (!res.elig[i]) return; Tags.TAGS.forEach((t) => { if (res.tagv[i][t.id] === 1) counts[t.id] = (counts[t.id] || 0) + 1; }); });
  $('tagChips').innerHTML = Tags.GROUPS.map((g) => {
    const ts = Tags.TAGS.filter((t) => t.group === g && (counts[t.id] || view.must.includes(t.id) || view.excl.includes(t.id)));
    if (!ts.length) return '';
    return '<div class="tgroup"><h4>' + esc(g) + '</h4>' + ts.map((t) => '<button class="chip' + (view.must.includes(t.id) ? ' must' : view.excl.includes(t.id) ? ' excl' : '') + '" data-tag="' + t.id + '">' + esc(t.label) + ' <span class="n">' + (counts[t.id] || 0) + '</span></button>').join('') + '</div>';
  }).join('');
}
function pillsFor(i, max = 7) {
  const ts = res.shown[i], pos = ts.filter((t) => t.pol > 0).sort((a, b) => b.imp - a.imp), neg = ts.filter((t) => t.pol < 0).sort((a, b) => b.imp - a.imp), neu = ts.filter((t) => t.pol === 0);
  const pick = neg.slice(0, 3).concat(pos.slice(0, max - Math.min(3, neg.length)), neu).slice(0, max);
  const more = ts.length - pick.length;
  return pick.map((t) => '<span class="pill ' + (t.pol > 0 ? 'pos' : t.pol < 0 ? 'neg' : '') + '" title="' + esc(t.group + (t.detail ? ': ' + t.detail : '')) + '">' + esc(t.label) + '</span>').join('') + (more > 0 ? '<span class="pill more">+' + more + '</span>' : '');
}
const ALL_COLS = [
  ['Pick', null], ['#', null], ['', null], ['Listing', 'name'], ['Score', 'board'], ['Overall', 'overall'], ['Loc', 'loc'], ['Space', 'space'], ['Comfort', 'comfort'], ['Outdoor', 'outdoor'], ['Trust', 'trust'], ['Value', 'value'],
  ['$/adult/night', 'ppan'], ['Rating', 'rating'], ['Sleep', 'sleep'], ['Transit', 'transit'], ['Flags', 'flags'], ['Votes', 'votes'],
];
function scoreCell(v, color, main) { return '<td class="sc' + (main ? ' main' : '') + '"><div class="n">' + (v == null ? '<span class="muted">n/a</span>' : f1(v)) + '</div>' + (v == null ? '' : '<div class="sbar"><i style="width:' + v + '%;background:' + color + '"></i></div>') + '</td>'; }
function currentOrder() {
  const idx = visible();
  const sk = view.sort.key === 'board' ? view.board : view.sort.key, dir = view.sort.dir;
  idx.sort((a, z) => { const va = sortVal(sk, a), vz = sortVal(sk, z);
    if (va == null && vz == null) return (res.R.overall[a] ?? 1e6) - (res.R.overall[z] ?? 1e6); if (va == null) return 1; if (vz == null) return -1;
    if (typeof va === 'string') return dir * va.localeCompare(vz); return dir * (va - vz) || ((res.R.overall[a] ?? 1e6) - (res.R.overall[z] ?? 1e6)); });
  return idx;
}
function renderTable() {
  const COLS = ALL_COLS.filter((c) => !(view.board === 'overall' && c[1] === 'overall'));
  const idx = currentOrder();
  const sk = view.sort.key === 'board' ? view.board : view.sort.key, dir = view.sort.dir;
  $('pickCount').textContent = view.picks.length ? String(view.picks.length) : '';
  const hidden = list.length - list.filter((_, i) => res.elig[i]).length;
  const boardName = (k) => (BOARDS.find((b) => b[0] === k) || [])[1];
  const sortName = boardName(sk) || (COLS.find((c) => c[1] === sk) || [sk])[0];
  $('summary').innerHTML = 'Showing <b>' + idx.length + '</b> of ' + list.length + ' · sorted by ' + esc(sortName) + (dir < 0 ? ', highest first' : ', lowest first') +
    (hidden ? ' · ' + hidden + ' hidden by Must have / Exclude rules in Settings' : '');
  const th = COLS.map(([label, key]) => { if (!key) return '<th>' + esc(label) + '</th>';
    const on = key === 'board' ? view.sort.key === 'board' || view.sort.key === view.board : view.sort.key === key;
    const lab = key === 'board' ? boardName(view.board) : label;
    return '<th aria-sort="' + (on ? (dir < 0 ? 'descending' : 'ascending') : 'none') + '"><button data-sort="' + key + '">' + esc(lab) + '</button></th>'; }).join('');
  const rows = idx.map((i, pos) => {
    const L = list[i], gg = L.geo || {}, fl = res.fl[i], tr = gg.transit;
    const sleepTxt = (L.sleep.studio ? 'Studio' : L.sleep.bedrooms != null ? L.sleep.bedrooms + ' BR' : '') + (L.sleep.summary ? ' · ' + L.sleep.summary : '');
    const vt = Object.entries(L.votes).map(([k, v]) => esc(k) + ': ' + esc(v)).join('<br>') || '<span class="muted">none</span>';
    const picked = view.picks.includes(L.id);
    let html = '<tr class="row' + (view.open === L.id ? ' open' : '') + (picked ? ' picked' : '') + '" data-i="' + i + '">' +
      '<td class="pick"><input type="checkbox" data-pick="' + esc(L.id) + '" aria-label="Pick for sharing"' + (picked ? ' checked' : '') + (!picked && view.picks.length >= 5 ? ' disabled title="5 picked already"' : '') + '></td>' +
      '<td class="rank" style="color:' + CAT_COLOR[view.board] + '">' + (pos + 1) + '</td>' +
      '<td class="photo">' + (L.cover ? '<img loading="lazy" src="' + esc(L.cover) + '" alt="">' : '') + '</td>' +
      '<td class="name"><a href="' + esc(L.url) + '" target="_blank" rel="noopener">' + esc(L.name || L.property_type + ' in ' + L.town) + '</a>' +
        '<div class="sub">' + esc(L.town) + ' · ' + esc(L.property_type) + '</div><div class="pills">' + pillsFor(i) + '</div></td>' +
      scoreCell(boardScore(view.board, i), CAT_COLOR[view.board], true) + (view.board === 'overall' ? '' : scoreCell(res.O[i], CAT_COLOR.overall)) +
      ['loc', 'space', 'comfort', 'outdoor', 'trust', 'value'].map((k) => scoreCell(res.C[k][i], CAT_COLOR[k])).join('') +
      '<td class="small">' + (L.ppan != null ? money(L.ppan) + '<br><span class="muted">' + money(L.price) + ' total</span>' : '<span class="muted">No price</span>') + '</td>' +
      '<td class="small">' + (L.rating != null ? L.rating.toFixed(2) : 'New') + '<br><span class="muted">' + L.reviews + ' reviews</span></td>' +
      '<td class="small">' + esc(sleepTxt || 'n/a') + '<br><span class="muted">' + (L.baths != null ? L.baths + ' bath' + (L.baths === 1 ? '' : 's') + (L.bath_type === 'shared' ? ' (shared)' : '') : '') + '</span></td>' +
      '<td class="small">' + (tr ? tr.min + ' min ' + esc(tr.kind || '') + '<br><span class="muted">' + esc((tr.name || '').slice(0, 22)) + '</span>' : '<span class="muted">n/a</span>') + '</td>' +
      '<td class="small">' + (fl.pr != null ? '<span style="color:#F7B0B0">' + (100 * fl.pr).toFixed(1) + '% red</span>' : '') + (fl.pg != null ? '<br><span style="color:#A6E8B5">' + Math.round(100 * fl.pg) + '% green</span>' : '') + '</td>' +
      '<td class="small">' + vt + '</td></tr>';
    if (view.open === L.id) html += '<tr class="detail"><td colspan="' + COLS.length + '"><div class="dwrap">' + detail(i) + '</div></td></tr>';
    return html;
  }).join('');
  $('board').innerHTML = '<thead><tr>' + th + '</tr></thead><tbody>' + (rows || '<tr><td colspan="' + COLS.length + '" class="empty">No listings match these filters</td></tr>') + '</tbody>';
}
function whyBar(pts, labelOf) {
  const tot = pts.reduce((a, p) => a + p[1], 0) || 1;
  return '<div class="why">' + pts.map((p, j) => '<i style="width:' + (100 * p[1] / Math.max(tot, 100)).toFixed(2) + '%;background:' + (CAT_COLOR[p[0]] || SEG[j % SEG.length]) + '" title="' + esc(labelOf(p[0])) + ': ' + p[1] + '"></i>').join('') + '</div>' +
    '<div class="legend">' + pts.map((p, j) => '<span style="--c:' + (CAT_COLOR[p[0]] || SEG[j % SEG.length]) + '">' + esc(labelOf(p[0])) + ' ' + p[1] + '</span>').join('') + '</div>';
}
function detail(i) {
  const L = list[i], gg = L.geo || {}, fl = res.fl[i];
  const fLabel = (id) => (Scorer.FACTORS.find((f) => f.id === id) || { label: id }).label, cLabel = (id) => (Scorer.CATS.find((c) => c.id === id) || { label: id }).label;
  let why = '<div class="dbox"><h4>Why it scores ' + f1(res.O[i]) + ' overall</h4>' + whyBar(res.oParts[i], cLabel);
  Scorer.CATS.forEach((c) => { if (c.id === 'votes') return; const v = res.C[c.id][i];
    why += '<div class="catline"><b>' + esc(c.label) + '</b><span>' + (v == null ? 'n/a' : f1(v)) + '</span></div>' + (res.parts[c.id][i].length ? whyBar(res.parts[c.id][i], fLabel) : ''); });
  why += '</div>';
  const byG = {}; res.shown[i].forEach((t) => { (byG[t.group] = byG[t.group] || []).push(t); });
  const tags = '<div class="dbox"><h4>Tags</h4>' + (Object.keys(byG).length ? Object.entries(byG).map(([g, ts]) => '<div class="line"><b>' + esc(g) + ':</b> ' +
    ts.map((t) => '<span class="pill ' + (t.pol > 0 ? 'pos' : t.pol < 0 ? 'neg' : '') + '">' + esc(t.label + (t.detail ? ' · ' + t.detail : '')) + '</span>').join(' ') + '</div>').join('') : '<div class="line muted">No tags yet</div>') + '</div>';
  const w = (x, lab) => { if (!x) return '';
    if (x.src === 'beyond') return '<div class="line">' + lab + ': <span class="muted">none within 5 km</span></div>';
    if (x.straight != null && x.straight < 40 && x.src !== 'routed') return '<div class="line">' + lab + ': <b>right there</b> <span class="muted">(inside or next to it)</span></div>';
    return '<div class="line">' + lab + ': <b>' + x.min + ' min</b> ' + esc(x.kind && !['sea', 'water', 'transit', 'center'].includes(x.kind) ? x.kind : '') + ' ' + esc(x.name || '') +
      ' <span class="muted">(' + (x.src === 'routed' ? 'routed walk' : 'estimated from ' + x.straight + ' m straight line') + ')</span></div>'; };
  const c = gg.counts;
  const loc = '<div class="dbox"><h4>Location</h4>' + (L.mapped ? w(gg.transit, 'Transit') + w(gg.train, 'Train station') + w(gg.center, 'Center') + w(gg.sea, 'Sea or beach') + w(gg.water, 'Lake or river') + w(gg.park, 'Park') + w(gg.groceries, 'Groceries') +
    (c ? '<div class="line">Within a short walk: ' + c.dining + ' places to eat · ' + c.nightlife + ' bars · ' + c.groceries + ' food shops · ' + c.pharmacy + ' pharmacies · ' + c.stops + ' transit stops · ' + c.sights + ' sights · ' + c.parks + ' parks</div>' : '') +
    (res.walkIdx[i] != null ? '<div class="line">Walkability index: <b>' + Math.round(res.walkIdx[i]) + '</b></div>' : '') : '<div class="line muted">No map data yet</div>') +
    (L.ratings.location != null ? '<div class="line">Guest location rating: ' + L.ratings.location + '</div>' : '') + '</div>';
  const s = L.sleep;
  const sl = '<div class="dbox"><h4>Sleep and bath</h4>' + (s.rooms.length ? s.rooms.map((r) => '<div class="line">' + esc(r.t) + ': ' + esc(r.beds.map(([t, n]) => { const lb = Model.BED_LABEL[t] || t; return n + ' ' + lb + (n > 1 && !/s$/.test(lb) ? 's' : ''); }).join(', ')) + '</div>').join('') : '<div class="line muted">' + (s.total != null ? s.total + ' beds, types not listed by the host' : 'Sleeping arrangement not listed') + '</div>') +
    '<div class="line">Real-bed spots: <b>' + s.spots + '</b> for ' + L.adults + ' adults' + (s.sofa ? ' · ' + s.sofa + ' sofa bed or couch' : '') + (s.makeshift ? ' · ' + s.makeshift + ' mattress or hammock' : '') + (s.partial ? ' · ' + s.unknown + ' bed(s) not described (counted as half a spot each)' : '') + '</div>' +
    '<div class="line">Bedrooms: ' + (s.studio ? 'studio' : s.bedrooms ?? 'n/a') + ' · Bathrooms: ' + (L.baths ?? 'n/a') + (L.bath_type ? ' (' + esc(L.bath_type) + ')' : '') + ' · Max guests: ' + (L.guests_max ?? 'n/a') + '</div></div>';
  const redL = Object.entries(fl.red).sort((a, b) => b[1] - a[1]).map(([id, n]) => esc((Tags.RED[id] || [id])[0]) + ' ' + n + (L.rev.last[id] ? ' (latest ' + L.rev.last[id] + ')' : '')).join(' · ');
  const greenL = Object.entries(fl.green).sort((a, b) => b[1] - a[1]).map(([id, n]) => esc((Tags.GREEN[id] || [id])[0]) + ' ' + n).join(' · ');
  const rv = '<div class="dbox"><h4>Reviews</h4><div class="line">' + L.rev.m + ' reviews scanned · rating ' + (L.rating ?? 'new') + '</div>' +
    (fl.pr != null ? '<div class="line">Red-flag rate (smoothed, severity weighted): <b>' + (100 * fl.pr).toFixed(1) + '%</b></div>' : '') + (redL ? '<div class="line" style="color:#F7B0B0">' + redL + '</div>' : '') +
    (fl.pg != null ? '<div class="line">Green-flag rate: <b>' + Math.round(100 * fl.pg) + '%</b></div>' : '') + (greenL ? '<div class="line" style="color:#A6E8B5">' + greenL + '</div>' : '') +
    (fl.stairsShare != null ? '<div class="line">Stairs come up in ' + Math.round(100 * fl.stairsShare) + '% of reviews</div>' : '') + '</div>';
  const host = '<div class="dbox"><h4>Host and policies</h4><div class="line">' + (L.host.superhost ? 'Superhost' : 'Not a Superhost') + (L.host.years ? ' · ' + L.host.years + ' years hosting' : '') + (L.host.response_time ? ' · responds within ' + esc(L.host.response_time) : '') + (L.host.response_rate ? ' · ' + L.host.response_rate + '% response rate' : '') + '</div>' +
    '<div class="line">Cancellation: ' + esc(L.cancellation || 'n/a') + '</div>' + L.notices.slice(0, 8).map((n) => '<div class="line muted">' + esc(n) + '</div>').join('') +
    Object.entries(L.notes).map(([k, v]) => '<div class="line">' + esc(k) + "'s note: " + esc(v) + '</div>').join('') + '</div>';
  return '<div class="dgrid">' + why + tags + loc + sl + rv + host + '</div>';
}
function renderFoot() {
  const r = res; const consts = Object.keys(r.constant).filter((k) => r.constant[k]).map((k) => Scorer.FACTORS.find((f) => f.id === k).label);
  $('foot').textContent = 'Median price ' + (r.medPpan ? money(r.medPpan) + ' per adult per night' : 'n/a') + ' · rating prior ' + f1(r.priors.overall) +
    (consts.length ? ' · ignored because every listing is the same: ' + consts.join(', ') : '') + (Object.keys(state.err).length ? ' · ' + Object.keys(state.err).length + ' listings failed to load details' : '') +
    (state.geoInfo ? ' · map data from OpenStreetMap contributors' : '');
}

// ---------- settings dialog ----------
const SET_TABS = [['weights', 'Category weights'], ['factors', 'Factors'], ['tags', 'Tags'], ['flags', 'Reviews and flags'], ['location', 'Location curves'], ['group', 'Group and sleep'], ['sharing', 'Sharing'], ['advanced', 'Advanced']];
function numIn(path, v, step = 1, min = 0, max) { return '<input type="number" data-path="' + path + '" value="' + esc(v) + '" step="' + step + '" min="' + min + '"' + (max != null ? ' max="' + max + '"' : '') + '>'; }
function renderSettings() {
  if (!$('settingsDlg').open || !res) return;
  const S = res.S;
  $('setState').textContent = Object.keys(over).length ? 'Custom settings (saved for every wishlist)' : 'Default settings';
  $('setNav').innerHTML = SET_TABS.map(([k, t]) => '<button data-tab="' + k + '" class="' + (k === setTab ? 'on' : '') + '">' + esc(t) + '</button>').join('');
  let h = '';
  if (setTab === 'weights') {
    const pi = S.cats || Scorer.PRESETS[S.preset], sum = Scorer.CATS.reduce((a, c) => a + (+pi[c.id] || 0), 0);
    h += '<h3>Preset</h3><p>Pick a starting point, then fine-tune any category. Weights are percentages of Overall.</p><select data-path="preset">' + Object.keys(Scorer.PRESETS).map((p) => '<option' + (!S.cats && p === S.preset ? ' selected' : '') + '>' + esc(p) + '</option>').join('') + (S.cats ? '<option selected>Custom</option>' : '') + '</select>';
    h += '<h3>Category weights <span class="sum' + (sum !== 100 ? ' bad' : '') + '">total ' + sum + (sum !== 100 ? ' (weights are rescaled to 100)' : '') + '</span></h3><table class="set"><tr><th>Category</th><th>Weight</th><th>Spread in this wishlist</th></tr>' +
      Scorer.CATS.map((c) => '<tr><td>' + esc(c.label) + '</td><td>' + numIn('cats.' + c.id, pi[c.id], 1, 0, 100) + '</td><td class="help">average ' + Math.round(res.norm[c.id].mu) + ', spread ' + Math.round(res.norm[c.id].sd) + '</td></tr>').join('') + '</table>';
    h += '<h3>Balance category influence</h3><p>On (default): each category is rescaled to a common spread before weighting, so a 22% weight really moves the ranking 22%. Off: raw category scores are averaged.</p>' +
      '<label><input type="checkbox" data-path="combine.balance"' + (S.combine.balance ? ' checked' : '') + '> Balance categories</label>';
  } else if (setTab === 'factors') {
    h += '<p>Every factor sits in exactly one category. Weights are relative within the category. Share of Overall assumes every listing has data. Invert flips a factor (for example nightlife to prefer quiet areas).</p>';
    Scorer.CATS.filter((c) => c.id !== 'votes').forEach((c) => {
      h += '<h3>' + esc(c.label) + '</h3><table class="set"><tr><th>On</th><th>Factor</th><th>Weight</th><th>Invert</th><th>Share of Overall</th><th>What it measures</th></tr>' +
        Scorer.FACTORS.filter((f) => f.cat === c.id).map((f) => { const fc = Object.assign({ on: true, w: f.w, invert: false }, S.factors[f.id] || {});
          return '<tr class="' + (fc.on ? '' : 'off') + '"><td><input type="checkbox" data-path="factors.' + f.id + '.on"' + (fc.on ? ' checked' : '') + '></td><td>' + esc(f.label) + (res.constant[f.id] ? '<span class="badge">same for all here</span>' : '') + '</td><td>' + numIn('factors.' + f.id + '.w', fc.w, 1, 0, 100) +
            '</td><td><input type="checkbox" data-path="factors.' + f.id + '.invert"' + (fc.invert ? ' checked' : '') + '></td><td>' + (res.share[f.id] != null ? res.share[f.id].toFixed(1) + '%' : '-') + '</td><td class="help">' + esc(f.help) + '</td></tr>'; }).join('') + '</table>';
    });
  } else if (setTab === 'tags') {
    h += '<p>Coverage tags (Essentials, Extras, Convenience) add their weight to a share-of-wanted score. Outdoor and view tags use their value (0 to 100, best one wins, bonuses add). Red and green flag tags carry a severity or value per review. Warnings carry a severity. Must have and Exclude hide listings everywhere.</p>';
    const ruleOpts = (t, cur) => { const opts = [['normal', 'Normal'], ['must', 'Must have'], ['exclude', 'Exclude']].concat(t.kind === 'cover' ? [['avoid', 'Avoid (subtract)'], ['ignore', 'Ignore']] : []);
      return '<select data-path="tags.' + t.id + '.pref">' + opts.map(([v, l]) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'; };
    const KIND = { cover: 'Weight', best: 'Value', bonus: 'Bonus', flag: 'Severity / value', warn: 'Severity', info: '' };
    Tags.GROUPS.forEach((g) => {
      const ts = Tags.TAGS.filter((t) => t.group === g);
      h += '<h3>' + esc(g) + '</h3><table class="set"><tr><th>Tag</th><th>' + esc(KIND[ts[0].kind] || '') + '</th><th>Rule</th><th>Listings with it</th></tr>' + ts.map((t) => { const tc = Object.assign({ pref: 'normal', w: t.w }, S.tags[t.id] || {});
        const n = res.tagv.filter((tv) => tv[t.id] === 1).length;
        return '<tr><td>' + esc(t.label) + '</td><td>' + (t.kind === 'info' ? '<span class="muted">scored by a factor</span>' : numIn('tags.' + t.id + '.w', tc.w, t.kind === 'flag' || t.kind === 'warn' ? 0.1 : 1, 0, t.kind === 'best' ? 100 : undefined)) + '</td><td>' + ruleOpts(t, tc.pref) + '</td><td>' + n + '</td></tr>'; }).join('') + '</table>';
    });
  } else if (setTab === 'flags') {
    const F = S.flags, R = S.rating, B = S.budget;
    h += '<h3>Rating trust</h3><p>Proven rating = prior + (rating − prior) weighted by trust w(n) = 1 − e^(−n/τ), on a squared quality scale from the floor to 5.0.</p><div class="kv">' +
      '<span>Prior rating</span><span><select data-path="rating.prior"><option value="fixed"' + (R.prior === 'fixed' ? ' selected' : '') + '>Fixed value</option><option value="p25"' + (R.prior === 'p25' ? ' selected' : '') + '>25th percentile of this wishlist</option></select> ' + numIn('rating.value', R.value, 0.05, 3, 5) + '</span>' +
      '<span>Reviews for 63% trust (τ)</span>' + numIn('rating.tau', R.tau, 1, 1) + '<span>Quality floor</span>' + numIn('rating.floor', R.floor, 0.1, 0, 4.9) + '<span>Curve exponent</span>' + numIn('rating.gamma', R.gamma, 0.1, 0.5, 4) + '</div>';
    h += '<h3>Review flags</h3><p>Rate = (flagged reviews weighted by tag severity + k × prior) / (reviews + k). Red score = 100 × 2^(−rate / half). Green score = 100 × (1 − 2^(−rate / half)).</p><div class="kv">' +
      '<span>Smoothing reviews (k)</span>' + numIn('flags.k', F.k, 1, 0) + '<span>Red prior rate</span>' + numIn('flags.redPrior', F.redPrior, 0.005, 0, 1) + '<span>Red half-score rate</span>' + numIn('flags.redHalf', F.redHalf, 0.005, 0.001, 1) +
      '<span>Green prior rate</span>' + numIn('flags.greenPrior', F.greenPrior, 0.01, 0, 1) + '<span>Green half-score rate</span>' + numIn('flags.greenHalf', F.greenHalf, 0.01, 0.01, 1) +
      '<span>Stairs prior rate</span>' + numIn('flags.stairsPrior', F.stairsPrior, 0.01, 0, 1) + '<span>Stairs half-score rate</span>' + numIn('flags.stairsHalf', F.stairsHalf, 0.01, 0.01, 1) + '</div>';
    h += '<p>Each red and green flag tag severity is on the Tags page.</p><h3>Budget board</h3><div class="kv"><span>Price share of the Budget score (%)</span>' + numIn('budget.wPrice', B.wPrice, 5, 0, 100) +
      '<span>Minimum rating</span>' + numIn('budget.minRating', B.minRating, 0.05, 0, 5) + '<span>Maximum red-flag rate</span>' + numIn('budget.maxRedRate', B.maxRedRate, 0.01, 0, 1) + '</div>';
  } else if (setTab === 'location') {
    const C = S.curves;
    h += '<p>Distance factors score 100 up to "full marks" minutes, then halve every "halves every" minutes. Count factors score 100 × (1 − e^(−count / k)).</p><table class="set"><tr><th>Destination</th><th>Full marks up to (min)</th><th>Halves every (min)</th></tr>' +
      [['transit', 'Public transport'], ['center', 'Center'], ['sea', 'Sea or beach'], ['water', 'Lake or river'], ['park', 'Park']].map(([k, l]) => '<tr><td>' + l + '</td><td>' + numIn('curves.' + k + '.full', C[k].full, 1, 0) + '</td><td>' + numIn('curves.' + k + '.half', C[k].half, 1, 1) + '</td></tr>').join('') + '</table>' +
      '<h3>Counts</h3><div class="kv"><span>Places to eat, k</span>' + numIn('curves.dining', C.dining, 1, 1) + '<span>Sights, k</span>' + numIn('curves.sights', C.sights, 1, 1) + '<span>Nightlife, k</span>' + numIn('curves.nightlife', C.nightlife, 1, 1) + '</div>' +
      '<h3>Walkability mix</h3><p>Weight and k for each everyday need within a short walk.</p><table class="set"><tr><th>Need</th><th>Weight</th><th>k</th></tr>' +
      Object.entries(S.walk).map(([k, [ww, kk]]) => '<tr><td>' + esc(k) + '</td><td>' + numIn('walk.' + k + '.0', ww, 1, 0) + '</td><td>' + numIn('walk.' + k + '.1', kk, 1, 1) + '</td></tr>').join('') + '</table>';
  } else if (setTab === 'group') {
    h += '<h3>How your group sleeps</h3><p>Sets how many beds and bedrooms count as enough.</p><label><input type="radio" name="sleep" data-path="sleep" value="pairs"' + (S.sleep !== 'separate' ? ' checked' : '') + '> Pairs can share a bed and a room (default)</label><br>' +
      '<label><input type="radio" name="sleep" data-path="sleep" value="separate"' + (S.sleep === 'separate' ? ' checked' : '') + '> Everyone gets their own bed and room</label>';
  } else if (setTab === 'sharing') {
    h += '<h3>Share page address</h3><p>Share links open this page and carry the listings after the #, so the listings never reach the server. Leave the default unless you host the page somewhere else.</p>' +
      '<input type="text" data-path="share.base" value="' + esc(S.share.base) + '" style="width:100%;max-width:560px;padding:7px 9px">';
  } else if (setTab === 'advanced') {
    h += '<h3>Ignore factors that do not differ</h3><p>When every listing has the same value for a factor (for example no listing has a pool), it cannot change the ranking but it would still dilute its category. On by default.</p>' +
      '<label><input type="checkbox" data-path="combine.dropConstant"' + (S.combine.dropConstant ? ' checked' : '') + '> Ignore identical factors</label>' +
      '<h3>Minimum spread when balancing</h3><p>Stops a category where listings are nearly identical from being stretched into a big difference.</p>' + numIn('combine.sigmaMin', S.combine.sigmaMin, 1, 1, 50) +
      '<h3>Your overrides</h3><p>Only what differs from the defaults is stored.</p><pre style="white-space:pre-wrap;font-size:11px;color:#A9B8C6">' + esc(JSON.stringify(over, null, 1)) + '</pre>';
  }
  $('setMain').innerHTML = h;
}
function onSettingChange(el) {
  const path = el.dataset.path; if (!path) return;
  if (path === 'preset') { if (el.value === 'Custom') return; delete over.cats; setOver('preset', el.value); return; }
  if (path.startsWith('cats.')) { const pi = Object.assign({}, res.S.cats || Scorer.PRESETS[res.S.preset]); pi[path.slice(5)] = Math.max(0, +el.value || 0); over.cats = pi; saveOver(); render(); renderSettings(); return; }
  if (path.startsWith('walk.')) { const [, k, j] = path.split('.'); const arr = res.S.walk[k].slice(); arr[+j] = Math.max(0, +el.value || 0); setOver('walk.' + k, arr); return; }
  let v;
  if (el.type === 'text') { setOver(path, el.value.trim()); return; }
  if (el.type === 'checkbox') v = el.checked; else if (el.type === 'radio') { if (!el.checked) return; v = el.value; } else if (el.type === 'number') { if (el.value === '') return; v = +el.value; } else v = el.value;
  setOver(path, v);
}

// ---------- exports ----------
const BASE = ['position', 'listing_id', 'wishlist_item_id', 'url', 'listing_name', 'property_type', 'town', 'badge', 'rating', 'beds', 'bedrooms', 'adults', 'nights',
  'check_in', 'check_out', 'total_price_usd', 'photo_count', 'cover_photo_url', 'agency_in_name', 'registration_code'];
const ENR = ['bathrooms', 'max_guests', 'review_count', 'rating_cleanliness', 'rating_accuracy', 'rating_checkin', 'rating_communication', 'rating_location', 'rating_value',
  'host_superhost', 'cancellation_policy', 'has_ac', 'has_wifi', 'has_kitchen', 'has_washer', 'has_heating', 'outdoor_space', 'sea_view', 'elevator_or_step_free',
  'sofa_bed_needed', 'walk_min_to_station', 'walk_source', 'stairs_mentions', 'red_flag_hits', 'red_flag_terms', 'red_flag_quotes',
  'reviews_scanned', 'red_flag_weighted', 'walk_min_to_beach', 'lat', 'lng'];
const V2 = ['real_bed_spots', 'real_beds', 'sofa_beds', 'bed_summary', 'bath_type', 'transit_min', 'transit_kind', 'transit_name', 'center_min', 'center_name', 'walkability', 'dining_500m', 'nightlife_600m', 'sights_1km',
  'sea_min', 'water_min', 'park_min', 'red_rate', 'green_rate', 'tags', 'S_overall', 'S_loc', 'S_space', 'S_comfort', 'S_outdoor', 'S_trust', 'S_value', 'S_votes', 'S_budget', 'R_overall', 'R_budget', 'pros', 'cons'];
function exportRows() {
  const voters = state.meta.voters || [];
  return list.map((L, i) => {
    const it = state.items[i], tv = res.tagv[i], gg = L.geo || {}, fl = res.fl[i];
    const b = (id) => (tv[id] === 1 ? 'TRUE' : tv[id] === 0 ? 'FALSE' : '');
    const outdoor = ['rooftop', 'terrace', 'garden', 'balcony', 'patio', 'courtyard'].some((k) => tv[k] === 1) ? 'TRUE' : L.collected && !L.legacy ? 'FALSE' : '';
    const row = { position: L.position, listing_id: L.id, wishlist_item_id: it.wishlist_item_id, url: L.url, listing_name: L.name, property_type: L.property_type, town: L.town, badge: L.badge,
      rating: L.rating ?? '', beds: L.sleep.total ?? '', bedrooms: L.sleep.bedrooms ?? '', adults: L.adults, nights: L.nights ?? '', check_in: L.check_in, check_out: L.check_out, total_price_usd: L.price ?? '',
      photo_count: L.photo_count ?? '', cover_photo_url: L.cover, agency_in_name: '', registration_code: L.registration,
      bathrooms: L.baths ?? '', max_guests: L.guests_max ?? '', review_count: L.reviews, rating_cleanliness: L.ratings.cleanliness ?? '', rating_accuracy: L.ratings.accuracy ?? '', rating_checkin: L.ratings.checkin ?? '',
      rating_communication: L.ratings.communication ?? '', rating_location: L.ratings.location ?? '', rating_value: L.ratings.value ?? '', host_superhost: L.host.superhost === true ? 'TRUE' : L.host.superhost === false ? 'FALSE' : '',
      cancellation_policy: L.cancellation, has_ac: b('ac'), has_wifi: b('wifi'), has_kitchen: b('kitchen'), has_washer: b('washer'), has_heating: b('heating'), outdoor_space: outdoor, sea_view: b('sea_view'),
      elevator_or_step_free: tv.elevator === 1 || tv.step_free === 1 ? 'TRUE' : L.collected ? 'FALSE' : '', sofa_bed_needed: b('sofa_needed'),
      walk_min_to_station: gg.train ? gg.train.min : gg.transit ? gg.transit.min : '', walk_source: gg.train ? gg.train.src : gg.transit ? gg.transit.src : '', stairs_mentions: L.rev.stairs,
      red_flag_hits: L.rev.red.length || (L.rev.v1 ? L.rev.v1.length : ''), red_flag_terms: Object.entries(fl.red).map(([k, n]) => (Tags.RED[k] || [k])[0] + ' x' + n).join(', '),
      red_flag_quotes: Object.entries(L.rev.last).map(([k, m]) => (Tags.RED[k] || [k])[0] + ' (' + m + ')').join(' | '), reviews_scanned: L.rev.m, red_flag_weighted: Math.round(fl.f * 10) / 10,
      walk_min_to_beach: gg.sea ? gg.sea.min : '', lat: L.lat ?? '', lng: L.lng ?? '',
      real_bed_spots: L.sleep.spots, real_beds: L.sleep.real, sofa_beds: L.sleep.sofa, bed_summary: L.sleep.summary, bath_type: L.bath_type,
      transit_min: gg.transit ? gg.transit.min : '', transit_kind: gg.transit ? gg.transit.kind : '', transit_name: gg.transit ? gg.transit.name : '', center_min: gg.center ? gg.center.min : '', center_name: gg.center ? gg.center.name : '',
      walkability: res.walkIdx[i] != null ? Math.round(res.walkIdx[i]) : '', dining_500m: gg.counts ? gg.counts.dining : '', nightlife_600m: gg.counts ? gg.counts.nightlife : '', sights_1km: gg.counts ? gg.counts.sights : '',
      sea_min: gg.sea ? gg.sea.min : '', water_min: gg.water ? gg.water.min : '', park_min: gg.park ? gg.park.min : '', red_rate: fl.pr != null ? fl.pr.toFixed(4) : '', green_rate: fl.pg != null ? fl.pg.toFixed(4) : '',
      tags: res.shown[i].map((t) => t.label).join('; '), S_overall: res.O[i] ?? '', S_budget: res.B[i] ?? '', R_overall: res.R.overall[i] ?? '', R_budget: res.R.budget[i] ?? '', pros: res.pros[i].join(' · '), cons: res.cons[i].join(' · ') };
    ['loc', 'space', 'comfort', 'outdoor', 'trust', 'value', 'votes'].forEach((k) => { row['S_' + k] = res.C[k][i] ?? ''; });
    voters.forEach((v) => { row[slug(v) + '_vote'] = L.votes[v] || ''; row[slug(v) + '_note'] = L.notes[v] || ''; });
    return row;
  });
}
const exportCols = () => BASE.concat(...(state.meta.voters || []).map((v) => [slug(v) + '_vote', slug(v) + '_note']), ENR, V2);


// ---------- share to phone ----------
let shareSrc = 'top', shareData = null;
function shareIdxs() {
  if (shareSrc === 'picks' && view.picks.length) { const order = currentOrder(); const all = list.map((_, i) => i);
    const pos = (i) => { const k = order.indexOf(i); return k < 0 ? 1e6 + (res.R.overall[i] ?? 1e6) : k; };
    return all.filter((i) => view.picks.includes(list[i].id)).sort((a, z) => pos(a) - pos(z)).slice(0, 5); }
  return currentOrder().slice(0, 5);
}
function openShare() {
  if (!res) return;
  shareSrc = view.picks.length ? 'picks' : 'top';
  document.querySelectorAll('input[name=shareSrc]').forEach((r) => { r.checked = r.value === shareSrc; r.disabled = r.value === 'picks' && !view.picks.length; });
  $('pickInfo').textContent = view.picks.length ? '(' + view.picks.length + ' picked)' : '(none picked yet)';
  $('shareDlg').showModal(); refreshShare();
}
function refreshShare() {
  const idxs = shareIdxs();
  shareData = idxs.length ? Share.pack(res, list, idxs, state.meta, view.board) : null;
  $('shareList').innerHTML = idxs.map((i) => '<li>' + esc(list[i].name) + ' <span class="muted">' + esc(list[i].town) + (res.O[i] != null ? ' · score ' + Math.round(res.O[i]) : '') + '</span></li>').join('') || '<li class="muted">Nothing matches the current filters</li>';
  $('shPreview').srcdoc = shareData ? Share.page(shareData) : '<p style="color:#A9B8C6;font:14px system-ui;padding:20px">Nothing to share yet</p>';
  $('shStatus').textContent = '';
  ['shCopyLink', 'shCopyText', 'shDownload'].forEach((id) => { $(id).disabled = !shareData; });
}
async function shareLink() { const base = (res.S.share && res.S.share.base) || ''; return base ? base + '#d=' + (await Share.encode(shareData)) : ''; }
async function photoData(url) {
  try {
    const r = await fetch(url.replace(/im_w=\d+/, 'im_w=720')); if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const w = Math.min(640, bmp.width), h = Math.round((bmp.height * w) / bmp.width);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', 0.74);
  } catch (e) { return null; }
}
function wireShare() {
  $('shareBtn').addEventListener('click', openShare);
  $('closeShare').addEventListener('click', () => $('shareDlg').close());
  document.querySelectorAll('input[name=shareSrc]').forEach((r) => r.addEventListener('change', () => { shareSrc = r.value; refreshShare(); }));
  $('shCopyLink').addEventListener('click', async () => {
    const link = await shareLink(); if (!link) { $('shStatus').textContent = 'Set a share page address in Settings > Sharing first.'; return; }
    await navigator.clipboard.writeText(link);
    $('shStatus').textContent = 'Link copied (' + link.length + ' characters). Paste it into Messages.';
  });
  $('shCopyText').addEventListener('click', async () => {
    const link = await shareLink();
    await navigator.clipboard.writeText(Share.text(shareData) + (link ? '\n\nAll ' + shareData.x.length + ' on one page: ' + link : ''));
    $('shStatus').textContent = 'Text copied. Paste it into Messages or any SMS app.';
  });
  $('shDownload').addEventListener('click', async () => {
    $('shStatus').textContent = 'Building the page with photos...';
    const photos = {};
    for (const x of shareData.x) { const d = await photoData(Share.photoUrl(x.p)); if (d) photos[x.i] = d; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([Share.page(shareData, photos)], { type: 'text/html' }));
    a.download = slug(state.meta.name || 'wishlist') + '_' + (shareData.x.length === 5 ? 'top5' : 'picks') + '.html'; a.click();
    $('shStatus').textContent = 'Saved ' + a.download + ' (' + Object.keys(photos).length + ' photos built in). Attach it in Messages or AirDrop it.';
  });
}

// ---------- events ----------
function wire() {
  $('rerun').addEventListener('click', () => run());
  $('preset').addEventListener('change', (e) => { if (e.target.value === 'Custom') return; delete over.cats; setOver('preset', e.target.value); });
  let qt = null; $('q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { view.q = e.target.value; renderTable(); }, 120); });
  $('filtersBtn').addEventListener('click', () => { view.filtersOpen = !view.filtersOpen; renderFilters(); });
  $('clearFilters').addEventListener('click', () => { view.must = []; view.excl = []; view.towns = []; view.num = {}; view.flags = {}; saveView(); render(); });
  $('filters').addEventListener('click', (e) => {
    const c = e.target.closest('[data-tag]'), t = e.target.closest('[data-town]');
    if (c) { const id = c.dataset.tag; if (view.must.includes(id)) { view.must = view.must.filter((x) => x !== id); view.excl.push(id); } else if (view.excl.includes(id)) view.excl = view.excl.filter((x) => x !== id); else view.must.push(id); saveView(); render(); }
    if (t) { const v = t.dataset.town; view.towns = view.towns.includes(v) ? view.towns.filter((x) => x !== v) : view.towns.concat(v); saveView(); render(); }
  });
  $('filters').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.num) { view.num[el.dataset.num] = el.value === '' ? null : +el.value; if (view.num[el.dataset.num] == null) delete view.num[el.dataset.num]; saveView(); renderTable(); renderFilters(); }
    if (el.dataset.flag) { view.flags[el.dataset.flag] = el.checked; saveView(); renderTable(); renderFilters(); }
  });
  $('board').addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) { const k = s.dataset.sort; view.sort = view.sort.key === k ? { key: k, dir: -view.sort.dir } : { key: k, dir: k === 'name' || k === 'ppan' || k === 'transit' || k === 'flags' ? 1 : -1 }; saveView(); renderTable(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) { const id = pk.dataset.pick; view.picks = pk.checked ? view.picks.filter((x) => x !== id).concat(id).slice(0, 5) : view.picks.filter((x) => x !== id); saveView(); renderTable(); return; }
    if (e.target.closest('a') || e.target.closest('td.pick')) return;
    const r = e.target.closest('tr.row'); if (!r) return;
    const id = list[+r.dataset.i].id; view.open = view.open === id ? null : id; renderTable();
  });
  $('settingsBtn').addEventListener('click', () => { $('settingsDlg').showModal(); renderSettings(); });
  $('closeSettings').addEventListener('click', () => $('settingsDlg').close());
  let armed = false;
  $('resetAll').addEventListener('click', () => {
    if (!armed) { armed = true; $('resetAll').textContent = 'Click again to reset'; setTimeout(() => { armed = false; $('resetAll').textContent = 'Reset to defaults'; }, 3000); return; }
    armed = false; $('resetAll').textContent = 'Reset to defaults'; over = {}; chrome.storage.local.remove('settings:v3'); render(); renderSettings();
  });
  $('setNav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { setTab = b.dataset.tab; renderSettings(); } });
  $('setMain').addEventListener('change', (e) => onSettingChange(e.target));
  $('copyTsv').addEventListener('click', async () => {
    const cols = exportCols(), rows = exportRows();
    const tsv = [cols.join('\t')].concat(rows.map((r) => cols.map((c) => { const v = String(r[c] ?? ''); if ((c === 'listing_id' || c === 'wishlist_item_id') && v) return '="' + v + '"'; return /["\t\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join('\t'))).join('\n');
    await navigator.clipboard.writeText(tsv);
    $('copyTsv').textContent = 'Copied ' + rows.length + ' rows'; setTimeout(() => { $('copyTsv').textContent = 'Copy for Google Sheets'; }, 2500);
  });
  $('dlCsv').addEventListener('click', () => {
    const cols = exportCols(), rows = exportRows(), q = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + [cols.join(',')].concat(rows.map((r) => cols.map((c) => q(r[c])).join(','))).join('\n')], { type: 'text/csv' }));
    a.download = slug(state.meta.name || 'wishlist') + '_scores.csv'; a.click();
  });
  $('diag').addEventListener('click', async () => {
    const { ops, key } = await loadOps();
    const keysOf = (o, d = 0) => (o && typeof o === 'object' && d < 3 ? Object.keys(o).map((k) => k + (o[k] && typeof o[k] === 'object' ? '{' + keysOf(o[k], d + 1) + '}' : '')).join(',') : '');
    const pct = (fn) => (list.length ? Math.round((100 * list.filter(fn).length) / list.length) + '%' : 'n/a');
    const report = { extension: chrome.runtime.getManifest().version, when: new Date().toISOString(), wishlist: state.meta && { name: state.meta.name, listings: state.items.length, voters: state.meta.voters },
      apiKey: !!key, learned: Object.fromEntries(Object.entries(ops).map(([o, r]) => [o, { method: r.method, learnedAt: new Date(r.at).toISOString(), headerNames: Object.keys(r.headers || {}), variables: keysOf(r.vars) }])),
      detailsLoaded: state.items.filter((it) => state.E[it.listing_id] && state.E[it.listing_id].v === 2).length + ' of ' + state.items.length, recipeUsed: state.recipe || {}, probe: state.probe, map: state.geoInfo,
      coverage: list.length ? { bedrooms: pct((L) => L.sleep.bedrooms != null), bedTypes: pct((L) => L.sleep.rooms.length > 0), baths: pct((L) => L.baths != null), amenities: pct((L) => L.amenities.length > 5),
        unavailableAmenities: pct((L) => L.amenities.some((a) => !a[1])), description: pct((L) => L.desc.length > 50), notices: pct((L) => L.notices.length > 0), host: pct((L) => L.host.years),
        subRatings: pct((L) => L.ratings.cleanliness != null), reviewsScanned: pct((L) => L.rev.m > 0), transit: pct((L) => L.geo.transit), routed: pct((L) => L.geo.transit && L.geo.transit.src === 'routed'),
        center: pct((L) => L.geo.center), counts: pct((L) => L.geo.counts) } : null,
      errors: Object.entries(state.err).slice(0, 8), stats: res && { priors: res.priors, medianPpan: res.medPpan, ignoredFactors: Object.keys(res.constant).filter((k) => res.constant[k]), spread: res.norm }, settingsOverrides: over };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    $('diag').textContent = 'Diagnostics copied'; setTimeout(() => { $('diag').textContent = 'Copy diagnostics'; }, 2500);
  });
}

// ---------- boot ----------
(async () => {
  wire(); wireShare();
  if (!WL) { $('meta').textContent = 'Open this from the extension icon on an Airbnb wishlist.'; return; }
  const got = await chrome.storage.local.get(['wl:' + WL, 'settings:v3', 'view:' + WL]);
  over = got['settings:v3'] || {};
  if (got['view:' + WL]) view = Object.assign(view, got['view:' + WL]); view.picks = view.picks || [];
  const saved = got['wl:' + WL];
  if (saved) { state = Object.assign(state, saved); render(); } else $('meta').textContent = 'Not scored yet';
  if (qs.get('run') === '1') { history.replaceState(null, '', location.pathname + '?wl=' + WL); run(); }
})();
