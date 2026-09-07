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
    "datatype.range": "\"{value}\" is out of range for {type}",
    "codelist.unknown": "\"{value}\" is not in List {list} ({title})",
    "codelist.deprecated": "\"{value}\" ({label}) was deprecated in List {list} at issue {issue}",
    "model.missing": "No content model bundled for ONIX {version}; structure was not checked",
  });

  // Severity per code, overridable like MESSAGES. An error is a schema
  // violation; a warning is valid ONIX that shouldn't be sent, or something
  // the viewer couldn't check. Anything unlisted is an error, so a new rule
  // is conservative until it says otherwise.
  const SEVERITIES = Object.assign(Object.create(null), {
    "codelist.deprecated": "warning",
    "model.missing": "warning",
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
    const model = modelFor(onixCtx.version);
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
      childElements,
      textOf,
    };

    if (!model) {
      api.report("model.missing", doc.documentElement, {
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
      const shape = api.model.elements[name];

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
      } else if (!value) {
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
      .filter((child) => api.model.elements[api.referenceName(child)]);
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
      api.report("structure.missing", state.node, { parent: state.node.nodeName, expected: name });
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
      expected: [...firstNames(particle)].map((n) => `<${n}>`).join(", "),
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
      if (!list.has(value)) {
        api.report("codelist.unknown", node, {
          value, list: listNumber,
          title: meta && meta[name] ? meta[name].title : name,
        });
        return true;
      }
      const deprecated = window.OnixViewerDeprecatedCodes;
      const issue = deprecated && listNumber && deprecated[listNumber]
        ? deprecated[listNumber][value] : null;
      if (issue) {
        api.report("codelist.deprecated", node, {
          value, list: listNumber, issue, label: list.get(value),
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
      const shape = api.model.elements[api.referenceName(node)];
      if (!shape || !shape.text || typeof shape.text !== "string") return true;
      const facets = api.model.datatypes[shape.text];
      if (!facets || node.children.length) return true;
      const value = api.textOf(node);
      if (!value) return true;

      if (facets.re && !facets.union && !facets.list) {
        let expression = patternCache[shape.text];
        if (expression === undefined) {
          try { expression = new RegExp(`^(?:${facets.re})$`); }
          catch (_) { expression = null; } // XSD regex dialect we can't compile
          patternCache[shape.text] = expression;
        }
        if (expression && !expression.test(value)) {
          api.report("datatype.pattern", node, { value, type: shape.text, found: node.nodeName });
          return true;
        }
      }
      if (facets.min != null || facets.max != null || facets.gt != null) {
        const numeric = Number(value);
        const outOfRange = Number.isNaN(numeric) ||
          (facets.min != null && numeric < facets.min) ||
          (facets.max != null && numeric > facets.max) ||
          (facets.gt != null && numeric <= facets.gt);
        if (outOfRange) {
          api.report("datatype.range", node, { value, type: shape.text, found: node.nodeName });
        }
      }
      return true;
    },
  });

  const patternCache = Object.create(null);

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
