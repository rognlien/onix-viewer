# The Safari port

What is known, what this branch changes, and what has to be seen in a real
Safari before any of it ships. Written the way `FIREFOX.md` is: every claim
below has the source that established it, or says it needs a run.

## The short version

The code needs no porting for Safari either. `content.js` reaches the
extension API through `browser`, which Safari provides, and the bundle uses
nothing WebKit lacks: `content-visibility: auto` is the newest thing in it
and arrived in Safari 18, which is therefore the floor. The manifest is
accepted as it is — Apple's converter warns about one key and tolerates the
Chrome and Firefox ones in silence — so the same `Resources/` loads in
Safari as it loads unpacked in Chrome and temporarily in Firefox.

What Safari needs instead is **an app around the extension**, because that
is how Safari extensions are distributed: an Xcode project that Apple's
converter generates from the manifest, built and signed with an Apple
Developer Program membership and submitted to the App Store or notarized
for distribution outside it. And it needs one **behavioural question**
answered in a real Safari: what WebKit's own XML tree viewer, which is on
for exactly the people who can run an unsigned extension, does to a page
whose root was swapped while the parser was still running.

This branch adds a `--target=safari` to the packager, which prunes the
manifest, keeps the folder for Safari's temporary-extension loader and
generates the Xcode project into `dist/`, and it records below what a
manual run has to look for. `content.js` is unchanged.

## Facts established

