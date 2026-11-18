// The branded launch loader (#boot in index.html). It stays for at least MIN_MS so the brand is
// seen, and until the app has what it needs to draw itself (tournament info, from cache or the
// network) — but never longer than MAX_MS, so a slow or offline network can't trap the user on it.
// Time is measured from page load (performance.now), so no inline script is needed (strict CSP).
const MIN_MS = 2000;
const MAX_MS = 10000;
let done = false;

export function bootReady() {
  if (done) return;
  done = true;
  const el = document.getElementById('boot');
  if (!el) return;
  const wait = Math.max(0, MIN_MS - performance.now());
  setTimeout(() => {
    el.classList.add('boot-out');
    setTimeout(() => el.remove(), 500);
  }, wait);
}

setTimeout(bootReady, Math.max(0, MAX_MS - performance.now()));
