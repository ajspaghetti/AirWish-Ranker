// Runs in the page (MAIN world) on www.airbnb.com so requests carry the user's session. Installed by the extension.
// It reads Airbnb's own data for each listing and returns facts and counts. Guest review text never leaves this function:
// only which red and green flag tags each review triggered, and when.
(() => {
  if (window.ABW && window.ABW.__v === 5) return;
  const ABW = (window.ABW = { __v: 5, E: {}, err: {}, done: {}, running: false, recipe: {}, probe: null });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const walk = (o, fn, seen = new Set()) => { if (o && typeof o === 'object' && !seen.has(o)) { seen.add(o); fn(o); for (const k in o) walk(o[k], fn, seen); } };
  const strings = (o) => { const out = []; walk(o, (x) => { for (const k in x) if (typeof x[k] === 'string' && !/^(__typename|id|url|baseUrl|pictureUrl|imageUrl|icon|loggingId|sectionId)$/i.test(k)) out.push(x[k]); }); return out; };
  const findKey = (o, key) => { let hit; walk(o, (x) => { if (hit === undefined && Object.prototype.hasOwnProperty.call(x, key) && x[key] != null) hit = x[key]; }); return hit; };
  const num = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? +m[0] : ''; };
  const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  // Point a captured variables template at another entity: swaps base64 "Type:123" ids and plain numeric id fields.
  ABW.retarget = (vars, type, id) => {
    const sw = (v, key) => {
      if (typeof v === 'string') {
        if (key && /^(listingId|wishlistId|id|demandStayListingId)$/i.test(key) && /^\d+$/.test(v)) return String(id);
        if (/^[A-Za-z0-9+/=]{8,}$/.test(v)) { try { const m = atob(v).match(/^(\w+):(\d+)$/); if (m && m[1] === type) return btoa(type + ':' + id); } catch (e) { /* not base64 */ } }
        return v;
      }
      if (Array.isArray(v)) return v.map((x) => sw(x));
      if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = sw(v[k], k); return o; }
      return v;
    };
    return sw(JSON.parse(JSON.stringify(vars)));
  };

  ABW.init = (cfg, meta) => { ABW.cfg = cfg; if (meta) ABW.meta = meta;
    const inj = document.getElementById('data-injector-instances');
    const km = inj && (inj.textContent.match(/"api_config":\{[^}]*?"key":"([a-z0-9]{20,40})"/) || inj.textContent.match(/"key":"([a-z0-9]{32})"/));
    if (km && !cfg.key) cfg.key = km[1];
    return !!cfg.key; };

  // Request recipes, tried in order until Airbnb accepts one; the winner is remembered per operation.
  // Captured CSRF tokens and per-request ids are never replayed: they go stale once the page that made them is gone.
  const BASE_H = { 'Content-Type': 'application/json', 'X-Airbnb-GraphQL-Platform': 'web', 'X-Airbnb-GraphQL-Platform-Client': 'minimalist-niobe' };
  const STALE = /csrf|action-id|trace-id|request-id|network-log/i;
  const cookie = (n) => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
  const recipes = (rec) => {
    const cap = {}; Object.entries(rec.headers || {}).forEach(([k, v]) => { if (!STALE.test(k)) cap[k] = v; });
    const noTok = Object.assign({}, BASE_H, { 'X-CSRF-Without-Token': '1' });
    const out = [{ name: rec.method + ' without token', method: rec.method, h: noTok },
      { name: rec.method + ' page headers', method: rec.method, h: Object.assign({}, BASE_H, cap, { 'X-CSRF-Without-Token': '1' }) }];
    const tok = ABW.cfg.csrf || cookie('_csrf_token');
    if (tok) out.push({ name: rec.method + ' fresh token', method: rec.method, h: Object.assign({}, BASE_H, cap, { 'X-CSRF-Token': tok }) });
    if (rec.method === 'POST') out.push({ name: 'GET without token', method: 'GET', h: noTok });
    return out;
  };
  ABW.gql = async (op, variables) => {
    const rec = ABW.cfg.ops[op]; if (!rec) throw new Error('not learned: ' + op);
    const ext = { persistedQuery: { version: 1, sha256Hash: rec.hash } };
    const base = `/api/v3/${op}/${rec.hash}?operationName=${op}&locale=en&currency=USD`;
    const R = recipes(rec);
    let i = Math.min(ABW.recipe[op] ? ABW.recipe[op].i : 0, R.length - 1);
    const tried = [];
    for (let a = 0; a < 8; a++) {
      const r = R[i], headers = Object.assign({}, r.h);
      if (ABW.cfg.key) headers['X-Airbnb-API-Key'] = ABW.cfg.key;
      const res = r.method === 'POST'
        ? await fetch(base, { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ operationName: op, variables, extensions: ext }) })
        : await fetch(base + '&variables=' + encodeURIComponent(JSON.stringify(variables)) + '&extensions=' + encodeURIComponent(JSON.stringify(ext)), { headers, credentials: 'include' });
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * (a + 1)); continue; }
      if (!res.ok) {
        let body = ''; try { body = (await res.text()).replace(/\s+/g, ' ').slice(0, 140); } catch (e) { /* no body */ }
        tried.push(r.name + ' ' + res.status);
        if ([400, 401, 403, 405].includes(res.status) && tried.length < R.length) { i = (i + 1) % R.length; continue; }
        throw new Error(op + ' HTTP ' + res.status + ' [' + tried.join('; ') + ']' + (body ? ' ' + body : ''));
      }
      const j = await res.json();
      if (!j.data && j.errors) throw new Error(op + ': ' + JSON.stringify(j.errors).slice(0, 160));
      ABW.recipe[op] = { i, name: r.name };
      return j.data;
    }
    throw new Error(op + ': rate limited');
  };

  // ---------- wishlist cards ----------
  ABW.wishlist = async (wishlistId) => {
    const d = await ABW.gql('WishlistDetailPageDataQuery', ABW.retarget(ABW.cfg.ops.WishlistDetailPageDataQuery.vars, 'Wishlist', wishlistId));
    const node = d.node || d;
    const items = findKey(node, 'wishlistItems');
    if (!items || !items.edges) throw new Error('wishlist items not found in response');
    const gd = findKey(node, 'guestDetails') || {};
    const me = (findKey(node, 'wishlistUser') || {}).contextualUser || {};
    const vote = (v) => (v === 'UPVOTE' ? 'Yes' : v === 'DOWNVOTE' ? 'No' : '');
    const meta = { id: String(wishlistId), name: node.name || '', adults: gd.numberOfAdults || 1, children: gd.numberOfChildren || 0,
      me: me.displayFirstName || 'Me', voters: {}, hasNextPage: !!(items.pageInfo && items.pageInfo.hasNextPage) };
    const who = (u) => (u ? (u.isCurrentUser ? meta.me : (u.contextualUser && u.contextualUser.displayFirstName)) : null);
    (findKey(node, 'collaboratorUsers') || []).forEach((u) => { const n = u.contextualUser && u.contextualUser.displayFirstName; if (n) meta.voters[n] = 1; });
    meta.voters[meta.me] = 1;
    const list = items.edges.map((e, i) => {
      const n = e.node, L = (n.dumbledoreListing && n.dumbledoreListing.listing) || findKey(n, 'listing') || {};
      const title = L.title || '', ix = title.indexOf(' in ');
      const badges = (n.formattedBadges || []).map((x) => x.textAccessibilityLabel || x.text);
      const lines = strings(L.structuredContent || {});
      const q = L.pricingQuote || (n.dumbledoreListing || {}).pricingQuote; const pl = q && q.structuredStayDisplayPrice && q.structuredStayDisplayPrice.primaryLine;
      const pics = n.contextualPictures || [];
      const name = String(L.subtitle || L.name || '').replace(/[\t\r\n]+/g, ' ').trim();
      const votes = {}, notes = {};
      (n.votes || []).forEach((v) => { const w = who(v.user); if (w) { votes[w] = vote(v.vote); meta.voters[w] = 1; } });
      (n.notes || []).forEach((v) => { const w = who(v.user); if (w) notes[w] = ((notes[w] ? notes[w] + ' | ' : '') + v.noteContent).replace(/[\t\r\n]+/g, ' '); });
      const r = parseFloat(L.avgRatingLocalized);
      let itemId = ''; try { itemId = atob(n.id).split(':')[1] || ''; } catch (err) { itemId = ''; }
      return {
        position: i + 1, listing_id: String(n.entityId), wishlist_item_id: itemId, name,
        property_type: ix > 0 ? title.slice(0, ix) : title, town: ix > 0 ? title.slice(ix + 4) : '',
        badge: badges.includes('Top guest favorite') ? 'Top guest favorite' : badges.includes('Guest favorite') ? 'Guest favorite' : badges.includes('Superhost') ? 'Superhost' : '',
        rating: isNaN(r) ? '' : r, beds: num(lines.find((x) => /\bbeds?\b/.test(x))), bedrooms: num(lines.find((x) => /bedroom|studio/i.test(x))),
        card_lines: lines.slice(0, 8),
        check_in: (n.listingLevelDate || {}).checkIn || (findKey(node, 'dateRangeDetails') || {}).checkIn || '',
        check_out: (n.listingLevelDate || {}).checkOut || (findKey(node, 'dateRangeDetails') || {}).checkOut || '',
        total_price_usd: pl ? num(pl.discountedPrice || pl.price) : '', photo_count: pics.length, cover_photo_url: (pics[0] && pics[0].picture) || '',
        lat: L.lat ?? (L.coordinate && L.coordinate.latitude) ?? '', lng: L.lng ?? (L.coordinate && L.coordinate.longitude) ?? '', votes, notes,
        registration_code: ((name.match(/\bIT\d{6}[A-Z0-9]{8,}\b/i) || name.match(/\b\d{6}-[A-Z]{2,4}-\d{3,5}\b/i) || [''])[0]).toUpperCase(),
      };
    });
    const dated = list.find((x) => x.check_in);
    list.forEach((x) => { if (!x.check_in && dated) { x.check_in = dated.check_in; x.check_out = dated.check_out; } });
    meta.voters = Object.keys(meta.voters);
    ABW.meta = meta; ABW.items = list;
    return { meta, items: list };
  };

  // ---------- review lexicons (whole words, Unicode aware; Airbnb's English translation plus the original text) ----------
  const W = (src) => new RegExp('(?<![\\p{L}\\p{N}])(?:' + src + ')(?![\\p{L}\\p{N}])', 'giu');
  const NEG = /(?:\b(?:no|not|never|without|zero|hardly|barely|non|nessun\w*|niente|sin|sans|pas de|wasn'?t|weren'?t|isn'?t|aren'?t|didn'?t|don'?t|doesn'?t)\b)[^.!?;,]{0,14}$/i;
  const AC = "(?:ac|a/c|air ?con\\w*)";
  const RED = [
    { id: 'damp_mold', re: W('mou?ld(?:y)?|mildew|damp(?:ness)?|humid(?:ity)?|musty|condensation|muffa|umid\\w*|moho|humedad|moisissure|humidit\\w*'), skipBefore: /(?:weather|outside|summer|air|day|days|night|nights|climate|heat)\W{0,4}(?:\w+\W{0,3}){0,2}$/i },
    { id: 'smell', re: W('smell(?:s|ed|y|ing)?|odou?rs?|stink\\w*|stench|sewage|sewer|drains?|puzza|olor|odeur|odore'),
      skipAfter: /^\W{0,3}(?:good|great|nice|amazing|lovely|wonderful|fresh|clean|delicious|of (?:the )?(?:sea|ocean|coffee|flowers|lemons?|basil|pesto|focaccia|bread|jasmine|pine))/i },
    { id: 'dirty', re: W("dirty|filthy|grimy|grubby|stain(?:s|ed)?|dust(?:y)?|hairs?|unclean|not (?:very )?clean|wasn'?t (?:very )?clean|sporc\\w*|sucio"), skipAfter: /^\W{0,3}(?:dryers?|straighteners?|ties?|salon|cut|pan)/i },
    { id: 'pests', re: W('bugs|bed ?-?bugs?|cockroach(?:es)?|roach(?:es)?|ants|mice|mouse|rats?|fleas|termites|scarafaggi|insetti|cucarachas') },
    { id: 'mosquitoes', re: W('mosquito(?:e?s)?|zanzar\\w*') },
    { id: 'noise', re: W('noisy|noise|loud|thin walls|traffic|construction|church bells|bells|rumore|rumoroso|ruido|bruit\\w*'), skipAfter: /^\W{0,3}(?:cancell?ing|machine|free)/i },
    { id: 'broken', neg: false, re: W("broken|leak(?:s|ing|ed|y)?|not working|out of order|stopped working|malfunction\\w*|(?:shower|toilet|door|lock|tv|washer|dryer|oven|stove|fridge|elevator|lift) (?:didn'?t|did not|doesn'?t|does not|wasn'?t|was not) work\\w*") },
    { id: 'too_hot', neg: false, re: W("too hot|very hot|so hot|extremely hot|unbearably hot|stuffy|sweltering|no " + AC + "|" + AC + " (?:didn'?t|did not|doesn'?t|does not|wasn'?t|was not) work\\w*|weak " + AC + "|hot at night") },
    { id: 'too_cold', neg: false, re: W("too cold|very cold|so cold|freezing|no heat(?:ing)?|heat(?:ing|er) (?:didn'?t|did not|wasn'?t|was not) work\\w*|no hot water|cold showers?|lukewarm (?:water|shower)") },
    { id: 'wifi_bad', neg: false, re: W("(?:wifi|wi-fi|internet) (?:was|is) (?:very |really |quite )?(?:weak|slow|spotty|patchy|bad|terrible|poor|unreliable|non-?existent)|weak (?:wifi|wi-fi|signal)|slow (?:wifi|wi-fi|internet)|no (?:wifi|wi-fi|internet)") },
    { id: 'misleading', re: W("not as (?:pictured|described|advertised|shown)|misleading|different (?:from|than) (?:the )?(?:photos|pictures|listing)|smaller than (?:expected|pictured|it looks|in the photos)|photos are (?:old|outdated|misleading)|false advertising") },
    { id: 'cancel_refund', re: W("host cancell?ed|cancell?ed (?:our|my|the) (?:booking|reservation|stay)|refund(?:ed|s)?|deposit"),
      skipBefore: /(?:train|ferry|boat|flight|bus|tour|trip|strike|restaurant)s?\b[^.]{0,30}$/i, needNear: { deposit: /(?:security|damage|cash|not returned|never returned|kept|withheld)/i } },
    { id: 'host_issue', re: W("rude|unresponsive|(?:didn'?t|did not|never) (?:respond|reply|answer)|no response|hard to (?:reach|contact)|difficult to (?:reach|contact)|unhelpful|unprofessional|had to wait|waited (?:for )?(?:over )?(?:an hour|hours)") },
    { id: 'safety', re: W("unsafe|sketchy|dangerous|break-?in|broke in|stolen|theft|not (?:feel )?safe|didn'?t feel safe") },
    { id: 'bad_beds', neg: false, re: W("uncomfortable (?:beds?|mattress(?:es)?|pillows?|sofa ?bed)|(?:bed|beds|mattress|sofa ?bed) (?:was|were|is) (?:a bit |very |really |quite )?(?:hard|uncomfortable|old|saggy|lumpy|too soft|too firm|squeaky)|hard (?:beds?|mattress)|saggy|lumpy") },
    { id: 'cramped', re: W('tiny|cramped|very small|too small|claustrophobic') },
  ];
  const GREEN = [
    { id: 'spotless', re: W('spotless|immaculate|impeccabl[ey]|pristine|squeaky clean|(?:very|super|extremely|incredibly|perfectly|so|really) clean|pulitissim\\w*') },
    { id: 'comfy_beds', re: W('(?:comfortable|comfy|great|amazing|excellent|wonderful) (?:beds?|mattress(?:es)?|pillows)|(?:bed|beds|mattress) (?:was|were|is) (?:so |very |super |really )?(?:comfortable|comfy)|slept (?:so |very |really )?well') },
    { id: 'quiet', re: W('quiet|peaceful|tranquil|calm|silent|serene|tranquill\\w*'), skipAfter: /^\W{0,3}(?:hours|time)/i },
    { id: 'great_location', re: W('(?:great|perfect|excellent|ideal|fantastic|amazing|central|convenient|unbeatable|superb|prime|wonderful) location|location (?:was|is) (?:just )?(?:perfect|great|excellent|ideal|amazing|fantastic|unbeatable|superb)|close to everything|walking distance (?:to|of) everything') },
    { id: 'great_views', re: W('(?:amazing|stunning|beautiful|breathtaking|incredible|gorgeous|spectacular|great|lovely|wonderful|magnificent) views?|views? (?:was|were|is|are) (?:amazing|stunning|beautiful|breathtaking|incredible|spectacular|gorgeous)') },
    { id: 'great_host', re: W('(?:great|amazing|wonderful|fantastic|excellent|lovely|kind|gracious|attentive|helpful|responsive|super|perfect) hosts?|(?:very|super|extremely|incredibly|really) (?:responsive|helpful|accommodating|attentive|kind|welcoming)|quick to (?:respond|reply)|responded (?:very )?(?:quickly|promptly|immediately)') },
    { id: 'as_described', re: W('(?:exactly|just) as (?:described|pictured|advertised|shown)|as described|better than (?:the )?(?:photos|pictures|described|expected)|accurate (?:description|photos|listing)') },
    { id: 'well_equipped', re: W('well[- ]equipped|fully equipped|well[- ]stocked|everything (?:we|you|i) (?:needed|need)|had everything|thoughtful touches') },
    { id: 'spacious', re: W('spacious|roomy|plenty of (?:space|room)|lots of (?:space|room)|very large') },
    { id: 'great_value', re: W('(?:great|good|excellent|amazing) value|worth (?:every penny|the price|the money)|reasonably priced|great price') },
    { id: 'would_return', re: W("(?:would|will|'d|'ll|definitely|hope to|can'?t wait to) (?:stay|come back|return|be back)|stay (?:here )?again|come back|be back") },
    { id: 'easy_checkin', re: W('(?:easy|smooth|seamless|simple|effortless) (?:check-?in|self check-?in|access|arrival)|check-?in was (?:easy|smooth|seamless|simple)') },
    { id: 'cool_ac', re: W(AC + ' (?:was|worked) (?:great|perfectly|well|amazing)|(?:great|good|strong|powerful|excellent) ' + AC + '|nice and cool') },
  ];
  const STAIRS = W("stairs?|staircase|steps|steep\\w*|uphill|climb\\w*|walk-?up|no elevator|no lift|without (?:an )?(?:elevator|lift)|luggage up|carry(?:ing)? (?:our|your|the|my) (?:luggage|bags|suitcases)|gradini|scalini|salita");
  const STAIRS_SKIP = /^\W{0,3}(?:from|away|to the|outside)/i; // "steps from the beach"

  function hits(L, t) {
    L.re.lastIndex = 0; let m;
    while ((m = L.re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 48), m.index), after = t.slice(m.index + m[0].length, m.index + m[0].length + 48);
      if (L.neg !== false && NEG.test(before)) continue;
      if (L.skipAfter && L.skipAfter.test(after)) continue;
      if (L.skipBefore && L.skipBefore.test(before)) continue;
      const low = m[0].toLowerCase();
      if (L.needNear && L.needNear[low] && !L.needNear[low].test(before + ' ' + after)) continue;
      return true;
    }
    return false;
  }
  ABW.scan = (text) => {
    const t = String(text || '').replace(/[‘’]/g, "'");
    let red = 0, green = 0;
    RED.forEach((L, i) => { if (hits(L, t)) red |= 1 << i; });
    GREEN.forEach((L, i) => { if (hits(L, t)) green |= 1 << i; });
    let stairs = false; STAIRS.lastIndex = 0; let m;
    while ((m = STAIRS.exec(t))) { if (!(m[0].toLowerCase() === 'steps' && STAIRS_SKIP.test(t.slice(m.index + 5, m.index + 30)))) { stairs = true; break; } }
    return { red, green, stairs };
  };
  ABW.LEX = { red: RED.map((x) => x.id), green: GREEN.map((x) => x.id) };

  // ---------- listing page parsing ----------
  const sectionsOf = (sec) => { const out = []; walk(sec, (x) => { if (typeof x.sectionId === 'string' && x.section && typeof x.section === 'object') out.push({ id: x.sectionId, type: x.section.__typename || x.sectionComponentType || '', node: x.section }); }); return out; };
  const pick = (secs, re) => secs.filter((s) => re.test(s.id) || re.test(s.type));
  const BED_TYPES = [
    ['sofa_bed', /sofa ?-?beds?|sleeper sofas?|pull-?out|divano letto|sof[aá] cama|canap[eé] lit/i, 2, 'sofa'],
    ['couch', /couch(?:es)?|sofas?/i, 1, 'sofa'],
    ['futon', /futons?|day ?beds?/i, 1, 'sofa'],
    ['air_mattress', /air mattress(?:es)?|inflatable/i, 1, 'makeshift'],
    ['floor_mattress', /floor mattress(?:es)?|mattress(?:es)? on the floor|mattress(?:es)?/i, 1, 'makeshift'],
    ['hammock', /hammocks?/i, 1, 'makeshift'],
    ['crib', /cribs?|\bcots?\b|toddler beds?|baby beds?/i, 0, 'child'],
    ['bunk', /bunk ?beds?/i, 2, 'real'],
    ['king', /king/i, 2, 'real'],
    ['queen', /queen/i, 2, 'real'],
    ['double', /double|\bfull\b|water ?beds?|matrimoniale|french bed/i, 2, 'real'],
    ['single', /single|twin|singolo/i, 1, 'real'],
    ['bed', /\bbeds?\b/i, 1, 'real'],
  ];
  const BED_RX = /\b(?:beds?|couch(?:es)?|sofas?|mattress(?:es)?|futons?|cribs?|cots?|bunk|hammocks?|day ?beds?)\b/i;
  function parseBeds(s) {
    const out = [];
    String(s).split(/\s*(?:,|·|•|\band\b|\+|;)\s*/i).forEach((part) => {
      if (!BED_RX.test(part)) return;
      const m = part.match(/^\s*(\d+)\s+(.+)$/); const n = m ? +m[1] : 1, txt = m ? m[2] : part;
      const t = BED_TYPES.find(([, re]) => re.test(txt)); if (t) out.push([t[0], n]);
    });
    return out;
  }
  function sleeping(secs, all) {
    const rooms = [];
    const src = pick(secs, /SLEEP|BEDROOM/i);
    (src.length ? src.map((s) => s.node) : [all]).forEach((node) => walk(node, (x) => {
      if (typeof x.title === 'string' && typeof x.subtitle === 'string' && /^\s*\d+\s+/.test(x.subtitle) && BED_RX.test(x.subtitle) && !BED_RX.test(x.title.replace(/bedroom/i, '')) && x.title.length < 60) {
        const beds = parseBeds(x.subtitle); if (beds.length) rooms.push({ t: x.title.slice(0, 40), beds });
      }
    }));
    if (!rooms.length && src.length) { // no title/subtitle pairs: fall back to plain bed strings inside the sleeping section
      strings(src.map((s) => s.node)).forEach((s) => { if (/^\s*\d+\s+[\w -]*\b(?:beds?|couch|sofa|mattress|futon|crib|bunk)/i.test(s) && s.length < 80) { const b = parseBeds(s); if (b.length) rooms.push({ t: 'Sleeping area', beds: b }); } });
    }
    const seen = new Set();
    return rooms.filter((r) => { const k = r.t + '|' + JSON.stringify(r.beds); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function overview(strs) {
    const o = {};
    for (const s0 of strs) {
      if (s0.length > 160) continue;
      for (const s of s0.split(/\s*[·•|]\s*/)) {
        const t = s.trim(); let m;
        if (o.guests == null && (m = t.match(/^(\d+)\+?\s+guests?$/i))) o.guests = +m[1];
        else if (o.bedrooms == null && (m = t.match(/^(\d+)\s+bedrooms?$/i))) o.bedrooms = +m[1];
        else if (o.bedrooms == null && /^studio$/i.test(t)) { o.bedrooms = 0; o.studio = true; }
        else if (o.beds == null && (m = t.match(/^(\d+)\s+beds?$/i))) o.beds = +m[1];
        else if (o.baths == null && (m = t.match(/^(\d+(?:\.\d+)?)\s+(?:(private|shared|dedicated)\s+)?(?:attached\s+)?(?:baths?|bathrooms?)$/i))) { o.baths = +m[1]; o.bathType = (m[2] || '').toLowerCase(); }
        else if (o.baths == null && (m = t.match(/^(?:(private|shared)\s+)?half-?baths?$/i))) { o.baths = 0.5; o.bathType = (m[1] || '').toLowerCase(); o.halfBath = true; }
      }
    }
    return o;
  }
  function amenities(sec) {
    const list = new Map();
    const add = (title, avail, group, sub) => {
      let t = clean(title); if (!t) return;
      if (/^unavailable:\s*/i.test(t)) { t = t.replace(/^unavailable:\s*/i, ''); avail = false; }
      if (/not included/i.test(group || '')) avail = false;
      const prev = list.get(t);
      if (!prev || (prev[1] === false && avail)) list.set(t, [t, !!avail, group || '', clean(sub).slice(0, 80)]);
    };
    walk(sec, (x) => { if (Array.isArray(x.amenities) && typeof x.title === 'string') x.amenities.forEach((a) => { if (a && typeof a.title === 'string') add(a.title, a.available !== false, x.title, a.subtitle); }); });
    walk(sec, (x) => { if (typeof x.title === 'string' && typeof x.available === 'boolean' && !list.has(clean(x.title))) add(x.title, x.available, '', x.subtitle); });
    return [...list.values()];
  }
  const textOf = (nodes, minLen = 0, cap = 6000) => { const seen = new Set(); return strings(nodes).map(clean).filter((s) => s.length >= minLen && !seen.has(s) && seen.add(s)).join('\n').slice(0, cap); };
  const shortStrings = (nodes, max = 160, cap = 80) => { const seen = new Set(); return strings(nodes).map(clean).filter((s) => s && s.length <= max && !seen.has(s) && seen.add(s)).slice(0, cap); };

  const policyName = (pol, checkIn) => {
    const s = strings(pol).join(' | ');
    const full = s.match(/(?:Free cancellation|Full refund)[^|]{0,40}?(?:before|until)\s+([A-Z][a-z]{2,8}\.? \d{1,2})/i);
    if (full && checkIn) {
      const ci = new Date(checkIn + 'T12:00:00'); const d = new Date(full[1].replace('.', '') + ' ' + ci.getFullYear() + ' 12:00'); if (d > ci) d.setFullYear(d.getFullYear() - 1);
      const days = Math.round((ci - d) / 864e5);
      if (!isNaN(days)) return days >= 28 ? 'Firm' : days >= 13 ? 'Limited' : days >= 4 ? 'Moderate' : 'Flexible';
    }
    if (/partial refund/i.test(s)) return 'Strict';
    if (/non-?refundable|no refund/i.test(s)) return 'Non-refundable';
    const named = s.match(/\b(Flexible|Moderate|Limited|Firm|Strict)\b/);
    return named ? named[1] : '';
  };
  const reviewList = (d) => { let best = []; walk(d, (x) => { for (const k in x) { const a = x[k]; if (Array.isArray(a) && a.length > best.length && a[0] && typeof a[0] === 'object' && ('comments' in a[0] || 'localizedReview' in a[0])) best = a; } }); return best; };
  const setPaging = (v, off) => { walk(v, (x) => { if ('offset' in x) x.offset = typeof x.offset === 'number' ? off : String(off); if ('limit' in x) x.limit = 50; if ('first' in x) x.first = 50; }); return v; };
  const monthOf = (r) => { const dt = new Date(r.createdAt || r.localizedDate || Date.now()); return isNaN(dt) ? '' : dt.toISOString().slice(0, 7); };

  ABW.listing = async (it) => {
    const ops = ABW.cfg.ops;
    const sec = await ABW.gql('StaysPdpSections', ABW.retarget(ops.StaysPdpSections.vars, 'StayListing', it.listing_id));
    const edl = findKey(sec, 'eventDataLogging') || {};
    const secs = sectionsOf(sec);
    const S = strings(sec);
    const ovStrings = strings(pick(secs, /OVERVIEW|TITLE|HERO/i).map((s) => s.node)).concat(S);
    const ov = overview(ovStrings);
    const rooms = sleeping(secs, sec);
    const amen = amenities(sec);
    const descNodes = pick(secs, /DESCRIPTION/i).map((s) => s.node);
    const policyNodes = pick(secs, /POLIC|HOUSE_RULE|SAFETY|THINGS_TO_KNOW/i).map((s) => s.node);
    const locNodes = pick(secs, /LOCATION/i).map((s) => s.node);
    const hostNodes = pick(secs, /HOST/i).map((s) => s.node);
    const hiNodes = pick(secs, /HIGHLIGHT/i).map((s) => s.node);
    const hostS = strings(hostNodes).join(' | ');
    const out = {
      v: 2,
      guests_max: edl.personCapacity ?? ov.guests ?? '',
      bedrooms: ov.bedrooms ?? '', studio: !!ov.studio, beds_total: ov.beds ?? '', baths: ov.baths ?? '', bath_type: ov.bathType || '', half_bath: !!ov.halfBath,
      rooms,
      amenities: amen,
      desc: textOf(descNodes, 30, 8000),
      highlights: shortStrings(hiNodes, 160, 20),
      notices: shortStrings(policyNodes, 160, 80),
      loc_text: textOf(locNodes, 0, 3000),
      host: { superhost: edl.isSuperhost ?? /superhost/i.test(hostS), years: num((hostS.match(/(\d+)\s+years? hosting/i) || [])[1]) || '',
        response_rate: num((hostS.match(/response rate:?\s*(\d+)%/i) || [])[1]), response_time: ((hostS.match(/responds within (an hour|a few hours|a day|a few days)/i) || [])[1] || '').toLowerCase() },
      review_count: edl.visibleReviewCount ?? '', rating: edl.guestSatisfactionOverall ?? edl.overallRating ?? '',
      rating_cleanliness: edl.cleanlinessRating ?? '', rating_accuracy: edl.accuracyRating ?? '', rating_checkin: edl.checkinRating ?? '',
      rating_communication: edl.communicationRating ?? '', rating_location: edl.locationRating ?? '', rating_value: edl.valueRating ?? '',
      top_pct: S.some((x) => /Top \d+% of homes/.test(x)),
      lat: findKey(locNodes, 'lat') ?? '', lng: findKey(locNodes, 'lng') ?? '',
    };
    if (!ABW.probe) ABW.probe = { sections: secs.map((s) => s.id + ':' + s.type).slice(0, 40), overview: ov, rooms: rooms.length, amenities: amen.length,
      amenityGroups: [...new Set(amen.map((a) => a[2]))].slice(0, 12), unavailable: amen.filter((a) => !a[1]).length, descChars: out.desc.length, notices: out.notices.length };
    out.cancellation_policy = '';
    if (ops.StaysPdpPoliciesQuery) { try { out.cancellation_policy = policyName(await ABW.gql('StaysPdpPoliciesQuery', ABW.retarget(ops.StaysPdpPoliciesQuery.vars, 'StayListing', it.listing_id)), it.check_in); } catch (e) { /* optional */ } }
    // reviews: per review, which red and green tags fired (bitmasks), plus stairs mentions and the latest month per red tag
    let off = 0, n = 0, stairs = 0; const rm = [], gm = [], rlast = {};
    for (let page = 0; page < 60; page++) {
      const v = setPaging(ABW.retarget(ops.StaysPdpReviewsQuery.vars, 'StayListing', it.listing_id), off);
      const d = await ABW.gql('StaysPdpReviewsQuery', v);
      const list = reviewList(d);
      for (const r of list) {
        n++;
        const s = ABW.scan(((r.localizedReview && r.localizedReview.comments) || '') + ' \n ' + (r.comments || ''));
        if (s.stairs) stairs++;
        if (s.red) { rm.push(s.red); const mo = monthOf(r); RED.forEach((L, i) => { if (s.red & (1 << i) && (!rlast[L.id] || mo > rlast[L.id])) rlast[L.id] = mo; }); }
        if (s.green) gm.push(s.green);
      }
      if (list.length < 50) break;
      off += 50; await sleep(400);
    }
    Object.assign(out, { reviews_scanned: n, stairs_mentions: stairs, red_masks: rm, green_masks: gm, red_last: rlast, lex: ABW.LEX });
    if (out.review_count === '') out.review_count = n;
    return out;
  };

  ABW.run = async (items, opts = {}) => {
    ABW.running = true; ABW.items = items || ABW.items;
    for (const it of ABW.items) {
      if (!ABW.running) break;
      if (ABW.done[it.listing_id] || (opts.skip && opts.skip.includes(it.listing_id))) continue;
      try { ABW.E[it.listing_id] = await ABW.listing(it); ABW.done[it.listing_id] = 1; delete ABW.err[it.listing_id]; }
      catch (e) { ABW.err[it.listing_id] = String(e && e.message || e).slice(0, 200); }
      await sleep(opts.delay || 700);
    }
    ABW.running = false;
  };
  ABW.progress = () => ({ done: Object.keys(ABW.done).length, errors: Object.keys(ABW.err).length, running: ABW.running });
  ABW.take = () => { const out = { E: ABW.E, err: ABW.err, recipe: ABW.recipe, probe: ABW.probe }; ABW.E = {}; return out; };
})();