| Fact | Source |
|---|---|
| Apple's converter, `xcrun safari-web-extension-converter`, takes the extension folder and generates an app target plus an extension target (`.appex`) that carries the web extension's files as bundle resources. Without `--copy-resources` the project references the original files by **absolute path** (`path = "../../../../../../../../../../Users/bendik/git/onix-viewer/Resources/content.js"`), which is no good to commit or move; with it the files are copied under the extension target and the paths are relative. It lists files individually, so a file added to `Resources/` needs the project regenerated — which is why the packager regenerates it every time rather than the repo committing it. | Xcode 27.0 (27A266a), run here 2026-09-26 |
| On this manifest the converter warns about **one key only**, `match_origin_as_fallback` ("not supported by your current version of Safari"), and says nothing about `minimum_chrome_version`, `version_name` or `browser_specific_settings.gecko`. MDN, however, records `match_origin_as_fallback` as supported from **Safari 18.4**. The two disagree; the key only matters for `blob:` URLs, and which is right is one line of the manual run below. | the converter on Safari 27.0; MDN compat data, `content_scripts.json` |
| The converter derives the **app's** bundle identifier from the app name — `--app-name "ONIX Viewer"` gives `io.maendeleo.ONIX-Viewer` whatever `--bundle-identifier` says — and the **extension's** from `--bundle-identifier` plus `.Extension`. Pass anything but the app's own derivation and the build fails at the embed step ("Embedded binary's bundle identifier is not prefixed with the parent app's bundle identifier"), which is why the packager passes `io.maendeleo.ONIX-Viewer`. With that, the generated project **builds** unsigned from the command line (`xcodebuild … CODE_SIGNING_ALLOWED=NO`), producing `ONIX Viewer.app` with `ONIX Viewer Extension.appex` inside it and the manifest and scripts under the appex's `Contents/Resources/`. The Swift in it is boilerplate: an `NSExtensionRequestHandling` handler that echoes native messages, which the extension never sends, and an app with a storyboard whose only job is to exist. | built here 2026-09-26 |
| The converter pins `MACOSX_DEPLOYMENT_TARGET` to the SDK it ran on (27.0). Safari 18 shipped with macOS 15, so the packager lowers it to 15.0 after generating. | the generated `project.pbxproj` |
| Content scripts in Safari are **not applied to a site until the user grants the extension access** to it, from the extension's popover in the toolbar; later loads then honour `run_at`. `<all_urls>` becomes a one-time "Always Allow on Every Website" rather than a grant at install, as in Chrome and as in Firefox since 127. Until then the page shows Safari's own XML rendering and nothing tells the reader the extension exists. | MDN compat data, `content_scripts.json` notes |
| `browser_specific_settings.safari` supports `strict_min_version` and `strict_max_version` (Safari 14). `version_name` is supported (Safari 14), so About should read `-dev` on a temporary load, and the packager strips it from the store build as it does for Chrome. | MDN compat data, `browser_specific_settings.json`, `version_name.json` |
| Web-accessible resources are served from a base URL that is **always dynamic** in Safari (`safari-web-extension://<uuid>/…`); `use_dynamic_url` is meaningless there and the object form with `resources` and `matches` is supported from 15.4. Nothing in the bundle depends on a fixed extension ID. | MDN compat data, `web_accessible_resources.json` |
| WebKit injects user scripts with **no check on the document type** — `LocalFrame::injectUserScriptImmediately` tests the frame (top only, if so declared) and the URL against the script's patterns, nothing else — so a content script should run on an `application/xml` document as it does in Chrome. | WebKit `Source/WebCore/page/LocalFrame.cpp` |
| `content-visibility: auto` is in **Safari 18**; the earlier partial implementation (18 to 26) did not make skipped content findable with find-in-page, which the viewer does not rely on. Hence `strict_min_version: "18.0"` in the Safari manifest. | MDN compat data, `content-visibility.json` |
| **WebKit has an XML tree viewer of its own**, and when it runs decides the open question below. `XMLDocumentParser::doEnd()` — when the parse finishes — calls `XMLTreeViewer::transformDocumentToTreeView()` if the parser saw no error, no CSS and no XSLT processing instruction, and `shouldRenderInXMLTreeViewerMode()` holds: the parser saw **no element in a namespace WebKit renders** (XHTML, SVG, MathML), the document is the **main frame's**, and the frame's settings have **`developerExtrasEnabled()`** — which in Safari is *Show features for web developers*. | WebKit `Source/WebCore/xml/parser/XMLDocumentParserLibxml2.cpp`, `xml/XMLTreeViewer.cpp` |
| The viewer's script, `prepareWebKitXMLViewer()`, **removes every child of the document** into a detached `<div>` — one that is *not* appended anywhere, unlike Chromium's `<div id="webkit-xml-viewer-source-xml">`, which `content.js` reads on the `file://` path — builds a fresh `<html>` with a `<style id="xml-viewer-style">`, a header ("This XML file does not appear to have any style information associated with it") and a `<div id="tree" class="pretty-print">`, and renders the tree into it from the detached copy. No shadow root. | WebKit `Source/WebCore/xml/XMLViewer.js` |
| **WebKit's tree viewer crashes if its `<html>` is removed between its script and its C++.** `transformDocumentToTreeView()` evaluates `XMLViewer.js`, which builds a fresh `<html>` and appends it to the document, and then, back in C++, appends the viewer's stylesheet to the `<style id="xml-viewer-style">` inside it by id. The microtask checkpoint at the end of the script evaluation runs any pending `MutationObserver` callback in between — and a first version of the detach code removed every non-shell element the document gained, so the C++ appended into a detached element: `EXC_BAD_ACCESS` in `WebCore::ContainerNode::appendChild` from `XMLTreeViewer::transformDocumentToTreeView()` from `XMLDocumentParser::doEnd()`, and after a few identical crashes "A problem repeatedly occurred". A blank placeholder root in the detached one's place changed nothing, which is what showed the empty document was not the cause. The observer now stops the moment the native root is taken, and the viewer's `<html>` is replaced by the shell like any other root. Worth a WebKit bug report all the same; a null check is all it needs. | crash reports `com.apple.WebKit.WebContent-2026-09-26-234515.ips` and `…-2026-09-27-011744.ips`, identical frames |
| Since **Safari 26** an extension folder (or zip) can be loaded without Xcode: Safari → Settings → Developer → **Add Temporary Extension…**, after *Allow unsigned extensions* on the same tab (Safari 17+; the Develop menu in 16 and earlier). "Safari removes temporary extensions after 24 hours or when you quit Safari", and *Allow unsigned extensions* "resets when you quit Safari". This is the Safari equivalent of *Load unpacked*, and the Developer tab exists only once *Show features for web developers* is on under Advanced — the same switch that turns the tree viewer on. | Apple, *Running your Safari web extension*; stefanvd.net on Safari 26 |
| Distribution needs the **Apple Developer Program** either way: "To distribute your web extension, first join the Apple Developer Program." The App Store takes an archive of the app; outside it, macOS wants the app signed with a Developer ID **and notarized**. Beta testers can be sent an unsigned app (the *Copy App* distribution method) and told to allow unsigned extensions. | Apple, *Distributing your Safari web extension* |

