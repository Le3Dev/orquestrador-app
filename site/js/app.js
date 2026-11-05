/* ==========================================================================
   Orquestrador de Agentes — JS da landing (vanilla, progressivo)
   Nada essencial depende daqui: o site funciona com JS desligado.
   ========================================================================== */

(function () {
  "use strict";

  // 1) Ano atual no rodapé.
  var anos = document.querySelectorAll("[data-ano]");
  var ano = String(new Date().getFullYear());
  for (var i = 0; i < anos.length; i++) {
    anos[i].textContent = ano;
  }

  // 2) Rolagem suave para âncoras internas (reforça o scroll-behavior do CSS).
  document.addEventListener("click", function (ev) {
    var alvo = ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
    if (!alvo) return;
    var id = alvo.getAttribute("href");
    if (!id || id === "#") return;
    var destino = document.querySelector(id);
    if (!destino) return;
    ev.preventDefault();
    destino.scrollIntoView({ behavior: "smooth", block: "start" });
    // Atualiza a URL sem recarregar.
    if (history.pushState) history.pushState(null, "", id);
  });

  // 3) Abrir o checkout.
  //    Se você configurar o Lemon Squeezy Overlay (lemon.js), este código abre
  //    o checkout em modal. Sem o overlay, os links <a data-checkout> já levam
  //    direto à URL de checkout normalmente — nada quebra.
  var temOverlay = typeof window.LemonSqueezy !== "undefined";
  if (temOverlay && window.LemonSqueezy.Setup) {
    try { window.LemonSqueezy.Setup({ eventHandler: function () {} }); } catch (e) {}
    var botoes = document.querySelectorAll("[data-checkout]");
    for (var j = 0; j < botoes.length; j++) {
      botoes[j].addEventListener("click", function (ev) {
        var url = this.getAttribute("href") || "";
        // Só intercepta URLs já configuradas (não o placeholder).
        if (url.indexOf("SEU-STORE") !== -1) return;
        ev.preventDefault();
        if (window.LemonSqueezy.Url && window.LemonSqueezy.Url.Open) {
          window.LemonSqueezy.Url.Open(url);
        } else {
          window.location.href = url;
        }
      });
    }
  }
})();
