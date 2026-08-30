/* ==========================================================================
   MeLi Connect — capa de interfaz compartida
   1. Inyecta el juego de iconos SVG (reemplaza los emojis del sistema).
   2. Aparicion de bloques al hacer scroll.
   3. Degradado del hero que sigue al cursor.
   Script clasico + IIFE: funciona en cualquier hosting y sin build.
   v20260825
   ========================================================================== */
(function () {
  "use strict";

  function safe(fn, name) {
    try { fn(); } catch (e) {
      if (window.console && console.warn) console.warn("[mc-ui] " + name + ":", e);
    }
  }

  /* ---------------------------------------------------------------------
     1. Juego de iconos — trazo de 24x24, hereda el color del texto
     --------------------------------------------------------------------- */
  var ICONS = {
    "i-link":    '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 12.6 5a4.6 4.6 0 0 1 6.5 6.5L17.5 13"/><path d="M13 17.5 11.4 19a4.6 4.6 0 0 1-6.5-6.5L6.5 11"/>',
    "i-home":    '<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.6V19a1 1 0 0 0 1 1h3.5v-4.5h3V20H17a1 1 0 0 0 1-1V9.6"/>',
    "i-box":     '<path d="M12 3.6 20 8v8l-8 4.4L4 16V8z"/><path d="M4 8l8 4.4L20 8"/><path d="M12 12.4V20.4"/><path d="M8 5.8l8 4.4"/>',
    "i-cart":    '<path d="M3 4h2.2l2.3 10.4a1.6 1.6 0 0 0 1.6 1.3h7.8a1.6 1.6 0 0 0 1.6-1.2L20 8H6"/><circle cx="9.5" cy="19.3" r="1.4"/><circle cx="17" cy="19.3" r="1.4"/>',
    "i-target":  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" class="ic-solid"/>',
    "i-brain":   '<path d="M12 5.2a2.8 2.8 0 0 0-5 1.5A2.6 2.6 0 0 0 5.6 11a2.7 2.7 0 0 0 .7 4.4A2.7 2.7 0 0 0 12 18.4z"/><path d="M12 5.2a2.8 2.8 0 0 1 5 1.5A2.6 2.6 0 0 1 18.4 11a2.7 2.7 0 0 1-.7 4.4A2.7 2.7 0 0 1 12 18.4z"/><path d="M12 5.2v13.2"/>',
    "i-calc":    '<rect x="5" y="3" width="14" height="18" rx="2.2"/><rect x="8" y="6.4" width="8" height="3.2" rx="1"/><path d="M8.6 13.4h.01M12 13.4h.01M15.4 13.4h.01M8.6 17h.01M12 17h.01M15.4 17h.01"/>',
    "i-cap":     '<path d="M2.8 8.6 12 4.4l9.2 4.2L12 12.8z"/><path d="M6.6 10.6v4.6c0 1.7 2.4 3 5.4 3s5.4-1.3 5.4-3v-4.6"/><path d="M21.2 8.6v5.6"/>',
    "i-chart":   '<path d="M4 19.4h16"/><rect x="5.6" y="12" width="3.2" height="5.6" rx="1"/><rect x="10.4" y="8" width="3.2" height="9.6" rx="1"/><rect x="15.2" y="4.6" width="3.2" height="13" rx="1"/>',
    "i-search":  '<circle cx="10.8" cy="10.8" r="6.2"/><path d="M15.4 15.4 20 20"/>',
    "i-truck":   '<path d="M3 6.6h10.4v9.8H3z"/><path d="M13.4 9.6h3.6l3 3.2v3.6h-6.6z"/><circle cx="7" cy="18" r="1.8"/><circle cx="16.8" cy="18" r="1.8"/>',
    "i-crown":   '<path d="M3.4 7.6 7 12l5-6.6 5 6.6 3.6-4.4-1.4 10.6H4.8z"/><path d="M4.8 19.4h14.4"/>',
    "i-rocket":  '<path d="M13.6 4.4c3.2-1 6 1.8 5 5-.7 2.4-2.6 4.6-5.2 6.2l-2.9.9-3-3 .9-2.9c1.6-2.6 3.8-4.5 6.2-5.2"/><circle cx="14.6" cy="9.4" r="1.5"/><path d="M8.4 15.6c-1.4.5-2.3 1.8-2.6 4 2.2-.3 3.5-1.2 4-2.6"/>',
    "i-chat":    '<path d="M20 12.4c0 3.8-3.6 6.8-8 6.8a9.6 9.6 0 0 1-2.6-.35L5 20.4l1.2-3.2A6.4 6.4 0 0 1 4 12.4c0-3.8 3.6-6.8 8-6.8s8 3 8 6.8z"/>',
    "i-menu":    '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "i-warn":    '<path d="M12 4.4 21 19.6H3z"/><path d="M12 10v4.2"/><path d="M12 17.2h.01"/>',
    "i-check":   '<path d="M5 12.8 9.6 17.4 19 7.6"/>',
    "i-x":       '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>',
    "i-star":    '<path d="m12 4 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7.9-5.6-4-3.9 5.6-.8z"/>',
    "i-money":   '<circle cx="12" cy="12" r="8"/><path d="M12 7.4v9.2"/><path d="M14.6 9.6a2.6 2.6 0 0 0-2.6-1.4c-1.5 0-2.6.9-2.6 2.1s1 1.8 2.6 2.1 2.7.9 2.7 2.1-1.2 2.1-2.7 2.1a2.7 2.7 0 0 1-2.7-1.5"/>',
    "i-eye":     '<path d="M2.6 12S6 6.4 12 6.4 21.4 12 21.4 12 18 17.6 12 17.6 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.6"/>',
    "i-trend":   '<path d="M4 16.6 9.4 11l3.4 3.2L20 7"/><path d="M15.6 7H20v4.4"/>',
    "i-bulb":    '<path d="M9.4 17.4a5.6 5.6 0 1 1 5.2 0v1.8H9.4z"/><path d="M10 21.2h4"/>',
    "i-scale":   '<path d="M12 4.4v15.2"/><path d="M7 19.6h10"/><path d="M4.6 8.2h14.8"/><path d="M4.6 8.2 2.4 13a2.6 2.6 0 0 0 4.4 0z"/><path d="M19.4 8.2 17.2 13a2.6 2.6 0 0 0 4.4 0z"/>',
    "i-info":    '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><path d="M12 8.2h.01"/>',
    "i-fire":    '<path d="M12 3.4c3.4 3.2 5.6 5.8 5.6 9a5.6 5.6 0 0 1-11.2 0c0-1.6.6-3 1.7-4.3.5 1 1.2 1.6 2 1.9-.4-2.6.2-4.7 1.9-6.6z"/>',
    "i-gear":    '<circle cx="12" cy="12" r="3"/><path d="M19 13.6v-3.2l-2-.5a5.6 5.6 0 0 0-.7-1.7l1.1-1.7-2.3-2.3-1.7 1.1a5.6 5.6 0 0 0-1.7-.7l-.5-2h-3.2l-.5 2a5.6 5.6 0 0 0-1.7.7L4.1 4.2 1.8 6.5l1.1 1.7a5.6 5.6 0 0 0-.7 1.7l-2 .5v3.2l2 .5c.15.6.4 1.2.7 1.7l-1.1 1.7 2.3 2.3 1.7-1.1c.5.3 1.1.55 1.7.7l.5 2h3.2l.5-2c.6-.15 1.2-.4 1.7-.7l1.7 1.1 2.3-2.3-1.1-1.7c.3-.5.55-1.1.7-1.7z" transform="translate(2.2 2.2) scale(0.82)"/>',
    "i-key":     '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H21"/><path d="M17.6 12v3.2"/><path d="M20 12v2.2"/>',
    "i-down":    '<path d="M12 4.4v12.2"/><path d="M7.4 12.2 12 16.8l4.6-4.6"/><path d="M5 19.6h14"/>',
    "i-store":   '<path d="M4 9.6h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4.6 4.4h14.8L21 9.6H3z"/><path d="M9.6 20v-5.4h4.8V20"/>',
    "i-phone":   '<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M10.8 17.6h2.4"/>',
    "i-dot":     '<circle cx="12" cy="12" r="4" class="ic-solid"/>',
    "i-camera":  '<path d="M3.4 8.6h3.4l1.5-2.4h7.4l1.5 2.4h3.4v10a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1z"/><circle cx="12" cy="13.4" r="3.5"/>',
    "i-print":   '<path d="M7 8.4V3.6h10v4.8"/><path d="M7 17.6H5a1.6 1.6 0 0 1-1.6-1.6v-4.4A1.6 1.6 0 0 1 5 10h14a1.6 1.6 0 0 1 1.6 1.6V16a1.6 1.6 0 0 1-1.6 1.6h-2"/><rect x="7" y="14.4" width="10" height="6" rx="1"/>',
    "i-plus":    '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
    "i-refresh": '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 4.6v4.6h-4.6"/>',
    "i-drop":    '<path d="M12 3.6c3.4 4 5.4 6.6 5.4 9.2A5.4 5.4 0 0 1 6.6 12.8c0-2.6 2-5.2 5.4-9.2z"/>',
    "i-build":   '<path d="M4 20.4V6.2a1 1 0 0 1 1-1h7v15.2"/><path d="M12 10.2h6.8a1 1 0 0 1 1 1v9.2"/><path d="M7 8.8h2M7 12h2M7 15.2h2M15 13.4h2M15 16.6h2"/><path d="M2.6 20.4h18.8"/>',
    "i-lock":    '<rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.2"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/><path d="M12 14.2v2.2"/>',
    "i-shield":  '<path d="M12 3.6 19.4 6v6c0 4-3 6.8-7.4 8.4C7.6 18.8 4.6 16 4.6 12V6z"/><path d="M9 12.2l2.2 2.2 4-4.2"/>'
  };

  function injectSprite() {
    if (document.getElementById("mc-sprite")) return;
    var parts = [];
    for (var k in ICONS) {
      if (Object.prototype.hasOwnProperty.call(ICONS, k)) {
        parts.push('<symbol id="' + k + '" viewBox="0 0 24 24">' + ICONS[k] + "</symbol>");
      }
    }
    var host = document.createElement("div");
    host.id = "mc-sprite";
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    host.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">' + parts.join("") + "</svg>";
    (document.body || document.documentElement).insertBefore(
      host,
      (document.body || document.documentElement).firstChild
    );
  }

  /* ---------------------------------------------------------------------
     2. Aparicion al hacer scroll
        Umbral bajo + red de seguridad: si algo falla, se ve igual.
     --------------------------------------------------------------------- */
  function initReveal() {
    var nodes = document.querySelectorAll(".mc-reveal");
    if (!nodes.length) return;

    var reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    if (reduced || !("IntersectionObserver" in window)) {
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("is-in");
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -6% 0px" }
    );
    for (var j = 0; j < nodes.length; j++) io.observe(nodes[j]);

    // Si en 2.5s algo quedo invisible, se muestra igual.
    setTimeout(function () {
      var pend = document.querySelectorAll(".mc-reveal:not(.is-in)");
      for (var k = 0; k < pend.length; k++) pend[k].classList.add("is-in");
    }, 2500);
  }

  /* ---------------------------------------------------------------------
     3. Degradado del hero siguiendo el cursor
     --------------------------------------------------------------------- */
  function initHeroGradient() {
    var heroes = document.querySelectorAll(".mc-hero, .hub-hero");
    if (!heroes.length) return;
    var reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    if (reduced) return;
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;

    var raf = null;
    function move(ev) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        for (var i = 0; i < heroes.length; i++) {
          var r = heroes[i].getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          var x = ((ev.clientX - r.left) / r.width) * 100;
          var y = ((ev.clientY - r.top) / r.height) * 100;
          heroes[i].style.setProperty("--mx", Math.max(-20, Math.min(120, x)) + "%");
          heroes[i].style.setProperty("--my", Math.max(-40, Math.min(140, y)) + "%");
        }
      });
    }
    window.addEventListener("mousemove", move, { passive: true });
  }

  /* ---------------------------------------------------------------------
     4. Command palette (Ctrl+K / Cmd+K) - una sola fuente de verdad
        para saltar a cualquier herramienta desde cualquier pagina.
     --------------------------------------------------------------------- */
  var COMMANDS = [
    { label: "Inicio", desc: "Volver a la landing", icon: "i-home", href: "/index.html#menu" },
    { label: "Buscador de oportunidades", desc: "Qué conviene importar según tu perfil", icon: "i-target", href: "/index.html#market" },
    { label: "Recomendador por perfil", desc: "Qué traer según tu capital y experiencia", icon: "i-brain", href: "/index.html#productfinder" },
    { label: "Calculador de margen", desc: "Cuánto vas a ganar de verdad", icon: "i-calc", href: "/margen.html" },
    { label: "Conectar cuenta de MercadoLibre", desc: "Vinculá tu cuenta", icon: "i-link", href: "/meli-connect.html" },
    { label: "Dashboard de ventas", desc: "Órdenes, comisiones y ganancia neta", icon: "i-chart", href: "/dashboard.html" },
    { label: "Analizador de publicaciones", desc: "Qué mejorar en tu publicación", icon: "i-search", href: "/analizador.html" },
    { label: "Flex vs Full", desc: "Qué envío te conviene", icon: "i-truck", href: "/calculadora-envios.html" },
    { label: "Aprendé a publicar", desc: "Guía para arrancar a vender", icon: "i-cap", href: "/educacion.html" },
    { label: "Asesoría de importación (WhatsApp)", desc: "Hablar 1 a 1 sobre tu importación", icon: "i-chat", href: "https://wa.me/541160374306" }
  ];

  function ensurePaletteMarkup() {
    if (document.getElementById("cmdkOverlay")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<div class="cmdk-overlay" id="cmdkOverlay" hidden>' +
        '<div class="cmdk-modal" role="dialog" aria-modal="true" aria-label="Buscar herramienta">' +
          '<div class="cmdk-inputrow">' +
            '<svg class="ic" aria-hidden="true"><use href="#i-search"></use></svg>' +
            '<label for="cmdkInput" class="sr-only">Buscar herramienta</label>' +
            '<input type="text" id="cmdkInput" class="cmdk-input" placeholder="Buscar herramienta o acción..." autocomplete="off" aria-autocomplete="list" aria-controls="cmdkList" role="combobox" aria-expanded="true">' +
            '<kbd class="cmdk-esc">Esc</kbd>' +
          '</div>' +
          '<ul class="cmdk-list" id="cmdkList" role="listbox" aria-label="Resultados"></ul>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap.firstChild);
  }

  function ensurePaletteButton() {
    if (document.querySelector(".mc-palette-btn")) return;
    var right = document.querySelector(".mc-nav .mc-right");
    if (!right) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mc-palette-btn";
    btn.setAttribute("aria-label", "Buscar herramienta (Ctrl+K)");
    btn.title = "Buscar herramienta (Ctrl+K)";
    btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-search"></use></svg>';
    btn.addEventListener("click", openPalette);
    right.insertBefore(btn, right.firstChild);
  }

  var paletteActiveIndex = 0;
  var paletteItems = COMMANDS;
  var paletteLastFocus = null;

  function renderPaletteList(items) {
    var list = document.getElementById("cmdkList");
    if (!list) return;
    paletteItems = items;
    paletteActiveIndex = items.length ? 0 : -1;
    if (!items.length) {
      list.innerHTML = '<li class="cmdk-empty">Sin resultados. Probá con otra palabra.</li>';
      return;
    }
    list.innerHTML = items
      .map(function (it, i) {
        return (
          '<li class="cmdk-item' + (i === 0 ? " is-active" : "") + '" role="option" id="cmdk-item-' + i + '" data-href="' + it.href + '">' +
          '<svg class="ic" aria-hidden="true"><use href="#' + it.icon + '"></use></svg>' +
          "<span><b>" + it.label + "</b><span>" + it.desc + "</span></span>" +
          "</li>"
        );
      })
      .join("");
    Array.prototype.forEach.call(list.querySelectorAll(".cmdk-item"), function (li) {
      li.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
        goTo(li.getAttribute("data-href"));
      });
    });
  }

  function filterPalette(q) {
    q = (q || "").toLowerCase().trim();
    if (!q) return COMMANDS;
    return COMMANDS.filter(function (it) {
      return (it.label + " " + it.desc).toLowerCase().indexOf(q) > -1;
    });
  }

  function goTo(href) {
    if (!href) return;
    closePalette();
    if (/^https?:\/\//.test(href)) {
      window.open(href, "_blank", "noopener");
    } else {
      window.location.href = href;
    }
  }

  function moveActive(delta) {
    var list = document.getElementById("cmdkList");
    if (!list) return;
    var items = Array.prototype.slice.call(list.querySelectorAll(".cmdk-item"));
    if (!items.length) return;
    items[paletteActiveIndex] && items[paletteActiveIndex].classList.remove("is-active");
    paletteActiveIndex = (paletteActiveIndex + delta + items.length) % items.length;
    items[paletteActiveIndex].classList.add("is-active");
    items[paletteActiveIndex].scrollIntoView({ block: "nearest" });
  }

  function openPalette() {
    ensurePaletteMarkup();
    var overlay = document.getElementById("cmdkOverlay");
    var input = document.getElementById("cmdkInput");
    if (!overlay || !input) return;
    paletteLastFocus = document.activeElement;
    overlay.hidden = false;
    input.value = "";
    renderPaletteList(COMMANDS);
    input.focus();
  }
  window.openPalette = openPalette;

  function closePalette() {
    var overlay = document.getElementById("cmdkOverlay");
    if (overlay) overlay.hidden = true;
    if (paletteLastFocus && paletteLastFocus.focus) {
      try { paletteLastFocus.focus(); } catch (e) {}
    }
  }
  window.closePalette = closePalette;

  function initPalette() {
    ensurePaletteMarkup();
    safe(ensurePaletteButton, "boton-palette");
    document.addEventListener("keydown", function (ev) {
      var overlay = document.getElementById("cmdkOverlay");
      var isOpen = overlay && !overlay.hidden;
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === "k" || ev.key === "K")) {
        ev.preventDefault();
        isOpen ? closePalette() : openPalette();
        return;
      }
      if (!isOpen) return;
      if (ev.key === "Escape") { ev.preventDefault(); closePalette(); }
      else if (ev.key === "ArrowDown") { ev.preventDefault(); moveActive(1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); moveActive(-1); }
      else if (ev.key === "Enter") {
        ev.preventDefault();
        var active = document.querySelector(".cmdk-item.is-active");
        if (active) goTo(active.getAttribute("data-href"));
      } else if (ev.key === "Tab") {
        // Foco atrapado dentro del modal (unico elemento enfocable: el input)
        ev.preventDefault();
        document.getElementById("cmdkInput").focus();
      }
    });
    document.addEventListener("input", function (ev) {
      if (ev.target && ev.target.id === "cmdkInput") renderPaletteList(filterPalette(ev.target.value));
    });
    document.addEventListener("mousedown", function (ev) {
      var overlay = document.getElementById("cmdkOverlay");
      if (overlay && !overlay.hidden && ev.target === overlay) closePalette();
    });
  }

  /* ---------------------------------------------------------------------
     Arranque
     --------------------------------------------------------------------- */
  function boot() {
    safe(injectSprite, "iconos");
    safe(initReveal, "aparicion");
    safe(initHeroGradient, "hero");
    safe(initPalette, "command-palette");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
