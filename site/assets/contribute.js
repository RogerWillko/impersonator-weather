(function () {
  var TERMS = ["elon", "musk", "maye"];
  var FX = { USD: 1, GBP: 0.75396, EUR: 0.87889, CNY: 6.7105 };
  var SYMBOL = { USD: "$", GBP: "£", EUR: "€", CNY: "¥" };
  var PRICE = 0.01;
  var CAP = 10;
  var running = false;

  function moneyLine(usd) {
    var parts = [];
    var codes = ["USD", "GBP", "EUR", "CNY"];
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      parts.push(SYMBOL[code] + (usd * FX[code]).toFixed(2));
    }
    return parts.join(" · ");
  }

  function text(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function redact(value, key) {
    var shown = String(value || "");
    if (key && key.length >= 4) shown = shown.split(key).join("…");
    return shown;
  }

  function status(value, key) {
    text("sweep-status", redact(value, key));
  }

  function publicProfile(user) {
    var row = { username: user && user.username ? String(user.username) : "" };
    if (user && Object.prototype.hasOwnProperty.call(user, "description")) {
      row.description = user.description == null ? null : String(user.description).slice(0, 500);
    }
    if (user && Object.prototype.hasOwnProperty.call(user, "created_at")) {
      row.created_at = user.created_at == null ? null : String(user.created_at).slice(0, 40);
    }
    if (user && Object.prototype.hasOwnProperty.call(user, "profile_image_url")) {
      row.profile_image_url = user.profile_image_url == null ? null : String(user.profile_image_url).slice(0, 300);
    }
    var metrics = user && user.public_metrics;
    if (metrics && typeof metrics === "object") {
      row.public_metrics = {
        followers_count: metrics.followers_count,
        following_count: metrics.following_count
      };
    }
    return row;
  }

  function searchTerm(term, key) {
    var url = "https://api.x.com/2/users/search?query=" + encodeURIComponent(term) + "&max_results=" + CAP + "&user.fields=" + encodeURIComponent("description,public_metrics,created_at,profile_image_url");
    return fetch(url, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + key,
        Accept: "application/json"
      }
    }).then(function (response) {
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        throw new Error("The search was redirected. The sweep stopped.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("X refused the key. Nothing was saved.");
      }
      if (!response.ok) {
        throw new Error("X returned " + response.status + " for " + term + ".");
      }
      return response.json().then(function (doc) {
        var data = doc && Array.isArray(doc.data) ? doc.data.slice(0, CAP) : [];
        return data;
      });
    });
  }

  function saveSweep(name, note, profiles) {
    return fetch("contribute.php", {
      method: "POST",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        name: name,
        note: note,
        terms: TERMS,
        profiles: profiles
      })
    }).then(function (response) {
      if (response.type === "opaqueredirect") {
        return { saved: false, reason: "This copy has no ledger to write." };
      }
      return response.text().then(function (body) {
        if (!response.ok) {
          var reason = body && body.length < 180 ? body.trim() : "The ledger did not accept the sweep.";
          if (response.status === 404 || response.status === 405 || response.status === 501) {
            reason = "This copy has no ledger to write.";
          }
          return { saved: false, reason: reason };
        }
        try {
          return { saved: true, doc: JSON.parse(body) };
        } catch (error) {
          return { saved: false, reason: "This copy has no ledger to write." };
        }
      });
    }).catch(function () {
      return { saved: false, reason: "This copy has no ledger to write." };
    });
  }

  function runSweep() {
    if (running) return;
    var keyInput = document.getElementById("gate");
    var nameInput = document.getElementById("donor-name");
    var noteInput = document.getElementById("donor-note");
    var button = document.getElementById("run");
    var key = keyInput ? keyInput.value : "";
    if (keyInput) keyInput.value = "";
    if (!key) {
      status("Paste an X API key to run one sweep.", "");
      return;
    }
    running = true;
    if (button) button.disabled = true;
    status("Searching X for elon, musk, and maye.", key);
    var profiles = [];
    var chain = Promise.resolve();
    TERMS.forEach(function (term) {
      chain = chain.then(function () {
        return searchTerm(term, key).then(function (rows) {
          for (var i = 0; i < rows.length && profiles.length < TERMS.length * CAP; i++) {
            profiles.push(publicProfile(rows[i]));
          }
        });
      });
    });
    chain.then(function () {
      var usd = profiles.length * PRICE;
      text("spent", "This sweep returned " + profiles.length + " profiles. About " + moneyLine(usd) + ". X bills the dollar amount. The other three are an approximate conversion as of 28 September 2026.");
      var spent = document.getElementById("spent");
      if (spent) spent.hidden = false;
      if (!profiles.length) {
        status("X returned no profiles. Nothing was written to the ledger. The key is already dropped.", "");
        return null;
      }
      var name = nameInput ? nameInput.value : "";
      var note = noteInput ? noteInput.value : "";
      if (window.NightLedger && window.NightLedger.stripWords) {
        name = window.NightLedger.stripWords(name);
        note = window.NightLedger.stripWords(note);
      }
      return saveSweep(name, note, profiles).then(function (result) {
        if (result.saved) {
          var added = result.doc && typeof result.doc.added === "number" ? result.doc.added : 0;
          status("Saved. The server added " + added + " handles. The station dial is unchanged. The key is already dropped.", "");
          if (window.NightLedger && window.NightLedger.reload) return window.NightLedger.reload();
          return null;
        }
        status("The sweep ran at X. " + result.reason + " The key is already dropped.", "");
        return null;
      });
    }).catch(function (error) {
      status(error && error.message ? error.message : "The sweep stopped.", key);
    }).then(function () {
      key = "";
      running = false;
      if (button) button.disabled = false;
    });
  }

  function start() {
    var form = document.getElementById("sweep");
    var button = document.getElementById("run");
    text("ceiling", "At most 30 profiles. About " + moneyLine(0.3) + ".");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
      });
    }
    if (button) button.addEventListener("click", runSweep);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
