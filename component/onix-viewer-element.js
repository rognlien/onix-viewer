// onix-viewer-element.js — the <onix-viewer> element.
//
// The extension's viewer as a custom element, for any HTML page:
//
//   <script src="component/onix-viewer-element.js"></script>
//   <onix-viewer src="feed.xml"></onix-viewer>
//
// or, with the XML already in hand, `element.xml = text`. The element loads
// the viewer's scripts from the Resources/ folder beside its own (the
// `resources` attribute points elsewhere), once per page, and renders into
// its own shadow root, so the page's styles and the viewer's never meet and
// any number of viewers can share a page. Each validation pass that
// finishes is announced as an `onix-validated` event.

(function () {
  "use strict";

  // In the order content.js injects them: the data, then the modules that
  // read it, then the viewer. Thema and both content models come along
  // unconditionally — the element cannot know beforehand what it will show.
  const SCRIPTS = [
    "versions.js",
    "onix-codelists.js",
    "onix-thema.js",
    "onix-content-model-3.0.js",
    "onix-content-model-3.1.js",
    "onix.js",
    "onix-validate.js",
    "onix-popup.js",
    "shell.js",
    "viewer.js",
  ];

  // Beside this script, or beside the page when it was not loaded by a
  // <script src> of its own.
  const DEFAULT_RESOURCES = new URL("../Resources/", (document.currentScript && document.currentScript.src) || document.baseURI).href;

  let loading = null;

  // Once per page, whichever element asks first. The scripts publish their
  // globals on window, so a second set would only overwrite the first.
  function loadScripts(base) {
    if (!loading) {
      loading = window.OnixViewerView ? Promise.resolve() : Promise.all(SCRIPTS.map((name) => loadScript(new URL(name, base).href)));
    }
    return loading;
  }

  // async = false runs them in insertion order while they download in
  // parallel.
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.addEventListener("load", resolve);
      script.addEventListener("error", () => reject(new Error(`Could not load ${url}`)));
      document.head.appendChild(script);
    });
  }

  // The last segment of a URL's path, which the viewer offers as the name of
  // a download.
  function fileNameOf(url) {
    return new URL(url, document.baseURI).pathname.split("/").pop();
  }

  class OnixViewerElement extends HTMLElement {
    static get observedAttributes() {
      return ["src"];
    }

    #xml = null;
    #fileName = "";
    #viewer = null;
    #stylesheet = null;
    #styled = false;
    #ticket = 0;

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    get xml() {
      return this.#xml;
    }

    set xml(text) {
      this.#xml = String(text);
      this.#fileName = "";
      this.#render();
    }

    get src() {
      return this.getAttribute("src") || "";
    }

    set src(url) {
      this.setAttribute("src", url);
    }

    connectedCallback() {
      if (this.#xml === null && this.src) this.#load(this.src);
      else this.#render();
    }

    disconnectedCallback() {
      this.#unmount();
    }

    attributeChangedCallback(name, previous, value) {
      if (this.isConnected && value && value !== previous) this.#load(value);
    }

    #resources() {
      return new URL(this.getAttribute("resources") || DEFAULT_RESOURCES, document.baseURI).href;
    }

    async #load(url) {
      const ticket = ++this.#ticket;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const text = await response.text();
        if (ticket !== this.#ticket) return;
        this.#xml = text;
        this.#fileName = fileNameOf(url);
        this.#render();
      } catch (error) {
        if (ticket === this.#ticket) this.#showNotice("Could not load the document", `${url}: ${error.message}`);
      }
    }

    // Each render starts from a fresh shell: the viewer renders once into
    // the markup it is given, so a new document gets new markup.
    async #render() {
      const ticket = ++this.#ticket;
      if (!this.isConnected || this.#xml === null) return;
      const resources = this.#resources();
      this.#ensureStylesheet(new URL("viewer.css", resources).href);
      try {
        await loadScripts(resources);
      } catch (error) {
        if (ticket === this.#ticket) this.#showNotice("Could not load ONIX Viewer", error.message);
        return;
      }
      if (ticket !== this.#ticket) return;
      this.#unmount();
      const frame = this.#freshFrame();
      frame.append(...this.#shell(resources));
      this.#viewer = window.OnixViewerView.mount({
        scope: this.shadowRoot,
        frame,
        keys: this,
        source: this.#xml,
        fileName: this.#fileName,
        onValidated: (result) => this.#announce(result),
      });
    }

    // The frame stays hidden until the stylesheet has loaded: an unstyled
    // tree flashes, and the lazy Products would measure the wrong layout. A
    // hidden frame intersects nothing, so they wait for the real one.
    #ensureStylesheet(href) {
      if (this.#stylesheet && this.#stylesheet.href === href) return;
      if (this.#stylesheet) this.#stylesheet.remove();
      this.#styled = false;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      const reveal = () => {
        this.#styled = true;
        const frame = this.shadowRoot.querySelector(".px-frame");
        if (frame) frame.hidden = false;
      };
      link.addEventListener("load", reveal);
      link.addEventListener("error", reveal);
      this.shadowRoot.prepend(link);
      this.#stylesheet = link;
    }

    #freshFrame() {
      for (const child of [...this.shadowRoot.children]) {
        if (child !== this.#stylesheet) child.remove();
      }
      const frame = document.createElement("div");
      frame.className = "px-frame";
      frame.hidden = !this.#styled;
      this.shadowRoot.appendChild(frame);
      return frame;
    }

    // The same toolbar and tree the extension's page carries, from the same
    // template, parsed rather than assigned as markup.
    #shell(resources) {
      const markup = window.OnixViewerShell.viewer({
        logoURL: new URL("icons/icon-28.png", resources).href,
        logoURL2x: new URL("icons/icon-56.png", resources).href,
      });
      const parsed = new DOMParser().parseFromString(`<!doctype html><body>${markup}`, "text/html");
      return [...parsed.body.childNodes];
    }

    #unmount() {
      if (this.#viewer) this.#viewer.destroy();
      this.#viewer = null;
    }

    #showNotice(heading, text) {
      this.#unmount();
      const frame = this.#freshFrame();
      const box = document.createElement("div");
      box.className = "px-error";
      box.setAttribute("role", "alert");
      const title = document.createElement("h2");
      title.textContent = heading;
      const detail = document.createElement("p");
      detail.textContent = text;
      box.append(title, detail);
      frame.appendChild(box);
    }

    #announce(result) {
      const validation = window.OnixViewerValidation;
      const findings = result.findings.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        message: validation.message(finding),
        element: finding.node || null,
      }));
      this.dispatchEvent(new CustomEvent("onix-validated", {
        detail: {
          version: result.version,
          errors: result.errors,
          warnings: result.warnings,
          total: result.total,
          truncated: result.truncated,
          findings,
        },
      }));
    }
  }

  if (!customElements.get("onix-viewer")) customElements.define("onix-viewer", OnixViewerElement);
})();
