/* Graphique du rendement cumulé (uPlot). Les données, en base 100, sont lues dans <script id="equity-data">.
   - un point par cycle, plus les relevés de la veille (toutes les 30 min et le dernier) : axe en temps réel,
     graduations sur des heures rondes UTC (4 h, 12 h, 1 jour…) choisies selon la largeur ;
   - axe vertical en écart au départ (« −0,5 % »), comme le tableau ;
   - légende HTML à boutons (clavier, tactile, lecteurs d'écran) qui montre les valeurs du dernier cycle
     ou du cycle survolé, à la place de la légende uPlot. */
(function () {
  "use strict";
  var node = document.getElementById("equity-data");
  var host = document.getElementById("chart");
  var legende = document.getElementById("legende");
  if (!node || !host || typeof uPlot === "undefined") return;
  var data;
  try { data = JSON.parse(node.textContent); } catch (err) { return; }
  var plot = null;
  var compactActuel = null;
  var masques = {};
  var MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  var LAST = data.x.length - 1;

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fr(v, d) { return v.toFixed(d).replace(".", ","); }
  function ecart(v, d) {
    if (v == null) return "—";
    var x = v - 100;
    var r = Number(fr(Math.abs(x), d).replace(",", "."));
    var s = r === 0 ? "" : (x > 0 ? "+" : "−");
    return s + fr(Math.abs(x), d) + " %";
  }
  function jour(d) { return d.getUTCDate() + " " + MOIS[d.getUTCMonth()]; }
  function heure(d) { return d.getUTCHours() + " h"; }
  var KINDS = data.kinds || [];
  function hm(d) { var m = d.getUTCMinutes(); return d.getUTCHours() + ":" + (m < 10 ? "0" : "") + m; }
  function quand(i) {
    if (i === 0 && KINDS[0] === "depart") return "Départ";
    var d = new Date(data.x[i] * 1000);
    if (KINDS[i] === "veille") return (i === LAST ? (data.dernier || "En direct") + " : " : "Relevé du ") + jour(d) + ", " + hm(d) + " UTC";
    return (i === LAST ? "Dernier cycle : " : "Cycle du ") + jour(d) + ", " + heure(d) + " UTC";
  }

  /* Styles des séries : calculés côté serveur (render._styles), source unique avec la légende HTML. */
  function styles() {
    return data.styles.map(function (st, i) {
      return {
        stroke: css(st.color), width: st.width, dash: st.dash, visible: st.visible,
        isLlm: data.series[i].kind === "llm" || data.series[i].kind === "conseil", focused: st.width >= 3
      };
    });
  }

  /* Graduations sur des heures rondes UTC : le plus petit pas (4 h, 8 h, 12 h, 1 j, 2 j, 7 j) qui laisse assez de place. */
  var PAS = [14400, 28800, 43200, 86400, 172800, 604800];
  function splits(u) {
    var xs = data.x, n = xs.length;
    if (n < 2) return xs.slice();
    var lo = xs[0], hi = xs[LAST], span = Math.max(1, hi - lo);
    var width = u.bbox.width / uPlot.pxRatio;
    var minPx = width < 420 ? 70 : 90;
    var pas = PAS[PAS.length - 1];
    for (var k = 0; k < PAS.length; k++) {
      if (width * PAS[k] / span >= minPx) { pas = PAS[k]; break; }
    }
    var out = [];
    for (var t = Math.ceil(lo / pas) * pas; t <= hi; t += pas) out.push(t);
    // Le départ garde sa graduation : ajoutée si elle a la place, sinon elle remplace la première (départ de saison).
    if (!out.length || (out[0] - lo) * width / span >= minPx * 0.8) out.unshift(lo);
    else if (KINDS[0] === "depart") out[0] = lo;
    return out;
  }

  /* La légende est déjà dans le HTML (valeurs du dernier cycle) : on active ses boutons. */
  var valeurs = [];
  var quandNode = document.getElementById("legende-quand");
  function brancherLegende() {
    if (!legende) return;
    valeurs = data.series.map(function () { return null; });
    Array.prototype.forEach.call(legende.querySelectorAll("button[data-serie]"), function (b) {
      var i = Number(b.getAttribute("data-serie"));
      var id = data.series[i].id;
      valeurs[i] = b.querySelector(".legende-val");
      b.disabled = false;
      b.addEventListener("click", function () {
        var off = b.getAttribute("aria-pressed") === "true";
        b.setAttribute("aria-pressed", off ? "false" : "true");
        masques[id] = off;
        if (plot) plot.setSeries(i + 1, { show: !off });
      });
    });
  }

  function afficherValeurs(idx) {
    if (idx == null) idx = LAST;
    if (quandNode) quandNode.textContent = quand(idx);
    data.series.forEach(function (s, i) {
      var v = valeurs[i];
      if (!v) return;
      var x = s.values[idx];
      v.textContent = ecart(x, 2);
      v.classList.toggle("gain", x != null && x >= 100.005);
      v.classList.toggle("perte", x != null && x <= 99.995);
    });
  }

  /* Étiquettes en bout de courbe (valeur et nom court), à la place d'une légende à décoder.
     Les courbes qui finissent à la même valeur partagent une étiquette ; les autres sont écartées verticalement. */
  function etiquettes(u) {
    var r = uPlot.pxRatio, ctx = u.ctx, gap = 16 * r;
    var groupes = [];
    data.series.forEach(function (s, i) {
      if (!u.series[i + 1].show) return;
      var j = s.values.length - 1;
      while (j >= 0 && s.values[j] == null) j--;
      if (j < 0) return;
      var txt = ecart(s.values[j], 2);
      var y = u.valToPos(s.values[j], "y", true);
      var g = null;
      for (var k = 0; k < groupes.length; k++) {
        if (groupes[k].txt === txt && Math.abs(groupes[k].y - y) < 2 * r) { g = groupes[k]; break; }
      }
      var llm = s.kind === "llm" || s.kind === "conseil";
      var c = llm ? css(data.styles[i].color) : css("--muted");
      if (g) { g.noms.push(data.short[i]); g.couleurs.push(c); g.llm = g.llm || llm; g.couleur = css("--text"); }
      else groupes.push({ txt: txt, y: y, noms: [data.short[i]], couleurs: [c], llm: llm, couleur: c });
    });
    groupes.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < groupes.length; k++) {
      if (groupes[k].y - groupes[k - 1].y < gap) groupes[k].y = groupes[k - 1].y + gap;
    }
    var x = u.bbox.left + u.bbox.width + 10 * r;
    var compact = u.bbox.width / r < 360;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    groupes.forEach(function (g) {
      ctx.fillStyle = g.couleur;
      ctx.font = (g.llm ? "600 " : "400 ") + Math.round(12 * r) + "px " + css("--mono");
      ctx.fillText(g.txt, x, g.y);
      var w = ctx.measureText(g.txt + " ").width;
      ctx.font = (g.llm ? "600 " : "400 ") + Math.round(12 * r) + "px " + css("--sans");
      var court = function (n) { return n.replace(/ \d+(\.\d+)?$/, ""); };
      var noms = g.noms.length > 1 || compact ? g.noms.map(court) : g.noms;
      var couleurs = g.couleurs;
      if (compact && noms.length > 1) { noms = [noms.length + (g.llm ? " IA" : " courbes")]; couleurs = [g.couleur]; }
      // Ce qui ne tient pas dans la marge droite devient « +N » (les noms complets restent dans la légende).
      var place = ctx.canvas.width - x - w - 4 * r;
      var largeur = function (liste, reste) {
        return ctx.measureText(liste.join(", ") + (reste ? ", +" + reste : "")).width;
      };
      var garde = noms.length;
      while (garde > 1 && largeur(noms.slice(0, garde), noms.length - garde) > place) garde--;
      if (garde < noms.length) {
        var reste = noms.length - garde;
        noms = noms.slice(0, garde).concat(["+" + reste]);
        couleurs = couleurs.slice(0, garde).concat([css("--muted")]);
      }
      var cx = x + w;
      noms.forEach(function (n, k) {
        var morceau = n + (k < noms.length - 1 ? ", " : "");
        ctx.fillStyle = couleurs[k];
        ctx.fillText(morceau, cx, g.y);
        cx += ctx.measureText(morceau).width;
      });
    });
    ctx.restore();
  }

  function build() {
    if (plot) { plot.destroy(); plot = null; }
    var width = host.clientWidth || 600;
    var compact = width < 520;
    compactActuel = compact;
    var sts = styles();
    var many = data.x.length > 60;
    var series = [{ label: "Cycle" }];
    var columns = [data.x];
    data.series.forEach(function (s, i) {
      var st = sts[i];
      series.push({
        label: s.name,
        spanGaps: true,
        stroke: st.stroke,
        width: st.width,
        dash: st.dash || undefined,
        show: st.visible && !masques[s.id],
        points: { show: !many, size: st.focused || st.isLlm ? 7 : 5, width: 1.5, stroke: st.stroke, fill: css("--surface") }
      });
      columns.push(s.values);
    });
    var axisStroke = css("--muted");
    var grid = { stroke: css("--grid"), width: 1 };
    var font = "12px " + css("--sans");
    var opts = {
      width: width,
      height: compact ? 280 : 320,
      series: series,
      legend: { show: false },
      padding: [12, compact ? 112 : 190, 0, 0],
      cursor: { drag: { x: false, y: false }, points: { size: 9 } },
      scales: {
        x: { time: false },
        y: { range: function (u, min, max) {
          // Bornes collées aux données, 0 % toujours visible, amplitude minimale de 0,4 point.
          if (min == null || max == null) return [99.6, 100.4];
          var lo = Math.min(min, 100), hi = Math.max(max, 100);
          if (hi - lo < 0.4) { var mid = (hi + lo) / 2; lo = Math.min(lo, mid - 0.2); hi = Math.max(hi, mid + 0.2); }
          var pad = (hi - lo) * 0.1;
          return [lo - pad, hi + pad];
        } }
      },
      axes: [
        { stroke: axisStroke, grid: grid, ticks: { stroke: css("--grid"), size: 4 }, font: font, gap: 6, size: 46,
          splits: splits,
          values: function (u, vals) {
            var prevDay = null;
            return vals.map(function (v) {
              if (v === data.x[0] && KINDS[0] === "depart") { return "départ"; }
              var d = new Date(v * 1000);
              var day = jour(d);
              var label = day === prevDay ? heure(d) : heure(d) + "\n" + day;
              prevDay = day;
              return label;
            });
          } },
        { stroke: axisStroke, grid: grid, ticks: { show: false }, size: 58, font: font,
          values: function (u, vals) { return vals.map(function (v) { return ecart(v, 1); }); } }
      ],
      hooks: {
        drawAxes: [function (u) {
          // Ligne du départ (0 %), sous les courbes.
          var r = uPlot.pxRatio;
          var y = Math.round(u.valToPos(100, "y", true)) + 0.5;
          var ctx = u.ctx;
          ctx.save();
          ctx.strokeStyle = css("--muted");
          ctx.lineWidth = 1 * r;
          ctx.setLineDash([4 * r, 4 * r]);
          ctx.beginPath();
          ctx.moveTo(u.bbox.left, y);
          ctx.lineTo(u.bbox.left + u.bbox.width, y);
          ctx.stroke();
          ctx.restore();
        }],
        draw: [etiquettes],
        setCursor: [function (u) { afficherValeurs(u.cursor.idx); }]
      }
    };
    plot = new uPlot(opts, columns, host);
    afficherValeurs(LAST);
  }

  brancherLegende();
  build();
  var timer = null;
  function onResize() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var w = host.clientWidth;
      if (!plot || !w) return;
      if ((w < 520) !== compactActuel) build();
      else plot.setSize({ width: w, height: w < 520 ? 280 : 320 });
    }, 120);
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(onResize).observe(host.parentNode);
  else window.addEventListener("resize", onResize);
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", build);
  }
})();
