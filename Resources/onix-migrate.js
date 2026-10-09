// onix-migrate.js — ONIX Viewer
//
// Converts an ONIX 3.0 document to ONIX 3.1 and says what it changed. The
// source is never touched: the document is copied into the 3.1 namespace, and
// an ordered registry of rules rewrites the copy, each change recorded with a
// grade —
//
//   * automatic — applied, and nothing is lost (DateFormat → dateformat)
//   * review    — applied, but a judgement a person should check (where a
//                 title's leading article ends)
//   * manual    — not applied; a person has to decide (CurrencyZone means a
//                 list of countries, PromotionContact is free text)
//
// Where there is more than one sensible answer, a rule offers the choices
// (`decision` on the change) and applies the first unless the reader picked
// another: convert() takes the picks as `options.choices`, keyed by each
// decision's `key`, and a picked change is graded `chosen`.
//
// Like the validator, the walk happens once and every element is offered to
// every rule. Names are compared as reference names and written in the
// document's own dialect, so a short-tag file converts to short tags.
//
// Loaded on demand: the viewer appends it the first time a reader asks for a
// conversion, together with the 3.1 content model, which the leftover and
// duplicate checks read.

(function () {
  "use strict";

  const FROM = "3.0";
  const TO = "3.1";
  const ELEMENT = 1;
  const TEXT = 3;
  const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

  // ---- messages -------------------------------------------------------------

  // {placeholders} are filled from a change's `data`; element names arrive in
  // the document's own spelling. The codes are the contract, not the prose.
  const MESSAGES = Object.assign(Object.create(null), {
    "release.declared": "<{name}> now declares ONIX {to}",
    "dateformat.attribute": "<{name}> {value} becomes the dateformat attribute of <{date}>",
    "dateformat.same": "<{name}> repeats the dateformat attribute <{date}> already carries, and is dropped",
    "dateformat.empty": "<{name}> is empty, and is dropped",
    "dateformat.conflict": "<{name}> {value} contradicts dateformat=\"{attribute}\" on <{date}>: keep one",
    "dateformat.no-date": "<{name}> has no <{date}> beside it to carry the dateformat attribute",
    "audience.converted": "<{name}> {value} becomes an <{audience}> with <{type}> 01",
    "audience.duplicate": "<{name}> {value} is dropped: an <{audience}> already gives it",
    "conference.converted": "<{name}> becomes <{event}>{role}",
    "title.split": "<{name}> \"{title}\" is split after the {language} article \"{prefix}\"",
    "title.no-article": "<{name}> \"{title}\" starts with no {language} article, so it is marked <{noPrefix}/>",
    "title.language-unknown": "<{name}> \"{title}\" is marked <{noPrefix}/>: its language is not given, so no article was looked for",
    "title.language-unsupported": "<{name}> \"{title}\" is marked <{noPrefix}/>: no articles are known for language \"{language}\"",
    "title.redundant": "<{name}> is dropped: <{parent}> already gives the title as prefix and remainder",
    "duplicate.removed": "<{name}> repeats an earlier one exactly, and is dropped",
    "element.removed": "<{name}> is not part of ONIX {to}{advice}",
    "element.deprecated": "<{name}> is deprecated in ONIX {to}{since}{advice}",
    "title.first-word": "<{name}> \"{title}\" is split after its first word, \"{prefix}\"",
    "title.none": "<{name}> \"{title}\" is marked <{noPrefix}/>",
    "default.pushed": "<{name}> {value} goes into each {target} ({count}), and leaves the header",
    "default.partial": "<{name}> {value} goes into each {target} ({count}), and leaves the header; {missing} without a <{holder}> get none",
    "textsource.converted": "<{name}>'s source becomes {count} <{textSource}>",
    "textsource.kept": "<{name}>'s source keeps the elements deprecated in ONIX {to} (since revision 3.1.3)",
    "gender.dropped": "<{name}> {value} is dropped: ONIX {to} has no place for it",
    "gender.kept": "<{name}> is not part of ONIX {to}, and is kept for you to decide",
    "salesrestriction.kept": "<{name}> directly in <{parent}> is not part of ONIX {to}: it belongs inside a <{salesRights}>",
    "salesrestriction.for-sale": "<{name}> moves into each <{salesRights}> that is for sale ({count})",
    "salesrestriction.every": "<{name}> moves into every <{salesRights}> ({count})",
    "salesrestriction.dropped": "<{name}> is dropped",
    "currencyzone.kept": "<{name}> {value} is not part of ONIX {to}: a <{territory}> says where the price applies",
    "currencyzone.territory": "<{name}> {value} becomes a <{territory}> of the {count} eurozone countries of {year}",
    "currencyzone.dropped": "<{name}> {value} is dropped{note}",
    "promotioncontact.kept": "<{name}> is not part of ONIX {to}: a <{contact}> with a role and a name replaces it",
    "promotioncontact.contact": "<{name}> becomes a <{contact}> with role 02, Promotional contact",
    "promotioncontact.dropped": "<{name}> is dropped",
    "reissue.kept": "<{name}> is not part of ONIX {to}{advice}",
    "reissue.date": "<{name}> leaves its date as a <{date}> with role 21, Forthcoming reissue date, and the rest is dropped",
    "reissue.dropped": "<{name}> is dropped, with everything in it",
  });

  function message(change) {
    const template = MESSAGES[change.code] || change.code;
    const data = change.data || {};
    return template.replace(/\{(\w+)\}/g, (whole, key) => (data[key] == null ? whole : String(data[key])));
  }

  // ---- articles -------------------------------------------------------------

  // The leading articles a title files without, per ISO 639-2/B code, as the
  // MARC non-filing tables list them. An entry ending in an apostrophe is
  // elided and joins the next word directly (L'Étranger).
  const ARTICLES = {
    eng: ["the", "a", "an"],
    fre: ["le", "la", "les", "l'", "un", "une"],
    ger: ["der", "die", "das", "dem", "den", "des", "ein", "eine", "einem", "einen", "einer", "eines"],
    spa: ["el", "la", "lo", "los", "las", "un", "una", "unos", "unas"],
    ita: ["il", "lo", "la", "i", "gli", "le", "l'", "un", "uno", "una", "un'"],
    dut: ["de", "het", "een", "'t"],
    por: ["o", "a", "os", "as", "um", "uma"],
    nor: ["den", "det", "de", "ei", "en", "et"],
    swe: ["den", "det", "de", "en", "ett"],
    dan: ["den", "det", "de", "en", "et"],
  };

  const LANGUAGE_NAMES = {
    eng: "English", fre: "French", ger: "German", spa: "Spanish", ita: "Italian",
    dut: "Dutch", por: "Portuguese", nor: "Norwegian", swe: "Swedish", dan: "Danish",
  };

  // List 74 is ISO 639-2/B, but feeds send the terminology codes too.
  const LANGUAGE_ALIASES = { fra: "fre", deu: "ger", nld: "dut", nob: "nor", nno: "nor" };

  // ---- rules ----------------------------------------------------------------

  const RULES = [];

  function registerRule(rule) {
    RULES.push(rule);
  }

  // The root declares the new release: the namespace moved with the copy, and
  // a `release` attribute, which a standalone <Product> does not carry, says
  // the same.
  registerRule({
    name: "release",
    element(node, api) {
      if (node !== api.doc.documentElement) return;
      const before = startTag(api.source(node));
      if (node.hasAttribute("release")) node.setAttribute("release", TO);
      api.change("release.declared", "automatic", node, { before, after: startTag(node), data: { to: TO } });
    },
  });

  // <DateFormat> left with 3.1; the format is the dateformat attribute of the
  // <Date> beside it, which 3.0 already allowed.
  registerRule({
    name: "dateformat",
    element(node, api) {
      if (api.referenceName(node) !== "DateFormat") return;
      const composite = node.parentNode;
      const date = api.childNamed(composite, "Date");
      const value = node.textContent.trim();
      const existing = date && date.getAttribute("dateformat");
      const data = { value, date: api.displayName("Date"), attribute: existing };
      if (!date) {
        api.change("dateformat.no-date", "manual", node, { data });
      } else if (existing && existing.trim() !== value && value) {
        api.change("dateformat.conflict", "manual", node, { data });
      } else {
        const before = api.snippetOf(api.source(composite));
        if (value && !existing) date.setAttribute("dateformat", value);
        api.remove(node);
        const code = !value ? "dateformat.empty" : existing ? "dateformat.same" : "dateformat.attribute";
        api.change(code, "automatic", node, { before, after: api.snippetOf(composite), data });
      }
    },
  });

  // <AudienceCode> X is what <Audience> says with type 01, ONIX audience
  // codes, and List 28 is the list both use.
  registerRule({
    name: "audience",
    element(node, api) {
      if (api.referenceName(node) !== "AudienceCode") return;
      const value = node.textContent.trim();
      const data = { value, audience: api.displayName("Audience"), type: api.displayName("AudienceCodeType") };
      const before = api.snippetOf(api.source(node));
      if (hasOnixAudience(node.parentNode, value, api)) {
        api.remove(node);
        api.change("audience.duplicate", "automatic", node, { before, data });
      } else {
        const indent = api.indentOf(node);
        const audience = api.build("Audience", [
          api.build("AudienceCodeType", "01", api.childIndent(indent)),
          api.build("AudienceCodeValue", value, api.childIndent(indent)),
        ], indent);
        copyAttributes(node, audience);
        api.replace(node, [audience]);
        api.change("audience.converted", "automatic", node, { before, after: api.snippetOf(audience), data });
      }
    },
  });

  function hasOnixAudience(parent, value, api) {
    return api.childrenNamed(parent, "Audience").some((audience) => {
      const type = api.childNamed(audience, "AudienceCodeType");
      const code = api.childNamed(audience, "AudienceCodeValue");
      return !!type && !!code && type.textContent.trim() === "01" && code.textContent.trim() === value;
    });
  }

  // <Conference> is <Event> by another name, child for child. The one
  // difference: <EventRole> is required, where <ConferenceRole> was optional
  // with a schema default of 01, so that default is written out.
  const CONFERENCE_NAMES = {
    Conference: "Event",
    ConferenceRole: "EventRole",
    ConferenceName: "EventName",
    ConferenceAcronym: "EventAcronym",
    ConferenceNumber: "EventNumber",
    ConferenceTheme: "EventTheme",
    ConferenceDate: "EventDate",
    ConferencePlace: "EventPlace",
    ConferenceSponsor: "EventSponsor",
    ConferenceSponsorIdentifier: "EventSponsorIdentifier",
    ConferenceSponsorIDType: "EventSponsorIDType",
  };
  const CONFERENCE_DEFAULT_ROLE = "01";

  registerRule({
    name: "conference",
    element(node, api) {
      if (api.referenceName(node) !== "Conference") return;
      const before = api.snippetOf(api.source(node));
      const event = api.renamed(node, CONFERENCE_NAMES);
      const role = api.childNamed(event, "EventRole");
      let defaulted = false;
      if (!role) {
        api.prepend(event, api.build("EventRole", CONFERENCE_DEFAULT_ROLE));
        defaulted = true;
      } else if (!role.textContent.trim()) {
        role.textContent = CONFERENCE_DEFAULT_ROLE;
        defaulted = true;
      }
      api.replace(node, [event]);
      const roleNote = defaulted
        ? `, with <${api.displayName("EventRole")}> ${CONFERENCE_DEFAULT_ROLE}, the role 3.0 assumed when none was given`
        : "";
      api.change("conference.converted", "automatic", node, {
        before, after: api.snippetOf(event), data: { event: api.displayName("Event"), role: roleNote },
      });
    },
  });

  // <TitleText> is deprecated in 3.1 for <TitlePrefix> or <NoPrefix/>, then
  // <TitleWithoutPrefix>. Where the article ends is a guess from the title's
  // language, so a split is always for review; a title in a known language
  // with no article at its head is not.
  const SPLIT_FORMS = ["TitlePrefix", "NoPrefix", "TitleWithoutPrefix"];

  registerRule({
    name: "title",
    element(node, api) {
      if (api.referenceName(node) !== "TitleText") return;
      const parent = node.parentNode;
      const before = api.snippetOf(api.source(parent));
      const data = { title: node.textContent.trim(), parent: api.displayName("TitleElement"), noPrefix: api.displayName("NoPrefix") };
      if (SPLIT_FORMS.some((name) => api.childNamed(parent, name))) {
        api.remove(node);
        api.change("title.redundant", "automatic", node, { before, after: api.snippetOf(parent), data });
      } else {
        const guess = splitTitle(data.title, languageOf(node, api));
        const decision = api.decision("title", node, titleOptions(data.title, guess), guess.prefix ? "article" : "none");
        const outcome = decision.explicit ? Object.assign({}, guess, chosenSplit(data.title, decision.id, guess)) : guess;
        api.replace(node, titleElements(node, outcome, api));
        Object.assign(data, { prefix: outcome.prefix, language: outcome.languageName || outcome.language });
        api.change(outcome.code, decision.explicit ? decision.grade : outcome.grade, node, {
          before, after: api.snippetOf(parent), data, decision,
        });
      }
    },
  });

  // The article the guess found, the first word, or no prefix at all: the
  // three answers a reader may give, whatever the guess was. The first word
  // is offered only when it is not the article already.
  function titleOptions(title, guess) {
    const firstWord = firstWordOf(title);
    const options = [];
    if (guess.prefix) options.push({ id: "article", label: `"${guess.prefix}" + "${guess.rest}"`, grade: guess.grade });
    if (firstWord && firstWord !== guess.prefix) {
      options.push({ id: "first-word", label: `"${firstWord}" + "${title.slice(firstWord.length).trim()}"`, grade: "review" });
    }
    options.push({ id: "none", label: `No prefix: "${title}"`, grade: guess.prefix ? "review" : guess.grade });
    return options;
  }

  function firstWordOf(title) {
    const match = title.match(/^(\S+)\s+\S/);
    return match ? match[1] : null;
  }

  function chosenSplit(title, id, guess) {
    let split = { code: "title.none", prefix: null, rest: title };
    if (id === "article") split = { code: "title.split", prefix: guess.prefix, rest: guess.rest };
    if (id === "first-word") {
      const prefix = firstWordOf(title);
      split = { code: "title.first-word", prefix, rest: title.slice(prefix.length).trim() };
    }
    return split;
  }

  function splitTitle(title, language) {
    const articles = language && ARTICLES[language];
    const prefix = articles ? articlePrefix(title, articles) : null;
    let outcome = null;
    if (!language) {
      outcome = { code: "title.language-unknown", grade: "review" };
    } else if (!articles) {
      outcome = { code: "title.language-unsupported", grade: "review" };
    } else if (prefix) {
      outcome = { code: "title.split", grade: "review", prefix };
    } else {
      outcome = { code: "title.no-article", grade: "automatic" };
    }
    outcome.language = language;
    outcome.languageName = LANGUAGE_NAMES[language];
    outcome.rest = prefix ? title.slice(prefix.length).trim() : title;
    return outcome;
  }

  // The article as written, or null. It must be followed by a space and more
  // title, or, elided, by the next word directly; a title that is nothing but
  // an article is not split.
  function articlePrefix(title, articles) {
    let prefix = null;
    for (const article of articles) {
      const head = title.slice(0, article.length).replace(/’/g, "'").toLowerCase();
      const rest = title.slice(article.length);
      const elided = article.endsWith("'");
      const separated = elided ? /^\S/.test(rest) : /^\s+\S/.test(rest);
      if (!prefix && head === article && separated) prefix = title.slice(0, article.length);
    }
    return prefix;
  }

  function titleElements(titleText, outcome, api) {
    const head = outcome.prefix
      ? api.build("TitlePrefix", outcome.prefix)
      : api.build("NoPrefix");
    const rest = api.build("TitleWithoutPrefix", outcome.rest);
    copyAttributes(titleText, rest);
    copyAttributes(titleText, head, outcome.prefix ? ["collationkey"] : ["collationkey", "language", "textscript", "textcase"]);
    return [head, rest];
  }

  // The title's own language attribute, else the product's one language of
  // text, else the header's default. Several languages of text say nothing
  // about which one a title is in.
  function languageOf(titleText, api) {
    let language = titleText.getAttribute("language");
    if (!language) language = productLanguage(api.ancestorNamed(titleText, "Product"), api);
    if (!language) language = headerLanguage(api);
    const code = language ? language.trim().toLowerCase() : null;
    return code ? LANGUAGE_ALIASES[code] || code : null;
  }

  function productLanguage(product, api) {
    const detail = product && api.childNamed(product, "DescriptiveDetail");
    const codes = new Set();
    for (const language of detail ? api.childrenNamed(detail, "Language") : []) {
      const role = api.childNamed(language, "LanguageRole");
      const code = api.childNamed(language, "LanguageCode");
      if (role && code && role.textContent.trim() === "01") codes.add(code.textContent.trim());
    }
    return codes.size === 1 ? [...codes][0] : null;
  }

  function headerLanguage(api) {
    const header = api.childNamed(api.doc.documentElement, "Header");
    const language = header && api.childNamed(header, "DefaultLanguageOfText");
    return language ? language.textContent : null;
  }

  // The header's defaults are deprecated in 3.1 for saying it in each place
  // it applies. Writing the default into every place that does not say
  // otherwise loses nothing; a product with no <DescriptiveDetail> has nowhere
  // to take a language, which is worth a look, unless it is a deletion.
  const DEFAULTS = {
    DefaultLanguageOfText: { holder: "DescriptiveDetail", target: "with no <Language> of role 01" },
    DefaultPriceType: { holder: "Price", field: "PriceType", target: "with no <PriceType>" },
    DefaultCurrencyCode: { holder: "Price", field: "CurrencyCode", needs: "PriceAmount", target: "with an amount and no <CurrencyCode>" },
  };

  registerRule({
    name: "defaults",
    element(node, api) {
      const name = api.referenceName(node);
      const spec = DEFAULTS[name];
      if (!spec || api.referenceName(node.parentNode) !== "Header") return;
      const value = node.textContent.trim();
      const before = api.snippetOf(api.source(node));
      const outcome = spec.field ? pushIntoPrices(spec, value, api) : pushLanguage(value, api);
      api.remove(node);
      api.change(outcome.missing ? "default.partial" : "default.pushed", outcome.missing ? "review" : "automatic", node, {
        before,
        after: outcome.first ? api.snippetOf(outcome.first) : null,
        data: {
          value, count: outcome.count, missing: outcome.missing,
          target: `<${api.displayName(spec.holder)}> ${api.displayPhrase(spec.target)}`,
          holder: api.displayName(spec.holder),
        },
      });
    },
  });

  function pushLanguage(value, api) {
    const outcome = { count: 0, missing: 0, first: null };
    for (const product of api.products()) {
      const detail = api.childNamed(product, "DescriptiveDetail");
      if (!detail) {
        if (!isDeletion(product, api)) outcome.missing++;
      } else if (!hasLanguageOfText(detail, api)) {
        const indent = api.childIndentOf(detail);
        const language = api.build("Language", [
          api.build("LanguageRole", "01"),
          api.build("LanguageCode", value),
        ], indent);
        api.insertChild(detail, language);
        outcome.count++;
        outcome.first = outcome.first || language;
      }
    }
    return outcome;
  }

  function isDeletion(product, api) {
    const type = api.childNamed(product, "NotificationType");
    return !!type && type.textContent.trim() === "05";
  }

  function hasLanguageOfText(detail, api) {
    return api.childrenNamed(detail, "Language").some((language) => {
      const role = api.childNamed(language, "LanguageRole");
      return !!role && role.textContent.trim() === "01";
    });
  }

  function pushIntoPrices(spec, value, api) {
    const outcome = { count: 0, missing: 0, first: null };
    for (const price of api.elementsNamed("Price")) {
      const applies = !api.childNamed(price, spec.field) && (!spec.needs || api.childNamed(price, spec.needs));
      if (applies) {
        api.insertChild(price, api.build(spec.field, value));
        outcome.count++;
        outcome.first = outcome.first || price;
      }
    }
    return outcome;
  }

  // <TextAuthor>, <TextSourceCorporate> and <TextSourceDescription> in a
  // <TextContent> became one <TextSource> per source in revision 3.1.3. Each
  // author is a person's name and the corporate source a corporate one; the
  // descriptions go with the source when there is exactly one, and when there
  // are several sources nothing says which description is whose, so the old
  // form stays, as it may: it is deprecated, not removed.
  const TEXT_SOURCE_NAMES = { TextAuthor: "PersonName", TextSourceCorporate: "CorporateName" };

  registerRule({
    name: "textsource",
    element(node, api) {
      if (api.referenceName(node) !== "TextContent") return;
      const names = [...node.children].filter((child) => TEXT_SOURCE_NAMES[api.referenceName(child)]);
      const descriptions = api.childrenNamed(node, "TextSourceDescription");
      if (!names.length || (descriptions.length && names.length > 1)) return;
      const before = api.snippetOf(api.source(node));
      const decision = api.decision("textsource", node, [
        { id: "convert", label: `Make each source a <${api.displayName("TextSource")}>`, grade: "review" },
        { id: "keep", label: "Keep the deprecated elements", grade: "manual" },
      ]);
      const data = { to: TO, count: names.length, textSource: api.displayName("TextSource") };
      if (decision.id === "convert") {
        const sources = names.map((name) => textSource(name, descriptions, api));
        api.replace(names[0], sources);
        for (const old of [...names.slice(1), ...descriptions]) api.remove(old);
        api.change("textsource.converted", decision.grade, node, { before, after: api.snippetOf(node), data, decision });
      } else {
        for (const old of [...names, ...descriptions]) api.reportRemoved(old);
        api.change("textsource.kept", decision.grade, node, { before, data, decision });
      }
    },
  });

  function textSource(old, descriptions, api) {
    const indent = api.indentOf(old);
    const name = api.build(TEXT_SOURCE_NAMES[api.referenceName(old)], old.textContent.trim());
    copyAttributes(old, name);
    const moved = descriptions.map((description) => api.moved(description, api.childIndent(indent)));
    return api.build("TextSource", [name, ...moved], indent);
  }

  // <Gender> has no successor in 3.1, so the one thing to do is drop it; the
  // loss is the reader's to accept.
  registerRule({
    name: "gender",
    element(node, api) {
      if (api.referenceName(node) !== "Gender") return;
      const decision = api.decision("gender", node, [
        { id: "drop", label: "Drop it", grade: "review" },
        { id: "keep", label: "Keep it, to decide later", grade: "manual" },
      ]);
      const data = { to: TO, value: node.textContent.trim() };
      if (decision.id === "drop") api.remove(node);
      else api.reportRemoved(node);
      api.change(decision.id === "drop" ? "gender.dropped" : "gender.kept", decision.grade, node, { data, decision });
    },
  });

  // A <SalesRestriction> directly in <PublishingDetail> applied to the
  // product wherever it was sold; in 3.1 it lives in a <SalesRights>. Which
  // ones is the reader's call: the ones that grant sales are the likely
  // answer, every one the literal one.
  const FOR_SALE = ["01", "02", "07", "08"];

  registerRule({
    name: "salesrestriction",
    element(node, api) {
      const parent = node.parentNode;
      if (api.referenceName(node) !== "SalesRestriction" || api.referenceName(parent) !== "PublishingDetail") return;
      const every = api.childrenNamed(parent, "SalesRights");
      const forSale = every.filter((rights) => FOR_SALE.includes(childText(rights, "SalesRightsType", api)));
      const salesRights = api.displayName("SalesRights");
      const options = [{ id: "keep", label: "Keep it, to decide later", grade: "manual" }];
      if (forSale.length) options.push({ id: "for-sale", label: `Move it into each <${salesRights}> for sale (${forSale.length})`, grade: "review" });
      if (every.length > forSale.length) options.push({ id: "every", label: `Move it into every <${salesRights}> (${every.length})`, grade: "review" });
      options.push({ id: "drop", label: "Drop it", grade: "review" });
      const decision = api.decision("salesrestriction", node, options);
      const targets = decision.id === "for-sale" ? forSale : decision.id === "every" ? every : [];
      const data = { to: TO, parent: api.displayName("PublishingDetail"), salesRights, count: targets.length };
      const before = api.snippetOf(api.source(node));
      for (const rights of targets) api.insertChild(rights, api.moved(node, api.childIndentOf(rights)));
      if (decision.id === "keep") api.reportRemoved(node);
      else api.remove(node);
      api.change(`salesrestriction.${decision.id === "keep" ? "kept" : decision.id === "drop" ? "dropped" : decision.id}`,
        decision.grade, node, { before, after: targets.length ? api.snippetOf(targets[0]) : null, data, decision });
    },
  });

  function childText(parent, name, api) {
    const child = api.childNamed(parent, name);
    return child ? child.textContent.trim() : "";
  }

  // <CurrencyZone> had one code, EUR, for the eurozone; 3.1 says where a
  // price applies with a <Territory>, which needs the countries spelled out.
  // The eurozone grows, so the list is dated: these are its members in 2026.
  const EUROZONE = { year: 2026, countries: "AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK" };

  registerRule({
    name: "currencyzone",
    element(node, api) {
      if (api.referenceName(node) !== "CurrencyZone") return;
      const value = node.textContent.trim();
      const hasTerritory = !!api.childNamed(node.parentNode, "Territory");
      const territory = api.displayName("Territory");
      const count = EUROZONE.countries.split(" ").length;
      const options = [{ id: "keep", label: "Keep it, to decide later", grade: "manual" }];
      if (value === "EUR" && !hasTerritory) {
        options.push({ id: "territory", label: `Replace it with a <${territory}> of the ${count} eurozone countries of ${EUROZONE.year}`, grade: "review" });
      }
      options.push({ id: "drop", label: hasTerritory ? `Drop it; the price's own <${territory}> stands` : "Drop it", grade: "review" });
      const decision = api.decision("currencyzone", node, options);
      const data = { to: TO, value, territory, count, year: EUROZONE.year, note: hasTerritory ? `: the price's own <${territory}> stands` : "" };
      const before = api.snippetOf(api.source(node));
      let after = null;
      if (decision.id === "territory") {
        const indent = api.indentOf(node);
        after = api.build("Territory", [api.build("CountriesIncluded", EUROZONE.countries)], indent);
        api.replace(node, [after]);
      } else if (decision.id === "drop") {
        api.remove(node);
      } else {
        api.reportRemoved(node);
      }
      api.change(`currencyzone.${decision.id === "keep" ? "kept" : decision.id === "drop" ? "dropped" : "territory"}`,
        decision.grade, node, { before, after: after ? api.snippetOf(after) : null, data, decision });
    },
  });

  // <PromotionContact> was free text; <ProductContact> wants a role and a
  // name. List 198's 02, Promotional contact, is the role, and the text, as
  // one line, the name — which a reader may want to split into a name and an
  // address by hand.
  registerRule({
    name: "promotioncontact",
    element(node, api) {
      if (api.referenceName(node) !== "PromotionContact") return;
      const contact = api.displayName("ProductContact");
      const decision = api.decision("promotioncontact", node, [
        { id: "keep", label: "Keep it, to decide later", grade: "manual" },
        { id: "contact", label: `Make it a <${contact}> with role 02, Promotional contact`, grade: "review" },
        { id: "drop", label: "Drop it", grade: "review" },
      ]);
      const before = api.snippetOf(api.source(node));
      let after = null;
      if (decision.id === "contact") {
        after = api.build("ProductContact", [
          api.build("ProductContactRole", "02"),
          api.build("ProductContactName", node.textContent.replace(/\s+/g, " ").trim()),
        ], api.childIndentOf(node.parentNode));
        api.insertChild(node.parentNode, after);
      }
      if (decision.id === "keep") api.reportRemoved(node);
      else api.remove(node);
      api.change(`promotioncontact.${decision.id === "keep" ? "kept" : decision.id === "drop" ? "dropped" : "contact"}`,
        decision.grade, node, { before, after: after ? api.snippetOf(after) : null, data: { to: TO, contact }, decision });
    },
  });

  // <Reissue> went with 3.1. Its date has a home in the product's
  // <PublishingDetail>, List 163's 21, Forthcoming reissue date; its prices
  // and resources say the same as their own dated counterparts, so they go.
  registerRule({
    name: "reissue",
    element(node, api) {
      if (api.referenceName(node) !== "Reissue") return;
      const reissueDate = api.childNamed(node, "ReissueDate");
      const product = api.ancestorNamed(node, "Product");
      const publishing = product && api.childNamed(product, "PublishingDetail");
      const dated = api.displayName("PublishingDate");
      const options = [{ id: "keep", label: "Keep it, to decide later", grade: "manual" }];
      if (reissueDate && publishing && !hasPublishingDate(publishing, "21", api)) {
        options.push({ id: "date", label: `Keep its date as a <${dated}> with role 21, and drop the rest`, grade: "review" });
      }
      options.push({ id: "drop", label: "Drop it, with everything in it", grade: "review" });
      const decision = api.decision("reissue", node, options);
      const before = api.snippetOf(api.source(node));
      let after = null;
      if (decision.id === "date") {
        const date = api.build("Date", reissueDate.textContent.trim());
        copyAttributes(reissueDate, date);
        after = api.build("PublishingDate", [api.build("PublishingDateRole", "21"), date], api.childIndentOf(publishing));
        api.insertChild(publishing, after);
      }
      if (decision.id === "keep") api.reportRemoved(node);
      else api.remove(node);
      const advice = api.models[FROM] ? adviceOf(api.models[FROM].deprecated.Reissue, api) : "";
      api.change(`reissue.${decision.id === "keep" ? "kept" : decision.id === "drop" ? "dropped" : "date"}`,
        decision.grade, node, { before, after: after ? api.snippetOf(after) : null, data: { to: TO, date: dated, advice }, decision });
    },
  });

  function hasPublishingDate(publishing, role, api) {
    return api.childrenNamed(publishing, "PublishingDate").some((date) => childText(date, "PublishingDateRole", api) === role);
  }

  // Whatever the rules above did not rewrite and 3.1 does not accept, or
  // accepts but deprecates, is left for a person, with EDItEUR's own advice
  // where the schema gives it. A removed composite is reported once, not once
  // more for each of its children.
  registerRule({
    name: "leftover",
    element(node, api) {
      const name = api.referenceName(node);
      const parentName = api.referenceName(node.parentNode);
      const from = api.models[FROM];
      const to = api.models[TO];
      if (!from || !to || api.insideReported(node)) return;
      if (from.elements[name] && !to.elements[name]) {
        api.reportRemoved(node);
        api.change("element.removed", "manual", node, { data: { to: TO, advice: adviceOf(from.deprecated[name], api) } });
      } else if (deprecatedIn(to, name, parentName)) {
        const note = to.deprecated[name];
        api.change("element.deprecated", "manual", node, {
          data: { to: TO, since: note.since ? ` (since ${note.since})` : "", advice: adviceOf(note, api) },
        });
      }
    },
  });

  function deprecatedIn(model, name, parentName) {
    const note = model.deprecated && model.deprecated[name];
    return !!note && (!note.within || note.within === parentName);
  }

  function adviceOf(note, api) {
    return note && note.advice ? ` — ${api.displayPhrase(note.advice)}` : "";
  }

  // 3.1 adds uniqueness rules 3.0 did not have — one <ContributorRole> of a
  // kind per contributor, one <PublishingDate> per role. A repeat that is
  // identical to an earlier one says nothing new and goes; a repeat that
  // differs is a choice, which the remaining findings put to the reader.
  function removeExactDuplicates(api) {
    const validation = window.OnixViewerValidation;
    if (!validation || !api.models[TO]) return;
    const onix = window.OnixViewerOnix;
    const result = validation.run(api.doc, onix.detect(api.doc), { version: TO, maxFindings: Infinity });
    for (const finding of result.findings) {
      const node = finding.node;
      if (finding.code === "unique.duplicate" && node.isConnected && earlierTwin(node, api)) {
        const before = api.snippetOf(api.source(node));
        api.remove(node);
        api.change("duplicate.removed", "automatic", node, { before, data: {} });
      }
    }
  }

  function earlierTwin(node, api) {
    const name = api.referenceName(node);
    const content = normalised(node);
    let twin = null;
    for (let sibling = node.previousElementSibling; sibling && !twin; sibling = sibling.previousElementSibling) {
      if (api.referenceName(sibling) === name && normalised(sibling) === content) twin = sibling;
    }
    return twin;
  }

  function normalised(node) {
    return new XMLSerializer().serializeToString(node).replace(/>\s+</g, "><").trim();
  }

  function copyAttributes(from, to, except) {
    for (const attribute of from.attributes) {
      if (!(except || []).includes(attribute.name)) to.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    }
  }

  // ---- conversion -----------------------------------------------------------

  /**
   * Converts a parsed ONIX 3.0 document to 3.1. Returns
   * { document, changes, counts, from, to }: `document` is the converted copy,
   * `changes` one entry per change in document order, each
   * { code, grade, node, before, after, data } — `node` the element in the
   * source document it concerns, `before` and `after` the XML around the
   * change (`after` null when nothing replaces it) — and `counts` the number
   * of changes per grade. A change with choices carries `decision`:
   * { key, id, explicit, options: [{ id, label }] }, and `options.choices`
   * maps a decision's key to the option the reader picked. `source(node)`
   * leads from a node of the converted document to the source element it
   * came from, or the nearest one it lies inside.
   */
  function convert(doc, onixCtx, options) {
    const copy = copyToRelease(doc);
    const choices = (options && options.choices) || {};
    const api = createApi(copy.document, copy.sources, onixCtx, choices);
    const elements = [...copy.document.getElementsByTagName("*")].filter((node) => api.isOnix(node));
    for (const node of elements) {
      for (const rule of RULES) {
        if (node.isConnected) rule.element(node, api);
      }
    }
    removeExactDuplicates(api);
    const changes = api.changes.sort(inDocumentOrder);
    return { document: copy.document, changes, counts: countGrades(changes), source: api.source, from: FROM, to: TO };
  }

  // The duplicates are found after the walk, so the list is put back in the
  // order a reader meets the elements in the file.
  function inDocumentOrder(a, b) {
    let order = 0;
    if (a.node !== b.node) order = a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    return order;
  }

  function countGrades(changes) {
    const counts = { automatic: 0, review: 0, manual: 0, chosen: 0 };
    for (const change of changes) counts[change.grade]++;
    return counts;
  }

  // ---- the copy -------------------------------------------------------------

  // The whole document, every node in the ONIX namespace moved to the 3.1
  // one; a declaration of the namespace keeps its place and names 3.1. Each
  // copied node remembers its source, so a change can point at the row the
  // reader sees.
  function copyToRelease(doc) {
    const fromNamespace = (doc.documentElement && doc.documentElement.namespaceURI) || null;
    const context = {
      fromNamespace,
      toNamespace: fromNamespace ? fromNamespace.replace(`/${FROM}/`, `/${TO}/`) : null,
      sources: new WeakMap(),
    };
    const document = doc.cloneNode(false);
    for (const child of doc.childNodes) document.appendChild(copyNode(child, context));
    return { document, sources: context.sources };
  }

  function copyNode(node, context) {
    let copy = null;
    if (node.nodeType === ELEMENT) {
      const inOnix = node.namespaceURI === context.fromNamespace;
      copy = node.ownerDocument.createElementNS(inOnix ? context.toNamespace : node.namespaceURI, node.nodeName);
      for (const attribute of node.attributes) {
        const declaresOnix = attribute.namespaceURI === XMLNS_NS && attribute.value === context.fromNamespace;
        copy.setAttributeNS(attribute.namespaceURI, attribute.name, declaresOnix ? context.toNamespace : attribute.value);
      }
      for (const child of node.childNodes) copy.appendChild(copyNode(child, context));
    } else {
      copy = node.cloneNode(true);
    }
    context.sources.set(copy, node);
    return copy;
  }

  // ---- the rule API ---------------------------------------------------------

  function createApi(doc, sources, onixCtx, choices) {
    const onix = window.OnixViewerOnix;
    const dialect = onixCtx.dialect;
    const namespace = doc.documentElement.namespaceURI;
    const unit = indentUnit(doc);
    const changes = [];
    const reported = [];
    let sourceIndexes = null;

    const api = {
      doc,
      changes,
      models: window.OnixViewerContentModels || {},
      isOnix: (node) => node.namespaceURI === namespace,
      referenceName(node) {
        const name = node && node.localName ? node.localName : "";
        return dialect === "short" ? onix.translatedName(name, "reference") || name : name;
      },
      displayName: (referenceName) => (dialect === "short" ? onix.translatedName(referenceName, "short") || referenceName : referenceName),
      displayPhrase: (text) => text.replace(/<(\w+)(\/?)>/g, (whole, name, empty) => `<${api.displayName(name)}${empty}>`),
      source(node) {
        let current = node;
        while (current && !sources.has(current)) current = current.parentNode;
        return current ? sources.get(current) : null;
      },
      childrenNamed: (parent, name) => [...parent.children].filter((child) => api.referenceName(child) === name),
      elementsNamed: (name) => [...doc.getElementsByTagName("*")].filter((node) => api.isOnix(node) && api.referenceName(node) === name),
      products() {
        const root = doc.documentElement;
        return api.referenceName(root) === "Product" ? [root] : api.childrenNamed(root, "Product");
      },
      childNamed: (parent, name) => api.childrenNamed(parent, name)[0] || null,
      ancestorNamed(node, name) {
        let current = node.parentNode;
        while (current && current.nodeType === ELEMENT && api.referenceName(current) !== name) current = current.parentNode;
        return current && current.nodeType === ELEMENT ? current : null;
      },
      indentOf: leadingIndent,
      childIndent: (indent) => (indent === null ? null : indent + unit),
      // The indentation of the parent's children: its first child's, else one
      // step deeper than the parent's own.
      childIndentOf(parent) {
        const first = parent.firstElementChild;
        return first ? leadingIndent(first) : api.childIndent(leadingIndent(parent));
      },
      // A child put where the 3.1 content model has it: before the first
      // existing child that the model orders after it, else at the end.
      insertChild(parent, child) {
        const shape = api.models[TO] && api.models[TO].elements[api.referenceName(parent)];
        const order = shape && shape.c ? particleOrder(shape.c) : [];
        const position = order.indexOf(api.referenceName(child));
        const next = [...parent.children].find((sibling) => order.indexOf(api.referenceName(sibling)) > position);
        insertBeforeSibling(parent, child, next || null, api.childIndentOf(parent));
      },
      // A copy of `node` for another place, its inner lines re-indented from
      // its own indentation to `indent`.
      moved: (node, indent) => reindented(node.cloneNode(true), leadingIndent(node), indent),
      decision(rule, node, options, defaultId) {
        const key = `${rule}:${sourceIndex(api.source(node))}`;
        const picked = options.find((option) => option.id === choices[key]);
        const option = picked || options.find((candidate) => candidate.id === defaultId) || options[0];
        return {
          key, id: option.id, explicit: !!picked, grade: picked ? "chosen" : option.grade,
          options: options.map(({ id, label }) => ({ id, label })),
        };
      },
      // An element in the document's dialect and namespace, holding `content`:
      // text, or child elements laid out one per line under `indent` when the
      // document is laid out at all.
      build(referenceName, content, indent) {
        const element = doc.createElementNS(namespace, api.displayName(referenceName));
        if (Array.isArray(content)) layOut(element, content, indent === undefined ? null : indent, unit);
        else if (content != null) element.textContent = content;
        return element;
      },
      renamed: (node, names) => renamedCopy(node, names, api),
      replace: replaceNode,
      remove: removeNode,
      prepend: prependChild,
      snippetOf: snippet,
      insideReported: (node) => reported.some((ancestor) => ancestor.contains(node)),
      reportRemoved: (node) => reported.push(node),
      change(code, grade, node, details) {
        changes.push({
          code, grade, node: api.source(node), before: details.before || snippetOf(api, node), after: details.after || null,
          data: Object.assign({ name: (api.source(node) || node).nodeName }, details.data),
          decision: details.decision && details.decision.options.length > 1 ? details.decision : null,
        });
      },
    };

    // A decision's key is its rule and the source element's place in the
    // document, which stays the same from one conversion to the next.
    function sourceIndex(node) {
      if (!sourceIndexes) {
        sourceIndexes = new Map();
        [...node.ownerDocument.getElementsByTagName("*")].forEach((element, index) => sourceIndexes.set(element, index));
      }
      return sourceIndexes.get(node);
    }
    return api;
  }

  // Element names in the order a content model lists them, each once.
  function particleOrder(particle, order) {
    const names = order || [];
    if (particle[0] === "e") {
      if (!names.includes(particle[1])) names.push(particle[1]);
    } else {
      for (const part of particle.slice(2)) particleOrder(part, names);
    }
    return names;
  }

  function insertBeforeSibling(parent, child, next, indent) {
    const doc = parent.ownerDocument;
    if (next) {
      const separator = separatorBefore(next);
      parent.insertBefore(child, next);
      if (separator) parent.insertBefore(doc.createTextNode(separator), next);
    } else {
      const last = parent.lastChild;
      const closing = last && last.nodeType === TEXT && !last.nodeValue.trim() ? last : null;
      if (indent !== null) parent.insertBefore(doc.createTextNode(`\n${indent}`), closing);
      parent.insertBefore(child, closing);
      if (indent !== null && !closing) parent.appendChild(doc.createTextNode(`\n${leadingIndent(parent) || ""}`));
    }
  }

  function reindented(node, from, to) {
    if (from !== null && to !== null) {
      const walker = node.ownerDocument.createTreeWalker(node, 4);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        text.nodeValue = text.nodeValue.split("\n")
          .map((line, index) => (index > 0 && line.startsWith(from) ? to + line.slice(from.length) : line))
          .join("\n");
      }
    }
    return node;
  }

  function snippetOf(api, node) {
    const source = api.source(node);
    return source ? snippet(source) : snippet(node);
  }

  // The element's name kept or mapped, attributes and every other node kept.
  function renamedCopy(node, names, api) {
    const mapped = names[api.referenceName(node)];
    const copy = node.ownerDocument.createElementNS(node.namespaceURI, mapped ? api.displayName(mapped) : node.nodeName);
    copyAttributes(node, copy);
    for (const child of node.childNodes) {
      copy.appendChild(child.nodeType === ELEMENT ? renamedCopy(child, names, api) : child.cloneNode(true));
    }
    return copy;
  }

  // ---- layout ---------------------------------------------------------------

  // A change keeps the document's own layout: a new element takes the line
  // and indentation of the one it replaces, and new children are indented a
  // step further, the step being the one the document uses. A document laid
  // out on one line gets no whitespace at all.

  function leadingIndent(node) {
    const previous = node.previousSibling;
    const text = previous && previous.nodeType === TEXT ? previous.nodeValue : "";
    const candidate = text.slice(text.lastIndexOf("\n") + 1);
    return text.includes("\n") && /^[ \t]*$/.test(candidate) ? candidate : null;
  }

  function indentUnit(doc) {
    const root = doc.documentElement;
    const first = root ? root.firstElementChild : null;
    const indent = first ? leadingIndent(first) : null;
    return indent || "  ";
  }

  function layOut(element, children, indent, unit) {
    const doc = element.ownerDocument;
    for (const child of children) {
      if (indent !== null) element.appendChild(doc.createTextNode(`\n${indent}${unit}`));
      element.appendChild(child);
    }
    if (indent !== null && children.length) element.appendChild(doc.createTextNode(`\n${indent}`));
  }

  function separatorBefore(node) {
    const indent = leadingIndent(node);
    return indent === null ? "" : `\n${indent}`;
  }

  function replaceNode(old, replacements) {
    const parent = old.parentNode;
    const separator = separatorBefore(old);
    replacements.forEach((node, index) => {
      if (index > 0 && separator) parent.insertBefore(old.ownerDocument.createTextNode(separator), old);
      parent.insertBefore(node, old);
    });
    parent.removeChild(old);
  }

  // The element and the whitespace that put it on its own line.
  function removeNode(node) {
    const previous = node.previousSibling;
    if (previous && previous.nodeType === TEXT && !previous.nodeValue.trim()) previous.parentNode.removeChild(previous);
    node.parentNode.removeChild(node);
  }

  function prependChild(parent, node) {
    const first = parent.firstElementChild;
    const separator = first ? separatorBefore(first) : "";
    parent.insertBefore(node, first);
    if (separator) parent.insertBefore(parent.ownerDocument.createTextNode(separator), first);
  }

  // ---- snippets ---------------------------------------------------------------

  // The XML of one element as the reader would copy it: no namespace
  // declaration the serialiser invented for it, and its own indentation
  // taken off every line.
  function snippet(node) {
    let xml = new XMLSerializer().serializeToString(node);
    const attributeName = node.prefix ? `xmlns:${node.prefix}` : "xmlns";
    if (node.namespaceURI && !node.hasAttribute(attributeName)) {
      const end = xml.indexOf(">");
      xml = xml.slice(0, end).replace(` ${attributeName}="${node.namespaceURI}"`, "") + xml.slice(end);
    }
    return dedent(xml, leadingIndent(node));
  }

  function dedent(xml, indent) {
    return indent
      ? xml.split("\n").map((line, index) => (index > 0 && line.startsWith(indent) ? line.slice(indent.length) : line)).join("\n")
      : xml;
  }

  function startTag(node) {
    return new XMLSerializer().serializeToString(node.cloneNode(false)).replace(/\s*\/>$/, ">").replace(/><\/[^>]+>$/, ">");
  }

  window.OnixViewerMigration = {
    convert,
    message,
    messages: MESSAGES,
    rules: RULES,
    registerRule,
    articles: ARTICLES,
    from: FROM,
    to: TO,
  };
})();
