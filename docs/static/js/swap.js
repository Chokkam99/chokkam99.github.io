// Changing page without loading one, for the trips. While a trip plays, the next page is
// fetched and made ready in the background: its stylesheets loaded but not yet applied, its
// script fetched. Then it takes this page's place in a single step, so nothing on screen
// ever waits on the network or shows a page loading. The address changes with it; Back
// reloads the page the trip left, since that page is no longer here to go back to.

const abs = (url) => new URL(url, location.href).href;

// A stylesheet the next page needs, loaded but not applied yet.
function sheet(href) {
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === href)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.media = "not all";
    l.dataset.next = "";
    l.onload = resolve;
    l.onerror = reject;
    document.head.appendChild(l);
  });
}
// A script the next page runs: fetched now, so it runs from the cache when it's needed. A
// plain fetch, since a module preload never reports back in some browsers (iOS before 17),
// which would hold the trip for good; the preload is only a hint on top.
function warm(src) {
  const l = document.createElement("link");
  l.rel = "modulepreload";
  l.href = src;
  document.head.appendChild(l);
  return fetch(src, { credentials: "same-origin" }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.text();
  });
}

// Starts readying href. Resolves, once everything it needs is here, with the parsed page and
// the address of its script (as `script` gives it: a page that runs its script a second
// time asks for a fresh copy).
export function prepare(href, script = (src) => src) {
  return fetch(href, { credentials: "same-origin" })
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.text();
    })
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const tag = doc.querySelector('script[type="module"][src]');
      const src = tag ? script(abs(tag.getAttribute("src"))) : null;
      const sheets = [...doc.querySelectorAll('head link[rel="stylesheet"]')].map((l) => sheet(abs(l.getAttribute("href"))));
      return Promise.all([...sheets, src && warm(src)]).then(() => ({ doc, src }));
    });
}

let here = null;

// Puts the next page in place of this one, in one step: its title, its body's class, its
// banner and its content (the header and its search stay). Its script is not run here: the
// caller sets the trip's classes first, then imports `src`. The page goes to its top unless
// `keepScroll` (a page whose window sits just where this one's did: moving would bring a
// phone's address bar in, and shift it).
export function swap({ doc }, href, { keepScroll = false } = {}) {
  for (const l of document.querySelectorAll("link[data-next]")) {
    l.media = "all";
    l.removeAttribute("data-next");
  }
  document.title = doc.title;
  for (const sel of ['meta[name="description"]', 'link[rel="canonical"]']) {
    const a = document.head.querySelector(sel), b = doc.head.querySelector(sel);
    if (a && b) a.replaceWith(document.importNode(b, true));
  }
  document.body.className = doc.body.className;
  const banner = document.querySelector("body > .status-banner"), next = doc.querySelector("body > .status-banner");
  if (banner) banner.remove();
  if (next) document.querySelector(".site-header").before(document.importNode(next, true));
  const main = document.importNode(doc.querySelector("main"), true);
  main.querySelectorAll("script").forEach((s) => s.remove());
  document.querySelector("main").replaceWith(main);
  history.pushState(null, "", href);
  if (!keepScroll) scrollTo(0, 0);
  if (here === null) addEventListener("popstate", () => { if (location.pathname !== here) location.reload(); });
  here = location.pathname;
  // For the page's other scripts (site.js, skills.js): the page under them has changed.
  document.dispatchEvent(new Event("pageswapped"));
}