## What the branch changes

### The packager takes `--target=safari`

```bash
tools/package-extension.sh --target=safari
#   dist/onix-viewer-<v>-safari/          the pruned folder, for Add Temporary Extension…
#   dist/safari/ONIX Viewer/ONIX Viewer.xcodeproj   the converter's project, to build and sign
```

The staging copy is made as for the other two targets, and its manifest
loses `version_name` and `minimum_chrome_version` and has its
`browser_specific_settings` replaced by `{ safari: { strict_min_version:
"18.0" } }` — each store build keeps only its own browser's keys, as
before. The folder is then **kept** rather than zipped, since that is what
Safari's temporary loader takes, and the converter is run on it with
`--copy-resources`, `--macos-only`, `--swift` and a bundle identifier of
`io.maendeleo.ONIX-Viewer` (the gecko id's domain, spelt the way the
converter spells the app's own id — see the facts; change both in the
script if the App Store record says otherwise). The deployment target is lowered
to 15.0. The Xcode project is build output, regenerated on every run and
ignored by git with the rest of `dist/`, so nothing Xcode-side is ever
committed — the team, the signing certificate and the archive are Xcode's
business at release time.

`match_origin_as_fallback` is left in. The converter warns about it every
run; MDN says Safari 18.4 has it. If the manual run shows a `blob:` URL is
not taken over, drop the key from the Safari manifest in the packager and
lose nothing, since it was not working anyway.

### The parser's root is detached as soon as it appears

The one `content.js` change, and it is for every browser rather than gated
on Safari, because it measured as a gain in Chrome too. When the parser
produces a root that looks like ONIX, `content.js` removes it from the
document at once and keeps it as `nativeRoot`: the parser fills it to the
end regardless (the DOM fallback serialises it if the re-fetch fails), but
the browser no longer styles or lays out a document about to be replaced,
and its tree viewer, running at the end of the parse over "every child of
the document", finds nothing. The shell is appended into the empty document
when the source is in. Chrome, cold load, time to the first verdict: 1.52 s
→ 1.31 s for 300 products, 4.84 s → 4.38 s for 1,000. What the manual run
showed in Safari before the change is in the next section; the run after it
is still to do.

## What could not be verified, and the question it hangs on

There is no automated path. puppeteer does not drive Safari, and the
sessions `safaridriver` starts are isolated from the user's extensions, so
the check is by hand, from a Safari with *Show features for web
developers* on — which is also what turns the tree viewer on.

**What one run showed, 2026-09-26, before the detach change**, Safari 27.0 on
macOS 27, the extension loaded as a temporary extension:

- The takeover works on an XML document: the small sample rendered with the
  toolbar, the verdict and the code-list labels, from the fetch path.
- Two Safari gotchas before anything works: site access is granted per
  extension from its toolbar button or Settings → Websites, and a temporary
  extension is enabled **in the profile it was added from only** — Settings
  → Extensions says "active in the Personal profile", with a dash in the
  checkbox, and a window in another profile shows nothing at all.
- The 300-product feed on a **cold** load: white, then Safari's unstyled
  rendering, then the web process unresponsive until Safari killed it and
  reloaded the page — after which the viewer appeared whole. A second cold
  load of the same feed under a new name took about ten seconds and worked.
  The server saw one request per load, so the re-fetch never reached it:
  WebKit coalesced it with the page's own download, which means the source
  cannot arrive before the download ends, and the tree viewer gets its turn
  first. Without the extension the same feed loads in a few seconds.
