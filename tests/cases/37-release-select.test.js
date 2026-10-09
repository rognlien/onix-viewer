const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, render, renderSource, codes, validationLabel, RES,
} = require("../harness");

// The toolbar's release selector: the verdict is against the release the
// document declares unless the reader picks the other bundled one. 3.0 and
// 3.1 disagree about what is an error and what a warning — <TitleText> is
// plain in 3.0 and deprecated in 3.1, <AudienceCode> is an element of 3.0
// and unknown to 3.1 — so a feed about to move between them wants both
// verdicts over the same file.
describe("Release selector", () => {
  const select = (w) => w.document.getElementById("oxv-release");
  const options = (w) => Array.from(select(w).options).map((o) => `${o.value}=${o.textContent}`);
  const pick = (w, release) => {
    select(w).value = release;
    select(w).dispatchEvent(new w.Event("change"));
  };
  const pinned = (w) => Array.from(w.document.querySelectorAll("#oxv-root .px-finding"))
    .map((m) => m.dataset.oxvCode);
  // What the verdict says it was checked against: its own title while the
  // document is clean, the findings list's eyebrow otherwise.
  const scopeNote = (w) => {
    const label = validationLabel(w);
    if (label.getAttribute("role") !== "button") return label.title;
    label.click();
    return w.document.querySelector("#oxv-findings .px-popup-eyebrow").textContent;
  };

  test("the selector lists both bundled releases and starts on the one the document declares", () => {
    const w = render("onix-3.1-valid.xml");
    assert(options(w).join("|") === "3.0=ONIX 3.0, Issue 74|3.1=ONIX 3.1, Issue 74", `got ${options(w).join("|")}`);
    assert(select(w).value === "3.1", `expected 3.1 selected, got ${select(w).value}`);
    assert(select(w).closest(".px-right"), "it sits in the right-hand group");
  });

  test("the validator takes the release as an option, defaulting to the document's", () => {
    const w = render("onix-3.0-reference.xml");
    const doc = new w.DOMParser().parseFromString(w.__OXV_SOURCE__, "application/xml");
    const ctx = w.OnixViewerOnix.detect(doc);
    const own = w.OnixViewerValidation.run(doc, ctx);
    const other = w.OnixViewerValidation.run(doc, ctx, { version: "3.1" });
    assert(own.version === "3.0" && other.version === "3.1",
      `expected 3.0 then 3.1, got ${own.version} then ${other.version}`);
    assert(!codes(own).includes("element.deprecated"), "<TitleText> is plain in 3.0");
    assert(codes(other).includes("element.deprecated"), "and deprecated in 3.1");
  });

  test("the release attribute is exempt under an override, where it can only disagree", () => {
    const w = render("onix-3.1-valid.xml");
    const doc = new w.DOMParser().parseFromString(w.__OXV_SOURCE__, "application/xml");
    const ctx = w.OnixViewerOnix.detect(doc);
    const asThirty = w.OnixViewerValidation.run(doc, ctx, { version: "3.0" });
    assert(!codes(asThirty).includes("attribute.value"),
      `release="3.1" is the reader's choice to overlook; got ${codes(asThirty).join(", ")}`);
    // At the document's own release the attribute is still judged.
    const wrong = new w.DOMParser().parseFromString(
      w.__OXV_SOURCE__.replace('release="3.1"', 'release="3.2"'), "application/xml");
    const own = w.OnixViewerValidation.run(wrong, w.OnixViewerOnix.detect(wrong));
    assert(codes(own).includes("attribute.value"), `got ${codes(own).join(", ")}`);
  });

  test("picking the other release judges the document again, and the verdict says so", () => {
    // <AudienceCode> is deprecated in 3.0 and gone from 3.1: a warning on one
    // side, an error on the other — the difference the selector is for.
    const xml = '<?xml version="1.0"?>' +
      '<ONIXMessage release="3.0" xmlns="http://ns.editeur.org/onix/3.0/reference">' +
      "<Header><Sender><SenderName>x</SenderName></Sender><SentDateTime>20260101</SentDateTime></Header>" +
      "<Product><RecordReference>r</RecordReference><NotificationType>03</NotificationType>" +
      "<ProductIdentifier><ProductIDType>15</ProductIDType><IDValue>9788234567896</IDValue></ProductIdentifier>" +
      "<DescriptiveDetail><ProductComposition>00</ProductComposition><ProductForm>BB</ProductForm>" +
      "<TitleDetail><TitleType>01</TitleType><TitleElement><TitleElementLevel>01</TitleElementLevel>" +
      "<NoPrefix/><TitleWithoutPrefix>T</TitleWithoutPrefix></TitleElement></TitleDetail>" +
      "<AudienceCode>01</AudienceCode></DescriptiveDetail></Product></ONIXMessage>";
    const w = renderSource(xml, "audience-code.xml");
    assert(validationLabel(w).textContent === "1 warning", `under 3.0; got ${validationLabel(w).textContent}`);
    assert(pinned(w).join() === "element.deprecated", `got ${pinned(w).join()}`);

    pick(w, "3.1");
    assert(validationLabel(w).textContent === "1 error", `under 3.1; got ${validationLabel(w).textContent}`);
    assert(pinned(w).join() === "structure.unknown", `pinned afresh; got ${pinned(w).join()}`);
    assert(select(w).title.includes("Validating as ONIX 3.1") && select(w).title.includes("declares ONIX 3.0"),
      `the title names both; got "${select(w).title}"`);
    assert(scopeNote(w) === "Checked against the bundled ONIX 3.1 content model; the document declares ONIX 3.0",
      `got "${scopeNote(w)}"`);

    pick(w, "3.0");
    assert(validationLabel(w).textContent === "1 warning", "back to the file's own release");
    assert(pinned(w).join() === "element.deprecated", "and the 3.1 finding is gone");
    assert(select(w).title.startsWith("Validate against"), `the title no longer names an override; got "${select(w).title}"`);
  });

  test("the findings list's eyebrow says which release was checked, and what the file declares", () => {
    const w = render("onix-3.1-valid.xml");
    pick(w, "3.0");
    assert(scopeNote(w) === "Checked against the bundled ONIX 3.0 content model; the document declares ONIX 3.1",
      `got "${scopeNote(w)}"`);
    // And with something to list, the list's eyebrow carries the same note.
    const w2 = render("onix-3.1-invalid.xml");
    pick(w2, "3.0");
    validationLabel(w2).click();
    const eyebrow = w2.document.querySelector("#oxv-findings .px-popup-eyebrow");
    assert(eyebrow && eyebrow.textContent.endsWith("; the document declares ONIX 3.1"),
      `got "${eyebrow && eyebrow.textContent}"`);
  });

  test("a document that declares no release is judged as 3.0, and can be judged as 3.1", () => {
    // A standalone <Product> with no namespace declares nothing; it is judged
    // against a real release rather than none.
    const w = render("onix-standalone-product-no-namespace.xml");
    assert(options(w).join("|") === "3.0=ONIX 3.0, Issue 74|3.1=ONIX 3.1, Issue 74", `got ${options(w).join("|")}`);
    assert(select(w).value === "3.0", `starts on 3.0; got ${select(w).value}`);
    assert(!pinned(w).includes("model.missing"), `structure is checked; got ${pinned(w).join()}`);
    assert(select(w).title.includes("declares no release"), `got "${select(w).title}"`);

    pick(w, "3.1");
    assert(!pinned(w).includes("model.missing"), `and as 3.1; got ${pinned(w).join()}`);
  });

  test("ONIX 2.1 is offered as declared, ahead of the bundled releases", () => {
    const w = renderSource(
      '<?xml version="1.0"?><ONIXMessage release="2.1"><Product>' +
      "<RecordReference>x</RecordReference></Product></ONIXMessage>", "onix-2.1.xml");
    assert(options(w).join("|") === "2.1=ONIX 2.1, Issue 74|3.0=ONIX 3.0, Issue 74|3.1=ONIX 3.1, Issue 74",
      `got ${options(w).join("|")}`);
    assert(select(w).value === "2.1");
  });

  test("an Acknowledgement names its release and the issue, and offers no other", () => {
    const w = render("onix-3.0-acknowledgement.xml");
    assert(options(w).join("|") === "3.0=ONIX 3.0, Issue 74", `got ${options(w).join("|")}`);
    assert(select(w).disabled, "nothing to choose: it is never checked structurally");
    assert(select(w).title.includes("Acknowledgement"), `the title says why; got "${select(w).title}"`);
  });

  test("a non-ONIX document gets no selector", () => {
    const w = render("rss.xml");
    assert(select(w).options.length === 0, "expected an empty, hidden select");
    assert(w.getComputedStyle(select(w)).display === "none", "hidden");
  });

  test("a model the content script did not send is fetched when its release is picked", () => {
    // Production ships the matching model alone; the other's URL is stamped
    // on the shell, and the viewer appends it as a script the first time it
    // is asked for. jsdom runs no script src, so the test plays the load.
    const url = "chrome-extension://abc/onix-content-model-3.0.js";
    const w = renderSource(fs.readFileSync(path.join(__dirname, "..", "fixtures", "onix-3.1-valid.xml"), "utf8"),
      "onix-3.1-valid.xml", (win) => {
        win.document.documentElement.setAttribute("data-oxv-models",
          JSON.stringify({ "3.1": "chrome-extension://abc/onix-content-model-3.1.js", "3.0": url }));
      }, ["3.1"]);
    assert(w.OnixViewerValidation.availableVersions().join() === "3.1", "only 3.1 loaded");
    assert(options(w).join("|") === "3.0=ONIX 3.0, Issue 74|3.1=ONIX 3.1, Issue 74",
      `both are still offered; got ${options(w).join("|")}`);

    pick(w, "3.0");
    const script = w.document.querySelector(`script[src="${url}"]`);
    assert(script, "the 3.0 model is requested");
    assert(validationLabel(w).textContent.includes("Validating"), "the verdict waits for it");

    w.eval(fs.readFileSync(path.join(RES, "onix-content-model-3.0.js"), "utf8"));
    script.dispatchEvent(new w.Event("load"));
    assert(w.OnixViewerValidation.availableVersions().join() === "3.0,3.1", "loaded");
    assert(!validationLabel(w).textContent.includes("Validating"), "the pass ran");
    assert(scopeNote(w).startsWith("Checked against the bundled ONIX 3.0"),
      `against 3.0; got "${scopeNote(w)}"`);

    pick(w, "3.1");
    pick(w, "3.0");
    assert(w.document.querySelectorAll(`script[src="${url}"]`).length === 1, "fetched once");
  });

  test("a failed fetch still gives a verdict, saying the model is missing", () => {
    const url = "chrome-extension://abc/onix-content-model-3.0.js";
    const w = renderSource(fs.readFileSync(path.join(__dirname, "..", "fixtures", "onix-3.1-valid.xml"), "utf8"),
      "onix-3.1-valid.xml", (win) => {
        win.document.documentElement.setAttribute("data-oxv-models", JSON.stringify({ "3.0": url }));
      }, ["3.1"]);
    pick(w, "3.0");
    w.document.querySelector(`script[src="${url}"]`).dispatchEvent(new w.Event("error"));
    assert(pinned(w).includes("model.missing"), `got ${pinned(w).join()}`);
    assert(scopeNote(w).startsWith("No content model bundled for ONIX 3.0"), `got "${scopeNote(w)}"`);
  });

  test("a mouse choice leaves no focus ring, a keyboard focus keeps one", () => {
    // Chrome outlines a focused <select> after a click, unlike a button, so
    // the selector sat outlined after every choice.
    const w = render("onix-3.1-valid.xml");
    const s = select(w);
    s.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
    assert(s.classList.contains("px-pointer"), "a press is marked");
    s.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert(!s.classList.contains("px-pointer"), "a key press clears it");
    s.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
    s.dispatchEvent(new w.FocusEvent("blur"));
    assert(!s.classList.contains("px-pointer"), "so does leaving the control");
    // A choice made by mouse leaves the control, so no ring can settle on it
    // afterwards; one made by key keeps focus for the next arrow press.
    s.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
    s.focus();
    pick(w, "3.0");
    assert(w.document.activeElement !== s, "left after a mouse choice");
    s.focus();
    s.dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    pick(w, "3.1");
    assert(w.document.activeElement === s, "kept after a key choice");
    const muted = Array.from(w.document.styleSheets[0].cssRules)
      .some((r) => r.selectorText === "#oxv-release.px-pointer:focus" && r.style.outline === "none");
    assert(muted, "and the mark is what the stylesheet mutes");
  });

  test("a superseded pass never pins its findings over the new one's", () => {
    // Two passes in flight: the first is abandoned when the second starts,
    // rather than finishing later and pinning a stale verdict.
    const w = render("onix-3.1-valid.xml");
    let slices = 0;
    const session = w.OnixViewerValidation.start(
      new w.DOMParser().parseFromString(w.__OXV_SOURCE__, "application/xml"),
      w.OnixViewerOnix.detect(new w.DOMParser().parseFromString(w.__OXV_SOURCE__, "application/xml")));
    while (!session.done) { session.step(Infinity); slices++; }
    assert(slices >= 1, "the session API is what the viewer pumps");
    pick(w, "3.0");
    pick(w, "3.1");
    assert(validationLabel(w).textContent === "Valid", `got ${validationLabel(w).textContent}`);
  });
});
