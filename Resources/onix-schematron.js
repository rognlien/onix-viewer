// onix-schematron.js — ONIX Viewer
//
// Custom validation rules, written as Schematron and evaluated with the
// browser's own XPath 1.0 engine (document.evaluate — no library, nothing to
// bundle). A rule set is installed once per page and runs as one more entry
// in the validator's rule registry, after the schema rules, so its findings
// sit in the same list with the same pills.
//
// The subset understood: <schema> > <pattern> > <rule context="…"> >
// <assert test="…"> / <report test="…">, with <value-of select="…"/> and
// <name/> in the message text, `id` for the finding code and `role` for the
// severity ("warning", otherwise error). Within a pattern a node is judged by
// the first rule whose context selects it, as ISO Schematron specifies.
//
// Rules are written in REFERENCE names, unprefixed, whatever dialect the
// document is in: they run against a mirror of the document in which every
// ONIX element has been renamed to its reference name and stripped of its
// namespace. That is what lets one rule set serve both dialects, and what
// keeps the XPath free of namespace declarations. A message still names the
// element the way the file spells it, since a finding is about the file.

(function () {
  "use strict";

  const SCHEMATRON_NS = "http://purl.oclc.org/dsdl/schematron";
  const ELEMENT = 1;
  const TEXT = 3;
  const CDATA = 4;
  // XPathResult types, by number: the constants live on window.XPathResult,
  // which the mirror document does not expose.
  const STRING_RESULT = 2;
  const BOOLEAN_RESULT = 3;
  const ORDERED_SNAPSHOT = 7;
  // A prefixed name in an XPath step: "onix:Product", but not the "::" of an
  // axis. Chrome refuses one at compile time; jsdom quietly matches nothing.
  const PREFIXED_NAME = /(?:^|[^\w.-])[A-Za-z_][\w.-]*:(?!:)[A-Za-z_*]/;

  const validation = window.OnixViewerValidation;
  const sets = [];
  const usedCodes = new Set();

  validation.messages["schematron.invalid"] = "Custom rule set: {detail}";
  validation.severities["schematron.invalid"] = "warning";

  // ---- parsing --------------------------------------------------------------

  /**
   * Parse a Schematron document into patterns of rules. Nothing is thrown:
   * every construct that is missing, malformed or unsupported becomes an entry
   * in `problems`, and the rest of the rule set still installs.
   */
  function parse(text) {
    const problems = [];
    let patterns = [];
    const root = parseXml(text, problems);
    if (root && (root.localName !== "schema" || root.namespaceURI !== SCHEMATRON_NS)) {
      problems.push(`expected a Schematron <schema> in the ${SCHEMATRON_NS} namespace, found <${root.nodeName}>`);
    } else if (root) {
      patterns = parseSchema(root, problems);
    }
    return { patterns, problems };
  }

  function parseXml(text, problems) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    let root = doc.documentElement;
    if (!root || doc.getElementsByTagName("parsererror").length) {
      problems.push("the rule set is not well-formed XML");
      root = null;
    }
    return root;
  }

  function parseSchema(schema, problems) {
    const patterns = [];
    for (const child of schematronChildren(schema)) {
      if (child.localName === "pattern") {
        patterns.push(parsePattern(child, patterns.length + 1, problems));
      } else {
        rejectUnsupported(child, "schema", problems);
      }
    }
    return patterns;
  }

  function parsePattern(pattern, ordinal, problems) {
    const id = pattern.getAttribute("id") || `pattern${ordinal}`;
    const rules = [];
    if (pattern.getAttribute("abstract") === "true") {
      problems.push(`pattern ${id} is abstract, which is not supported`);
    }
    for (const child of schematronChildren(pattern)) {
      if (child.localName === "rule") {
        rules.push(parseRule(child, id, rules.length + 1, problems));
      } else {
        rejectUnsupported(child, `pattern ${id}`, problems);
      }
    }
    return { id, rules };
  }

  function parseRule(rule, patternId, ordinal, problems) {
    const id = rule.getAttribute("id") || `${patternId}-rule${ordinal}`;
    const context = rule.getAttribute("context");
    const assertions = [];
    if (!context) problems.push(`rule ${id} has no context`);
    if (rule.getAttribute("abstract") === "true") {
      problems.push(`rule ${id} is abstract, which is not supported`);
    }
    for (const child of schematronChildren(rule)) {
      if (child.localName === "assert" || child.localName === "report") {
        assertions.push(parseAssertion(child, id, assertions.length + 1, problems));
      } else {
        rejectUnsupported(child, `rule ${id}`, problems);
      }
    }
    return { id, context: context || "", assertions };
  }

  function parseAssertion(assertion, ruleId, ordinal, problems) {
    const id = assertion.getAttribute("id") || `${ruleId}-${ordinal}`;
    const test = assertion.getAttribute("test");
    if (!test) problems.push(`${assertion.localName} ${id} has no test`);
    return {
      id,
      firesWhen: assertion.localName === "report",
      test: test || "",
      severity: severityOf(assertion.getAttribute("role")),
      template: templateOf(assertion),
    };
  }

  function severityOf(role) {
    const word = (role || "").trim().toLowerCase();
    return word === "warning" || word === "warn" || word === "info" ? "warning" : "error";
  }

  // The message, as a template for the validator's own message(): text with
  // one {placeholder} per <value-of>, filled when the assertion fires, and
  // {name} for <name/>, the context element as the file spells it.
  function templateOf(assertion) {
    const selects = [];
    let text = "";
    for (const child of assertion.childNodes) {
      if (child.nodeType === TEXT || child.nodeType === CDATA) {
        text += child.data;
      } else if (child.nodeType === ELEMENT && child.localName === "value-of") {
        text += placeholder(selects, child.getAttribute("select") || ".");
      } else if (child.nodeType === ELEMENT && child.localName === "name") {
        const path = child.getAttribute("path");
        text += path ? placeholder(selects, `local-name(${path})`) : "{name}";
      } else if (child.nodeType === ELEMENT) {
        text += child.textContent;
      }
    }
    return { text: text.replace(/\s+/g, " ").trim(), selects };
  }

  function placeholder(selects, path) {
    const key = `v${selects.length}`;
    selects.push({ key, path });
    return `{${key}}`;
  }

  function schematronChildren(element) {
    return [...element.children].filter((child) => child.namespaceURI === SCHEMATRON_NS);
  }

  // Documentation and phases are ignored; anything that would change what
  // the rules mean is refused, so a rule set never runs quietly narrower
  // than it was written.
  const IGNORED = new Set(["title", "p", "ns", "phase", "diagnostics", "properties"]);

  function rejectUnsupported(element, where, problems) {
    if (!IGNORED.has(element.localName)) {
      problems.push(`<${element.localName}> in ${where} is not supported`);
    }
  }

  // ---- compiling ------------------------------------------------------------

  // Every expression is compiled once up front, so a typo is reported as a
  // problem with the rule set rather than thrown from the middle of a pass.
  // A rule or assertion with a problem is left out; the rest still runs.
  function compile(parsed) {
    const problems = parsed.problems.slice();
    const patterns = parsed.patterns.map((pattern) => ({
      id: pattern.id,
      rules: pattern.rules.filter((rule) => compileRule(rule, problems)),
    }));
    return { patterns, problems };
  }

  function compileRule(rule, problems) {
    rule.selector = absolutePath(rule.context);
    const usable = checkExpression(rule.selector, `the context of rule ${rule.id}`, problems);
    rule.assertions = rule.assertions.filter((assertion) => compileAssertion(assertion, problems));
    return usable;
  }

  function compileAssertion(assertion, problems) {
    assertion.code = uniqueCode(assertion.id);
    let usable = checkExpression(assertion.test, `the test of ${assertion.id}`, problems);
    for (const select of assertion.template.selects) {
      usable = checkExpression(select.path, `a value-of in ${assertion.id}`, problems) && usable;
    }
    return usable;
  }

  // An empty expression was already reported by the parser as missing.
  function checkExpression(expression, where, problems) {
    let usable = Boolean(expression);
    if (expression && PREFIXED_NAME.test(expression)) {
      problems.push(`${where} uses a namespace prefix; write element names unprefixed, as reference names`);
      usable = false;
    } else if (expression && !compiles(expression)) {
      problems.push(`${where} is not valid XPath 1.0: ${expression}`);
      usable = false;
    }
    return usable;
  }

  function compiles(expression) {
    let ok = true;
    try {
      document.createExpression(expression, null);
    } catch {
      ok = false;
    }
    return ok;
  }

  // A Schematron context is a match pattern — "Product" means every Product
  // anywhere — where XPath wants a path from the root. Each branch of a union
  // gets its own "//" unless it is already absolute.
  function absolutePath(context) {
    return splitUnion(context)
      .map((branch) => (branch.startsWith("/") ? branch : `//${branch}`))
      .join(" | ");
  }

  function splitUnion(expression) {
    const branches = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < expression.length; i++) {
      const char = expression[i];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "[" || char === "(") {
        depth++;
      } else if (char === "]" || char === ")") {
        depth--;
      } else if (char === "|" && depth === 0) {
        branches.push(expression.slice(start, i).trim());
        start = i + 1;
      }
    }
    branches.push(expression.slice(start).trim());
    return branches.filter((branch) => branch !== "");
  }

  function uniqueCode(id) {
    let code = `schematron.${id}`;
    let suffix = 1;
    while (usedCodes.has(code)) code = `schematron.${id}-${++suffix}`;
    usedCodes.add(code);
    return code;
  }

  // ---- the mirror -----------------------------------------------------------

  // The document as the rules see it: every element renamed to its reference
  // name in no namespace, attributes and text carried over, comments and
  // processing instructions dropped. `sourceOf` leads from a mirrored element
  // back to the real one, which is where a finding is pinned. Built with an
  // explicit stack, like the renderer and the validator, so depth costs an
  // array entry rather than a JS frame.
  function mirror(doc, referenceName) {
    const clone = doc.implementation.createDocument(null, null, null);
    const sourceOf = new WeakMap();
    const stack = doc.documentElement ? [{ source: doc.documentElement, parent: clone }] : [];
    while (stack.length) {
      const { source, parent } = stack.pop();
      if (source.nodeType === ELEMENT) {
        const copy = mirrorElement(source, clone, referenceName);
        sourceOf.set(copy, source);
        parent.appendChild(copy);
        pushChildren(source, copy, stack);
      } else {
        parent.appendChild(clone.createTextNode(source.data));
      }
    }
    return { clone, sourceOf };
  }

  function mirrorElement(element, clone, referenceName) {
    const copy = clone.createElementNS(null, referenceName(element));
    for (const attribute of element.attributes) {
      if (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) continue;
      copy.setAttribute(attribute.localName, attribute.value);
    }
    return copy;
  }

  function pushChildren(source, copy, stack) {
    const children = source.childNodes;
    for (let i = children.length - 1; i >= 0; i--) {
      const type = children[i].nodeType;
      if (type === ELEMENT || type === TEXT || type === CDATA) {
        stack.push({ source: children[i], parent: copy });
      }
    }
  }

  // The real node a mirrored one stands for: an attribute or text reports on
  // its element, since that is the row the reader can see.
  function sourceNodeOf(node, mirrored) {
    let element = node;
    if (node.ownerElement) element = node.ownerElement;
    else if (node.nodeType !== ELEMENT) element = node.parentNode;
    return mirrored.sourceOf.get(element) || mirrored.sourceOf.get(mirrored.clone.documentElement);
  }

  // ---- running --------------------------------------------------------------

  function evaluate(mirrored, expression, node, type) {
    return mirrored.clone.evaluate(expression, node, null, type, null);
  }

  function runSet(set, mirrored, api) {
    const failures = new Set();
    for (const pattern of set.patterns) runPattern(pattern, mirrored, api, failures);
    for (const failure of failures) {
      api.report("schematron.invalid", api.doc.documentElement, { detail: failure });
    }
  }

  // Within one pattern, the first rule whose context selects a node owns it.
  function runPattern(pattern, mirrored, api, failures) {
    const claimed = new Set();
    for (const rule of pattern.rules) {
      const nodes = selectNodes(rule, mirrored, failures);
      for (const node of nodes) {
        if (claimed.has(node)) continue;
        claimed.add(node);
        for (const assertion of rule.assertions) judge(assertion, node, mirrored, api, failures);
      }
    }
  }

  function selectNodes(rule, mirrored, failures) {
    const nodes = [];
    try {
      const result = evaluate(mirrored, rule.selector, mirrored.clone, ORDERED_SNAPSHOT);
      for (let i = 0; i < result.snapshotLength; i++) nodes.push(result.snapshotItem(i));
    } catch (error) {
      failures.add(`the context of rule ${rule.id} failed: ${error.message}`);
    }
    return nodes;
  }

  function judge(assertion, node, mirrored, api, failures) {
    try {
      const holds = evaluate(mirrored, assertion.test, node, BOOLEAN_RESULT).booleanValue;
      if (holds === assertion.firesWhen) fire(assertion, node, mirrored, api);
    } catch (error) {
      failures.add(`${assertion.id} failed: ${error.message}`);
    }
  }

  function fire(assertion, node, mirrored, api) {
    const source = sourceNodeOf(node, mirrored);
    const data = { name: source ? source.nodeName : "" };
    for (const select of assertion.template.selects) {
      data[select.key] = evaluate(mirrored, select.path, node, STRING_RESULT).stringValue;
    }
    api.report(assertion.code, source, data);
  }

  // One registered rule serves every installed set. The XPath needs the whole
  // document, so the work happens in finish(), after the walk: one blocking
  // evaluation per rule rather than a slice per node.
  validation.registerRule({
    name: "schematron",
    start(api) {
      for (const set of sets) {
        for (const problem of set.problems) {
          api.report("schematron.invalid", api.doc.documentElement, { detail: problem });
        }
      }
    },
    finish(api) {
      if (sets.length > 0) {
        const mirrored = mirror(api.doc, api.referenceName);
        for (const set of sets) runSet(set, mirrored, api);
      }
    },
  });

  // ---- public API -----------------------------------------------------------

  /**
   * Install a Schematron rule set for every validation pass on this page.
   * Returns { patterns, assertions, problems }: the counts of what installed
   * and the problems found, which the next pass also reports as warnings so
   * the reader learns why a rule did not fire.
   */
  function install(text) {
    const set = compile(parse(text));
    let assertions = 0;
    for (const pattern of set.patterns) {
      for (const rule of pattern.rules) {
        assertions += rule.assertions.length;
        for (const assertion of rule.assertions) {
          validation.messages[assertion.code] = assertion.template.text;
          validation.severities[assertion.code] = assertion.severity;
        }
      }
    }
    sets.push(set);
    return { patterns: set.patterns.length, assertions, problems: set.problems };
  }

  // Forget every installed set, codes included, so a set installed again
  // gets its own ids back rather than a -2 suffix.
  function reset() {
    sets.length = 0;
    usedCodes.clear();
  }

  window.OnixViewerSchematron = { install, parse, reset };
})();