- The verdict pill showed "600 warnings" with the *error* glyph: the viewer
  picks that icon whenever there are findings (`viewer.js`, `icon("error")`
  in the verdict), a bug of its own for its own commit.

**After the detach change, 2026-09-27**: two cold loads of the 300-product
feed rendered the viewer with no crash and no kill, so the open question is
answered — the swap survives the end of the parse in Safari — and what is
left is speed. Bendik's word for it: "sluggish and slow". Safari parses the
whole feed into the detached root before the re-fetch can resolve, since
WebKit coalesces it with the page's own download, and it then builds and
lays out the viewer's 144k rows as Chrome does, only slower. The next step
was not Safari-specific: Products are now rendered only as they near the
viewport (see `CLAUDE.md`), and with that in the loaded folder the same
300-product feed on a cold load was, in Bendik's words, "really well" —
load and scrolling both. No Timeline recording was needed.

### WebKit's tree viewer and a swapped root

Put the facts above against `content.js`, which swaps the root as soon as
the re-fetch resolves and the root exists:

- **Developer features off** (every ordinary reader): no tree viewer.
  Safari renders the raw XML as unstyled text, the swap lands whenever the
  fetch resolves, parse finished or not, and the viewer takes over as in
  Chrome. The DOM fallback (`readSourceFromDom`) finds no wrapper and
  serialises `documentElement`, which is the original root — correct.
- **Developer features on, swap after the parse ends** (a small file, the
  parser done before the fetch resolves): at `doEnd()` the tree viewer
  rebuilt the document around its own `<html>`; our `replaceChild` then
  replaces *that* root with the shell. Fine, and the source came from the
  fetch, not the DOM.
- **Developer features on, swap during the parse** (a feed big enough to
  arrive in more than one chunk): the parser carries on into the detached
  original root, and at `doEnd()` `prepareWebKitXMLViewer()` **removes our
  shell** into its detached div and renders a tree *of the shell's own
  markup*. The reader sees WebKit's tree of `<html>`, `<div id="oxv-toolbar">`
  and half a million viewer rows, and nothing of ours. Unlike Firefox's
  overlay, which the next mutation unhooks, this is permanent: the shell is
  no longer in the document.
- **Developer features on, DOM fallback** (`file://`, or a fetch that
  fails): after `doEnd()` the source is gone from the document — WebKit's
  detached div is not appended anywhere — so `readSourceFromDom` finds no
  wrapper and serialises the tree viewer's `<html>`, which is not ONIX and
  fails the sniff. `file://` therefore cannot work through the fallback
  while developer features are on, unless a Safari extension's content
  script can `fetch()` a `file:` URL, which is the first thing to find out.

### If the mid-parse case misbehaves: the fix is in `content.js`, Safari only

Gated on `runtime.getURL("").startsWith("safari-web-extension:")` so Chrome
keeps its proven path, and cheap either way:

- **Wait for the parse.** When the fetch resolves while `readyState` is
  `"loading"`, hold the source and install the shell on `DOMContentLoaded`,
  which WebKit fires after `doEnd()` — so the tree viewer, if it runs, has
  already run, and the shell replaces its `<html>` as in the small-file
  case. Always safe; the cost is the flash of Safari's own rendering and,
  with developer features on, the tree viewer's work over the whole feed
  first. The `file://` case is not helped, since the source is gone by then.
- **Detach first.** Remove the original root as soon as the fetch resolves,
  install the shell on `DOMContentLoaded`. With nothing in the document at
  `doEnd()` the viewer builds an empty tree, which the shell then replaces.
  No viewer work over the feed, a blank page instead of a native one for
  the rest of the parse. Preferred if it works.

Neither should be written until the run shows which case the swap lands in.

### The run

