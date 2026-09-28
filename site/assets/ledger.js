(function () {
  var FALLBACK = ["fuck", "shit", "bitch", "asshole", "bastard", "damn", "crap", "dick", "cock", "pussy", "cunt", "slut", "whore", "nigger", "nigga", "faggot", "fag", "retard", "retarded", "spastic", "chink", "spic", "kike", "tranny", "rape", "rapist", "nazi"];
  var FX = { USD: 1, GBP: 0.75396, EUR: 0.87889, CNY: 6.7105 };
  var SYMBOL = { USD: "$", GBP: "£", EUR: "€", CNY: "¥" };
  var currency = "USD";
  var words = FALLBACK.slice();
  var ledger = { donors: [], handles: [] };

  function foldToken(token) {
    var map = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "@": "a", "$": "s" };
    var lower = String(token || "").toLowerCase();
    var letters = "";
    for (var i = 0; i < lower.length; i++) {
      var c = map[lower.charAt(i)] || lower.charAt(i);
      if (c >= "a" && c <= "z") letters += c;
    }
    return letters.replace(/([a-z])\1{2,}/g, "$1");
  }

  function stripWords(text) {
    var blocked = {};
    for (var i = 0; i < words.length; i++) blocked[words[i]] = true;
    var parts = String(text || "").trim().split(/\s+/);
    var kept = [];
    for (var j = 0; j < parts.length; j++) {
      if (!parts[j]) continue;
      var folded = foldToken(parts[j]);
      if (folded && blocked[folded]) continue;
      kept.push(parts[j]);
    }
    return kept.join(" ").replace(/\s+/g, " ").trim();
  }

  function centsOf(donor) {
    var profiles = Number(donor && donor.profiles);
    if (isFinite(profiles) && profiles >= 0) return Math.round(profiles);
    var usd = Number(donor && donor.usd);
    if (!isFinite(usd) || usd < 0) return 0;
    return Math.round(usd * 100);
  }

  function money(cents) {
    var usd = cents / 100;
    var amount = usd * (FX[currency] || 1);
    return (SYMBOL[currency] || "$") + amount.toFixed(2);
  }

  function rowsOf(donors) {
    var groups = [];
    var byName = {};
    for (var i = 0; i < donors.length; i++) {
      var donor = donors[i] || {};
      var name = stripWords(donor.name || "") || "A visitor";
      if (name.length > 32) name = name.slice(0, 32).trim() || "A visitor";
      var anon = name.toLowerCase() === "a visitor";
      var key = anon ? "anon:" + i : name.toLowerCase();
      var note = stripWords(donor.note || "");
      if (note.length > 140) note = note.slice(0, 140).trim();
      var at = String(donor.at || "");
      var row = byName[key];
      if (!row) {
        row = { name: name, note: note, at: at, cents: 0, profiles: 0, added: 0 };
        byName[key] = row;
        groups.push(row);
      }
      row.cents += centsOf(donor);
      row.profiles += centsOf(donor);
      row.added += Math.max(0, Math.round(Number(donor.added) || 0));
      if (at >= row.at) {
        row.at = at;
        row.note = note;
        if (!anon) row.name = name;
      }
    }
    groups.sort(function (a, b) {
      if (b.cents !== a.cents) return b.cents - a.cents;
      if (a.at < b.at) return 1;
      if (a.at > b.at) return -1;
      return 0;
    });
    return groups;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function handleNode(handle) {
    if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      var link = document.createElement("a");
      link.href = "https://x.com/" + handle;
      link.rel = "noreferrer noopener";
      link.textContent = "@" + handle;
      return link;
    }
    return el("span", "", String(handle || ""));
  }

  function paint() {
    var list = document.getElementById("donor-list");
    var section = document.getElementById("ledger-board");
    var visitor = document.getElementById("visitor");
    var handleBox = document.getElementById("visitor-handles");
    if (!list) return;
    var donors = Array.isArray(ledger.donors) ? ledger.donors : [];
    var handles = Array.isArray(ledger.handles) ? ledger.handles : [];
    var show = donors.length > 0 || handles.length > 0 || (section && section.getAttribute("data-show-empty") === "1");
    if (section) {
      if (show) section.hidden = false;
      else section.hidden = true;
    }
    if (visitor) {
      if (donors.length || handles.length) {
        visitor.hidden = false;
        visitor.textContent = "Visitor sweeps have added " + handles.length + " handles.";
      } else {
        visitor.hidden = true;
        visitor.textContent = "";
      }
    }
    list.textContent = "";
    if (!donors.length) {
      list.appendChild(el("li", "fine", "No visitor sweeps yet."));
    } else {
      var rows = rowsOf(donors);
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var item = document.createElement("li");
        item.appendChild(el("div", "donor-name", row.name));
        item.appendChild(el("p", "donor-meta", money(row.cents) + " · " + row.profiles + " profiles · " + row.added + " new handles"));
        if (row.note) item.appendChild(el("p", "donor-note", row.note));
        list.appendChild(item);
      }
    }
    if (handleBox) {
      handleBox.textContent = "";
      if (!handles.length) {
        handleBox.appendChild(el("p", "fine", "None yet."));
        return;
      }
      var ul = document.createElement("ul");
      ul.className = "handle-list";
      var start = Math.max(0, handles.length - 40);
      for (var h = handles.length - 1; h >= start; h--) {
        var handle = handles[h] && handles[h].handle;
        if (!handle) continue;
        var li = document.createElement("li");
        li.appendChild(handleNode(String(handle)));
        var score = handles[h].score;
        if (typeof score === "number") li.appendChild(el("span", "fine", " " + score));
        ul.appendChild(li);
      }
      handleBox.appendChild(ul);
    }
  }

  function setCurrency(next) {
    if (!FX[next]) return;
    currency = next;
    var buttons = document.querySelectorAll(".currencies button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-currency") === next ? "true" : "false");
    }
    paint();
  }

  function loadWords() {
    return fetch("words.json", { cache: "no-store", credentials: "omit", redirect: "manual" })
      .then(function (response) {
        if (!response.ok) throw new Error("words");
        return response.json();
      })
      .then(function (doc) {
        if (doc && Array.isArray(doc.words) && doc.words.length) {
          words = doc.words.map(function (word) { return String(word).toLowerCase(); });
        }
      })
      .catch(function () {
        words = FALLBACK.slice();
      });
  }

  function loadLedger() {
    return fetch("ledger.json", { cache: "no-store", credentials: "omit", redirect: "manual" })
      .then(function (response) {
        if (response.type === "opaqueredirect" || !response.ok) throw new Error("ledger");
        return response.json();
      })
      .then(function (doc) {
        ledger = doc && typeof doc === "object" ? doc : { donors: [], handles: [] };
      })
      .catch(function () {
        ledger = { donors: [], handles: [] };
      });
  }

  function start() {
    if (!document.getElementById("donor-list")) return;
    var buttons = document.querySelectorAll(".currencies button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (event) {
        setCurrency(event.currentTarget.getAttribute("data-currency"));
      });
    }
    loadWords().then(loadLedger).then(paint);
  }

  window.NightLedger = {
    stripWords: stripWords,
    reload: function () {
      return loadLedger().then(paint);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
