// Learns Airbnb's own GraphQL calls (operation, hash, variables, headers) as the pages make them. Nothing is sent anywhere.
const OPS = ['WishlistDetailPageDataQuery', 'StaysPdpSections', 'StaysPdpReviewsQuery', 'StaysPdpPoliciesQuery'];
const FILTER = { urls: ['https://www.airbnb.com/api/v3/*'] };
const seen = {};

chrome.webRequest.onBeforeRequest.addListener((d) => {
  const m = d.url.match(/\/api\/v3\/(\w+)\/([0-9a-f]{64})/);
  if (!m) return;
  let vars = null;
  if (OPS.includes(m[1])) {
    try { const v = new URL(d.url).searchParams.get('variables'); if (v) vars = JSON.parse(v); } catch (e) { /* ignore */ }
    if (!vars && d.requestBody && d.requestBody.raw && d.requestBody.raw[0] && d.requestBody.raw[0].bytes) {
      try { vars = JSON.parse(new TextDecoder().decode(d.requestBody.raw[0].bytes)).variables || null; } catch (e) { /* ignore */ }
    }
  }
  seen[d.requestId] = { op: m[1], rec: vars ? { hash: m[2], vars, method: d.method === 'POST' ? 'POST' : 'GET', at: Date.now() } : null };
}, FILTER, ['requestBody']);

chrome.webRequest.onSendHeaders.addListener((d) => {
  const s = seen[d.requestId];
  if (!s) return;
  delete seen[d.requestId];
  const headers = {}; let key = null, csrf = null, page = false;
  (d.requestHeaders || []).forEach((h) => {
    const n = h.name.toLowerCase();
    if (n === 'x-client-request-id' || n === 'x-airbnb-client-trace-id') page = true; // Airbnb's own client always sends these; the scorer never does
    if (n === 'x-airbnb-api-key') key = h.value;
    else if (/^x-(airbnb|csrf|client|niobe)/.test(n)) headers[h.name] = h.value;
    if (n === 'x-csrf-token' && h.value) csrf = h.value;
  });
  if (!page) return; // the scorer's own replayed request: never learn from it
  const upd = {};
  if (s.rec) { s.rec.headers = headers; upd['op:' + s.op] = s.rec; }
  if (key) upd.apiKey = key;
  if (csrf && d.tabId >= 0) upd['tok:' + d.tabId] = { csrf, at: Date.now(), post: d.method === 'POST' };
  if (Object.keys(upd).length) chrome.storage.local.set(upd);
}, FILTER, ['requestHeaders']);

chrome.webRequest.onErrorOccurred.addListener((d) => { delete seen[d.requestId]; }, FILTER);
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.local.remove('tok:' + tabId));
chrome.runtime.onInstalled.addListener(() => chrome.action.setBadgeBackgroundColor({ color: '#F28DB2' }));
