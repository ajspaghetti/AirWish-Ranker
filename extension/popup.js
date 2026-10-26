(async () => {
  const OPS = { WishlistDetailPageDataQuery: 'Wishlist cards', StaysPdpSections: 'Listing details', StaysPdpReviewsQuery: 'Reviews', StaysPdpPoliciesQuery: 'Cancellation policy' };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = tab && tab.url && tab.url.match(/^https:\/\/www\.airbnb\.com\/wishlists\/(\d+)/);
  const sub = document.getElementById('sub');
  const store = await chrome.storage.local.get(null);
  const ul = document.getElementById('learned');
  Object.entries(OPS).forEach(([op, label]) => {
    const li = document.createElement('li');
    const ok = !!store['op:' + op];
    li.innerHTML = '<span class="' + (ok ? 'ok' : 'no') + '">' + (ok ? 'Learned' : 'Learns on first run') + '</span> &middot; ' + label;
    ul.appendChild(li);
  });
  if (!m) { sub.textContent = 'Open an Airbnb wishlist (airbnb.com/wishlists/...) and click the icon again.'; return; }
  const wl = m[1];
  const last = store['wl:' + wl];
  sub.textContent = last ? (last.meta.name + ' · last scored ' + new Date(last.ts).toLocaleString()) : 'Ready to score the wishlist in this tab.';
  const open = (run) => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') + '?wl=' + wl + '&tab=' + tab.id + (run ? '&run=1' : '') });
  const runBtn = document.getElementById('run'); runBtn.hidden = false; runBtn.onclick = () => { open(true); window.close(); };
  if (last) { const lb = document.getElementById('last'); lb.hidden = false; lb.onclick = () => { open(false); window.close(); }; }
})();
