(function () {
  "use strict";

  var FALLBACK_SCALE = {
    active: [
      { id: "clear", label: "Clear", at: 0 },
      { id: "breeze", label: "Breeze", at: 1 },
      { id: "wind", label: "Wind", at: 200 },
      { id: "squall", label: "Squall", at: 1000 },
      { id: "storm", label: "Storm", at: 5000 },
      { id: "whiteout", label: "Whiteout", at: 20000 }
    ],
    dormant: [
      { id: "quiet", label: "Quiet", at: 0 },
      { id: "banked", label: "Banked", at: 10000 },
      { id: "deep", label: "Deep", at: 100000 },
      { id: "buried", label: "Buried", at: 1000000 }
    ]
  };

  var SIGNAL = {
    handle_one_off: "one character off",
    young_account: "under 90 days",
    follower_ratio: "followers dwarf following",
    empty_bio: "empty bio",
    default_avatar: "default picture",
    multi_company: "several companies",
    three_companies: "Tesla, SpaceX, and xAI"
  };

  var HOLD = {
    login_wall: "X sent the search page to a login wall. The count was not reset.",
    markup_moved: "The search page no longer has the marks this station reads. The count was not reset.",
    blocked: "The sweep was blocked. The count was not reset.",
    network: "The sweep did not connect. The count was not reset.",
    missing: "The log did not load. This is not a count of zero."
  };

  var ACTIVE_LINE = {
    clear: "Nothing on the log is young enough to count as active.",
    breeze: "Active flags are only a handful.",
    wind: "Active flags are in the hundreds.",
    squall: "Active flags are in the low thousands.",
    storm: "Active flags are past five thousand.",
    whiteout: "Active flags are at twenty thousand or more."
  };

  var DORMANT_LINE = {
    quiet: "Dormant flags are under ten thousand.",
    banked: "Dormant flags are in the tens of thousands.",
    deep: "Dormant flags are in the hundreds of thousands.",
    buried: "Dormant flags are at a million or more."
  };

  var START = -120;
  var SWEEP = 240;
  var NS = "http://www.w3.org/2000/svg";
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var sky = document.getElementById("sky");
  var ctx = sky.getContext("2d");
  var particles = [];
  var particleKind = "";
  var shown = { angle: START, count: 0, have: false, target: null, from: 0, began: 0 };

  function byId(id) { return document.getElementById(id); }

  function format(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function bandAt(n, bands) {
    var current = bands[0];
    for (var i = 0; i < bands.length; i++) {
      if (n >= bands[i].at) current = bands[i];
    }
    return current;
  }

  function position(n, bands) {
    var index = 0;
    for (var i = 0; i < bands.length; i++) {
      if (n >= bands[i].at) index = i;
    }
    var start = bands[index].at;
    var end = bands[index + 1] ? bands[index + 1].at : start + Math.max(start, 1);
    var frac = (n - start) / Math.max(1, end - start);
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return (index + frac) / bands.length;
  }

  function angleFor(n, bands) {
    return START + position(n, bands) * SWEEP;
  }

  function polar(deg, r) {
    var rad = deg * Math.PI / 180;
    return {
      x: 200 + r * Math.sin(rad),
      y: 200 - r * Math.cos(rad)
    };
  }

  function arc(r, a0, a1) {
    var p0 = polar(a0, r);
    var p1 = polar(a1, r);
    var large = (a1 - a0) > 180 ? 1 : 0;
    return "M " + p0.x.toFixed(2) + " " + p0.y.toFixed(2) + " A " + r + " " + r + " 0 " + large + " 1 " + p1.x.toFixed(2) + " " + p1.y.toFixed(2);
  }

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function drawFace(scale, activeId, dormantPos) {
    var face = byId("face");
    while (face.firstChild) face.removeChild(face.firstChild);
    face.appendChild(el("circle", { cx: "200", cy: "200", r: "188", fill: "none", stroke: "rgba(215,181,109,0.35)", "stroke-width": "2" }));
    var bands = scale.active;
    var step = SWEEP / bands.length;
    bands.forEach(function (band, i) {
      var a0 = START + i * step;
      var a1 = a0 + step - 1.4;
      var hot = band.id === activeId;
      face.appendChild(el("path", {
        d: arc(168, a0, a1),
        fill: "none",
        stroke: hot ? "#f2f6f8" : "rgba(215,181,109,0.75)",
        "stroke-width": hot ? "8" : "5",
        "stroke-linecap": "butt"
      }));
      var tick = polar(a0, 168);
      var outer = polar(a0, 182);
      face.appendChild(el("line", {
        x1: tick.x, y1: tick.y, x2: outer.x, y2: outer.y,
        stroke: "#d7b56d", "stroke-width": "1.4"
      }));
      var labelAt = polar(a0, 146);
      var text = el("text", {
        x: labelAt.x, y: labelAt.y,
        fill: "#d7b56d",
        "font-size": "11",
        "font-family": "ui-monospace, Menlo, Consolas, monospace",
        "text-anchor": "middle",
        "dominant-baseline": "middle"
      });
      text.textContent = shortAt(band);
      face.appendChild(text);
    });
    var end = polar(START + SWEEP, 168);
    var endOuter = polar(START + SWEEP, 182);
    face.appendChild(el("line", {
      x1: end.x, y1: end.y, x2: endOuter.x, y2: endOuter.y,
      stroke: "#d7b56d", "stroke-width": "1.4"
    }));
    face.appendChild(el("path", {
      d: arc(132, START, START + SWEEP),
      fill: "none",
      stroke: "rgba(215,181,109,0.28)",
      "stroke-width": "4",
      "stroke-linecap": "round"
    }));
    if (dormantPos != null) {
      var endAngle = START + Math.max(0.02, dormantPos) * SWEEP;
      face.appendChild(el("path", {
        d: arc(132, START, endAngle),
        fill: "none",
        stroke: "#9fd7e8",
        "stroke-width": "4",
        "stroke-linecap": "round"
      }));
    }
    var needle = el("polygon", { id: "needle", points: "200,86 193,200 207,200", fill: "#f4f7f2" });
    needle.setAttribute("transform", "rotate(" + shown.angle.toFixed(2) + " 200 200)");
    needle.setAttribute("opacity", shown.have ? "1" : "0");
    face.appendChild(needle);
    face.appendChild(el("circle", { cx: "200", cy: "200", r: "8", fill: "#d7b56d" }));
    face.appendChild(el("circle", { cx: "200", cy: "200", r: "3.5", fill: "#1a140c" }));
  }

  function shortAt(band) {
    if (band.at >= 1000000) return "1m";
    if (band.at >= 1000) return String(band.at / 1000) + "k";
    return String(band.at);
  }

  function setNeedle(angle, visible) {
    var needle = document.getElementById("needle");
    if (!needle) return;
    needle.setAttribute("transform", "rotate(" + angle.toFixed(2) + " 200 200)");
    needle.setAttribute("opacity", visible ? "1" : "0");
  }

  function phrase(doc, activeBand, dormantBand) {
    if (doc.active == null) {
      return HOLD[doc.reason] || HOLD.missing;
    }
    var parts = [];
    if (doc.status === "held") parts.push(HOLD[doc.reason] || HOLD.network);
    if (activeBand) parts.push(activeBand.label + ". " + (ACTIVE_LINE[activeBand.id] || ""));
    if (dormantBand && doc.dormant != null) parts.push(DORMANT_LINE[dormantBand.id] || "");
    if (doc.status === "ok" && doc.seen != null) {
      parts.push("Last sweep parsed " + format(doc.seen) + " public accounts. " + format(doc.added || 0) + " new handles scored high.");
    }
    if (doc.unknown) {
      parts.push(format(doc.unknown) + " flagged with no age on the page.");
    }
    return parts.filter(Boolean).join(" ");
  }

  function whenText(doc, preview) {
    if (preview) return "Specimen";
    var read = stamp(doc.run);
    var tried = stamp(doc.attempted_at);
    if (read && tried && doc.status === "held" && doc.run !== doc.attempted_at) {
      return "Last good read " + read + " · Tried " + tried;
    }
    if (read) return "Read " + read;
    if (tried) return "Tried " + tried;
    return "";
  }

  function stamp(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var hh = String(d.getUTCHours()).padStart(2, "0");
    var mm = String(d.getUTCMinutes()).padStart(2, "0");
    return d.getUTCDate() + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", " + hh + ":" + mm + " UTC";
  }

  function fillLog(accounts, preview) {
    var log = byId("log");
    while (log.firstChild) log.removeChild(log.firstChild);
    var rows = (accounts || []).slice(0, 200);
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No handles on the log.";
      log.appendChild(empty);
      return;
    }
    rows.forEach(function (account) {
      var entry = document.createElement("article");
      entry.className = "entry";
      var handle = String(account.handle || "");
      var name;
      if (!preview && /^[A-Za-z0-9_]{1,15}$/.test(handle)) {
        name = document.createElement("a");
        name.href = "https://x.com/" + handle;
        name.rel = "noreferrer noopener";
        name.target = "_blank";
      } else {
        name = document.createElement("span");
      }
      name.className = "handle";
      name.textContent = "@" + handle;
      var score = document.createElement("span");
      score.className = "score";
      score.textContent = String(account.score == null ? "—" : account.score);
      var signals = document.createElement("p");
      signals.className = "signals";
      var words = (account.signals || []).map(function (key) { return SIGNAL[key] || key; });
      var activity = account.activity === "active" ? "Active" : account.activity === "dormant" ? "Dormant" : "Unspecified";
      signals.textContent = activity + (words.length ? " · " + words.join(" · ") : "");
      entry.appendChild(name);
      entry.appendChild(score);
      entry.appendChild(signals);
      log.appendChild(entry);
    });
    if ((accounts || []).length > 200) {
      var note = document.createElement("p");
      note.className = "empty";
      note.textContent = "Showing 200 of " + format(accounts.length) + ", highest scores.";
      log.appendChild(note);
    }
  }

  function render(doc, preview) {
    var scale = doc.scale && doc.scale.active ? doc.scale : FALLBACK_SCALE;
    window.__gaugeScale = scale;
    var activeBand = doc.active == null ? null : bandAt(doc.active, scale.active);
    var dormantBand = doc.dormant == null ? null : bandAt(doc.dormant, scale.dormant);
    var weather = activeBand ? activeBand.id : "none";
    document.body.dataset.weather = weather;
    byId("condition").textContent = activeBand ? activeBand.label : "No reading";
    byId("unit").textContent = "flagged active";
    if (doc.dormant == null) {
      byId("dormant").textContent = "Dormant · —";
    } else {
      byId("dormant").textContent = "Dormant · " + dormantBand.label + " · " + format(doc.dormant);
    }
    byId("forecast").textContent = phrase(doc, activeBand, dormantBand);
    byId("asof").textContent = whenText(doc, preview);
    byId("banner").hidden = !preview;
    var label = activeBand ? activeBand.label : "No reading";
    document.title = label + " · Fake Elon weather";
    var dialLabel = label;
    if (doc.active != null) dialLabel += ", " + format(doc.active) + " flagged active";
    if (doc.dormant != null) dialLabel += ", dormant " + dormantBand.label + " " + format(doc.dormant);
    byId("dial").setAttribute("aria-label", dialLabel);
    var dormantPos = doc.dormant == null ? null : position(doc.dormant, scale.dormant);
    drawFace(scale, weather === "none" ? "" : weather, dormantPos);
    shown.target = doc.active;
    shown.from = shown.have ? shown.count : 0;
    shown.began = performance.now();
    shown.have = doc.active != null;
    byId("count").classList.toggle("is-empty", doc.active == null);
    if (!shown.have) {
      byId("count").textContent = "—";
      setNeedle(START, false);
    } else if (motion.matches) {
      shown.count = doc.active;
      shown.angle = angleFor(doc.active, scale.active);
      byId("count").textContent = format(doc.active);
      setNeedle(shown.angle, true);
    }
    fillLog(doc.accounts, preview);
    ensureParticles(true);
  }

  function specimen(doc) {
    var scale = doc && doc.scale && doc.scale.active ? doc.scale : FALLBACK_SCALE;
    return {
      status: "ok",
      reason: null,
      active: 2847,
      dormant: 48200,
      unknown: 0,
      flagged: 2860,
      seen: null,
      added: null,
      run: null,
      attempted_at: null,
      scale: scale,
      accounts: [
        { handle: "specimen-a", score: 9, activity: "active", signals: ["handle_one_off", "young_account", "default_avatar"] },
        { handle: "specimen-b", score: 5, activity: "dormant", signals: ["three_companies", "follower_ratio"] },
        { handle: "specimen-c", score: 4, activity: "active", signals: ["handle_one_off"] },
        { handle: "specimen-d", score: 4, activity: "dormant", signals: ["multi_company", "empty_bio"] },
        { handle: "specimen-e", score: 6, activity: "active", signals: ["young_account", "default_avatar", "empty_bio"] },
        { handle: "specimen-f", score: 4, activity: "dormant", signals: ["handle_one_off"] }
      ]
    };
  }

  function failedLoad() {
    return {
      status: "held",
      reason: "missing",
      active: null,
      dormant: null,
      unknown: null,
      flagged: null,
      accounts: [],
      scale: FALLBACK_SCALE
    };
  }

  function countsUrl() {
    var host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "") {
      var local = document.body.dataset.countsLocal || "../counts.json";
      if (local !== "counts.json" && local !== "../counts.json") local = "../counts.json";
      return new URL(local, location.href).href;
    }
    var repo = document.body.dataset.countsRepo || "";
    var branch = document.body.dataset.countsBranch || "main";
    var path = document.body.dataset.countsPath || "counts.json";
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) repo = "RogerWillko/impersonator-weather";
    if (!/^[A-Za-z0-9_.-]+$/.test(branch)) branch = "main";
    if (path !== "counts.json") path = "counts.json";
    return "https://raw.githubusercontent.com/" + repo + "/" + branch + "/" + path;
  }

  function ease(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function tick(now) {
    if (shown.have && shown.target != null && !motion.matches) {
      var t = Math.min(1, (now - shown.began) / 1400);
      var k = ease(t);
      var value = shown.from + (shown.target - shown.from) * k;
      shown.count = value;
      var scale = window.__gaugeScale || FALLBACK_SCALE;
      shown.angle = angleFor(value, scale.active);
      byId("count").textContent = format(value);
      setNeedle(shown.angle, true);
    }
    if (!document.hidden) paintSky();
    if (!motion.matches) requestAnimationFrame(tick);
  }

  function resizeSky() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    sky.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    sky.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(kind, anywhere) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    return {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -30,
      v: speedFor(kind),
      len: lengthFor(kind),
      a: 0.15 + Math.random() * 0.45,
      r: 8 + Math.random() * 40
    };
  }

  function speedFor(kind) {
    if (kind === "storm") return 9 + Math.random() * 8;
    if (kind === "squall") return 6 + Math.random() * 5;
    if (kind === "wind") return 4 + Math.random() * 4;
    if (kind === "breeze") return 1.5 + Math.random() * 2;
    if (kind === "whiteout") return 0.4 + Math.random() * 0.8;
    return 0.15 + Math.random() * 0.35;
  }

  function lengthFor(kind) {
    if (kind === "storm") return 16 + Math.random() * 22;
    if (kind === "squall") return 12 + Math.random() * 16;
    if (kind === "wind") return 14 + Math.random() * 20;
    if (kind === "breeze") return 8 + Math.random() * 10;
    return 2;
  }

  function countFor(kind) {
    return { none: 26, clear: 20, breeze: 40, wind: 64, squall: 90, storm: 130, whiteout: 170 }[kind] || 26;
  }

  function ensureParticles(reset) {
    var kind = document.body.dataset.weather || "none";
    if (!reset && kind === particleKind && particles.length) return;
    particleKind = kind;
    var n = countFor(kind);
    particles = [];
    for (var i = 0; i < n; i++) particles.push(spawn(kind, true));
  }

  function paintSky() {
    var kind = document.body.dataset.weather || "none";
    ensureParticles(false);
    var w = window.innerWidth;
    var h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    particles.forEach(function (p) {
      if (kind === "squall" || kind === "storm") {
        ctx.strokeStyle = "rgba(214,230,242," + p.a + ")";
        ctx.lineWidth = kind === "storm" ? 1.4 : 1.1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len * 0.45, p.y + p.len);
        ctx.stroke();
        p.y += p.v;
        p.x += p.v * 0.45;
      } else if (kind === "wind" || kind === "breeze") {
        ctx.strokeStyle = "rgba(190,224,236," + p.a + ")";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.len, p.y);
        ctx.stroke();
        p.x += p.v;
      } else if (kind === "whiteout") {
        ctx.fillStyle = "rgba(255,255,255," + (0.35 + p.a * 0.5) + ")";
        ctx.fillRect(p.x, p.y, 2.2, 2.2);
        p.y += p.v;
        p.x += 0.4;
      } else if (kind === "clear") {
        ctx.fillStyle = "rgba(231,215,168," + p.a + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
        p.y -= p.v;
      } else {
        ctx.fillStyle = "rgba(180,190,198," + (p.a * 0.35) + ")";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        p.x += Math.sin(p.y * 0.01) * 0.3;
        p.y += p.v;
      }
      if (p.x > w + 40) p.x = -20;
      if (p.x < -40) p.x = w + 20;
      if (p.y > h + 40) {
        p.y = -20;
        p.x = Math.random() * w;
      }
      if (p.y < -40) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
    });
  }

  function boot() {
    var preview = new URLSearchParams(location.search).get("preview") === "1";
    resizeSky();
    window.addEventListener("resize", function () {
      resizeSky();
      ensureParticles(true);
      paintSky();
    });
    fetch(countsUrl(), { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("missing");
      return response.json();
    }).then(function (doc) {
      window.__gaugeScale = doc.scale || FALLBACK_SCALE;
      render(preview ? specimen(doc) : doc, preview);
    }).catch(function () {
      window.__gaugeScale = FALLBACK_SCALE;
      render(preview ? specimen(null) : failedLoad(), preview);
    });
    paintSky();
    if (!motion.matches) requestAnimationFrame(tick);
  }

  boot();
})();
