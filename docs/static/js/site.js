// Search (a combobox over search.json) and two small enhancements.
// Every page works without this file.

(function () {
  "use strict";

  // Open "Go deeper" when a link points inside it (or at its stone), and by default on
  // wide screens.
  function openTarget() {
    var id = decodeURIComponent(location.hash.slice(1));
    var el = id && document.getElementById(id);
    var details = el && (el.closest("details") || el.querySelector("details.deeper"));
    if (details) {
      details.open = true;
      el.scrollIntoView();
    }
  }
  function openDeeper() {
    if (window.matchMedia("(min-width: 48rem)").matches) {
      document.querySelectorAll("details.deeper").forEach(function (d) { d.open = true; });
    }
  }
  openDeeper();
  // A trip can put a planet's page in place of this one without a load (swap.js).
  document.addEventListener("pageswapped", openDeeper);
  window.addEventListener("hashchange", openTarget);
  openTarget();

  var input = document.getElementById("search-input");
  var list = document.getElementById("search-results");
  if (!input || !list) return;

  var data = null;
  var options = [];
  var active = -1;

  function load() {
    if (data) return Promise.resolve(data);
    return fetch("/search.json")
      .then(function (r) { return r.json(); })
      .then(function (d) { data = d; return d; });
  }

  function norm(s) { return s.toLowerCase().trim(); }

  function topicScore(t, q) {
    var best = 0;
    [t.label].concat(t.aliases).forEach(function (name) {
      var n = norm(name);
      if (n === q) best = Math.max(best, 3);
      else if (n.indexOf(q) === 0) best = Math.max(best, 2);
      else if (n.indexOf(q) > -1) best = Math.max(best, 1);
    });
    return best;
  }

  function topicMatches(q) {
    if (!q) return data.topics.slice(0, 6);
    return data.topics
      .map(function (t) { return { t: t, s: topicScore(t, q) }; })
      .filter(function (m) { return m.s > 0; })
      .sort(function (a, b) { return b.s - a.s || a.t.label.localeCompare(b.t.label); })
      .map(function (m) { return m.t; })
      .slice(0, 6);
  }

  function excerptMatches(q) {
    var words = q.split(/\s+/).filter(function (w) { return w.length > 1; });
    if (!words.length) return [];
    return data.excerpts
      .map(function (e) {
        var text = norm(e.text);
        var score = 0;
        words.forEach(function (w) { if (text.indexOf(w) > -1) score += 1; });
        return { e: e, s: score };
      })
      .filter(function (m) { return m.s === words.length; })
      .slice(0, 6)
      .map(function (m) { return m.e; });
  }

  function snippet(text, q) {
    var i = norm(text).indexOf(q.split(/\s+/)[0]);
    var start = Math.max(0, i - 40);
    var s = text.slice(start, start + 120);
    return (start > 0 ? "..." : "") + s + (start + 120 < text.length ? "..." : "");
  }

  function option(href, kind, label, extra) {
    var a = document.createElement("a");
    a.className = "search-option";
    a.href = href;
    a.setAttribute("role", "option");
    a.id = "search-option-" + options.length;
    a.tabIndex = -1;
    var k = document.createElement("span");
    k.className = "kind";
    k.textContent = kind;
    a.appendChild(k);
    a.appendChild(document.createTextNode(label));
    if (extra) {
      var s = document.createElement("span");
      s.className = "snippet";
      s.textContent = extra;
      a.appendChild(s);
    }
    options.push(a);
    list.appendChild(a);
  }

  function render() {
    var q = norm(input.value);
    list.textContent = "";
    options = [];
    active = -1;
    input.removeAttribute("aria-activedescendant");
    topicMatches(q).forEach(function (t) { option(t.url, "Skill", t.label); });
    if (q && options.length === 0) {
      excerptMatches(q).forEach(function (e) { option(e.url, e.planet, "", snippet(e.text, q)); });
    }
    if (q && options.length === 0) {
      var none = document.createElement("p");
      none.className = "search-empty";
      none.textContent = "Nothing matches that yet. Try a tool or a skill, like Kubernetes or Terraform.";
      list.appendChild(none);
    }
    show(true);
  }

  function show(open) {
    list.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function move(step) {
    if (!options.length) return;
    if (active > -1) options[active].setAttribute("aria-selected", "false");
    active = (active + step + options.length) % options.length;
    options[active].setAttribute("aria-selected", "true");
    options[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", options[active].id);
  }

  input.addEventListener("focus", function () { load().then(render); });
  input.addEventListener("input", function () { load().then(render); });

  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) render(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Escape") { if (list.hidden) bar(false, true); show(false); }
  });

  // On the home page a skill lights up on the map instead of opening its page (skills.js).
  function pick(href) {
    var m = /^\/skills\/([^/]+)\/$/.exec(href || "");
    if (!m || !window.showSkill || !window.showSkill(m[1])) return false;
    show(false);
    bar(false);
    input.blur();
    return true;
  }

  input.form.addEventListener("submit", function (e) {
    e.preventDefault();
    load().then(function () {
      if (list.hidden) render();
      var target = options[Math.max(active, 0)];
      if (target && !pick(target.getAttribute("href"))) location.href = target.href;
    });
  });
  list.addEventListener("click", function (e) {
    var target = e.target.closest(".search-option");
    if (target && pick(target.getAttribute("href"))) e.preventDefault();
  });

  // Phones: search sits behind an icon in the header and opens as a bar over the top.
  var header = input.form.closest(".site-header");
  var opener = header.querySelector(".search-open");
  function bar(open, refocus) {
    if (header.classList.contains("is-searching") === open) return;
    header.classList.toggle("is-searching", open);
    opener.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) input.focus();
    else {
      show(false);
      if (refocus) opener.focus();
    }
  }
  opener.addEventListener("click", function () { bar(true); });
  input.form.querySelector(".search-close").addEventListener("click", function () { bar(false, true); });

  document.addEventListener("click", function (e) {
    if (input.form.contains(e.target)) return;
    show(false);
    if (!opener.contains(e.target)) bar(false);
  });
  input.form.addEventListener("focusout", function (e) {
    if (!input.form.contains(e.relatedTarget)) show(false);
  });
})();
