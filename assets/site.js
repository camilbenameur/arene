/* Fraîcheur du dashboard : la page est statique, ce script compare l'heure du prochain cycle à l'heure du lecteur.
   Sans JavaScript, la date absolue reste affichée. */
(function () {
  "use strict";
  var t = document.querySelector("[data-prochain]");
  var detail = document.querySelector("[data-fraicheur]");
  if (!t || !detail) return;
  var prochain = Number(t.getAttribute("data-prochain"));
  var intervalle = Number(t.getAttribute("data-intervalle")) || 14400;
  var original = detail.textContent;

  function duree(s) {
    if (s < 60) return "moins d\u2019une minute";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), r = m % 60;
    return h + " h" + (r ? " " + (r < 10 ? "0" : "") + r : "");
  }

  // Heure locale du lecteur à côté de l'heure UTC (la page est générée en UTC).
  var locale = "";
  try {
    var d = new Date(prochain * 1000);
    var mm = d.getMinutes();
    locale = (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (mm < 10 ? "0" : "") + mm + " heure locale";
  } catch (err) { /* l'heure UTC suffit */ }

  // Le texte remplace un emplacement déjà réservé (une ligne) : aucun décalage de mise en page.
  function maj() {
    var now = Date.now() / 1000;
    var ecart = prochain - now;
    var parts = [];
    detail.classList.remove("warn-txt", "perte-txt");
    if (ecart > 0) {
      parts.push("dans " + duree(ecart));
    } else if (-ecart < 3600) {
      // Le minuteur tourne à HH:05 et la page est reconstruite à la fin du cycle.
      parts.push("en cours ou imminent");
    } else {
      var manques = Math.floor(-ecart / intervalle) + 1;
      parts.push("en retard de " + duree(-ecart) + " : " + manques + " cycle" + (manques > 1 ? "s" : "") +
        " sans mise à jour de cette page");
      detail.classList.add(-ecart > intervalle ? "perte-txt" : "warn-txt");
    }
    if (locale) parts.push(locale);
    if (original) parts.push(original);
    detail.textContent = parts.join(" · ");
  }

  maj();
  setInterval(maj, 60000);
})();
