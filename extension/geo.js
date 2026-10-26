// Location engine. Works anywhere OpenStreetMap has data: finds points of interest around each listing,
// measures straight-line distance to all of them, routes walking time to the few that matter most,
// and counts what is within walking range. No place names or regions are hard-coded.
(function (root) {
  const M_PER_MIN = 80;          // average walking pace, meters per minute
  const DETOUR = 1.3;            // street network vs straight line, used when a route is not available
  const PAD = { near: 1200, far: 5000, xfar: 15000 }; // search margins around the listings, meters
  const CELL = 0.15;             // degrees per search tile (about 15 km), so spread-out wishlists stay cheap
  const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const ROUTER = 'https://valhalla1.openstreetmap.de/sources_to_targets';

  // What to look for. scope = how far from the listings to search. out = how much geometry to return.
  const LAYERS = [
    { k: 'dining', scope: 'near', out: 'skel center', q: ['nwr["amenity"~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"]'] },
    { k: 'nightlife', scope: 'near', out: 'skel center', q: ['nwr["amenity"~"^(bar|pub|nightclub|biergarten)$"]'] },
    { k: 'groceries', scope: 'near', out: 'skel center', q: ['nwr["shop"~"^(supermarket|convenience|greengrocer|bakery|deli|butcher|grocery|general)$"]'] },
    { k: 'pharmacy', scope: 'near', out: 'skel center', q: ['nwr["amenity"="pharmacy"]'] },
    { k: 'stops', scope: 'near', out: 'skel', q: ['node["highway"="bus_stop"]', 'node["railway"="tram_stop"]', 'node["public_transport"="platform"]["bus"="yes"]'] },
    { k: 'metro_entrance', scope: 'near', out: 'skel', q: ['node["railway"="subway_entrance"]'] },
    { k: 'sights', scope: 'near', out: 'skel center', q: ['nwr["tourism"~"^(attraction|museum|gallery|viewpoint)$"]',
      'nwr["historic"~"^(monument|castle|ruins|archaeological_site|fort|city_gate|palace|church|cathedral|monastery|tower|aqueduct|amphitheatre|manor)$"]'] },
    { k: 'park', scope: 'near', out: 'skel bb', q: ['nwr["leisure"~"^(park|nature_reserve)$"]', 'nwr["leisure"="garden"]["access"!~"private|no"]'] },
    { k: 'rail', scope: 'far', out: 'body center', q: ['nwr["railway"~"^(station|halt)$"]', 'node["railway"="tram_stop"]["name"]'] },
    { k: 'ferry', scope: 'far', out: 'skel center', q: ['nwr["amenity"="ferry_terminal"]'] },
    { k: 'beach', scope: 'far', out: 'skel geom(BOX)', q: ['nwr["natural"="beach"]', 'nwr["leisure"="beach_resort"]'] },
    { k: 'coast', scope: 'far', out: 'skel geom(BOX)', q: ['way["natural"="coastline"]'] },
    { k: 'lake', scope: 'far', out: 'skel geom(BOX)', q: ['way["natural"="water"]["water"~"^(lake|reservoir|lagoon)$"]', 'REL:rel["natural"="water"]["water"~"^(lake|reservoir|lagoon)$"]'] },
    { k: 'river', scope: 'far', out: 'skel geom(BOX)', q: ['way["waterway"~"^(river|canal)$"]', 'way["natural"="water"]["water"~"^(river|canal|oxbow)$"]'] },
    { k: 'village', scope: 'far', out: 'body', q: ['node["place"~"^(village|town)$"]'] },
    { k: 'city', scope: 'xfar', out: 'body', q: ['node["place"="city"]', 'node["place"="town"]["population"]'] },
  ];

  const toRad = Math.PI / 180;
  const hav = (a, b) => { const dl = (b.lat - a.lat) * toRad, dn = (b.lng - a.lng) * toRad;
    const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dn / 2) ** 2; return 2 * 6371e3 * Math.asin(Math.sqrt(h)); };
  const padBox = (b, m) => { const dLat = m / 111320, dLng = m / (111320 * Math.cos(((b.s + b.n) / 2) * toRad));
    return { s: b.s - dLat, w: b.w - dLng, n: b.n + dLat, e: b.e + dLng }; };
  const boxStr = (b) => [b.s, b.w, b.n, b.e].map((x) => x.toFixed(5)).join(',');

  // Group listings into tiles so a wishlist spread across a region does not become one huge query.
  function tiles(points) {
    const cells = {};
    points.forEach((p) => { const key = Math.floor(p.lat / CELL) + ':' + Math.floor(p.lng / CELL); (cells[key] = cells[key] || []).push(p); });
    return Object.values(cells).map((ps) => {
      const b = { s: Math.min(...ps.map((p) => p.lat)), n: Math.max(...ps.map((p) => p.lat)), w: Math.min(...ps.map((p) => p.lng)), e: Math.max(...ps.map((p) => p.lng)) };
      return { points: ps, box: { near: padBox(b, PAD.near), far: padBox(b, PAD.far), xfar: padBox(b, PAD.xfar) } };
    });
  }

  function query(tile) {
    const lines = ['[out:json][timeout:150];'];
    LAYERS.forEach((L) => {
      const bx = boxStr(tile.box[L.scope]);
      const out = L.out.replace('BOX', bx);
      L.q.forEach((stmt) => {
        if (stmt.startsWith('REL:')) lines.push(stmt.slice(4) + '(' + bx + ');way(r)(' + bx + ');out ' + out + ' qt;');
        else lines.push(stmt + '(' + bx + ');out ' + out + ' qt;');
      });
      lines.push('make m k="' + L.k + '";out;');
    });
    return lines.join('\n');
  }

  // Turn Overpass elements into {k: [features]}; a feature has a point, a polyline or a bounding box.
  function parse(json) {
    const out = {}; let buf = [];
    for (const el of json.elements || []) {
      if (el.type === 'm' && el.tags && el.tags.k) { out[el.tags.k] = (out[el.tags.k] || []).concat(buf); buf = []; continue; }
      const f = { id: el.type[0] + el.id, tags: el.tags || null };
      if (el.lat != null) f.pt = { lat: el.lat, lng: el.lon };
      else if (el.center) f.pt = { lat: el.center.lat, lng: el.center.lon };
      if (el.geometry && el.geometry.length) f.line = el.geometry.filter(Boolean).map((g) => ({ lat: g.lat, lng: g.lon }));
      if (el.bounds) f.bb = { s: el.bounds.minlat, w: el.bounds.minlon, n: el.bounds.maxlat, e: el.bounds.maxlon };
      if (f.pt || f.line || f.bb) buf.push(f);
    }
    return out;
  }

  // Distance from a point to a feature (meters, straight line). Polylines use their nearest vertex, boxes their nearest edge.
  function dist(p, f) {
    if (f.line) { let best = Infinity; const L = f.line, step = L.length > 400 ? 2 : 1; for (let i = 0; i < L.length; i += step) { const d = hav(p, L[i]); if (d < best) best = d; } return best; }
    if (f.bb) { const q = { lat: Math.max(f.bb.s, Math.min(f.bb.n, p.lat)), lng: Math.max(f.bb.w, Math.min(f.bb.e, p.lng)) }; return hav(p, q); }
    return hav(p, f.pt);
  }
  function nearest(p, feats, n = 1) {
    if (!feats || !feats.length) return [];
    return feats.map((f) => ({ f, d: dist(p, f) })).sort((a, b) => a.d - b.d).slice(0, n);
  }
  const count = (p, feats, r) => (feats || []).reduce((a, f) => a + (dist(p, f) <= r ? 1 : 0), 0);
  const nearPoint = (p, f) => { if (f.pt) return f.pt; if (f.line) { let best = f.line[0], bd = Infinity; f.line.forEach((q) => { const d = hav(p, q); if (d < bd) { bd = d; best = q; } }); return best; }
    return { lat: Math.max(f.bb.s, Math.min(f.bb.n, p.lat)), lng: Math.max(f.bb.w, Math.min(f.bb.e, p.lng)) }; };
  const est = (m) => Math.round((m * DETOUR) / M_PER_MIN);

  function railKind(t) {
    t = t || {};
    if (t.railway === 'tram_stop' || t.station === 'tram') return 'tram';
    if (t.station === 'subway' || (t.subway === 'yes' && t.train !== 'yes')) return 'metro';
    if (t.station === 'light_rail' || t.light_rail === 'yes') return 'light rail';
    if (t.station === 'monorail' || t.station === 'funicular' || t.railway === 'funicular') return 'funicular';
    return 'train';
  }

  async function overpass(q, log) {
    let lastErr = '';
    for (let a = 0; a < 4; a++) {
      const url = ENDPOINTS[a % ENDPOINTS.length];
      try {
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (res.status === 429 || res.status === 504 || res.status >= 500) { lastErr = 'HTTP ' + res.status; await new Promise((r) => setTimeout(r, 4000 * (a + 1))); continue; }
        if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
        const j = await res.json();
        if (j.remark && /timed out|out of memory/i.test(j.remark)) { lastErr = j.remark.slice(0, 80); await new Promise((r) => setTimeout(r, 3000)); continue; }
        return j;
      } catch (e) { lastErr = String(e.message || e); await new Promise((r) => setTimeout(r, 3000)); }
    }
    if (log) log('Map data request failed: ' + lastErr);
    return null;
  }

  async function route(src, targets) {
    if (!targets.length) return [];
    try {
      const body = { sources: [{ lat: src.lat, lon: src.lng }], targets: targets.map((t) => ({ lat: t.lat, lon: t.lng })), costing: 'pedestrian' };
      const res = await fetch(ROUTER, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) return [];
      const j = await res.json();
      return (j.sources_to_targets && j.sources_to_targets[0]) || [];
    } catch (e) { return []; }
  }

  // Main entry. points: [{id, lat, lng}]. Returns {id: metrics}. onProgress(doneFraction, text).
  async function analyze(points, opts = {}) {
    const onProgress = opts.onProgress || (() => {}), log = opts.log || (() => {});
    const pts = points.filter((p) => isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0);
    const T = tiles(pts), feats = {};
    for (let i = 0; i < T.length; i++) {
      onProgress(i / (T.length + 1) * 0.3, 'Map data ' + (i + 1) + ' of ' + T.length);
      const j = await overpass(query(T[i]), log);
      if (!j) continue;
      const got = parse(j);
      Object.entries(got).forEach(([k, arr]) => { const seen = new Set((feats[k] || []).map((f) => f.id)); feats[k] = (feats[k] || []).concat(arr.filter((f) => !seen.has(f.id))); });
      if (i < T.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }
    const has = (k) => feats[k] && feats[k].length > 0;
    const out = {}, cap = PAD.far; // no feature within the search margin = treated as "beyond" the margin
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], r = { v: 2 };
      // rapid transit: train, metro, tram, light rail, funicular, ferry; metro entrances stand in for their station
      // ferries only stand in when no train, metro or tram stop is within 1.5 km (tourist boat landings are common in cities)
      const rails = (feats.rail || []).map((f) => ({ ...f, kind: railKind(f.tags) })).concat((feats.metro_entrance || []).map((f) => ({ ...f, kind: 'metro' })));
      let rn = nearest(p, rails, 3);
      if (!rn.length || rn[0].d > 1500) rn = nearest(p, rails.concat((feats.ferry || []).map((f) => ({ ...f, kind: 'ferry' }))), 3);
      const rapid = rails;
      const trainOnly = nearest(p, rapid.filter((f) => f.kind === 'train'), 2);
      // center: nearest place node, with cities counting as closer than towns and towns closer than villages
      const places = (feats.city || []).concat(feats.village || []).map((f) => {
        const t = f.tags || {}, rank = t.place === 'city' ? 3 : t.place === 'town' ? 2 : 1; return { ...f, rank, name: t.name || t.place };
      });
      const pc = places.map((f) => ({ f, d: dist(p, f) })).sort((a, b) => a.d / a.f.rank - b.d / b.f.rank)[0];
      const be = nearest(p, (feats.beach || []).concat(feats.coast || []), 2), bOnly = nearest(p, feats.beach || [], 1);
      const wa = nearest(p, (feats.lake || []).concat(feats.river || []), 1);
      const pk = nearest(p, feats.park || [], 1), gr = nearest(p, feats.groceries || [], 1);

      // route the few destinations whose walking time matters most
      const targets = [], tag = [];
      rn.forEach((x) => { targets.push(nearPoint(p, x.f)); tag.push(['transit', x]); });
      trainOnly.forEach((x) => { targets.push(nearPoint(p, x.f)); tag.push(['train', x]); });
      if (pc && pc.d < 20000) { targets.push(nearPoint(p, pc.f)); tag.push(['center', pc]); }
      be.forEach((x) => { if (x.d < cap) { targets.push(nearPoint(p, x.f)); tag.push(['sea', x]); } });
      wa.forEach((x) => { if (x.d < cap) { targets.push(nearPoint(p, x.f)); tag.push(['water', x]); } });
      const routed = opts.noRouting ? [] : await route(p, targets);
      const best = {};
      tag.forEach(([k, x], j) => {
        const rr = routed[j];
        const cand = rr && rr.time != null ? { min: Math.round(rr.time / 60), m: Math.round(rr.distance * 1000), src: 'routed' } : { min: est(x.d), m: Math.round(x.d * DETOUR), src: 'estimated' };
        cand.name = (x.f.tags && x.f.tags.name) || x.f.name || ''; cand.kind = x.f.kind || (x.f.rank ? ['', 'village', 'town', 'city'][x.f.rank] : k);
        cand.straight = Math.round(x.d);
        if (!best[k] || cand.min < best[k].min) best[k] = cand;
      });
      r.transit = best.transit || (has('rail') || has('metro_entrance') || has('ferry') ? { min: est(cap), src: 'beyond', straight: cap } : null);
      r.train = best.train || null;
      r.center = best.center || null;
      r.sea = best.sea || (has('beach') || has('coast') ? { min: est(cap), src: 'beyond', straight: cap } : null);
      r.beach_straight = bOnly.length ? Math.round(bOnly[0].d) : null;
      r.water = best.water || (has('lake') || has('river') ? { min: est(cap), src: 'beyond', straight: cap } : null);
      r.park = pk.length ? { min: est(pk[0].d), straight: Math.round(pk[0].d), src: 'estimated' } : null;
      r.groceries = gr.length ? { min: est(gr[0].d), straight: Math.round(gr[0].d), src: 'estimated' } : null;
      r.counts = {
        dining: count(p, feats.dining, 500), nightlife: count(p, feats.nightlife, 600), groceries: count(p, feats.groceries, 600),
        pharmacy: count(p, feats.pharmacy, 800), stops: count(p, feats.stops, 500) + count(p, feats.metro_entrance, 500), sights: count(p, feats.sights, 1000), parks: count(p, feats.park, 600),
      };
      r.available = Object.fromEntries(['dining', 'nightlife', 'groceries', 'pharmacy', 'stops', 'sights', 'park', 'rail', 'beach', 'coast', 'lake', 'river'].map((k) => [k, has(k)]));
      out[p.id] = r;
      onProgress(0.3 + 0.7 * (i + 1) / pts.length, (i + 1) + ' of ' + pts.length + ' listings mapped');
      if (!opts.noRouting && targets.length) await new Promise((res) => setTimeout(res, 400));
    }
    return { metrics: out, tiles: T.length, layers: Object.fromEntries(Object.entries(feats).map(([k, v]) => [k, v.length])) };
  }

  const api = { analyze, query, parse, tiles, hav, LAYERS, PAD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Geo = api;
})(typeof window !== 'undefined' ? window : globalThis);