```bash
tools/package-extension.sh --target=safari
node -e '
  const fs = require("fs"), s = fs.readFileSync("Onix/onix-3.1-refnames.xml", "utf8");
  const a = s.indexOf("<Product>"), b = s.indexOf("</Product>") + 10, p = s.slice(a, b);
  fs.writeFileSync("dist/large.xml", s.slice(0, a) + Array.from({length: 300}, (_, i) =>
    p.replace(/<RecordReference>[^<]*/, "<RecordReference>large-" + i)).join("\n") + s.slice(b));
'   # 5 MB, 300 products — the multi-chunk case. In dist/, NOT Onix/: the
    # suite runs every file in Onix/, and a 5 MB feed there blows jsdom's heap
python3 -m http.server 8000   # from the repo root; serves .xml as application/xml
```

Then in Safari: Settings → Advanced → *Show features for web developers*;
Settings → Developer → *Allow unsigned extensions*, then *Add Temporary
Extension…* → `dist/onix-viewer-0.9.19-safari`; Settings → Extensions →
turn ONIX Viewer on **in the profile you will browse from** (a temporary
extension is enabled in the profile it was added from and nowhere else);
open `http://127.0.0.1:8000/Onix/onix-3.1-refnames-defects.xml`, click the
extension's toolbar button and choose *Always Allow on Every Website*,
reload. A cold load needs a name Safari has not cached, so copy the feed to
a new name in `dist/` for each one. Look for:

1. **The toolbar and the verdict** on the small file — the takeover works
   on an XML document at all, the stylesheet loads from
   `safari-web-extension://`, the mark shows, About reads `0.9.19-dev`.
2. **`/dist/large.xml`**, cold: whether the page ends as the viewer or as WebKit's tree
   of the viewer's markup ("This XML file does not appear to have any style
   information…" at the top is the tell). This is the question.
3. **Developer features off** (uncheck it, which also drops the temporary
   extension — so do this last, with a built app instead, or accept that it
   can only be inferred): the ordinary reader's path.
4. **A `blob:` URL** — from the Web Inspector console on any page,
   `open(URL.createObjectURL(new Blob([xml], {type: "application/xml"})))` —
   settles `match_origin_as_fallback`.
5. **`file:///…/Onix/onix-3.1-refnames.xml`**, with the extension allowed on
   file URLs if Safari asks: whether the fetch or the fallback carries it.
6. **The rules editor**: paste the house rules, Apply, and look for "Kept"
   — `browser.storage.local` in a Safari content script.
7. **Chrome's XPath tests by hand**: the house rules' findings match the
   suite's, on both `Onix/` dialects.

## What comes after a green run

1. Apply whichever `content.js` change the run calls for, if any, behind
   the `safari-web-extension:` gate, with a jsdom test for the branch
   Chrome takes.
2. A listing: the App Store needs an Apple Developer Program membership,
   an app record, screenshots of the *app* as well as the extension, and a
   privacy declaration — the manifest's "collects nothing" has an App Store
   Connect form of its own. The `description` says "in Chrome".
3. `release.yml` cannot build this: signing needs the certificate, and the
   runner has no Xcode. The Safari release is `tools/package-extension.sh
   --target=safari`, then Xcode → Product → Archive → Distribute, by hand.
4. `SECURITY.md`, `README.md` and `CLAUDE.md` then say Safari alongside the
   other two.

## What is deliberately not done

- **No committed Xcode project.** The converter references files by
  absolute path unless told to copy them, lists them one by one, and pins
  the SDK's deployment target; a committed project would go stale on every
  new file and carry one machine's paths. Regenerating it is two seconds.
- **No iOS target.** `--macos-only`. The viewer is a full-window tree with
  a toolbar built for a pointer and a keyboard; an iOS build would need a
  design pass, not a port, and iOS Safari has no raw-XML view to improve on
  in the same way.
- **No native messaging.** The generated Swift handler stays as generated
  and is never called; there is nothing the extension needs from the app.
- **No `world: "MAIN"`, no polyfill** — for the reasons in `FIREFOX.md`.
