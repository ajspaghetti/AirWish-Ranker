// AirWish Ranker, scoring model v3: location-agnostic, tag-driven, every factor and weight adjustable.
// Pure functions over records built by model.js. Depends on tags.js (Tags).
(function (root) {
  const Tags = root.Tags || (typeof require !== 'undefined' ? require('./tags.js') : null);

  const CATS = [
    { id: 'loc', label: 'Location' }, { id: 'space', label: 'Space & Sleep' }, { id: 'comfort', label: 'Comfort & Amenities' },
    { id: 'outdoor', label: 'Outdoor & Views' }, { id: 'trust', label: 'Reviews & Trust' }, { id: 'value', label: 'Value' }, { id: 'votes', label: 'Our votes' },
  ];
  const PRESETS = {
    'Balanced': { loc: 22, space: 16, comfort: 12, outdoor: 8, trust: 20, value: 8, votes: 14 },
    'Location first': { loc: 38, space: 12, comfort: 10, outdoor: 6, trust: 16, value: 6, votes: 12 },
    'Comfort first': { loc: 14, space: 22, comfort: 20, outdoor: 12, trust: 16, value: 4, votes: 12 },
    'No surprises': { loc: 14, space: 14, comfort: 10, outdoor: 6, trust: 38, value: 6, votes: 12 },
    'Best value': { loc: 16, space: 14, comfort: 10, outdoor: 6, trust: 18, value: 24, votes: 12 },
  };
  // Each factor lives in exactly one category. w = default weight inside its category (each category sums to 100).
  const FACTORS = [
    { id: 'loc_rating', cat: 'loc', w: 20, label: 'Guest location rating', help: 'Airbnb location sub-rating, trusted more as reviews grow' },
    { id: 'transit', cat: 'loc', w: 18, label: 'Walk to public transport', help: 'Nearest train, metro, tram or light rail stop (ferry if none within 1.5 km)' },
    { id: 'center', cat: 'loc', w: 12, label: 'Walk to the center', help: 'Nearest city, town or village center' },
    { id: 'walkability', cat: 'loc', w: 18, label: 'Walkability', help: 'Groceries, places to eat, pharmacy, transit stops and parks within a short walk' },
    { id: 'dining', cat: 'loc', w: 8, label: 'Places to eat nearby', help: 'Restaurants and cafes within 500 m' },
    { id: 'sights', cat: 'loc', w: 10, label: 'Sights nearby', help: 'Attractions, museums, viewpoints and historic sites within 1 km' },
    { id: 'nightlife', cat: 'loc', w: 4, label: 'Nightlife nearby', help: 'Bars, pubs and clubs within 600 m. Invert it to prefer quiet areas' },
    { id: 'sea', cat: 'loc', w: 4, label: 'Walk to the sea or a beach', help: 'Nearest beach or coastline' },
    { id: 'water', cat: 'loc', w: 2, label: 'Walk to a lake or river', help: 'Nearest lake, river or canal' },
    { id: 'park', cat: 'loc', w: 4, label: 'Walk to a park', help: 'Nearest park or public garden' },
    { id: 'real_beds', cat: 'space', w: 30, label: 'Real beds for the group', help: 'Sleeping spots in real beds vs adults; sofa beds, couches and mattresses do not count' },
    { id: 'bed_count', cat: 'space', w: 15, label: 'Number of real beds', help: 'Real beds vs beds needed (one per pair, or one each)' },
    { id: 'bedrooms', cat: 'space', w: 25, label: 'Bedrooms', help: 'Bedrooms vs rooms needed (one per pair, or one each); a studio counts as half' },
    { id: 'bathrooms', cat: 'space', w: 20, label: 'Bathrooms', help: 'Bathrooms vs one per two adults; a shared bath counts as half' },
    { id: 'headroom', cat: 'space', w: 10, label: 'Guest headroom', help: 'Max guests minus your adults' },
    { id: 'essentials', cat: 'comfort', w: 45, label: 'Essentials', help: 'Weighted share of essential amenity tags present' },
    { id: 'step_free', cat: 'comfort', w: 25, label: 'Step-free access', help: 'Elevator or single level; otherwise stairs evidence from reviews, house rules and description' },
    { id: 'convenience', cat: 'comfort', w: 15, label: 'Convenience', help: 'Self check-in, free parking, private entrance, luggage drop-off' },
    { id: 'extras', cat: 'comfort', w: 15, label: 'Extras', help: 'Pool, hot tub, sauna, gym, fireplace, bathtub, EV charger' },
    { id: 'outdoor_space', cat: 'outdoor', w: 55, label: 'Outdoor space', help: 'Best outdoor tag (rooftop, terrace, garden, balcony, patio, courtyard) plus bonuses' },
    { id: 'view', cat: 'outdoor', w: 45, label: 'View', help: 'Best view tag (sea, lake or river, mountain, city, garden)' },
    { id: 'proven', cat: 'trust', w: 30, label: 'Proven rating', help: 'Overall rating, trusted more as reviews grow' },
    { id: 'cleanliness', cat: 'trust', w: 12, label: 'Cleanliness rating', help: 'Airbnb sub-rating, same trust rule' },
    { id: 'accuracy', cat: 'trust', w: 10, label: 'Accuracy rating', help: 'Airbnb sub-rating, same trust rule' },
    { id: 'checkin', cat: 'trust', w: 3, label: 'Check-in rating', help: 'Airbnb sub-rating, same trust rule' },
    { id: 'communication', cat: 'trust', w: 5, label: 'Communication rating', help: 'Airbnb sub-rating, same trust rule' },
    { id: 'red_flags', cat: 'trust', w: 20, label: 'Red flags in reviews', help: 'Share of reviews with a red flag, weighted by each red flag tag severity' },
    { id: 'green_flags', cat: 'trust', w: 8, label: 'Green flags in reviews', help: 'Share of reviews with praise, weighted by each green flag tag value' },
    { id: 'warnings', cat: 'trust', w: 6, label: 'Listing warnings', help: 'House rules and safety notices, each warning tag has a severity' },
    { id: 'superhost', cat: 'trust', w: 3, label: 'Superhost', help: 'Superhost 100, not 0' },
    { id: 'cancellation', cat: 'trust', w: 3, label: 'Cancellation policy', help: 'Flexible 100 to Non-refundable 0' },
    { id: 'price', cat: 'value', w: 100, label: 'Price per adult per night', help: '50 at the wishlist median, 100 at half of it, 0 at double' },
  ];
  const DEFAULTS = {
    v: 3, preset: 'Balanced', cats: null, factors: {}, tags: {}, sleep: 'pairs',
    rating: { prior: 'fixed', value: 4.7, tau: 25, floor: 4.0, gamma: 2 },
    flags: { k: 10, redPrior: 0.03, redHalf: 0.04, greenPrior: 0.3, greenHalf: 0.25, stairsPrior: 0.04, stairsHalf: 0.06 },
    curves: { transit: { full: 4, half: 8 }, center: { full: 5, half: 12 }, sea: { full: 3, half: 8 }, water: { full: 3, half: 8 }, park: { full: 3, half: 6 }, dining: 25, sights: 20, nightlife: 8 },
    walk: { groceries: [3, 2], dining: [3, 8], pharmacy: [1, 1], stops: [2, 3], parks: [1, 1] },
    combine: { balance: true, sigmaMin: 8, dropConstant: true },
    budget: { wPrice: 60, minRating: 4.6, maxRedRate: 0.08 },
    share: { base: 'https://ajspaghetti.github.io/AirWish-Ranker/s/' },
  };
  const BADGE = { 'Top guest favorite': 100, 'Guest favorite': 85, 'Superhost': 65 };
  const CANC = { Flexible: 100, Moderate: 80, Limited: 65, Firm: 50, Strict: 30, 'Non-refundable': 0 };

  const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
  const r1 = (x) => Math.round(x * 10) / 10;
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  function merge(base, over) { const out = Array.isArray(base) ? base.slice() : Object.assign({}, base); if (!isObj(over)) return out;
    for (const k in over) out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k]; return out; }
  const resolve = (overrides) => merge(DEFAULTS, overrides || {});
  const catWeights = (S) => S.cats || PRESETS[S.preset] || PRESETS.Balanced;
  const factorCfg = (S, f) => Object.assign({ on: true, w: f.w, invert: false }, S.factors[f.id] || {});
  const tagCfg = (S, t) => Object.assign({ pref: 'normal', w: t.w }, S.tags[t.id] || {});

  const dist = (min, c) => (min == null ? null : min <= c.full ? 100 : 100 * Math.pow(2, -(min - c.full) / c.half));
  const cnt = (n, k) => (n == null ? null : 100 * (1 - Math.exp(-n / k)));
  const quality = (r, R) => Math.pow(clamp((r - R.floor) / (5 - R.floor), 0, 1), R.gamma);
  function p25(xs) { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const pos = 0.25 * (s.length - 1), lo = Math.floor(pos);
    return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo); }
  function proven(r, n, prior, R) {
    if (prior == null) return null;
    const qp = quality(prior, R);
    const w = r != null ? 1 - Math.exp(-(n || 0) / R.tau) : 0;
    return 100 * (w * (r != null ? quality(r, R) : 0) + (1 - w) * qp);
  }
  function median(xs) { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; }

  // ---------- per-listing review flag arithmetic ----------
  function flagStats(L, S) {
    const red = {}, green = {}; let f = 0, g = 0;
    const sevR = (id) => { const t = Tags.BY_ID['r_' + id]; return t ? +tagCfg(S, t).w : 1; };
    const valG = (id) => { const t = Tags.BY_ID['g_' + id]; return t ? +tagCfg(S, t).w : 0.5; };
    if (L.rev.v1) { L.rev.v1.forEach((id) => { red[id] = (red[id] || 0) + 1; f += sevR(id); }); }
    L.rev.red.forEach((mask) => { let mx = 0; L.rev.lexRed.forEach((id, i) => { if (mask & (1 << i)) { red[id] = (red[id] || 0) + 1; mx = Math.max(mx, sevR(id)); } }); f += mx; });
    L.rev.green.forEach((mask) => { let mx = 0; L.rev.lexGreen.forEach((id, i) => { if (mask & (1 << i)) { green[id] = (green[id] || 0) + 1; mx = Math.max(mx, valG(id)); } }); g += mx; });
    const F = S.flags, m = L.rev.m;
    const has = L.collected && (m > 0 || L.reviews === 0);
    const pr = has ? (f + F.k * F.redPrior) / (m + F.k) : null;
    const pg = has && !L.legacy ? (g + F.k * F.greenPrior) / (m + F.k) : null;
    const ps = has ? (L.rev.stairs + F.k * F.stairsPrior) / (m + F.k) : null;
    return { red, green, f, g, pr, pg, ps, stairsShare: m ? L.rev.stairs / m : null,
      redScore: pr == null ? null : 100 * Math.pow(2, -pr / F.redHalf), greenScore: pg == null ? null : 100 * (1 - Math.pow(2, -pg / F.greenHalf)),
      stairsScore: ps == null ? null : 100 * Math.pow(2, -ps / F.stairsHalf) };
  }

  function coverage(tv, group, S) {
    let num = 0, den = 0, known = false;
    Tags.TAGS.filter((t) => t.group === group && t.kind === 'cover').forEach((t) => {
      const c = tagCfg(S, t), x = tv[t.id], w = +c.w || 0;
      if (x != null) known = true;
      if (c.pref === 'ignore' || w <= 0) return;
      if (c.pref === 'avoid') { if (x === 1) num -= w; return; }
      if (x != null) { den += w; num += w * x; }
    });
    return !known ? null : den > 0 ? clamp((100 * num) / den) : (num < 0 ? 0 : null);
  }
  function bestOf(tv, group, S) {
    let best = 0, bonus = 0, known = false;
    Tags.TAGS.filter((t) => t.group === group).forEach((t) => {
      const x = tv[t.id]; if (x != null) known = true; if (x !== 1) return;
      const w = +tagCfg(S, t).w || 0;
      if (t.kind === 'best') best = Math.max(best, w); else if (t.kind === 'bonus') bonus += w;
    });
    return known ? clamp(best + (best > 0 ? bonus : bonus / 2)) : null;
  }

  // ---------- main ----------
  function score(list, overrides) {
    const S = resolve(overrides);
    const N = list.length, A = (L) => L.adults || 1;
    const pairs = S.sleep !== 'separate';
    const need = (L) => (pairs ? Math.ceil(A(L) / 2) : A(L));
    const priors = {};
    ['overall', 'location', 'cleanliness', 'accuracy', 'checkin', 'communication'].forEach((k) => {
      const vals = list.filter((L) => L.reviews > 0).map((L) => (k === 'overall' ? L.rating : L.ratings[k]));
      priors[k] = S.rating.prior === 'p25' ? p25(vals) ?? S.rating.value : S.rating.value;
    });
    const medPpan = median(list.map((L) => L.ppan));
    const fl = list.map((L) => flagStats(L, S));
    const W = S.walk;
    const walkIdx = list.map((L) => { const c = L.geo && L.geo.counts; if (!c) return null;
      let n = 0, d = 0; Object.entries(W).forEach(([k, [w, kk]]) => { if (c[k] == null) return; n += w * (1 - Math.exp(-c[k] / kk)); d += w; }); return d ? (100 * n) / d : null; });
    const tagv = list.map((L, i) => Tags.evaluate(L, { redCount: fl[i].red, greenCount: fl[i].green, stairsShare: fl[i].stairsShare, walk: walkIdx[i], targetBedrooms: need(L) }));

    const C = S.curves;
    const calc = {
      loc_rating: (L) => (L.collected ? proven(L.ratings.location, L.reviews, priors.location, S.rating) : null),
      transit: (L) => dist(L.geo.transit && L.geo.transit.min, C.transit),
      center: (L) => dist(L.geo.center && L.geo.center.min, C.center),
      walkability: (L, i) => walkIdx[i],
      dining: (L) => cnt(L.geo.counts && L.geo.counts.dining, C.dining),
      sights: (L) => cnt(L.geo.counts && L.geo.counts.sights, C.sights),
      nightlife: (L) => cnt(L.geo.counts && L.geo.counts.nightlife, C.nightlife),
      sea: (L) => dist(L.geo.sea && L.geo.sea.min, C.sea),
      water: (L) => dist(L.geo.water && L.geo.water.min, C.water),
      park: (L) => dist(L.geo.park && L.geo.park.min, C.park),
      real_beds: (L) => { const s = L.sleep; if (!s.known && s.total == null) return null; return s.spots >= A(L) ? 100 : (60 * s.spots) / A(L); },
      bed_count: (L) => { const s = L.sleep; if (s.v1 || (!s.known && s.total == null)) return null; return 100 * Math.min(1, (s.real + 0.5 * s.unknown) / need(L)); },
      bedrooms: (L) => { const b = L.sleep.studio ? 0.5 : L.sleep.bedrooms; return b == null ? null : 100 * Math.min(1, b / need(L)); },
      bathrooms: (L) => (L.bathEff == null ? null : 100 * Math.min(1, L.bathEff / Math.max(1, A(L) / 2))),
      headroom: (L) => { if (L.guests_max == null) return null; const h = L.guests_max - A(L); return h >= 2 ? 100 : h >= 1 ? 70 : h >= 0 ? 40 : 0; },
      essentials: (L, i) => coverage(tagv[i], 'Essentials', S),
      convenience: (L, i) => coverage(tagv[i], 'Convenience', S),
      extras: (L, i) => coverage(tagv[i], 'Extras', S),
      step_free: (L, i) => { const t = tagv[i]; if (!L.collected) return null; if (t.elevator === 1 || t.step_free === 1) return 100;
        let s = fl[i].stairsScore ?? 60; if (t.must_climb_stairs === 1) s = Math.min(s, 40); if (t.no_elevator === 1) s = Math.min(s, 50); return s; },
      outdoor_space: (L, i) => bestOf(tagv[i], 'Outdoor', S),
      view: (L, i) => bestOf(tagv[i], 'Views', S),
      proven: (L) => (L.rating == null && !L.collected ? null : proven(L.rating, L.reviews, priors.overall, S.rating)),
      cleanliness: (L) => (L.collected ? proven(L.ratings.cleanliness, L.reviews, priors.cleanliness, S.rating) : null),
      accuracy: (L) => (L.collected ? proven(L.ratings.accuracy, L.reviews, priors.accuracy, S.rating) : null),
      checkin: (L) => (L.collected ? proven(L.ratings.checkin, L.reviews, priors.checkin, S.rating) : null),
      communication: (L) => (L.collected ? proven(L.ratings.communication, L.reviews, priors.communication, S.rating) : null),
      red_flags: (L, i) => fl[i].redScore,
      green_flags: (L, i) => fl[i].greenScore,
      warnings: (L, i) => { if (!L.collected || L.legacy) return null; let s = 0; Tags.TAGS.filter((t) => t.kind === 'warn').forEach((t) => { if (tagv[i][t.id] === 1) s += +tagCfg(S, t).w || 0; }); return 100 * Math.pow(2, -s); },
      superhost: (L) => (L.host.superhost === true || L.badge === 'Superhost' ? 100 : L.host.superhost === false ? 0 : null),
      cancellation: (L) => (CANC[L.cancellation] ?? null),
      price: (L) => (L.ppan == null || !medPpan ? null : clamp(50 - 50 * Math.log2(L.ppan / medPpan))),
    };

    // factor values, constant-factor detection
    const F = {}, constant = {};
    FACTORS.forEach((f) => {
      const cfg = factorCfg(S, f);
      F[f.id] = list.map((L, i) => { let v = null; try { v = calc[f.id](L, i); } catch (e) { v = null; } if (v == null || isNaN(v)) return null; return cfg.invert ? 100 - v : v; });
      const xs = F[f.id].filter((v) => v != null);
      constant[f.id] = S.combine.dropConstant && xs.length >= 2 && Math.max(...xs) - Math.min(...xs) < 0.5;
    });
    const active = (f) => { const c = factorCfg(S, f); return c.on && +c.w > 0 && !constant[f.id]; };

    // category scores (absolute, 0 to 100) and the points behind them
    const Cs = {}, parts = {};
    CATS.forEach((cat) => { if (cat.id === 'votes') return;
      const fs = FACTORS.filter((f) => f.cat === cat.id && active(f));
      Cs[cat.id] = []; parts[cat.id] = [];
      list.forEach((L, i) => {
        let nu = 0, de = 0; const pts = [];
        fs.forEach((f) => { const v = F[f.id][i]; if (v == null) return; const w = +factorCfg(S, f).w; nu += w * v; de += w; pts.push([f.id, w * v]); });
        Cs[cat.id].push(de ? r1(nu / de) : null);
        parts[cat.id].push(de ? pts.map(([id, p]) => [id, r1(p / de)]) : []);
      });
    });
    const voters = Math.max(1, ...list.map((L) => Math.max(L.voters || 0, Object.keys(L.votes).length)));
    const yes = list.map((L) => Object.values(L.votes).filter((v) => v === 'Yes').length), no = list.map((L) => Object.values(L.votes).filter((v) => v === 'No').length);
    Cs.votes = list.map((L, i) => r1(clamp(50 + (50 * (yes[i] - no[i])) / voters)));

    // overall: optional balancing so each category's preset weight is its real pull on the ranking
    const pi = catWeights(S), norm = {};
    CATS.forEach((cat) => {
      const xs = Cs[cat.id].filter((v) => v != null), mu = xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(xs.length, 1));
      norm[cat.id] = { mu, sd, scale: Math.max(sd, S.combine.sigmaMin) };
    });
    const adj = (k, v) => (v == null ? null : S.combine.balance ? clamp(50 + (20 * (v - norm[k].mu)) / norm[k].scale) : v);
    const O = list.map((L, i) => { let nu = 0, de = 0; CATS.forEach((cat) => { const v = adj(cat.id, Cs[cat.id][i]); const w = +pi[cat.id] || 0; if (v == null || !w) return; nu += w * v; de += w; }); return de ? r1(nu / de) : null; });
    const oParts = list.map((L, i) => { let de = 0; const pts = []; CATS.forEach((cat) => { const v = adj(cat.id, Cs[cat.id][i]); const w = +pi[cat.id] || 0; if (v == null || !w) return; de += w; pts.push([cat.id, w * v]); });
      return pts.map(([k, p]) => [k, r1(p / de)]); });
    const B = list.map((L, i) => (Cs.value[i] == null || O[i] == null ? null : r1((S.budget.wPrice * Cs.value[i] + (100 - S.budget.wPrice) * O[i]) / 100)));

    // hard rules from tag settings (Must have / Exclude) and budget gate
    const rules = Tags.TAGS.map((t) => [t, tagCfg(S, t).pref]).filter(([, p]) => p === 'must' || p === 'exclude');
    const elig = list.map((L, i) => rules.every(([t, p]) => (p === 'must' ? tagv[i][t.id] === 1 : tagv[i][t.id] !== 1)));
    const belig = list.map((L, i) => elig[i] && (L.rating == null || L.rating >= S.budget.minRating) && (fl[i].pr == null || fl[i].pr <= S.budget.maxRedRate));

    // tags shown on each listing, and pros/cons
    const shown = list.map((L, i) => Tags.TAGS.filter((t) => tagv[i][t.id] === 1).map((t) => ({ id: t.id, label: t.label, group: t.group, pol: t.pol,
      detail: t.detail ? t.detail(L, { redCount: fl[i].red, greenCount: fl[i].green }) : '',
      imp: t.kind === 'flag' || t.kind === 'warn' ? 2 + (+tagCfg(S, t).w || 0) : t.kind === 'cover' ? 1 + (+tagCfg(S, t).w || 0) / 10 : t.kind === 'best' ? 1 + (+tagCfg(S, t).w || 0) / 100 : 1 })));
    // a tag most listings share says little, so pros and cons favor what sets a listing apart
    const prev = {}; shown.forEach((ts) => ts.forEach((t) => { prev[t.id] = (prev[t.id] || 0) + 1 / N; }));
    shown.forEach((ts) => ts.forEach((t) => { t.imp = t.imp * (1.15 - (prev[t.id] || 0)); }));
    const pros = shown.map((ts) => ts.filter((t) => t.pol > 0).sort((a, b) => b.imp - a.imp).slice(0, 6).map((t) => t.label));
    const cons = shown.map((ts) => ts.filter((t) => t.pol < 0).sort((a, b) => b.imp - a.imp).slice(0, 6).map((t) => t.label + (t.detail ? ' (' + t.detail + ')' : '')));

    // ranks among eligible listings: score desc, then rating desc, price asc, wishlist order
    const rank = (sc, ok) => { const idx = list.map((_, i) => i).filter((i) => ok[i] && sc[i] != null);
      idx.sort((a, z) => (sc[z] - sc[a]) || ((list[z].rating ?? -1) - (list[a].rating ?? -1)) || ((list[a].ppan ?? 1e9) - (list[z].ppan ?? 1e9)) || (list[a].position - list[z].position));
      const out = list.map(() => null); idx.forEach((i, k) => { out[i] = k + 1; }); return out; };
    const R = { overall: rank(O, elig), budget: rank(B, belig) }; CATS.forEach((c) => { R[c.id] = rank(Cs[c.id], elig); });

    // nominal share of Overall each factor would have with full data (for the settings screen)
    const piSum = CATS.reduce((a, c) => a + (+pi[c.id] || 0), 0) || 1;
    const share = {}; CATS.forEach((cat) => { const fs = FACTORS.filter((f) => f.cat === cat.id && active(f)); const ws = fs.reduce((a, f) => a + +factorCfg(S, f).w, 0) || 1;
      fs.forEach((f) => { share[f.id] = (100 * (+pi[cat.id] || 0) / piSum) * (+factorCfg(S, f).w / ws); }); });

    return { S, F, C: Cs, O, B, R, parts, oParts, elig, belig, tagv, shown, pros, cons, fl, walkIdx, constant, norm, priors, medPpan, share, voters, prev };
  }

  const api = { score, resolve, merge, DEFAULTS, PRESETS, CATS, FACTORS, BADGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Scorer = api;
})(typeof window !== 'undefined' ? window : globalThis);
