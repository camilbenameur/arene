/* Prix en direct de la ligue dérivés : estimation dans le navigateur, à partir du flux public de Kraken Futures.
   La page publiée garde les chiffres officiels du journal (relevé toutes les 5 min). Ce script ne fait que
   revaloriser les positions publiées au mark du moment ; si le flux se tait, les chiffres publiés reviennent. */
(function () {
  "use strict";
  var src = document.getElementById("direct-data");
  if (!src || typeof WebSocket === "undefined") return;
  var D;
  try { D = JSON.parse(src.textContent); } catch (err) { return; }
  if (!D || !D.flux || !D.produits || !D.produits.length) return;

  var NBSP = " ", NNBSP = " ", MINUS = "−";
  var FRAIS_S = 15;        // un prix plus vieux que 15 s n'est plus « en direct »
  var ECART_MAX = 0.25;    // un mark à plus de 25 % du prix publié est ignoré
  var marks = {};          // produit -> {m: µUSD, t: secondes (horloge du lecteur), k: ms (horloge Kraken)}
  var MUET_S = 30;         // une connexion sans aucun message depuis 30 s est refaite
  var ws = null, essais = 0, sale = false, vu = 0;

  var etat = document.querySelector("[data-direct-etat]");
  var mot = document.querySelector("[data-direct-mot]");
  var motOriginal = mot ? mot.textContent : "";
  var cellules = Array.prototype.slice.call(document.querySelectorAll("[data-direct]"));
  cellules.forEach(function (c) { c.setAttribute("data-officiel", c.textContent); c.setAttribute("data-ton", c.className); });

  function grouper(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP); }
  function eur(u, signe) {
    var c = Math.round(Math.abs(u) / 10000), w = Math.floor(c / 100), f = c % 100;
    var s = u < 0 && c > 0 ? MINUS : (signe && c > 0 ? "+" : "");
    return s + grouper(w) + "," + (f < 10 ? "0" : "") + f + NBSP + "€";
  }
  function pct(x) {
    var v = Math.round(x * 10000) / 100, s = v < 0 ? MINUS : (v > 0 ? "+" : "");
    return s + Math.abs(v).toFixed(2).replace(".", ",") + NBSP + "%";
  }
  function usdPrix(u) {
    var d = Math.abs(u) >= 100000000 ? 2 : 4, v = (Math.abs(u) / 1e6).toFixed(d).split(".");
    return grouper(v[0]) + "," + v[1] + NBSP + "$";
  }
  function ton(v) { return v > 0 ? "gain" : (v < 0 ? "perte" : ""); }
  function hms(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + NBSP + "UTC";
  }

  function frais(p) {
    var x = marks[p];
    return x && Date.now() / 1000 - x.t <= FRAIS_S ? x : null;
  }

  // Valeur estimée d'un portefeuille : valeur publiée, moins le latent publié, plus le latent au mark du moment.
  function estimer(pf) {
    var eq = pf.eq, vif = false, pos = {};
    pf.pos.forEach(function (x) {
      var f = frais(x.p);
      if (!f) return;
      var usd = (x.q > 0 ? 1 : -1) * (f.m - x.e) * Math.abs(x.q) / 1e8;
      var lat = usd >= 0 ? usd * 1e6 / pf.fx[1] : usd * 1e6 / pf.fx[0];
      eq += lat - x.l;
      pos[x.p] = {m: f.m, l: lat};
      vif = true;
    });
    return vif ? {eq: eq, pos: pos} : null;
  }

  function poser(c, txt, cls) {
    if (c.textContent !== txt) c.textContent = txt;
    var base = (c.getAttribute("data-ton") || "").replace(/\b(gain|perte)\b/g, "").trim();
    var nouv = (base + " " + (cls || "") + " est").trim();
    if (c.className !== nouv) c.className = nouv;
    c.title = "Estimation en direct";
  }
  function retablir(c) {
    c.textContent = c.getAttribute("data-officiel");
    c.className = c.getAttribute("data-ton");
    c.removeAttribute("title");
  }

  function rendre() {
    sale = false;
    var dernier = 0, actif = false, ests = {};
    Object.keys(D.pf).forEach(function (slug) { ests[slug] = estimer(D.pf[slug]); });
    cellules.forEach(function (c) {
      var est = ests[c.getAttribute("data-pf")], k = c.getAttribute("data-direct"), pf = D.pf[c.getAttribute("data-pf")];
      if (!est) { retablir(c); return; }
      if (k === "val") poser(c, eur(est.eq, false), "");
      else if (k === "rend") poser(c, pct(est.eq / pf.c - 1), ton(est.eq - pf.c));
      else {
        var x = est.pos[c.getAttribute("data-p")];
        if (!x) { retablir(c); return; }
        if (k === "mark") poser(c, usdPrix(x.m), "");
        else if (k === "lat") poser(c, eur(x.l, true), ton(Math.round(x.l / 10000)));
      }
      actif = true;
    });
    D.produits.forEach(function (p) { var f = frais(p); if (f && f.k > dernier) dernier = f.k; });
    if (etat) {
      if (actif && dernier) {
        etat.textContent = "Estimation en direct, prix Kraken de " + hms(dernier) + (etat.hasAttribute("data-court") ? "" : " · officiel au relevé de " + D.releve);
        etat.hidden = false;
      } else {
        etat.hidden = true;
      }
    }
    if (mot) mot.textContent = actif && dernier ? "Chiffres officiels de" : motOriginal;
  }

  function surMessage(m) {
    var d;
    try { d = JSON.parse(m.data); } catch (err) { return; }
    if (!d || d.feed !== "ticker" || D.produits.indexOf(d.product_id) < 0) return;
    var px = Number(d.markPrice);
    if (!isFinite(px) || px <= 0) return;
    var u = Math.round(px * 1e6), ref = D.ref[d.product_id];
    if (ref && Math.abs(u / ref - 1) > ECART_MAX) return;
    essais = 0;
    marks[d.product_id] = {m: u, t: Date.now() / 1000, k: Number(d.time) || Date.now()};
    sale = true;
  }

  function ouvrir() {
    if (ws || document.hidden) return;
    try { ws = new WebSocket(D.flux); } catch (err) { ws = null; return; } // CSP ou réseau : on garde la page publiée
    vu = Date.now() / 1000;
    ws.onopen = function () {
      this.send(JSON.stringify({event: "subscribe", feed: "ticker", product_ids: D.produits}));
    };
    ws.onmessage = function (m) { vu = Date.now() / 1000; surMessage(m); };
    ws.onclose = function () {
      ws = null;
      if (!document.hidden) relancer();
    };
    ws.onerror = function () { /* onclose suit */ };
  }
  function fermer() {
    if (!ws) return;
    var w = ws;
    ws = null;
    w.onclose = null;
    try { w.close(); } catch (err) { /* déjà fermé */ }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) fermer(); else ouvrir();
  });
  function relancer() {
    fermer();
    essais += 1;
    setTimeout(ouvrir, Math.min(60, Math.pow(2, essais)) * 1000);
  }
  setInterval(function () {
    if (ws && Date.now() / 1000 - vu > MUET_S) relancer();
    // Aussi sans nouveau message : un prix qui vieillit au-delà de 15 s doit rendre les chiffres publiés.
    if (sale || Object.keys(marks).length) rendre();
  }, 1000);
  ouvrir();
})();
