// onix-popup.js
// Modal overlay that lists every code we know for a given ONIX code list,
// with the active code highlighted and a link to the canonical EDItEUR
// definition. Triggered by clicks on the "List N" badges in either pane.
//
// Public API:
//   window.OnixViewerPopup.show(codelistKey, currentValue?)
//
// Lifecycle: a single overlay node is mounted lazily on first show() and
// reused across opens. Esc, the close button, or a click on the backdrop
// close it.

(function () {
  "use strict";

  let overlay = null;
  let dialog = null;
  let lastFocus = null;
  let escListener = null;

  function show(codelistKey, currentValue) {
    if (!window.OnixViewerOnix || !window.OnixViewerCodeLists) return;
    const meta = window.OnixViewerOnix.codelistMeta(codelistKey);
    const entries = window.OnixViewerCodeLists[codelistKey];
    if (!meta || !entries) return;

    ensureMounted();
    populate(meta, entries, currentValue);
    open();
  }

  function ensureMounted() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "px-popup-overlay";
    overlay.setAttribute("hidden", "");
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close();
    });

    dialog = document.createElement("div");
    dialog.className = "px-popup";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "px-popup-title");
    overlay.appendChild(dialog);

    document.body.appendChild(overlay);
  }

  function populate(meta, entries, currentValue) {
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);

    // Header — list name / title / close
    const header = document.createElement("header");
    header.className = "px-popup-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "px-popup-title-wrap";

    const eyebrow = document.createElement("div");
    eyebrow.className = "px-popup-eyebrow";
    eyebrow.textContent = `${meta.listName} · ${meta.key}`;
    titleWrap.appendChild(eyebrow);

    const title = document.createElement("h2");
    title.id = "px-popup-title";
    title.className = "px-popup-title";
    title.textContent = meta.title || meta.listName;
    titleWrap.appendChild(title);

    header.appendChild(titleWrap);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "px-popup-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);
    header.appendChild(closeBtn);

    dialog.appendChild(header);

    // Body — definition list of codes
    const body = document.createElement("div");
    body.className = "px-popup-body";

    const dl = document.createElement("dl");
    dl.className = "px-popup-list";
    // entries is a Map<code, label> declared in EDItEUR order. Map iteration
    // preserves insertion order, unlike Object.keys (which would reorder
    // canonical-numeric string keys ahead of zero-padded ones).
    let highlighted = null;
    let count = 0;
    for (const [code, label] of entries) {
      count++;
      // HTML5 allows wrapping each <dt>/<dd> pair in a <div>, which is the
      // ergonomic way to apply zebra striping and current-row highlighting.
      const row = document.createElement("div");
      row.className = "px-popup-row";
      if (currentValue && code === currentValue) {
        row.classList.add("px-popup-row-current");
        if (!highlighted) highlighted = row;
      }
      const dt = document.createElement("dt");
      dt.className = "px-popup-code";
      dt.textContent = code;
      const dd = document.createElement("dd");
      dd.className = "px-popup-label";
      dd.textContent = label;
      row.append(dt, dd);
      dl.appendChild(row);
    }
    body.appendChild(dl);

    if (currentValue && !highlighted) {
      // The doc has a code outside our curated subset. Surface that, so the
      // user knows the popup isn't lying about coverage.
      const note = document.createElement("p");
      note.className = "px-popup-note";
      note.textContent =
        `Code "${currentValue}" isn't in the bundled subset for this list. ` +
        `Open on EDItEUR for the canonical, complete definition.`;
      body.appendChild(note);
    } else if (count < 20) {
      // Be honest about the curated nature.
      const note = document.createElement("p");
      note.className = "px-popup-note";
      note.textContent =
        "Curated subset (most common codes only). The EDItEUR page below is canonical.";
      body.appendChild(note);
    }

    dialog.appendChild(body);

    // Footer — EDItEUR link
    const footer = document.createElement("footer");
    footer.className = "px-popup-footer";
    const link = document.createElement("a");
    link.className = "px-popup-link";
    link.href = meta.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `Open ${meta.listName} on EDItEUR`;
    if (window.OnixViewerOnix && window.OnixViewerOnix.externalLinkIcon) {
      link.appendChild(window.OnixViewerOnix.externalLinkIcon());
    }
    footer.appendChild(link);
    dialog.appendChild(footer);

    // Scroll the highlighted row into view if any. requestAnimationFrame
    // isn't available in jsdom (where tests run); fall back to setTimeout.
    if (highlighted && typeof highlighted.scrollIntoView === "function") {
      const schedule = (typeof requestAnimationFrame === "function")
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 0);
      schedule(() => highlighted.scrollIntoView({ block: "center" }));
    }
  }

  function open() {
    lastFocus = document.activeElement;
    overlay.removeAttribute("hidden");
    document.body.classList.add("px-popup-open");
    escListener = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", escListener);
    const close_ = dialog.querySelector(".px-popup-close");
    if (close_) close_.focus();
  }

  function close() {
    if (!overlay || overlay.hasAttribute("hidden")) return;
    overlay.setAttribute("hidden", "");
    document.body.classList.remove("px-popup-open");
    if (escListener) {
      document.removeEventListener("keydown", escListener);
      escListener = null;
    }
    if (lastFocus && typeof lastFocus.focus === "function") {
      try { lastFocus.focus(); } catch (_) {}
    }
  }

  window.OnixViewerPopup = { show, close };
})();
