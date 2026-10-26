// Builds one clean record per listing from the three raw sources: wishlist card, listing details, map metrics.
// Also upgrades details collected by version 1 so old results stay viewable until the next run.
(function (root) {
  const num = (x) => (x === null || x === undefined || x === '' || isNaN(+x) ? null : +x);
  const BED = { king: [2, 'real'], queen: [2, 'real'], double: [2, 'real'], single: [1, 'real'], bunk: [2, 'real'], bed: [1, 'real'],
    sofa_bed: [2, 'sofa'], couch: [1, 'sofa'], futon: [1, 'sofa'], air_mattress: [1, 'makeshift'], floor_mattress: [1, 'makeshift'], hammock: [1, 'makeshift'], crib: [0, 'child'] };
  const BED_LABEL = { king: 'king', queen: 'queen', double: 'double', single: 'single', bunk: 'bunk', bed: 'bed', sofa_bed: 'sofa bed', couch: 'couch', futon: 'futon/day bed',
    air_mattress: 'air mattress', floor_mattress: 'floor mattress', hammock: 'hammock', crib: 'crib' };
  // version 1 stored red-flag terms, not tags: map them so old data still produces flags
  const V1_TERMS = { mold: 'damp_mold', damp: 'damp_mold', musty: 'damp_mold', mildew: 'damp_mold', smell: 'smell', odor: 'smell', sewage: 'smell', drains: 'smell', drain: 'smell',
    dirty: 'dirty', stain: 'dirty', dust: 'dirty', hair: 'dirty', bugs: 'pests', cockroach: 'pests', ants: 'pests', 'bed bugs': 'pests', bedbugs: 'pests', mosquito: 'mosquitoes', mosquitoes: 'mosquitoes',
    noisy: 'noise', noise: 'noise', loud: 'noise', 'thin walls': 'noise', broken: 'broken', leak: 'broken', leaking: 'broken', 'not working': 'broken', 'out of order': 'broken', 'did not work': 'broken',
    'no ac': 'too_hot', 'no a/c': 'too_hot', 'no air conditioning': 'too_hot', 'no hot water': 'too_cold', 'weak wifi': 'wifi_bad', misleading: 'misleading', 'not as described': 'misleading',
    'not as pictured': 'misleading', cancelled: 'cancel_refund', canceled: 'cancel_refund', refund: 'cancel_refund', deposit: 'cancel_refund' };

  function sleepInfo(E, card) {
    const kinds = {}; let rooms = E.rooms || [];
    rooms.forEach((r) => (r.beds || []).forEach(([t, n]) => { kinds[t] = (kinds[t] || 0) + n; }));
    let real = 0, realCap = 0, sofa = 0, sofaCap = 0, makeshift = 0, child = 0;
    Object.entries(kinds).forEach(([t, n]) => { const [cap, cls] = BED[t] || [1, 'real'];
      if (cls === 'real') { real += n; realCap += cap * n; } else if (cls === 'sofa') { sofa += n; sofaCap += cap * n; } else if (cls === 'makeshift') makeshift += n; else child += n; });
    const total = num(E.beds_total) ?? num(card.beds);
    const listed = real + sofa + makeshift + child;
    let unknown = 0, partial = false;
    if (!rooms.length) { if (total != null) { unknown = total; partial = true; } }
    else if (total != null && total > listed) { unknown = total - listed; partial = true; }
    const bedrooms = num(E.bedrooms) ?? num(card.bedrooms);
    const bedroomRooms = rooms.filter((r) => /bed ?room|camera|chambre|dormitorio|loft/i.test(r.t)).length;
    const summary = Object.entries(kinds).filter(([t]) => t !== 'crib').sort((a, b) => (BED[a[0]][1] === 'real' ? 0 : 1) - (BED[b[0]][1] === 'real' ? 0 : 1))
      .map(([t, n]) => n + ' ' + BED_LABEL[t] + (n > 1 && !/s$/.test(BED_LABEL[t]) ? 's' : '')).join(', ');
    // spots = sleeping places in real beds; a bed the host did not describe counts as half a place
    return { bedrooms, studio: !!E.studio, total, kinds, rooms, real, realCap, spots: realCap + 0.5 * unknown, sofa, sofaCap, makeshift, child, unknown, partial, bedroomRooms,
      known: rooms.length > 0, summary: summary || (total != null ? total + ' bed' + (total === 1 ? '' : 's') + ' (types not listed)' : '') };
  }

  function fromV1(E) { // details collected by version 1
    const amen = [];
    const put = (k, title) => { if (E[k] === true || E[k] === false) amen.push([title, E[k], '', '']); };
    put('has_ac', 'Air conditioning'); put('has_wifi', 'Wifi'); put('has_kitchen', 'Kitchen'); put('has_washer', 'Washer'); put('has_heating', 'Heating');
    if (E.outdoor_space === true) amen.push(['Patio or balcony', true, '', '']);
    if (E.sea_view === true) amen.push(['Sea view', true, '', '']);
    if (E.elevator_or_step_free === true) amen.push(['Elevator', true, '', '']);
    const masks = [];
    String(E.red_flag_terms || '').split(', ').forEach((p) => { const m = p.match(/^(.+) x(\d+)$/); if (m && V1_TERMS[m[1]]) for (let i = 0; i < +m[2]; i++) masks.push(V1_TERMS[m[1]]); });
    return { v: 1, guests_max: E.max_guests, bedrooms: '', beds_total: '', baths: E.bathrooms, bath_type: '', rooms: [], amenities: amen, desc: '', highlights: [], notices: [], loc_text: '',
      host: { superhost: E.host_superhost }, review_count: E.review_count, rating_cleanliness: E.rating_cleanliness, rating_accuracy: E.rating_accuracy, rating_checkin: E.rating_checkin,
      rating_communication: E.rating_communication, rating_location: E.rating_location, rating_value: E.rating_value, top_pct: E.top_pct, cancellation_policy: E.cancellation_policy,
      reviews_scanned: E.reviews_scanned, stairs_mentions: E.stairs_mentions, red_tags_v1: masks, green_masks: [], red_masks: [], red_last: {}, sofa_v1: E.sofa_bed_needed };
  }

  function build(it, E0, G0, meta) {
    let E = E0 || null; const G = G0 || {};
    const legacy = !!(E && E.v !== 2);
    if (E && legacy) E = fromV1(E);
    E = E || {};
    const adults = num(meta.adults) || 1;
    const nights = it.check_in && it.check_out ? Math.max(1, Math.round((new Date(it.check_out) - new Date(it.check_in)) / 864e5)) : null;
    const price = num(it.total_price_usd);
    const sl = sleepInfo(E, it);
    if (legacy && E.sofa_v1 != null) { sl.realCap = sl.spots = E.sofa_v1 ? adults - 1 : adults; sl.known = true; sl.v1 = true; }
    const baths = num(E.baths);
    const bathEff = baths == null ? null : E.bath_type === 'shared' ? baths * 0.5 : baths;
    const lexRed = (E.lex && E.lex.red) || [], lexGreen = (E.lex && E.lex.green) || [];
    return {
      id: it.listing_id, position: it.position, name: it.name || '', property_type: it.property_type || '', town: it.town || '', badge: it.badge || '',
      url: 'https://www.airbnb.com/rooms/' + it.listing_id + '?adults=' + adults + (it.check_in ? '&check_in=' + it.check_in + '&check_out=' + it.check_out : ''),
      cover: it.cover_photo_url || '', photo_count: num(it.photo_count), registration: it.registration_code || '',
      rating: num(it.rating), reviews: num(E.review_count) ?? 0, adults, nights, check_in: it.check_in || '', check_out: it.check_out || '',
      price, ppa: price != null ? price / adults : null, ppan: price != null && nights ? price / adults / nights : null,
      lat: num(it.lat) ?? num(E.lat), lng: num(it.lng) ?? num(E.lng),
      votes: it.votes || {}, notes: it.notes || {}, voters: (meta.voters || []).length,
      ratings: { cleanliness: num(E.rating_cleanliness), accuracy: num(E.rating_accuracy), checkin: num(E.rating_checkin), communication: num(E.rating_communication), location: num(E.rating_location), value: num(E.rating_value) },
      sleep: sl, guests_max: num(E.guests_max), baths, bath_type: E.bath_type || '', half_bath: !!E.half_bath, bathEff,
      amenities: E.amenities || [], text: [E.desc || '', (E.highlights || []).join('\n'), E.loc_text || ''].join('\n'), desc: E.desc || '', highlights: E.highlights || [], notices: E.notices || [], loc_text: E.loc_text || '',
      host: E.host || {}, cancellation: E.cancellation_policy || '', top_pct: !!E.top_pct,
      rev: { m: num(E.reviews_scanned) || 0, stairs: num(E.stairs_mentions) || 0, red: E.red_masks || [], green: E.green_masks || [], last: E.red_last || {}, lexRed, lexGreen, v1: E.red_tags_v1 || null },
      geo: G, collected: !!E0, legacy, mapped: !!(G0 && G0.v === 2),
    };
  }

  const api = { build, BED, BED_LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Model = api;
})(typeof window !== 'undefined' ? window : globalThis);
