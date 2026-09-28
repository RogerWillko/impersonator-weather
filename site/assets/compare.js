(function () {
  "use strict";

  var SCALE = {
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

  var HOLD = {
    login_wall: "X sent the search page to a login wall. The count was not reset.",
    markup_moved: "The search page no longer has the marks this station reads. The count was not reset.",
    blocked: "The sweep was blocked. The count was not reset.",
    network: "The sweep did not connect. The count was not reset.",
    missing: "The log did not load. This is not a count of zero."
  };

  var START = -120;
  var SWEEP = 240;
  var NS = "http://www.w3.org/2000/svg";

  function format(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function halfUp(num, den) {
    return Math.floor((num + Math.floor(den / 2)) / den);
  }

  function percentProduct(base, percentText) {
    var bits = String(percentText).split(".");
    var frac = bits.length > 1 ? bits[1] : "";
    var digits = Number(bits[0] + frac);
    var den = Math.pow(10, frac.length) * 100;
    return halfUp(base * digits, den);
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

  function bandsTouched(low, high, bands) {
    var ids = [];
    for (var i = 0; i < bands.length; i++) {
      var start = bands[i].at;
      var end = i + 1 < bands.length ? bands[i + 1].at : Infinity;
      if (high >= start && low < end) ids.push(bands[i].id);
    }
    return ids;
  }

  function polar(deg, r) {
    var rad = deg * Math.PI / 180;
    return { x: 200 + r * Math.sin(rad), y: 200 - r * Math.cos(rad) };
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

  function specFrom(face) {
    var bands = SCALE[face.getAttribute("data-scale")] || SCALE.active;
    var mode = face.getAttribute("data-mode") || "empty";
    if (mode === "point") {
      var n = Number(face.getAttribute("data-value"));
      var band = bandAt(n, bands);
      return { bands: bands, hot: [band.id], needle: angleFor(n, bands), span: null, weather: band.id };
    }
    if (mode === "range") {
      var low = Number(face.getAttribute("data-low"));
      var high = Number(face.getAttribute("data-high"));
      var a0 = angleFor(low, bands);
      var a1 = angleFor(high, bands);
      if (a1 < a0) {
        var swap = a0;
        a0 = a1;
        a1 = swap;
      }
      var hot = bandsTouched(low, high, bands);
      return {
        bands: bands,
        hot: hot,
        needle: (a0 + a1) / 2,
        span: { a0: a0, a1: a1 },
        weather: hot.length > 1 ? "span" : (hot[0] || "none")
      };
    }
    return { bands: bands, hot: [], needle: null, span: null, weather: "none" };
  }

  function drawFace(face, spec) {
    while (face.firstChild) face.removeChild(face.firstChild);
    face.appendChild(el("circle", {
      cx: "200", cy: "200", r: "188", fill: "none",
      stroke: "rgba(215,181,109,0.35)", "stroke-width": "2"
    }));
    var step = SWEEP / spec.bands.length;
    spec.bands.forEach(function (band, i) {
      var a0 = START + i * step;
      var a1 = a0 + step - 1.6;
      var hot = spec.hot.indexOf(band.id) !== -1;
      face.appendChild(el("path", {
        d: arc(168, a0, a1),
        fill: "none",
        stroke: hot ? "#f2f6f8" : "rgba(215,181,109,0.75)",
        "stroke-width": hot ? "11" : "6",
        "stroke-linecap": "butt"
      }));
      var inner = polar(a0, 168);
      var outer = polar(a0, 184);
      face.appendChild(el("line", {
        x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y,
        stroke: "#d7b56d", "stroke-width": "1.6"
      }));
    });
    var endIn = polar(START + SWEEP, 168);
    var endOut = polar(START + SWEEP, 184);
    face.appendChild(el("line", {
      x1: endIn.x, y1: endIn.y, x2: endOut.x, y2: endOut.y,
      stroke: "#d7b56d", "stroke-width": "1.6"
    }));
    face.appendChild(el("path", {
      d: arc(132, START, START + SWEEP),
      fill: "none",
      stroke: "rgba(215,181,109,0.28)",
      "stroke-width": "5",
      "stroke-linecap": "round"
    }));
    if (spec.span) {
      face.appendChild(el("path", {
        d: arc(132, spec.span.a0, spec.span.a1),
        fill: "none",
        stroke: "#9fd7e8",
        "stroke-width": "5",
        "stroke-linecap": "round"
      }));
    }
    var needle = el("polygon", { points: "200,72 191,200 209,200", fill: "#f4f7f2" });
    if (spec.needle == null) {
      needle.setAttribute("opacity", "0");
    } else {
      needle.setAttribute("transform", "rotate(" + spec.needle.toFixed(2) + " 200 200)");
    }
    face.appendChild(needle);
    face.appendChild(el("circle", { cx: "200", cy: "200", r: "9", fill: "#d7b56d" }));
    face.appendChild(el("circle", { cx: "200", cy: "200", r: "4", fill: "#1a140c" }));
  }

  function paintFace(face) {
    var spec = specFrom(face);
    var reading = face.closest(".reading");
    if (reading) reading.setAttribute("data-weather", spec.weather);
    drawFace(face, spec);
  }

  function paintAll() {
    var faces = document.querySelectorAll(".face");
    for (var i = 0; i < faces.length; i++) paintFace(faces[i]);
  }

  function text(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
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

  function stationSentence(doc) {
    if (!doc || doc.active == null && doc.status !== "ok") {
      return HOLD[doc && doc.reason] || HOLD.missing;
    }
    if (doc.active == null) return HOLD[doc.reason] || HOLD.missing;
    var parts = [];
    if (doc.status === "held") parts.push(HOLD[doc.reason] || HOLD.network);
    var active = bandAt(doc.active, SCALE.active);
    parts.push(active.label + " · " + format(doc.active) + " flagged active.");
    if (doc.dormant != null) {
      var dormant = bandAt(doc.dormant, SCALE.dormant);
      parts.push("Dormant " + dormant.label + " · " + format(doc.dormant) + ".");
    }
    return parts.join(" ");
  }

  function applyStation(doc) {
    var face = document.querySelector("#station-reading .face");
    var mini = document.querySelector("#station-reading .mini");
    var count = document.getElementById("station-count");
    if (doc.active == null) {
      face.setAttribute("data-mode", "empty");
      face.removeAttribute("data-value");
      text("station-condition", "No reading");
      text("station-count", "—");
      count.classList.add("is-empty");
      text("station-dormant", "Dormant · —");
      if (mini) mini.setAttribute("aria-label", "No reading");
    } else {
      face.setAttribute("data-mode", "point");
      face.setAttribute("data-value", String(doc.active));
      var active = bandAt(doc.active, SCALE.active);
      text("station-condition", active.label);
      text("station-count", format(doc.active));
      count.classList.remove("is-empty");
      var dormantLine = "Dormant · —";
      if (doc.dormant != null) {
        var dormant = bandAt(doc.dormant, SCALE.dormant);
        dormantLine = "Dormant · " + dormant.label + " · " + format(doc.dormant);
      }
      text("station-dormant", dormantLine);
      if (mini) mini.setAttribute("aria-label", active.label + ", " + format(doc.active) + " flagged active");
    }
    text("station-note", stationSentence(doc));
    var when = stamp(doc.attempted_at);
    text("station-asof", when ? "Tried " + when : "");
    paintFace(face);
  }

  function applySources(doc) {
    var list = doc && doc.sources ? doc.sources : [];
    var spark = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === "sparktoro") spark = list[i];
    }
    if (!spark) return;
    var primary = percentProduct(spark.followers, spark.unlikely_authentic_active_percent);
    var secondary = percentProduct(spark.tweeted_in_90_days, spark.fake_or_spam_among_those_percent);
    text("spark-product", format(primary));
    text("spark-active-product", format(secondary));
    var face = document.querySelector("#sparktoro .face");
    if (!face) return;
    face.setAttribute("data-mode", "point");
    face.setAttribute("data-value", String(primary));
    var mini = document.querySelector("#sparktoro .mini");
    if (mini) mini.setAttribute("aria-label", "Whiteout, " + format(primary) + " followers unlikely to be authentic and active");
    paintFace(face);
  }

  paintAll();
  text("read-from", countsUrl());

  fetch("sources.json", { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error("missing");
    return response.json();
  }).then(applySources).catch(function () {});

  fetch(countsUrl(), { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error("missing");
    return response.json();
  }).then(applyStation).catch(function () {
    applyStation({ status: "held", reason: "missing", active: null, dormant: null });
  });
}());
