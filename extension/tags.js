// Tag dictionary. Every tag is a yes/no fact about a listing that you can filter on, and most carry weight in a score.
// kind: cover = counts toward an amenity coverage score (weight w), best = best-of score (value w, 0 to 100),
//       bonus = adds w points to a best-of score, flag = review-derived (red severity or green value w),
//       warn = listing warning (severity w), info = filter only (its fact is already scored by a factor).
// pol: +1 good, -1 bad, 0 neutral. unlisted: what an amenity not mentioned at all means (absent = no, unknown = skip).
(function (root) {
  const NEG = /(?:\b(?:no|not|never|without|lacks?|nessun\w*|senza|sin|sans)\b)[^.!?;,]{0,18}$/i;
  function amen(L, re, not, unlisted = 'absent') {
    let seenTrue = false, seenFalse = false;
    for (const [t, ok] of L.amenities) { if (re.test(t) && !(not && not.test(t))) { if (ok) seenTrue = true; else seenFalse = true; } }
    if (seenTrue) return 1; if (seenFalse) return 0;
    if (!L.collected || L.legacy) return null; // version 1 only recorded five amenities
    return unlisted === 'unknown' ? null : 0;
  }
  function text(L, re, src = L.text) {
    re.lastIndex = 0; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); let m;
    while ((m = g.exec(src))) { if (!NEG.test(src.slice(Math.max(0, m.index - 40), m.index))) return 1; }
    return 0;
  }
  const notice = (L, re) => (L.notices.some((s) => re.test(s)) ? 1 : 0);
  const either = (...xs) => (xs.some((x) => x === 1) ? 1 : xs.some((x) => x === 0) ? 0 : null);
  const g = (L, k) => L.geo && L.geo[k];

  const T = [];
  const add = (group, kind, pol, id, label, w, test, extra = {}) => T.push(Object.assign({ group, kind, pol, id, label, w, test }, extra));

  // Essentials (Comfort & Amenities > Essentials)
  add('Essentials', 'cover', 1, 'wifi', 'Wifi', 10, (L) => amen(L, /\bwi-?fi\b|internet|ethernet/i, null, 'unknown'));
  add('Essentials', 'cover', 1, 'ac', 'Air conditioning', 10, (L) => amen(L, /air.?condition|\bAC\b|a\/c|split.type|ductless|central air|window ac/i, /fans?\b/i, 'unknown'));
  add('Essentials', 'cover', 1, 'heating', 'Heating', 4, (L) => amen(L, /heating|heater|heat pump|radiant|radiator/i, null, 'unknown'));
  add('Essentials', 'cover', 1, 'kitchen', 'Kitchen', 8, (L) => amen(L, /^kitchen\b|kitchenette|full kitchen/i, null, 'unknown'));
  add('Essentials', 'cover', 1, 'washer', 'Washer', 5, (L) => amen(L, /washer|washing machine/i, /dish/i, 'unknown'));
  add('Essentials', 'cover', 1, 'dryer', 'Dryer', 2, (L) => amen(L, /dryer|tumble|drying machine/i, /hair|rack/i));
  add('Essentials', 'cover', 1, 'workspace', 'Workspace', 2, (L) => amen(L, /dedicated workspace|\bdesk\b/i));
  add('Essentials', 'cover', 1, 'dishwasher', 'Dishwasher', 2, (L) => amen(L, /dishwasher/i));
  add('Essentials', 'cover', 1, 'coffee', 'Coffee maker', 1, (L) => amen(L, /coffee|espresso|nespresso|moka/i));
  add('Essentials', 'cover', 1, 'tv', 'TV', 1, (L) => amen(L, /\bTV\b|HDTV|television/i));
  // Extras (Comfort & Amenities > Extras)
  add('Extras', 'cover', 1, 'pool', 'Pool', 4, (L) => amen(L, /\bpool\b/i, /pool table|pool cue/i));
  add('Extras', 'cover', 1, 'hot_tub', 'Hot tub', 3, (L) => amen(L, /hot tub|jacuzzi|whirlpool/i));
  add('Extras', 'cover', 1, 'sauna', 'Sauna', 1, (L) => amen(L, /sauna|steam room/i));
  add('Extras', 'cover', 1, 'gym', 'Gym', 1, (L) => amen(L, /\bgym\b|fitness|exercise equipment/i));
  add('Extras', 'cover', 1, 'fireplace', 'Fireplace', 1, (L) => amen(L, /fireplace|wood.?burning|pellet stove/i));
  add('Extras', 'cover', 1, 'bathtub', 'Bathtub', 1, (L) => amen(L, /bathtub|soaking tub/i));
  add('Extras', 'cover', 1, 'ev_charger', 'EV charger', 0.5, (L) => amen(L, /ev charger|electric vehicle/i));
  // Convenience (Comfort & Amenities > Convenience)
  add('Convenience', 'cover', 1, 'self_checkin', 'Self check-in', 3, (L) => either(amen(L, /self check-?in|keypad|lockbox|smart lock|building staff/i), text(L, /self check-?in/i, L.highlights.join(' '))));
  add('Convenience', 'cover', 1, 'free_parking', 'Free parking', 2, (L) => amen(L, /free (?:street |residential )?parking/i));
  add('Convenience', 'cover', 1, 'private_entrance', 'Private entrance', 1, (L) => amen(L, /private entrance/i));
  add('Convenience', 'cover', 1, 'luggage', 'Luggage drop-off', 1, (L) => amen(L, /luggage drop.?off/i));
  add('Convenience', 'info', 0, 'paid_parking', 'Paid parking', 0, (L) => amen(L, /paid parking|parking garage/i));
  add('Convenience', 'info', 0, 'pets_allowed', 'Pets allowed', 0, (L) => amen(L, /pets allowed/i));
  add('Convenience', 'info', 0, 'crib', 'Crib', 0, (L) => amen(L, /crib|pack .?n play|travel crib/i));
  // Outdoor (Outdoor & Views > Outdoor space: best value wins, bonuses add)
  add('Outdoor', 'best', 1, 'rooftop', 'Rooftop', 100, (L) => either(amen(L, /roof ?top|roof terrace|roof deck/i), text(L, /roof ?top|roof terrace|roof deck|terrazza panoramica/i)));
  add('Outdoor', 'best', 1, 'terrace', 'Terrace', 90, (L) => either(amen(L, /terrace|\bdeck\b/i, /view/i), text(L, /\bterrace\b|terrazz[ao]|terrasse|\bdeck\b/i)));
  add('Outdoor', 'best', 1, 'garden', 'Garden or yard', 90, (L) => either(amen(L, /backyard|\bgarden\b|\byard\b/i, /view/i), text(L, /private garden|own garden|giardino privato/i)));
  add('Outdoor', 'best', 1, 'balcony', 'Balcony', 75, (L) => either(amen(L, /balcon/i), text(L, /balcon(?:y|ies|e)/i)));
  add('Outdoor', 'best', 1, 'patio', 'Patio', 70, (L) => either(amen(L, /patio/i), text(L, /\bpatio\b/i)));
  add('Outdoor', 'best', 1, 'courtyard', 'Courtyard', 45, (L) => either(amen(L, /courtyard/i, /view/i), text(L, /courtyard|cortile/i)));
  add('Outdoor', 'bonus', 1, 'outdoor_dining', 'Outdoor dining', 10, (L) => amen(L, /outdoor dining|outdoor furniture|al fresco/i));
  add('Outdoor', 'bonus', 1, 'bbq', 'BBQ grill', 5, (L) => amen(L, /bbq|barbecue|grill/i));
  add('Outdoor', 'bonus', 1, 'loungers', 'Sun loungers', 5, (L) => amen(L, /sun loungers?|sunbeds?|deck chairs?/i));
  // Views (Outdoor & Views > View: best value wins)
  add('Views', 'best', 1, 'sea_view', 'Sea view', 100, (L) => either(amen(L, /(?:sea|ocean|beach|bay|harbou?r|marina) view/i), text(L, /(?:sea|ocean) views?|vista mare|view of the (?:sea|ocean)/i)));
  add('Views', 'best', 1, 'water_view', 'Lake, river or canal view', 90, (L) => either(amen(L, /(?:lake|river|canal|waterfront) view/i), text(L, /(?:lake|river|canal) views?/i)));
  add('Views', 'best', 1, 'mountain_view', 'Mountain or valley view', 85, (L) => amen(L, /(?:mountain|valley|hill|vineyard|countryside) view/i));
  add('Views', 'best', 1, 'city_view', 'City view', 75, (L) => either(amen(L, /city (?:skyline )?view|skyline/i), text(L, /(?:city|skyline|rooftops?|panoramic) views?/i)));
  add('Views', 'best', 1, 'garden_view', 'Garden or park view', 45, (L) => amen(L, /(?:garden|park|courtyard) view/i));
  // Access (Comfort & Amenities > Step-free access)
  add('Access', 'info', 1, 'elevator', 'Elevator', 0, (L) => either(amen(L, /elevator|\blift\b/i), text(L, /\belevator\b|\blift\b|ascensore/i)));
  add('Access', 'info', 1, 'step_free', 'Step-free', 0, (L) => either(amen(L, /single level|step.?free|no stairs|wheelchair|ground floor/i), text(L, /ground floor|step.?free|no stairs|piano terra/i)));
  add('Access', 'info', -1, 'no_elevator', 'No elevator', 0, (L) => (/(?:no|without(?: an)?) (?:elevator|lift)|walk.?up|senza ascensore/i.test(L.text) ? 1 : 0));
  add('Access', 'info', -1, 'must_climb_stairs', 'Must climb stairs', 0, (L) => either(notice(L, /must climb stairs/i), /(?:steep|narrow|many|lots of) (?:stairs|steps)/i.test(L.desc) ? 1 : 0));
  add('Access', 'info', -1, 'stairs_reviews', 'Stairs come up in reviews', 0, (L, c) => (c.stairsShare != null ? (c.stairsShare >= 0.15 && L.rev.stairs >= 3 ? 1 : 0) : null));
  // Sleep & bath (Space & Sleep factors carry the weight; these are for filtering)
  add('Sleep & bath', 'info', 1, 'real_beds_all', 'Real beds for everyone', 0, (L) => (L.sleep.known || L.sleep.total != null ? (L.sleep.spots >= L.adults ? 1 : 0) : null));
  add('Sleep & bath', 'info', -1, 'sofa_needed', 'Someone sleeps on a sofa', 0, (L) => (L.sleep.known || L.sleep.total != null ? (L.sleep.spots < L.adults ? 1 : 0) : null));
  add('Sleep & bath', 'info', 0, 'has_sofa_bed', 'Has a sofa bed', 0, (L) => (L.sleep.known ? (L.sleep.sofa > 0 ? 1 : 0) : null));
  add('Sleep & bath', 'info', 1, 'king_bed', 'King bed', 0, (L) => (L.sleep.known ? (L.sleep.kinds.king ? 1 : 0) : null));
  add('Sleep & bath', 'info', 1, 'queen_bed', 'Queen bed', 0, (L) => (L.sleep.known ? (L.sleep.kinds.queen ? 1 : 0) : null));
  add('Sleep & bath', 'info', 1, 'room_each', 'A bedroom per pair', 0, (L, c) => (L.sleep.bedrooms != null ? (L.sleep.bedrooms >= c.targetBedrooms ? 1 : 0) : null));
  add('Sleep & bath', 'info', 0, 'studio', 'Studio', 0, (L) => (L.sleep.studio ? 1 : 0));
  add('Sleep & bath', 'info', 1, 'two_baths', '2+ bathrooms', 0, (L) => (L.baths != null ? (L.baths >= 2 ? 1 : 0) : null));
  add('Sleep & bath', 'info', -1, 'shared_bath', 'Shared bathroom', 0, (L) => (L.baths != null ? (L.bath_type === 'shared' ? 1 : 0) : null));
  // Location (Location factors carry the weight)
  add('Location', 'info', 1, 'transit_5', 'Transit 5 min', 0, (L) => (g(L, 'transit') ? (g(L, 'transit').min <= 5 ? 1 : 0) : null));
  add('Location', 'info', 1, 'transit_10', 'Transit 10 min', 0, (L) => (g(L, 'transit') ? (g(L, 'transit').min <= 10 ? 1 : 0) : null));
  add('Location', 'info', 1, 'metro_10', 'Metro 10 min', 0, (L) => (g(L, 'transit') ? (g(L, 'transit').kind === 'metro' && g(L, 'transit').min <= 10 ? 1 : 0) : null));
  add('Location', 'info', 1, 'train_10', 'Train station 10 min', 0, (L) => (g(L, 'train') ? (g(L, 'train').min <= 10 ? 1 : 0) : null));
  add('Location', 'info', 1, 'central', 'Central (10 min)', 0, (L) => (g(L, 'center') ? (g(L, 'center').min <= 10 ? 1 : 0) : null));
  add('Location', 'info', 1, 'walkable', 'Very walkable', 0, (L, c) => (c.walk != null ? (c.walk >= 70 ? 1 : 0) : null));
  add('Location', 'info', 0, 'nightlife', 'Nightlife nearby', 0, (L) => (g(L, 'counts') ? (g(L, 'counts').nightlife >= 8 ? 1 : 0) : null));
  add('Location', 'info', 1, 'quiet_area', 'Quiet area', 0, (L) => (g(L, 'counts') ? (g(L, 'counts').nightlife <= 1 && g(L, 'counts').dining <= 5 ? 1 : 0) : null));
  add('Location', 'info', 1, 'dining', 'Lots of places to eat', 0, (L) => (g(L, 'counts') ? (g(L, 'counts').dining >= 20 ? 1 : 0) : null));
  add('Location', 'info', 1, 'sights', 'Sights nearby', 0, (L) => (g(L, 'counts') ? (g(L, 'counts').sights >= 10 ? 1 : 0) : null));
  add('Location', 'info', 1, 'sea_10', 'Sea or beach 10 min', 0, (L) => (g(L, 'sea') ? (g(L, 'sea').min <= 10 ? 1 : 0) : null));
  add('Location', 'info', 1, 'water_10', 'Lake or river 10 min', 0, (L) => (g(L, 'water') ? (g(L, 'water').min <= 10 ? 1 : 0) : null));
  add('Location', 'info', 1, 'park_5', 'Park 5 min', 0, (L) => (g(L, 'park') ? (g(L, 'park').min <= 5 ? 1 : 0) : null));
  add('Location', 'info', 1, 'groceries_5', 'Groceries 5 min', 0, (L) => (g(L, 'groceries') ? (g(L, 'groceries').min <= 5 ? 1 : 0) : null));
  // Listing warnings (Reviews & Trust > Listing warnings, severity w)
  add('Warnings', 'warn', -1, 'noise_potential', 'Potential for noise', 0.5, (L) => (L.collected ? notice(L, /potential for noise/i) : null));
  add('Warnings', 'warn', -1, 'shared_spaces', 'Some spaces shared', 0.4, (L) => (L.collected ? notice(L, /spaces are shared|shared spaces/i) : null));
  add('Warnings', 'warn', -1, 'pets_on_property', 'Pets live on property', 0.2, (L) => (L.collected ? notice(L, /pets? (?:live|lives) on/i) : null));
  add('Warnings', 'warn', -1, 'cameras', 'Security cameras', 0.2, (L) => (L.collected ? either(notice(L, /camera/i), amen(L, /security camera|cameras? on property/i)) : null));
  add('Warnings', 'warn', -1, 'no_co_alarm', 'No CO alarm reported', 0.3, (L) => (L.collected ? notice(L, /carbon monoxide alarm not|no carbon monoxide/i) : null));
  add('Warnings', 'warn', -1, 'no_smoke_alarm', 'No smoke alarm reported', 0.5, (L) => (L.collected ? notice(L, /smoke alarm not|no smoke alarm/i) : null));
  add('Warnings', 'warn', -1, 'weapons', 'Weapons on property', 0.5, (L) => (L.collected ? notice(L, /weapons?/i) : null));
  // Status (scored elsewhere; filter only)
  add('Status', 'info', 1, 'top_guest_favorite', 'Top guest favorite', 0, (L) => (L.badge === 'Top guest favorite' || L.top_pct ? 1 : 0));
  add('Status', 'info', 1, 'guest_favorite', 'Guest favorite', 0, (L) => (/guest favorite/i.test(L.badge) || L.top_pct ? 1 : 0));
  add('Status', 'info', 1, 'superhost', 'Superhost', 0, (L) => (L.host.superhost === true || L.badge === 'Superhost' ? 1 : L.host.superhost === false ? 0 : null));
  add('Status', 'info', 1, 'highly_rated', 'Rated 4.9+ (25+ reviews)', 0, (L) => (L.rating != null ? (L.rating >= 4.9 && L.reviews >= 25 ? 1 : 0) : null));
  add('Status', 'info', 0, 'new_listing', 'New (under 3 reviews)', 0, (L) => (L.reviews < 3 ? 1 : 0));
  add('Status', 'info', 1, 'flexible_cancel', 'Flexible cancellation', 0, (L) => (L.cancellation ? (/flexible|moderate/i.test(L.cancellation) ? 1 : 0) : null));
  add('Status', 'info', -1, 'strict_cancel', 'Strict cancellation', 0, (L) => (L.cancellation ? (/strict|non-refundable/i.test(L.cancellation) ? 1 : 0) : null));
  add('Status', 'info', 1, 'fast_response', 'Responds within an hour', 0, (L) => (L.host.response_time ? (L.host.response_time === 'an hour' ? 1 : 0) : null));

  // Review-derived flags (labels and default severities/values; the collector decides which reviews mention them)
  const RED = { damp_mold: ['Damp or mold', 1], smell: ['Bad smells', 0.8], dirty: ['Cleanliness complaints', 1], pests: ['Pests', 1], mosquitoes: ['Mosquitoes', 0.2], noise: ['Noise', 0.5],
    broken: ['Things broken', 0.6], too_hot: ['Too hot or weak AC', 0.6], too_cold: ['Too cold or no hot water', 0.5], wifi_bad: ['Weak wifi', 0.3], misleading: ['Not as described', 1],
    cancel_refund: ['Cancellations or refunds', 0.8], host_issue: ['Host issues', 0.6], safety: ['Safety concerns', 1], bad_beds: ['Uncomfortable beds', 0.5], cramped: ['Cramped', 0.3] };
  const GREEN = { spotless: ['Spotless', 1], comfy_beds: ['Comfy beds', 1], quiet: ['Quiet', 0.8], great_location: ['Great location', 0.7], great_views: ['Great views', 0.6],
    great_host: ['Great host', 0.5], as_described: ['As described', 0.8], well_equipped: ['Well equipped', 0.5], spacious: ['Spacious', 0.6], great_value: ['Great value', 0.5],
    would_return: ['Guests would return', 0.8], easy_checkin: ['Easy check-in', 0.3], cool_ac: ['Cool AC', 0.4] };
  const GREEN_SHOW = { great_location: 0.3, great_host: 0.3 }; // near-universal praise needs a higher share before it becomes a tag
  Object.entries(RED).forEach(([id, [label, sev]]) => add('Red flags', 'flag', -1, 'r_' + id, label, sev, (L, c) => {
    const n = c.redCount[id] || 0, m = L.rev.m; if (!L.collected) return null; return n >= 2 && (n / Math.max(m, 1) >= 0.01 || sev >= 1) ? 1 : 0;
  }, { flag: id, detail: (L, c) => (c.redCount[id] || 0) + ' of ' + L.rev.m + ' reviews' + (L.rev.last[id] ? ', latest ' + L.rev.last[id] : '') }));
  Object.entries(GREEN).forEach(([id, [label, val]]) => add('Green flags', 'flag', 1, 'g_' + id, label, val, (L, c) => {
    const n = c.greenCount[id] || 0, m = L.rev.m; if (!L.collected || L.legacy) return null; return n >= 3 && n / Math.max(m, 1) >= (GREEN_SHOW[id] || 0.15) ? 1 : 0;
  }, { flag: id, detail: (L, c) => (c.greenCount[id] || 0) + ' of ' + L.rev.m + ' reviews' }));

  const BY_ID = Object.fromEntries(T.map((t) => [t.id, t]));
  const GROUPS = [...new Set(T.map((t) => t.group))];

  // Evaluate every tag for one listing. Returns {id: 1 | 0 | null}.
  function evaluate(L, ctx) { const out = {}; T.forEach((t) => { let v = null; try { v = t.test(L, ctx); } catch (e) { v = null; } out[t.id] = v; }); return out; }

  const api = { TAGS: T, BY_ID, GROUPS, RED, GREEN, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Tags = api;
})(typeof window !== 'undefined' ? window : globalThis);
