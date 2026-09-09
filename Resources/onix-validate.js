// onix-validate.js — ONIX Viewer
//
// Validates a parsed ONIX document against the compiled content model in
// onix-content-model.js. Three things are deliberately pluggable:
//
//   * MESSAGES — a template per finding code, so wording can be changed (or
//     translated) without touching a line of validation logic.
//   * RULES    — an ordered registry. The runner walks the document ONCE and
//     offers every element to every rule, so adding a rule costs no extra
//     traversal. xs:unique duplicate detection and GTIN-13 check digits slot
//     in as new rules; see the notes at the bottom.
//   * MODELS   — keyed by ONIX release. 3.1 ships today; a 3.0 model is a
//     second generator run, and documents whose release has no model skip the
//     structural rules rather than being judged against the wrong schema.

(function () {
  "use strict";

  // ---- messages -------------------------------------------------------------

  // {placeholders} are filled from a finding's `data`. Replace any entry to
  // reword it; the codes are the stable contract, not the prose.
  const MESSAGES = Object.assign(Object.create(null), {
    "structure.unknown": "<{found}> is not an element of ONIX {version}",
    "structure.missing": "<{parent}> is missing a required <{expected}>",
    "structure.expected-one-of": "<{parent}> requires one of {expected} here",
    "structure.unexpected": "<{found}> is not allowed at this position in <{parent}>",
    "structure.repeated": "<{found}> may appear at most {max}× in <{parent}>",
    "structure.childless": "<{found}> takes a value, not child elements",
    "structure.not-empty": "<{found}> must be empty",
    "structure.missing-value": "<{found}> must carry a value",
    "datatype.pattern": "\"{value}\" is not a valid {type}",
    "datatype.lexical": "\"{value}\" is not {article} {base}",
    "datatype.empty-list": "<{found}> must list at least one code",
    "datatype.list-member": "\"{member}\" is not in List {list} ({title})",
    "unique.duplicate": "<{parent}> repeats <{selector}> with the same {fields}",
    "attribute.unknown": "{name} is not an attribute of <{element}>",
    "attribute.empty": "{name} on <{element}> has no value",
    "attribute.missing": "<{element}> is missing its required {name} attribute",
    "attribute.value": "{name} must be {expected}, not \"{value}\"",
    "attribute.code": "{name}=\"{value}\" is not in List {list} ({title})",
    "attribute.deprecated": "{name}=\"{value}\" ({label}) was deprecated in List {list} at issue {issue}",
    "attribute.pattern": "{name}=\"{value}\" is not a valid {type}",
    "attribute.lexical": "{name}=\"{value}\" is not {article} {base}",
    "attribute.range": "{name}=\"{value}\" is out of range for {type}",
    "datatype.range": "\"{value}\" is out of range for {type}",
    "codelist.unknown": "\"{value}\" is not in List {list} ({title})",
    "codelist.deprecated": "\"{value}\" ({label}) was deprecated in List {list} at issue {issue}",
    // {since} and {advice} carry their own leading connective, because EDItEUR
    // supplies neither for every element: a 3.0 note names the replacement but
    // not the revision, a 3.1 one often the reverse. One code with optional
    // detail beats two codes for one defect.
    "element.deprecated": "<{name}> is deprecated{since}{advice}",
    "gtin.checkdigit": "\"{value}\" has an invalid check digit for {scheme} (expected {expected})",
    "model.missing": "No content model bundled for ONIX {version} (bundled: {available}); structure was not checked",
    "model.acknowledgement": "Acknowledgement messages have their own schema, which isn't bundled; structure was not checked",
  });

  // Severity per code, overridable like MESSAGES. An error is a schema
  // violation; a warning is valid ONIX that shouldn't be sent, or something
  // the viewer couldn't check. Anything unlisted is an error, so a new rule
  // is conservative until it says otherwise.
  const SEVERITIES = Object.assign(Object.create(null), {
    "codelist.deprecated": "warning",
    // Still valid ONIX — the schema accepts it, EDItEUR asks you to stop.
    "element.deprecated": "warning",
    "attribute.deprecated": "warning",
    "model.missing": "warning",
    "model.acknowledgement": "warning",
  });

  function severity(finding) {
    return SEVERITIES[finding.code] || "error";
  }

  function message(finding) {
    const template = MESSAGES[finding.code] || finding.code;
    return template.replace(/\{(\w+)\}/g, (whole, key) => {
      const value = finding.data ? finding.data[key] : undefined;
      return value == null ? whole : String(value);
    });
  }

  // ---- rule registry --------------------------------------------------------

  // A rule may implement any of:
  //   start(api)            once, before the walk
  //   element(node, api)    for every element, in document order
  //   finish(api)           once, after the walk
  // `api.report(code, node, data)` records a finding. Returning `false` from
  // element() tells the runner not to descend into that node.
  const RULES = [];

  function registerRule(rule) {
    RULES.push(rule);
    return rule;
  }

  // ---- models ---------------------------------------------------------------

  function modelFor(version) {
    const models = window.OnixViewerContentModels;
    return (models && version && models[version]) || null;
  }

  function availableVersions() {
    return Object.keys(window.OnixViewerContentModels || {}).sort();
  }

  // ---- runner ---------------------------------------------------------------

  /**
   * Begin a validation pass that does its work in slices, so a caller can
   * spread it across idle time instead of blocking the page:
   *
   *   const session = start(doc, ctx);
   *   session.step(12);               // work for up to 12ms
   *   if (!session.done) …            // schedule the rest
   *   const result = session.result();
   *
   * A small document finishes inside the first slice, so the caller gets a
   * synchronous answer without a special case.
   */
  function start(doc, onixCtx, options) {
    const pass = createPass(doc, onixCtx, options);
    return {
      get done() { return pass.done; },
      get processed() { return pass.processed; },
      total: pass.total,
      step: (budgetMs) => stepPass(pass, budgetMs),
      result: () => passResult(pass),
    };
  }

  /**
   * Validate `doc` in one go. Returns
   * { findings, total, errors, warnings, version, checkedStructure, truncated }.
   * `options.maxFindings` caps the array (default 500) so a badly broken feed
   * can't build an unbounded list; counting continues past the cap.
   */
  function run(doc, onixCtx, options) {
    const session = start(doc, onixCtx, options);
    while (!session.done) session.step(Infinity);
    return session.result();
  }

  function createPass(doc, onixCtx, options) {
    const settings = options || {};
    const limit = settings.maxFindings == null ? 500 : settings.maxFindings;
    // An Acknowledgement message is a different schema — <MessageStatus>,
    // <RecordStatus> and friends aren't in the Book Product model at all — so
    // judging one against it would report every element as unknown. Its code
    // lists are still checked, which is the point of Acknowledgement support.
    const isAcknowledgement = onixCtx.messageType === "acknowledgement";
    const model = isAcknowledgement ? null : modelFor(onixCtx.version);
    const findings = [];
    const counts = { error: 0, warning: 0 };

    const api = {
      onixCtx,
      model,
      findings,
      reported: 0,
      report(code, node, data) {
        api.reported++;
        const finding = { code, node, data: data || {}, severity: SEVERITIES[code] || "error" };
        counts[finding.severity]++;
        if (findings.length < limit) findings.push(finding);
      },
      referenceName,
      // An element's effective shape. Five declarations in ONIX 3.1 name a
      // complexType rather than carrying an inline one, which makes
      // <EpubLicense>'s content depend on where it sits: EpubLicenseType
      // inside <Price>, EpubLicenseWithDateType elsewhere. The model records
      // the exceptions as `in`, keyed by parent reference name, so every rule
      // must reach an element's shape through here rather than indexing
      // `elements` directly.
      shapeOf(node) {
        const shape = model && model.elements[referenceName(node)];
        if (!shape || !shape.in) return shape;
        const parent = node.parentNode;
        const variant = parent && parent.nodeType === 1 && shape.in[referenceName(parent)];
        return variant || shape;
      },
      displayName: (name) => nameInDialect(name, onixCtx.dialect),
      displayPhrase: (text) => phraseInDialect(text, onixCtx.dialect),
      parentName,
      siblingValue,
      childElements,
      textOf,
    };

    if (!model) {
      api.report(isAcknowledgement ? "model.acknowledgement" : "model.missing",
        doc.documentElement, {
          version: onixCtx.version || "(unknown release)",
          available: availableVersions().join(", "),
        });
    }

    for (const rule of RULES) {
      if (rule.start) rule.start(api);
    }

    // An explicit stack rather than recursion, so the traversal can be paused
    // between nodes and resumed in the next slice. Children are pushed in
    // reverse so they come off the stack in document order, which keeps the
    // findings list in the order a reader scans the file.
    const stack = doc.documentElement ? [doc.documentElement] : [];
    return {
      api, stack, findings, counts, model,
      processed: 0,
      done: false,
      // Only used to report progress; the traversal itself doesn't need it.
      total: doc.documentElement ? doc.getElementsByTagName("*").length : 0,
    };
  }

  function stepPass(pass, budgetMs) {
    const started = now();
    const budget = budgetMs == null ? 8 : budgetMs;
    // Check the clock every so often rather than per node: for small
    // documents the whole pass costs less than one now() call would suggest.
    let untilClockCheck = 256;

    while (pass.stack.length) {
      visit(pass.stack.pop(), pass);
      pass.processed++;
      if (--untilClockCheck > 0) continue;
      untilClockCheck = 256;
      if (budget !== Infinity && now() - started >= budget) return false;
    }

    for (const rule of RULES) {
      if (rule.finish) rule.finish(pass.api);
    }
    pass.done = true;
    return true;
  }

  // One visit, every rule. A rule that returns false prunes the subtree — used
  // for XHTML content and for elements the model doesn't know, where
  // descending would only produce noise.
  function visit(node, pass) {
    let descend = true;
    for (const rule of RULES) {
      if (rule.element && rule.element(node, pass.api) === false) descend = false;
    }
    if (!descend) return;
    const children = node.children;
    for (let i = children.length - 1; i >= 0; i--) pass.stack.push(children[i]);
  }

  function passResult(pass) {
    return {
      findings: pass.findings,
      total: pass.api.reported,
      errors: pass.counts.error,
      warnings: pass.counts.warning,
      truncated: pass.api.reported > pass.findings.length,
      version: pass.model ? pass.model.version : null,
      checkedStructure: !!pass.model,
      done: pass.done,
    };
  }

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  // Reference-dialect name, so rules and the model speak one language.
  function referenceName(node) {
    const name = node.localName || node.nodeName;
    const onix = window.OnixViewerOnix;
    return (onix && onix.translatedName(name, "reference")) || name;
  }

  // A name written the way the document writes it. The content model is in
  // reference names, so a finding about a short-tag file would otherwise name
  // an element the reader cannot find: their file says <b203>, not
  // <TitleText>. Names taken straight off a node need no help —
  // node.nodeName is already the document's own spelling — this is for the
  // ones that come out of the model.
  function nameInDialect(name, dialect) {
    const onix = window.OnixViewerOnix;
    if (dialect !== "short" || !onix) return name;
    return onix.translatedName(name, "short") || name;
  }

  // The same, for element references embedded in prose — EDItEUR's deprecation
  // advice reads "use either <TitlePrefix> or <NoPrefix/> instead", and every
  // name in it belongs in the reader's dialect too.
  function phraseInDialect(text, dialect) {
    if (dialect !== "short") return text;
    return text.replace(/<([A-Za-z][A-Za-z0-9]*)(\/?)>/g,
      (whole, name, selfClosing) => `<${nameInDialect(name, dialect)}${selfClosing}>`);
  }

  // The parent's reference name, or "" at the document root.
  function parentName(node) {
    const parent = node.parentNode;
    return parent && parent.nodeType === 1 ? referenceName(parent) : "";
  }

  // The text of a named sibling — how an identifier's value finds its type.
  // Restricted to siblings, so a <RelatedProduct>'s type can't be read for a
  // <Product>'s value.
  function siblingValue(node, siblingName) {
    const parent = node.parentNode;
    let found = "";
    if (parent && parent.nodeType === 1) {
      for (const sibling of parent.children) {
        if (sibling !== node && referenceName(sibling) === siblingName) {
          found = textOf(sibling).trim();
          break;
        }
      }
    }
    return found;
  }

  function childElements(node) {
    return [...node.children];
  }

  // Direct text content, ignoring nothing: an element with element children
  // is reported by the structural rule, not silently trimmed here.
  function textOf(node) {
    return (node.textContent || "").trim();
  }

  // ---- the structural rule --------------------------------------------------

  registerRule({
    name: "structure",
    element(node, api) {
      if (!api.model) return true;
      const name = api.referenceName(node);
      const shape = api.shapeOf(node);

      if (!shape) {
        api.report("structure.unknown", node, { found: node.nodeName, version: api.model.version });
        return false; // an unknown element's contents tell us nothing
      }
      if (shape.flow) return false; // XHTML — not ours to judge
      if (shape.c) {
        matchChildren(node, name, shape.c, api);
        return true;
      }

      // Leaves: no element children, and content that suits the declared kind.
      const children = api.childElements(node);
      if (children.length) {
        api.report("structure.childless", node, { found: node.nodeName });
        return false;
      }
      const value = api.textOf(node);
      if (shape.empty) {
        if (value) api.report("structure.not-empty", node, { found: node.nodeName });
      } else if (!value && shape.d == null) {
        // `d` is an XSD default, which applies precisely when the element is
        // left empty — so <CopyrightType/> carries "C" and is not missing a
        // value at all.
        api.report("structure.missing-value", node, { found: node.nodeName });
      }
      return false;
    },
  });

  // Greedy single pass. Sound because the schema has no repeating compound
  // particle and XSD's Unique Particle Attribution makes the first-sets of a
  // choice disjoint, so one-token lookahead never needs revisiting.
  function matchChildren(node, parentName, particle, api) {
    // Error recovery: an element the model has never heard of is reported on
    // its own visit as structure.unknown, so it is left out of the match
    // rather than derailing it. Without this, one typo makes every following
    // sibling "not allowed at this position". Elements that ARE known but
    // misplaced stay in — that mismatch is the finding worth showing.
    const children = api.childElements(node)
      .filter((child) => api.shapeOf(child));
    const names = children.map((child) => api.referenceName(child));
    const state = { children, names, pos: 0, parentName, node };
    matchParticle(particle, state, api);
    while (state.pos < children.length) {
      api.report("structure.unexpected", children[state.pos], {
        found: children[state.pos].nodeName,
        parent: node.nodeName,
      });
      state.pos++;
    }
  }

  function matchParticle(particle, state, api) {
    const kind = particle[0];
    if (kind === "e") return matchElement(particle, state, api);
    if (kind === "s") return matchSequence(particle, state, api);
    return matchChoice(particle, state, api);
  }

  function matchElement(particle, state, api) {
    const [, name, min, max] = particle;
    let seen = 0;
    while (state.pos < state.names.length && state.names[state.pos] === name &&
           (max === 0 || seen < max)) {
      state.pos++;
      seen++;
    }
    if (seen === 0 && min > 0) {
      api.report("structure.missing", state.node,
        { parent: state.node.nodeName, expected: api.displayName(name) });
    }
    // Consume any surplus so one repetition error doesn't cascade into a
    // string of "not allowed here" for the following siblings.
    if (max !== 0 && seen >= max && state.names[state.pos] === name) {
      api.report("structure.repeated", state.children[state.pos], {
        found: state.children[state.pos].nodeName, parent: state.node.nodeName, max,
      });
      while (state.names[state.pos] === name) state.pos++;
    }
  }

  function matchSequence(particle, state, api) {
    const min = particle[1];
    const parts = particle.slice(2);
    if (min === 0 && !startsHere(particle, state)) return;
    for (const part of parts) matchParticle(part, state, api);
  }

  function matchChoice(particle, state, api) {
    const min = particle[1];
    const parts = particle.slice(2);
    const branch = parts.find((part) => startsHere(part, state));
    if (branch) {
      matchParticle(branch, state, api);
      return;
    }
    // A choice is also satisfied vacuously when one of its alternatives can
    // match empty — ONIX uses that shape for the "No…" elements, e.g.
    // gp.authorship is a required choice of (Contributor+, …) or an OPTIONAL
    // <NoContributor>, so supplying neither is legal.
    if (min === 0 || parts.some(nullable)) return;
    api.report("structure.expected-one-of", state.node, {
      parent: state.node.nodeName,
      expected: [...firstNames(particle)].map((n) => `<${api.displayName(n)}>`).join(", "),
    });
  }

  // Can this particle be satisfied by consuming nothing?
  function nullable(particle) {
    if (particle[0] === "e") return particle[2] === 0;
    if (particle[1] === 0) return true;
    const parts = particle.slice(2);
    return particle[0] === "c" ? parts.some(nullable) : parts.every(nullable);
  }

  function startsHere(particle, state) {
    const name = state.names[state.pos];
    return name != null && firstNames(particle).has(name);
  }

  // Element names that may legally begin a particle. Memoised on the particle
  // array itself — the model is a constant, so the sets are computed once per
  // document and reused for every element that shares the particle.
  const firstSets = new WeakMap();

  function firstNames(particle) {
    let names = firstSets.get(particle);
    if (names) return names;
    names = new Set();
    if (particle[0] === "e") {
      names.add(particle[1]);
    } else if (particle[0] === "c") {
      for (const part of particle.slice(2)) {
        for (const name of firstNames(part)) names.add(name);
      }
    } else {
      // A sequence can begin with any of its leading optional parts, and ends
      // the search at its first required part.
      for (const part of particle.slice(2)) {
        for (const name of firstNames(part)) names.add(name);
        const required = part[0] === "e" ? part[2] > 0 : part[1] > 0;
        if (required) break;
      }
    }
    firstSets.set(particle, names);
    return names;
  }

  // ---- the code-list rule ---------------------------------------------------

  registerRule({
    name: "codelist",
    element(node, api) {
      const lists = window.OnixViewerCodeLists;
      const meta = window.OnixViewerCodeListMeta;
      if (!lists) return true;
      const name = api.referenceName(node);
      const list = lists[name];
      if (!list || node.children.length) return true;
      const value = api.textOf(node);
      if (!value) return true;

      const listNumber = meta && meta[name] ? meta[name].listNumber : null;
      const problem = codeProblem(value, listNumber, list);
      if (!problem) return true;
      if (problem.kind === "unknown") {
        api.report("codelist.unknown", node, {
          value, list: listNumber,
          title: meta && meta[name] ? meta[name].title : name,
        });
      } else {
        api.report("codelist.deprecated", node, {
          value, list: listNumber, issue: problem.issue, label: problem.label,
        });
      }
      return true;
    },
  });

  // ---- datatype rule --------------------------------------------------------

  registerRule({
    name: "datatype",
    element(node, api) {
      if (!api.model) return true;
      const shape = api.shapeOf(node);
      if (!shape || !shape.text || typeof shape.text !== "string") return true;
      if (!api.model.datatypes[shape.text] || node.children.length) return true;
      const value = api.textOf(node);
      if (!value) return true;

      const problem = datatypeProblem(value, shape.text, api.model);
      if (problem) {
        api.report(`datatype.${problem.kind}`, node, Object.assign({
          value, type: shape.text, found: node.nodeName,
          title: problem.list ? listTitle(problem.list) : undefined,
        }, problem));
      }
      return true;
    },
  });

  const patternCache = Object.create(null);

  // ---- shared value checks --------------------------------------------------

  // Both the codelist rule and the attribute rule need these, and a second copy
  // would drift. Each returns null when the value is fine.

  function codeProblem(value, listNumber, list) {
    if (!list.has(value)) return { kind: "unknown" };
    const deprecated = window.OnixViewerDeprecatedCodes;
    const issue = deprecated && listNumber && deprecated[listNumber]
      ? deprecated[listNumber][value] : null;
    return issue ? { kind: "deprecated", issue, label: list.get(value) } : null;
  }

  // The lexical space of the XSD built-ins ONIX restricts. dt.Integer,
  // dt.PositiveInteger, dt.PositiveIntegerOrZero and dt.Decimal carry no facets
  // at all, so without this they were entirely unchecked and
  // <NumberOfPages>abc</NumberOfPages> passed.
  const LEXICAL = Object.assign(Object.create(null), {
    decimal: { re: /^[+-]?(\d+(\.\d*)?|\.\d+)$/, article: "a", label: "decimal number" },
    int: { re: /^[+-]?\d+$/, article: "an", label: "integer", min: -2147483648, max: 2147483647 },
    integer: { re: /^[+-]?\d+$/, article: "an", label: "integer" },
    positiveInteger: { re: /^\+?0*[1-9]\d*$/, article: "a", label: "positive integer" },
    nonNegativeInteger: { re: /^\+?\d+$/, article: "a", label: "non-negative integer" },
  });

  function datatypeProblem(value, typeName, model) {
    const facets = model.datatypes[typeName];
    if (!facets) return null;
    // A list is a whitespace-separated sequence of members; the whole value is
    // never one token, so the other checks don't apply.
    if (facets.list) return listProblem(value, facets);
    const lexical = facets.base && LEXICAL[facets.base];
    if (lexical) {
      const numeric = Number(value);
      const outside = !lexical.re.test(value) ||
        (lexical.min != null && numeric < lexical.min) ||
        (lexical.max != null && numeric > lexical.max);
      if (outside) return { kind: "lexical", base: lexical.label, article: lexical.article };
    }
    if (facets.re && !facets.union && !facets.list) {
      let expression = patternCache[typeName];
      if (expression === undefined) {
        try { expression = new RegExp(`^(?:${facets.re})$`); }
        catch (_) { expression = null; } // XSD regex dialect we can't compile
        patternCache[typeName] = expression;
      }
      if (expression && !expression.test(value)) return { kind: "pattern" };
    }
    if (facets.min != null || facets.max != null || facets.gt != null) {
      const numeric = Number(value);
      const outOfRange = Number.isNaN(numeric) ||
        (facets.min != null && numeric < facets.min) ||
        (facets.max != null && numeric > facets.max) ||
        (facets.gt != null && numeric <= facets.gt);
      if (outOfRange) return { kind: "range" };
    }
    return null;
  }

  // dt.CountryCodeList and dt.RegionCodeList: space-separated codes that
  // together define a territory. Previously the whole value was skipped, so
  // <CountriesIncluded>XX YY</CountriesIncluded> passed unchallenged.
  function listProblem(value, facets) {
    const members = value.split(/\s+/).filter(Boolean);
    if (facets.minLength != null && members.length < facets.minLength) {
      return { kind: "empty-list" };
    }
    if (!facets.listOf) return null;
    const list = window.OnixViewerCodeListsByNumber &&
      window.OnixViewerCodeListsByNumber[facets.listOf];
    if (!list) return null;
    for (const member of members) {
      if (!list.has(member)) {
        return { kind: "list-member", member, list: facets.listOf };
      }
    }
    return null;
  }

  // ---- attribute rule -------------------------------------------------------

  // ONIX carries ten attributes in total — datestamp, sourcename, sourcetype,
  // language, textscript, textformat, textcase, dateformat, collationkey and
  // release — and they were unchecked until now: a textformat="99" sailed
  // through while the same bad code in an element was reported. Their names are
  // identical in both dialects (only element names shorten), so nothing needs
  // translating here.
  //
  // Only unqualified attributes are ours to judge. Testing namespaceURI for
  // null excludes xmlns declarations, xsi:schemaLocation and xml:lang in one
  // go — all legal, none of them ONIX's.
  registerRule({
    name: "attribute",
    element(node, api) {
      if (!api.model) return true;
      const name = api.referenceName(node);
      const shape = api.shapeOf(node);
      if (!shape) return true; // already reported as structure.unknown

      const allowed = shape.a != null ? api.model.attributeSets[shape.a] : [];
      for (const attribute of node.attributes) {
        if (attribute.namespaceURI !== null) continue;
        checkAttribute(node, name, attribute, allowed, api);
      }
      for (const attributeName of allowed) {
        const spec = api.model.attributes[attributeName];
        if (spec && spec.required && !node.hasAttribute(attributeName)) {
          api.report("attribute.missing", node, { element: node.nodeName, name: attributeName });
        }
      }
      return true;
    },
  });

  function checkAttribute(node, referenceName, attribute, allowed, api) {
    const name = attribute.name;
    // Every element may carry refname/shortname, and the only legal value is
    // its own name in that dialect — which the short-tag map already knows, so
    // the model doesn't waste 511 single-value enumerations saying it.
    if (name === "refname" || name === "shortname") {
      const expected = name === "refname"
        ? referenceName
        : nameInDialect(referenceName, "short");
      if (attribute.value !== expected) {
        api.report("attribute.value", node,
          { name, expected: `"${expected}"`, value: attribute.value });
      }
      return;
    }
    if (!allowed.includes(name)) {
      api.report("attribute.unknown", node, { name, element: node.nodeName });
      return;
    }

    const spec = api.model.attributes[name];
    if (!spec) return;

    // Trimming is what the schema does: every enumerated type in ONIX
    // restricts xs:token, which collapses whitespace before validating — so
    // language=" eng " is valid, and language="   " is the empty string.
    const value = attribute.value.trim();
    if (!value) {
      // No ONIX attribute has a legal empty value. Each is either code-list
      // bound (no enumeration includes ""), an enumeration of its own
      // (`release`), or a datatype whose pattern demands a character —
      // dt.NonEmptyString is literally `.*\S.*`. Bailing out here let
      // language="" and datestamp="" through unchecked.
      api.report("attribute.empty", node, { name, element: node.nodeName });
      return;
    }

    if (spec.values) {
      if (!spec.values.includes(value)) {
        api.report("attribute.value", node, {
          name, value, expected: spec.values.map((v) => `"${v}"`).join(" or "),
        });
      }
      return;
    }
    if (spec.list) {
      const list = window.OnixViewerCodeListsByNumber &&
        window.OnixViewerCodeListsByNumber[spec.list];
      if (!list) return;
      const problem = codeProblem(value, spec.list, list);
      if (!problem) return;
      const title = listTitle(spec.list);
      if (problem.kind === "unknown") {
        api.report("attribute.code", node, { name, value, list: spec.list, title });
      } else {
        api.report("attribute.deprecated", node, {
          name, value, list: spec.list, issue: problem.issue, label: problem.label,
        });
      }
      return;
    }
    if (typeof spec.text === "string") {
      const problem = datatypeProblem(value, spec.text, api.model);
      if (problem) {
        // Attribute types are scalars in ONIX, so only the scalar kinds can
        // come back here; anything else would want its own message.
        const code = problem.kind === "lexical" ? "attribute.lexical" : `attribute.${problem.kind}`;
        api.report(code, node, Object.assign({ name, value, type: spec.text }, problem));
      }
    }
  }

  // OnixViewerCodeListMeta is keyed by element name, and 35 lists are bound to
  // attributes rather than elements — so those need the by-number titles.
  function listTitle(listNumber) {
    const titles = window.OnixViewerCodeListTitles;
    return (titles && titles[listNumber]) || `List ${listNumber}`;
  }

  // ---- identity constraints (xs:unique) -------------------------------------

  // The schema carries 142 of these in 3.1 and 85 in 3.0 — "no two <Price> with
  // the same type, currency and territory", "each repeat of <Text> needs a
  // distinct language + textscript". They are compiled into the model as `u`
  // (see tools/generate-content-model.js), so this walks the host element's own
  // subtree once per constraint rather than interpreting XPath.
  //
  // XSD semantics worth keeping: a node whose key is incomplete — any field
  // absent — is simply outside the constraint, not a violation. That is what
  // makes repeated <Text> with no language attribute at all legal, while two
  // with language="eng" is not.
  registerRule({
    name: "unique",
    element(node, api) {
      if (!api.model) return true;
      const shape = api.shapeOf(node);
      if (!shape || !shape.u) return true;
      for (const constraint of shape.u) checkUnique(node, constraint, api);
      return true;
    },
  });

  function checkUnique(node, constraint, api) {
    const selected = selectNodes(node, constraint.s, api);
    if (selected.length < 2) return;
    const seen = new Map();
    for (const candidate of selected) {
      const key = keyOf(candidate, constraint.f, api);
      if (key === null) continue; // incomplete key — outside the constraint
      if (seen.has(key)) {
        api.report("unique.duplicate", candidate, {
          parent: node.nodeName,
          selector: candidate.nodeName,
          fields: describeFields(constraint.f, api),
        });
      } else {
        seen.set(key, candidate);
      }
    }
  }

  // One or two steps of element names, over one or more alternative paths.
  function selectNodes(node, paths, api) {
    const found = [];
    for (const path of paths) {
      let level = [node];
      for (const step of path) {
        const next = [];
        for (const parent of level) {
          for (const child of parent.children) {
            if (api.referenceName(child) === step) next.push(child);
          }
        }
        level = next;
      }
      found.push(...level);
    }
    return found;
  }

  // null when any field is absent, so the node falls outside the constraint.
  // \u0000 separates parts: it cannot occur in XML character data, so no pair of
  // field values can collide by concatenation.
  function keyOf(node, fields, api) {
    const parts = [];
    for (const field of fields) {
      let value = null;
      if (field.self) {
        value = textOf(node).trim();
        if (!value) value = null;
      } else if (field.a) {
        value = node.hasAttribute(field.a) ? node.getAttribute(field.a).trim() : null;
      } else if (field.c) {
        for (const child of node.children) {
          if (api.referenceName(child) === field.c) { value = textOf(child).trim(); break; }
        }
        if (value === "") value = null;
      }
      if (value === null) return null;
      parts.push(value);
    }
    return parts.join("\u0000");
  }

  function describeFields(fields, api) {
    const names = fields.map((field) => {
      if (field.self) return "value";
      if (field.a) return field.a;
      return api.displayName(field.c);
    });
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  // ---- room to grow ---------------------------------------------------------

  // Two rules the architecture is shaped for but that aren't written yet:
  //
  //   xs:unique — the 3.1 schema carries 125 identity constraints ("no two
  //   <Price> with the same PriceType, CurrencyCode and Territory"). The
  //   generator would emit selector/field paths per element; the rule collects
  //   keys in element() and reports duplicates in finish().
  //
  //   GTIN-13 / ISBN-13 check digits — pure arithmetic on <IDValue> where the
  //   sibling <ProductIDType> is 03 or 15. An element()-only rule, no model
  //   needed.
  //
  // Elements EDItEUR has deprecated. Its own rule rather than a branch of
  // `structure`, so it applies to leaves and composites alike and can be
  // dropped without touching the content-model matcher.
  registerRule({
    name: "deprecation",
    element(node, api) {
      if (api.model) {
        const name = api.referenceName(node);
        const note = api.model.deprecated && api.model.deprecated[name];
        // One element is deprecated only in one parent: <TextSourceDescription>
        // within <TextContent>, but not within <TextSource>.
        const applies = note && (!note.within || api.parentName(node) === note.within);
        if (applies) {
          api.report("element.deprecated", node, {
            name: node.nodeName,
            since: note.since ? ` from ${note.since}` : "",
            advice: note.advice ? ` — ${api.displayPhrase(note.advice)}` : "",
          });
        }
      }
      return true;
    },
  });

  // GTIN-13 and ISBN-13 check digits. The schema can't see these — both are
  // just 13 digits to it — and a wrong one is a common real defect, so it is
  // worth the twenty lines. ISBN-10 (type 02) uses a different, mod-11
  // algorithm and is checked too.
  registerRule({
    name: "gtin",
    element(node, api) {
      if (api.referenceName(node) === "IDValue") {
        const scheme = IDENTIFIER_SCHEMES[api.siblingValue(node, "ProductIDType")];
        const value = api.textOf(node).trim();
        if (scheme && scheme.length === value.length && /^[0-9Xx]+$/.test(value)) {
          const expected = scheme.checkDigit(value);
          if (expected !== null && expected !== value.slice(-1).toUpperCase()) {
            api.report("gtin.checkdigit", node, { value, scheme: scheme.label, expected });
          }
        }
      }
      return true;
    },
  });

  // Keyed by ProductIDType (List 5): 03 GTIN-13, 15 ISBN-13, 02 ISBN-10.
  // A length mismatch is left to the datatype rule — reporting a check digit
  // for a value that isn't the right length would only add noise.
  const IDENTIFIER_SCHEMES = Object.assign(Object.create(null), {
    "02": { label: "ISBN-10", length: 10, checkDigit: isbn10CheckDigit },
    "03": { label: "GTIN-13", length: 13, checkDigit: gtin13CheckDigit },
    "15": { label: "ISBN-13", length: 13, checkDigit: gtin13CheckDigit },
  });

  // Alternating weights of 1 and 3 from the left, then the digit that takes
  // the total to a multiple of 10.
  function gtin13CheckDigit(value) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return String((10 - (sum % 10)) % 10);
  }

  // Weights 10 down to 2, modulo 11; a remainder of 10 is written "X".
  function isbn10CheckDigit(value) {
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += Number(value[i]) * (10 - i);
    }
    const remainder = (11 - (sum % 11)) % 11;
    return remainder === 10 ? "X" : String(remainder);
  }

  // Both are additive: registerRule({...}) plus their message templates.

  window.OnixViewerValidation = {
    run,
    start,
    message,
    severity,
    messages: MESSAGES,
    severities: SEVERITIES,
    rules: RULES,
    registerRule,
    modelFor,
    availableVersions,
  };
})();
