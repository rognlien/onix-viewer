// runtime.js — the entry point of the standalone bundle.
//
// tools/build-standalone.js embeds this file after the viewer sources and
// calls createStandalone once, with what the bundle holds: `start`, the
// wrapped Resources/viewer.js (not yet run), and `css`, Resources/viewer.css
// as a string. The shell and the data files have run by then. The factory
// returns the one function the bundle publishes, as OnixViewerStandalone.
//
// Where the extension takes over a raw XML page, this renders into an
// ordinary HTML document the caller owns. The caller loads and decodes the
// XML and hands over the text; nothing here fetches, stores or validates.

/* exported createStandalone */
function createStandalone(viewer) {
  "use strict";

  const { start, css } = viewer;

  let opened = false;

  // What the extension's shell has that a page embedding the viewer does not
  // want: the About door, the download, dialect and release controls, the
  // rules editor and the validation pill (the bundle ships no validator),
  // and the stylesheet link (the style goes in as a <style> below).
  const REMOVED = [
    ".px-logo-btn", '[data-action="download-xml"]', ".px-dialect-group",
    "#oxv-release-group", '[data-action="rules"]', "#oxv-validation",
    "link[rel=stylesheet]",
  ];

  function open(xml, { title, fallback } = {}) {
    if (typeof xml !== "string") throw new TypeError("open(xml): xml must be a string");
    if (opened) throw new Error("OnixViewerStandalone.open() can run once per document");
    if (!document.body) throw new Error("OnixViewerStandalone.open() needs document.body");

    const shell = window.OnixViewerShell.html({
      title: title || "ONIX", cssURL: "", logoURL: "", logoURL2x: "",
      version: "", browser: "", modelURLs: {}, migrationURL: "", bytes: 0,
    });
    const parsedShell = new DOMParser().parseFromString(shell, "text/html");
    for (const selector of REMOVED) {
      for (const el of parsedShell.querySelectorAll(selector)) el.remove();
    }

    const style = document.createElement("style");
    style.textContent = css;
    const holder = document.createElement("script");
    holder.setAttribute("type", "application/xml");
    holder.id = "__oxv-source__";
    holder.appendChild(document.createTextNode(xml));
    const added = [
      document.importNode(parsedShell.getElementById("oxv-toolbar"), true),
      document.importNode(parsedShell.getElementById("oxv-main"), true),
      holder,
    ];

    try {
      document.head.appendChild(style);
      document.body.append(...added);
      start();
    } catch (error) {
      // Leave the page as it was, so the call can be tried again.
      style.remove();
      for (const el of added) el.remove();
      throw error;
    }

    const parsed = !document.querySelector("#oxv-root .px-error");
    if (!parsed) document.getElementById("oxv-toolbar").style.display = "none";
    if (parsed && fallback instanceof Element) fallback.remove();
    if (title) document.title = title;
    opened = true;
    return { rendered: true, parsed };
  }

  return { open };
}
