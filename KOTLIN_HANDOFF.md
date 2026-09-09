# Kotlin ONIX validator — implementation handoff

Porting this extension's compiled-XSD validator to Kotlin, parsing with
[Aalto](https://github.com/FasterXML/aalto-xml). The schema work is already done
and reusable; the parts that need designing are **streaming**, **model
delivery**, and **where conformance comes from**.

Every figure below is measured from the shipping ONIX 3.1 model at `v0.9.16`,
not estimated. Regenerate them with `tools/generate-content-model.js` if the
schema moves.

**Contents**

1. [Decide the route first](#1-decide-the-route-first)
2. [Shape of the problem](#2-shape-of-the-problem)
3. [The XSD subset](#3-the-xsd-subset)
4. [Model and delivery](#4-model-and-delivery)
5. [The streaming matcher](#5-the-streaming-matcher)
6. [The rule seam](#6-the-rule-seam)
7. [Traps already paid for](#7-traps-already-paid-for)
8. [Proving it correct](#8-proving-it-correct)
9. [What to reuse](#9-what-to-reuse)
10. [Open decisions](#10-open-decisions)

---

## 1. Decide the route first

The browser version compiles the XSD because browsers have no XSD processor and
libxml2-via-WASM would have added ~4 MB plus `'wasm-unsafe-eval'`. **That
constraint does not exist on the JVM.** Xerces ships in the JDK. So the case for
a hand-built validator has to rest on something else — and it does, but be
honest about which thing.

### Route A — borrow conformance

A SAX parser feeds `javax.xml.validation.ValidatorHandler`, which validates
*and forwards* events to your own `ContentHandler` downstream. One traversal, no
DOM. `TypeInfoProvider` hands you each element's and attribute's resolved type.

- Works for **any** XSD on day one
- Nothing to maintain but your rules
- Xerces' wording for schema errors, yours for domain rules
- Aalto optional — the validator dominates the cost, so its speed edge is
  mostly moot

### Route B — own the matcher

Compile each content model to a state table at build time, intern element names
to `Int`, and validate as Aalto pulls. No Xerces at runtime. This is the only
route where Aalto's speed is actually on the table, because nothing else is in
the way.

- One name lookup plus one array index per element
- Full control of messages, severities and slicing
- One model for both dialects, via the short-tag map
- You now own a matcher, and it was subtly wrong twice in JS (see §7)

### Recommended sequencing

Build the rule engine against Route A, measure Xerces on a real feed, and only
move to Route B if the numbers demand it. Route B then slots in underneath the
same rule engine as a faster backend. The reusable, differentiated asset is the
rule engine — not the XSD interpretation, which is a commodity here.

### One thing to settle immediately

**Aalto does no validation.** It is FasterXML's non-blocking StAX/SAX parser and
implements no DTD, RELAX NG or XSD checking. `validateAgainst` is Woodstox's
StAX2 extension, and even there W3C Schema support leans on MSV as an extra
dependency. Aalto and XSD validation are alternatives, not partners.

---

## 2. Shape of the problem

Measured from `Resources/onix-content-model-3.1.js`:

| | |
|---|---|
| Element types | 510 (512 in 3.0) |
| Composites with a content model | 143 |
| Total particles | 1,401 |
| — element references | 978 (359 of them unbounded) |
| — sequences | 346 |
| — choices | 77 |
| Max particle nesting | 10 |
| Max branches in one particle | 20 |
| Compiled model size | 65.2 KB (3.1), 61.7 KB (3.0) |

Largest content models: `<Contributor>` 88 particles, `<NameAsSubject>` 79,
`<TextSource>` 78, `<AlternativeName>` 74, `<DescriptiveDetail>` 72.

Identity constraints add 142 compiled `xs:unique` in 3.1 and 85 in 3.0, hanging
off 51 host elements.

**The headline: 143 small automata over ~1,400 particles.** A DFA per content
model is a few tens of KB of flat `IntArray`s. There is no scale problem here —
the engineering is all in correctness and in the streaming inversion, not in
size.

Alongside the content models you need the reference data, all already generated:

| | |
|---|---|
| Code lists | 165, holding 4,791 code/label pairs |
| Element → list bindings | 158 |
| Short-tag → reference-name pairs | 530 (both releases merged) |
| Deprecated codes | 167 across 25 lists |
| Deprecated elements | 7 in 3.1, 18 in 3.0 |
| Attributes | 10, in 10 pooled sets |

---

## 3. The XSD subset

The compiled route is not a general XSD implementation. It buys its speed by
betting on properties of this particular schema, and one of those bets is a hard
`throw` in the generator. If you build a library rather than an ONIX validator,
this table is your specification — and the honest posture is to *check* the
profile and name the construct that disqualifies a schema, rather than emit a
model the matcher will quietly mis-match.

| XSD feature | In ONIX 3.1 | Status | Consequence |
|---|---|---|---|
| `xs:attribute` | 2,770 | handled | Ten distinct attributes; specs global, names identical in both dialects |
| `xs:complexContent` | 29 | handled | 28 extend `Flow` and are deliberately opaque (XHTML); the one that extends a real complexType is compiled normally |
| Simple-type facets | 19 types | handled | Patterns, numeric ranges, `minLength`, **and the base type** — four types have no facets at all |
| `xs:list` | 2 | handled | Members checked against their item list; `minLength` enforced |
| `xs:union` | 2 | partial | Unwrapped when it has exactly one member type; otherwise opaque |
| `xs:unique` | 142 | handled | 85 in 3.0, all compiled; the generator throws on a shape it cannot compile |
| Repeating compound particle | 0 | **asserted** | Generator throws. This is what makes the matcher backtrack-free |
| `xs:import` | 0 | not handled | Single target namespace only |
| `xs:include` | 2 | not followed | Code lists and the XHTML subset are handled out of band |
| `xs:any`, `xs:all`, `substitutionGroup` | 0 | absent | Never exercised, so never implemented |
| `nillable`, `abstract`, `xsi:type`, `redefine` | 0 | absent | Same |

Three of those absences are what make one-token lookahead exact. XSD's Unique
Particle Attribution rule makes the alternatives of a choice disjoint; with no
`xs:any`, no substitution groups and no repeating compound particle, every
sequence and choice is entered at most once and nothing ever needs revisiting.
**That is precisely the property a streaming matcher needs** — the same
guarantee that kept the DOM matcher simple pays off twice as hard here.

---

## 4. Model and delivery

The current encoding, for reference. Particles are arrays so the emitted model
stays small:

```
// particle forms
["e", name, min, max]   element; max 0 means unbounded
["s", min, ...parts]    sequence, matched at most once
["c", min, ...parts]    choice, matched at most once

// leaves
{ list: N }        code-list bound
{ text: "Type" }   datatype bound
{ empty: 1 }       no content
{ flow: 1 }        XHTML — never inspected

// on an element, beside its content particle
a               index into attributeSets
u               identity constraints: [{ s: [[step, ...], ...], f: [field, ...] }]
                field is { c: "Child" } | { a: "attr" } | { self: 1 }

// per model, beside `elements`
datatypes       19 entries: patterns, numeric ranges, minLength, base type
attributes      10 specs, global in effect
attributeSets   10 pooled name sets; each element stores an index
deprecated      name -> { since?, advice?, within? }
```

Names in the model are **reference names only**. Short-tag documents are
validated by translating each name through the generated map first, which halves
the model and keeps one source of truth for the aliases. There is a test
asserting the two dialects of one record produce identical findings, and it is
worth carrying over.

### Ship it as a binary resource, not generated Kotlin

Two reasons, and the first is a hard wall. **The JVM caps a method at 64 KB of
bytecode.** 510 elements of nested array literals in a static initialiser will
blow past it, and it fails as a compile error that reads like nonsense. Flat
`IntArray`s read from a resource through a `ByteBuffer` load in microseconds,
sidestep the limit entirely, and let you memory-map later if you ever care.

Second: the same applies to the 4,791 code-list pairs. Sorted arrays with binary
search or a build-time perfect hash — not a `HashMap<String, Map<String,
String>>` rebuilt at every startup.

### Intern names at build time

Map all 511 referenced element names to `Int` in the generator, and emit
transitions over those ints. Then validating an element is one name→id lookup
plus one array index. The lookup is the one cost you cannot remove, since Aalto
hands you a `String`: a generated minimal perfect hash makes it a single probe, a
plain `HashMap<String, Int>` is far less work. Measure before optimising — at 143
automata the tables are not where the time goes.

---

## 5. The streaming matcher

This is the one genuinely new piece of engineering.

The DOM matcher collects an element's children into an array and matches the
particle tree against that array. A pull parser gives you one event at a time,
so the matcher has to become **incremental**: a stack of cursors, one frame per
open element.

```
START_ELEMENT   consult the current frame's cursor, advance it,
                push a new frame for the child
END_ELEMENT     check the cursor reached an accepting position —
                every required particle satisfied — then pop
```

Because of UPA and the absent constructs, that cursor never needs to back up. It
is a deterministic pushdown automaton, and the accepting check at `END_ELEMENT`
is where `structure.missing` and `structure.expected-one-of` come from.

Two behaviours from the DOM version must survive the port, because both were
bugs before they were features:

- **A choice can be satisfied by nothing.** `gp.authorship` is a *required*
  choice whose second branch is an optional element, so supplying neither a
  contributor nor `<NoContributor>` is legal. The matcher needs a `nullable()`
  predicate over particles; without it, EDItEUR's own sample reports a false
  error.
- **Unknown elements are skipped, not matched.** An element the model has never
  heard of is reported once and left out of its parent's match. In a stream that
  means the cursor must not advance for it. Without that recovery, one typo
  makes every following sibling "not allowed at this position" — nine findings
  for four defects, measured.

---

## 6. The rule seam

This is the part worth generalising, whichever route you take.

The JS registry offers every element to every rule on a single traversal, so a
new rule costs no extra pass. Six ship today: `structure`, `codelist`,
`datatype`, `attribute`, `deprecation` and `gtin`. The streaming equivalent
needs enter and exit hooks rather than one visit:

```kotlin
interface Rule {
    fun onStart(name: Int, depth: Int, ctx: Context) {}
    fun onText(text: CharSequence, ctx: Context) {}
    fun onEnd(name: Int, depth: Int, ctx: Context) {}
    fun onFinish(ctx: Context) {}
}
```

Seven rules ship in the JS version: `structure`, `codelist`, `datatype`,
`attribute`, `unique`, `deprecation` and `gtin`. Everything the classic XSD
expresses is checked, so a port reaching parity has a fixed target rather than a
moving one.

Around the seam, four pieces that are not XSD-specific and are the actual
product:

- **A message catalogue** keyed by stable codes, so prose is replaceable and
  translatable and the codes are the contract. Findings must be worded in the
  document's own dialect — a short-tag file told about `<TitleText>` when it says
  `<b203>` sends the reader looking for a tag their file does not contain.
- **A severity table** with a conservative default, so a newly registered rule
  is an error until it says otherwise.
- **Sliced, cancellable execution** with progress, so a 4.8 MB feed never blocks
  the caller. In the browser this is a `MessageChannel` pump; on the JVM it is a
  coroutine or a budgeted `step()`, and the interesting part is the API shape,
  not the scheduler.
- **Findings pinned to source positions**, capped, with a running total. Aalto's
  `Location` gives you line and column for free — better than the DOM version,
  which can only point at a node.

### Design for sibling access now

The check-digit rule reads a *sibling*: it needs `<ProductIDType>` to interpret
`<IDValue>`. In a DOM that is free. In a stream it only works if the sibling
arrived earlier — which it does here, because ONIX's sequence puts the type
first, and which will break on the first composite where it does not.

**Give each rule a small per-composite scratch frame and let it decide on that
composite's `onEnd`.** `xs:unique` wants exactly the same shape: accumulate keys
as children go past, report clashes when the parent closes. Build it once,
deliberately, rather than discovering it twice.

---

## 7. Traps already paid for

Real bugs from the JS build, with what each one cost.

### A group reference's own `minOccurs`
*Cost: an optional group became required.*

Collapsing a single-particle group discarded the *reference's* occurrence.
`gp.structured_name` is referenced with `minOccurs="0"`, so flattening it made an
optional group mandatory. Fix: always wrap a group ref as a sequence carrying the
ref's own min.

### The nullable choice
*Cost: false error on EDItEUR's own sample.*

A required `xs:choice` whose branch is optional is satisfiable by nothing. See
§5 — this one is worth a test before you write the code, not after.

### Cascading findings
*Cost: 9 findings for 4 defects.*

An unknown element derailed the rest of the sequence. Filtering model-unknown
children out of the match brought it to 5 findings for 5 defects.

### Scraping the XSD with regexes
*Cost: one element silently missing for months.*

`<xs:element name="x512" default="C">` was skipped because the pattern required
`name="x"` to be the last attribute. `<CopyrightType>` therefore had no short
tag: no code-list label, no dialect translation, and conformant ONIX reported as
an unknown element. Both schemas are parsed as XML now. If you write any new
schema tooling, parse it.

### A union of one treated as opaque
*Cost: every date went unchecked.*

The generator saw `xs:union` on `dt.DateOrDateTime` and gave up, so every
`datestamp` and every date element was unvalidated. That union has exactly one
member type, carrying the five date patterns — a union of one is just that
member.

### Deprecation notes about *children*
*Cost: would flag nearly every ONIX file.*

Three annotations that say "Deprecated" describe an element's children, not
itself: `<Header>`, `<TitleElement>` and `<SalesRestriction>`. The first two
appear in almost every document. The discriminator: "Deprecated" followed
immediately by an element reference or a P.x clause number is about something
else. Also note `<TextSourceDescription>` is deprecated *only* within
`<TextContent>` — deprecation can be context-sensitive.

---

## 8. Proving it correct

**Differential-test against Xerces.** Run both over a corpus of real feeds and
diff the verdicts. That is how you earn confidence in Route B, and it is exactly
how the two matcher bugs in §7 would have been caught on day one instead of
after shipping. Keep Xerces as a test-only dependency and it costs nothing at
runtime.

Expect and account for legitimate divergence: your validator reports things
Xerces cannot (check digits, deprecated elements, your own rules). The reverse
list is now short — identity constraints, `xs:list` members and the base-type
lexical spaces are all covered in JS, so what remains is unions of more than one
member type and the facets ONIX never uses. Encode that expected delta
explicitly so the diff stays meaningful instead of noisy.

Two properties from the JS suite are worth porting as tests in their own right:

- **The two dialects of one record must produce identical findings.**
- **A document must yield the same verdict from its own release's model alone as
  from every model loaded.**

Both caught real bugs.

One note on the corpus: the browser version is validated against EDItEUR's own
reference/short-tag sample pair, which is schema-valid but carries two
deprecation warnings. Real feeds are the better corpus — and 12 of this
project's own test fixtures turned out to carry invalid ISBN check digits, a good
reminder that "our files pass" is not the same as "our files are valid".

---

## 9. What to reuse

`tools/generate-content-model.js` already parses the XSDs correctly and encodes
every trap in §7. Retarget its emit step to write your binary format and you
inherit all of that debugged. It is roughly 300 lines of Node and jsdom, and the
value is in the details, not the volume.

Reuse as-is: the XSD front end, the particle encoding, the group-ref and nullable
handling, the no-repeating-compound assertion, the attribute-set pooling, the
deprecation discriminator, and the short-tag map (530 pairs, both releases merged
— 3.0 keeps about twenty tags 3.1 dropped, so the union is required, not a
convenience).

Also worth carrying over: which releases exist. There are exactly two since 3.0
— a message declares `release="3.0"` or `"3.1"` and nothing else, because each
schema restricts the attribute to its own single value. Revisions like 3.0.8 or
3.1.3 are *not declarable*, so validating against the newest revision of each
release is the only option — and a safe one, since ONIX evolves additively.

---

## 10. Open decisions

Answer these before writing code.

- **Route A or Route B?** Everything else follows. If speed has not been
  measured against plain Xerces on a real feed, that measurement is the first
  task.
- **ONIX validator, or a library for the subset?** A library means owning an XSD
  profile forever and fielding "why doesn't my schema work". The rule engine
  generalises; the schema compiler does not.
- **Are attributes in scope?** Ten of them, global specs, ten pooled sets —
  cheap here, but attribute-use resolution through type derivation is one of the
  expensive parts of generic XSD.
- **Is `xs:unique` in scope?** 142 constraints in 3.1, 85 in 3.0, all of them
  enforced in the JS version — so parity means porting them. In a stream they
  need the same per-composite scratch frame as the check-digit rule, so decide
  before designing the rule seam, not after.
- **Where does the model live?** Binary resource in the jar is the
  recommendation. If it must be generated Kotlin, prove the 64 KB method limit is
  not hit before committing to it.
- **Who owns the generator?** It stays in Node unless someone ports the XSD front
  end. A JS build step in a Kotlin project is a real cost — a deliberate one, not
  an accident.

---

*Source: `github.com/rognlien/onix-viewer` @ `v0.9.16`. Model: ONIX 3.1.3 and
3.0.8, code lists Issue 74. Figures measured 2026-09-08.*
