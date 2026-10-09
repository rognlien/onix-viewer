const fs = require("fs");
const path = require("path");
const {
  test, describe, assert, render, stubClipboard, shortTwin, viewerCss, FIXTURES, SAMPLES,
} = require("../harness");

describe("Version conversion", () => {
  const FIXTURE = "onix-3.0-conversion.xml";

  function parse(window, xml) {
    return new window.DOMParser().parseFromString(xml, "application/xml");
  }

  function convert(window, xml) {
    const doc = parse(window, xml);
    return window.OnixViewerMigration.convert(doc, window.OnixViewerOnix.detect(doc));
  }

  function serialize(window, node) {
    return new window.XMLSerializer().serializeToString(node);
  }

  function verdict(window, converted) {
    const doc = converted.document;
    return window.OnixViewerValidation.run(doc, window.OnixViewerOnix.detect(doc), { version: "3.1" });
  }

  function changeList(window, converted) {
    return converted.changes.map((change) => `${change.grade} ${change.code} <${change.data.name}>`);
  }

  // A one-product 3.0 message with `detail` as the inside of <DescriptiveDetail>,
  // after its form; `publishing` the inside of a <PublishingDetail>, if any.
  function message(detail, publishing, header) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<ONIXMessage release="3.0" xmlns="http://ns.editeur.org/onix/3.0/reference">
  <Header>
    <Sender><SenderName>Hippo House</SenderName></Sender>
    <SentDateTime>20260101</SentDateTime>${header || ""}
  </Header>
  <Product>
    <RecordReference>com.hippohouse.1</RecordReference>
    <NotificationType>03</NotificationType>
    <ProductIdentifier><ProductIDType>15</ProductIDType><IDValue>9780306406157</IDValue></ProductIdentifier>
    <DescriptiveDetail>
      <ProductComposition>00</ProductComposition>
      <ProductForm>BC</ProductForm>
      ${detail}
    </DescriptiveDetail>${publishing ? `
    <PublishingDetail>
      ${publishing}
    </PublishingDetail>` : ""}
  </Product>
</ONIXMessage>`;
  }

  function titled(titleText, languages) {
    const language = (languages || []).map((code) =>
      `<Language><LanguageRole>01</LanguageRole><LanguageCode>${code}</LanguageCode></Language>`).join("");
    return `<TitleDetail><TitleType>01</TitleType><TitleElement><TitleElementLevel>01</TitleElementLevel>${titleText}</TitleElement></TitleDetail>${language}`;
  }

  function titleOutcome(window, titleText, languages, header) {
    const converted = convert(window, message(titled(titleText, languages), null, header));
    const change = converted.changes.find((candidate) => candidate.code.startsWith("title."));
    const element = converted.document.getElementsByTagName("TitleElement")[0];
    const parts = [...element.children].slice(1).map((child) => serialize(window, child).replace(/ xmlns="[^"]*"/, ""));
    return { change, parts: parts.join("") };
  }

  // ---- the engine ------------------------------------------------------------

  test("the fixture's changes come out graded and in document order", () => {
    const w = render(FIXTURE);
    const converted = convert(w, fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8"));
    const expected = [
      "automatic release.declared <ONIXMessage>",
      "automatic default.pushed <DefaultLanguageOfText>",
      "automatic default.pushed <DefaultPriceType>",
      "automatic default.pushed <DefaultCurrencyCode>",
      "review title.split <TitleText>",
      "automatic duplicate.removed <ContributorRole>",
      "review gender.dropped <Gender>",
      "automatic conference.converted <Conference>",
      "automatic audience.converted <AudienceCode>",
      "review textsource.converted <TextContent>",
      "automatic dateformat.attribute <DateFormat>",
      "manual salesrestriction.kept <SalesRestriction>",
      "manual promotioncontact.kept <PromotionContact>",
      "manual currencyzone.kept <CurrencyZone>",
      "manual reissue.kept <Reissue>",
      "review title.split <TitleText>",
      "automatic title.no-article <TitleText>",
      "review title.language-unsupported <TitleText>",
    ];
    const got = changeList(w, converted);
    assert(got.join("\n") === expected.join("\n"), `got:\n    ${got.join("\n    ")}`);
    assert(JSON.stringify(converted.counts) === JSON.stringify({ automatic: 9, review: 5, manual: 4, chosen: 0 }),
      `counts: ${JSON.stringify(converted.counts)}`);
  });

  test("what is left after conversion is exactly what was handed over as manual", () => {
    const w = render(FIXTURE);
    const result = verdict(w, convert(w, fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8")));
    const left = result.findings.map((finding) => `${finding.code} <${finding.node.nodeName}>`);
    assert(left.join() === "structure.not-allowed <SalesRestriction>,structure.unknown <PromotionContact>," +
      "structure.unknown <CurrencyZone>,structure.unknown <Reissue>", `left: ${left.join(", ")}`);
  });

  // ---- choices ---------------------------------------------------------------

  function decisionsOf(converted) {
    return converted.changes.filter((change) => change.decision).map((change) => change.decision);
  }

  test("each decision offers its options, the first sensible one applied until the reader picks", () => {
    const w = render(FIXTURE);
    const converted = convert(w, fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8"));
    const offered = decisionsOf(converted).map((decision) => `${decision.key.split(":")[0]} ${decision.id}: ` +
      decision.options.map((option) => option.id).join("/"));
    assert(offered.join("\n") === [
      "title article: article/none",
      "gender drop: drop/keep",
      "textsource convert: convert/keep",
      "salesrestriction keep: keep/for-sale/every/drop",
      "promotioncontact keep: keep/contact/drop",
      "currencyzone keep: keep/territory/drop",
      "reissue keep: keep/date/drop",
      "title article: article/none",
      "title none: first-word/none",
    ].join("\n"), `offered:\n    ${offered.join("\n    ")}`);
  });

  test("whatever the reader picks short of keeping, the result is valid 3.1", () => {
    const w = render(FIXTURE);
    const xml = fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8");
    const decisions = decisionsOf(convert(w, xml));
    const widest = Math.max(...decisions.map((decision) => decision.options.length));
    for (let pick = 0; pick < widest; pick++) {
      const choices = {};
      for (const decision of decisions) {
        const options = decision.options.filter((option) => option.id !== "keep");
        choices[decision.key] = options[Math.min(pick, options.length - 1)].id;
      }
      const converted = w.OnixViewerMigration.convert(parse(w, xml), w.OnixViewerOnix.detect(parse(w, xml)), { choices });
      const result = verdict(w, converted);
      assert(result.total === 0, `pick ${pick}: ${result.findings.map((finding) => w.OnixViewerValidation.message(finding)).join(" | ")}`);
      assert(converted.counts.chosen === decisions.length, `pick ${pick}: every picked change should be graded chosen`);
    }
  });

  test("a pick that no longer applies falls back to the default", () => {
    const w = render(FIXTURE);
    const xml = fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8");
    const key = decisionsOf(convert(w, xml)).find((decision) => decision.key.startsWith("gender:")).key;
    const converted = w.OnixViewerMigration.convert(parse(w, xml), w.OnixViewerOnix.detect(parse(w, xml)), { choices: { [key]: "nonsense" } });
    const change = converted.changes.find((candidate) => candidate.decision && candidate.decision.key === key);
    assert(change.code === "gender.dropped" && change.grade === "review", `${change.code} ${change.grade}`);
  });

  test("the eurozone, the sales rights and the reissue date land where 3.1 puts them", () => {
    const w = render(FIXTURE);
    const xml = fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8");
    const choices = {};
    for (const decision of decisionsOf(convert(w, xml))) {
      const want = { salesrestriction: "every", currencyzone: "territory", reissue: "date", promotioncontact: "contact" }[decision.key.split(":")[0]];
      if (want) choices[decision.key] = want;
    }
    const converted = w.OnixViewerMigration.convert(parse(w, xml), w.OnixViewerOnix.detect(parse(w, xml)), { choices });
    const out = serialize(w, converted.document);
    assert(out.includes(`        <CurrencyCode>EUR</CurrencyCode>
          <Territory>
            <CountriesIncluded>AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK</CountriesIncluded>
          </Territory>`), "the eurozone should be a territory where the zone was");
    assert((out.match(/<SalesRestrictionType>01<\/SalesRestrictionType>/g) || []).length === 2, "one restriction in each <SalesRights>");
    assert(out.includes(`        <CountriesIncluded>US</CountriesIncluded>
        </Territory>
        <SalesRestriction>
          <SalesRestrictionType>01</SalesRestrictionType>
        </SalesRestriction>
      </SalesRights>`), "after the territory, at the <SalesRights> child indentation");
    assert(out.includes(`        <Date dateformat="05">2026</Date>
      </PublishingDate>
      <PublishingDate>
        <PublishingDateRole>21</PublishingDateRole>
        <Date>20270101</Date>
      </PublishingDate>
      <SalesRights>`), "the reissue date should follow the other publishing dates");
    assert(out.includes(`      <MarketPublishingDetail>
        <ProductContact>
          <ProductContactRole>02</ProductContactRole>
          <ProductContactName>Pat Publicist, pat@hippohouse.example</ProductContactName>
        </ProductContact>
        <MarketPublishingStatus>04</MarketPublishingStatus>`), "the contact goes before the status, where 3.1 has it");
  });

  // ---- the header's defaults and the text sources -----------------------------

  test("the header's defaults go where each product does not say otherwise", () => {
    const w = render(FIXTURE);
    const converted = convert(w, fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8"));
    const out = serialize(w, converted.document);
    assert(!/<Default/.test(out), "no default should remain in the header");
    assert(out.includes(`        <Price>
          <PriceType>02</PriceType>
          <PriceAmount>9.99</PriceAmount>
          <CurrencyCode>GBP</CurrencyCode>
        </Price>`), "the bare price should gain both, each in its place");
    assert(out.includes("<PriceType>01</PriceType>\n          <PriceAmount>11.99</PriceAmount>\n          <CurrencyCode>EUR</CurrencyCode>"),
      "a price with its own should keep its own");
    assert((out.match(/<LanguageCode>eng<\/LanguageCode>/g) || []).length === 2, "only the product with no language of text gains one");
  });

  test("a product with nowhere to put the language is worth a look, unless it is a deletion", () => {
    const w = render(FIXTURE);
    const header = "\n    <DefaultLanguageOfText>eng</DefaultLanguageOfText>";
    const bare = (type) => `<Product><RecordReference>r${type}</RecordReference><NotificationType>${type}</NotificationType>` +
      "<ProductIdentifier><ProductIDType>01</ProductIDType><IDValue>1</IDValue></ProductIdentifier></Product>";
    const withDeletion = message(titled("<NoPrefix/><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>"), null, header)
      .replace("</ONIXMessage>", `${bare("05")}</ONIXMessage>`);
    const deletion = convert(w, withDeletion).changes.find((change) => change.code.startsWith("default."));
    assert(deletion.code === "default.pushed" && deletion.grade === "automatic", `${deletion.code} ${deletion.grade}`);
    const partial = convert(w, withDeletion.replace(`${bare("05")}`, bare("04"))).changes.find((change) => change.code.startsWith("default."));
    assert(partial.code === "default.partial" && partial.grade === "review", `${partial.code} ${partial.grade}`);
  });

  function textContent(sources) {
    return "<CollateralDetail><TextContent><TextType>06</TextType><ContentAudience>00</ContentAudience>" +
      `<Text>Splendid.</Text>${sources}</TextContent></CollateralDetail>`;
  }

  test("one text source takes its descriptions along; several leave the old form alone", () => {
    const w = render(FIXTURE);
    const title = titled("<NoPrefix/><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>");
    const one = message(title).replace("</DescriptiveDetail>",
      `</DescriptiveDetail>${textContent("<TextAuthor>Ann Critic</TextAuthor><TextSourceDescription>Hippo Weekly, 2026</TextSourceDescription>")}`);
    const converted = convert(w, one);
    assert(serialize(w, converted.document).includes("<TextSource><PersonName>Ann Critic</PersonName>" +
      "<TextSourceDescription>Hippo Weekly, 2026</TextSourceDescription></TextSource>"), serialize(w, converted.document));
    assert(verdict(w, converted).total === 0, "and that is valid 3.1");
    const several = message(title).replace("</DescriptiveDetail>", `</DescriptiveDetail>${textContent(
      "<TextAuthor>Ann</TextAuthor><TextAuthor>Bob</TextAuthor><TextSourceDescription>Weekly</TextSourceDescription>")}`);
    const left = changeList(w, convert(w, several)).filter((line) => line.includes("deprecated"));
    assert(left.length === 3, `each deprecated element should be left for a person: ${left.join("; ")}`);
  });

  test("the reissue date is not offered where the product already has one", () => {
    const w = render(FIXTURE);
    const xml = fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8").replace("<PublishingDateRole>01</PublishingDateRole>",
      "<PublishingDateRole>21</PublishingDateRole>");
    const reissue = decisionsOf(convert(w, xml)).find((decision) => decision.key.startsWith("reissue:"));
    assert(reissue.options.map((option) => option.id).join() === "keep,drop", reissue.options.map((option) => option.id).join());
  });

  test("the source document is not touched", () => {
    const w = render(FIXTURE);
    const doc = parse(w, fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8"));
    const before = serialize(w, doc);
    w.OnixViewerMigration.convert(doc, w.OnixViewerOnix.detect(doc));
    assert(serialize(w, doc) === before, "the parsed source should be exactly as it was");
  });

  test("every change points at an element of the source document", () => {
    const w = render(FIXTURE);
    const doc = parse(w, fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8"));
    const converted = w.OnixViewerMigration.convert(doc, w.OnixViewerOnix.detect(doc));
    const strays = converted.changes.filter((change) => !change.node || change.node.ownerDocument !== doc);
    assert(strays.length === 0, `changes not in the source: ${strays.map((change) => change.code).join(", ")}`);
  });

  test("the namespace, the release and every element move to 3.1, laid out as before", () => {
    const w = render(FIXTURE);
    const xml = serialize(w, convert(w, fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8")).document);
    assert(xml.includes('<ONIXMessage release="3.1" xmlns="http://ns.editeur.org/onix/3.1/reference">'), xml.slice(0, 200));
    assert(!xml.includes("/onix/3.0/"), "no trace of the 3.0 namespace should remain");
    assert(xml.includes(`      <PublishingDate>
        <PublishingDateRole>01</PublishingDateRole>
        <Date dateformat="05">2026</Date>
      </PublishingDate>`), "the composite should keep its indentation, one line shorter");
  });

  test("a document on one line gains no whitespace", () => {
    const w = render(FIXTURE);
    const compact = message("<AudienceCode>02</AudienceCode>").replace(/>\s+</g, "><");
    const xml = serialize(w, convert(w, compact).document);
    assert(xml.includes("<Audience><AudienceCodeType>01</AudienceCodeType><AudienceCodeValue>02</AudienceCodeValue></Audience>"), xml);
  });

  // ---- titles ----------------------------------------------------------------

  test("a title splits after its language's leading article", () => {
    const w = render(FIXTURE);
    const cases = [
      ["<TitleText>The Happy Hippo</TitleText>", ["eng"], "<TitlePrefix>The</TitlePrefix><TitleWithoutPrefix>Happy Hippo</TitleWithoutPrefix>"],
      ["<TitleText>THE HAPPY HIPPO</TitleText>", ["eng"], "<TitlePrefix>THE</TitlePrefix><TitleWithoutPrefix>HAPPY HIPPO</TitleWithoutPrefix>"],
      ["<TitleText>Der Prozess</TitleText>", ["ger"], "<TitlePrefix>Der</TitlePrefix><TitleWithoutPrefix>Prozess</TitleWithoutPrefix>"],
      ["<TitleText>L’Étranger</TitleText>", ["fra"], "<TitlePrefix>L’</TitlePrefix><TitleWithoutPrefix>Étranger</TitleWithoutPrefix>"],
      ["<TitleText>'t Hooge Nest</TitleText>", ["dut"], "<TitlePrefix>'t</TitlePrefix><TitleWithoutPrefix>Hooge Nest</TitleWithoutPrefix>"],
      ["<TitleText>Det store spranget</TitleText>", ["nob"], "<TitlePrefix>Det</TitlePrefix><TitleWithoutPrefix>store spranget</TitleWithoutPrefix>"],
    ];
    for (const [titleText, languages, expected] of cases) {
      const { change, parts } = titleOutcome(w, titleText, languages);
      assert(change.code === "title.split" && change.grade === "review", `${titleText}: ${change.code}`);
      assert(parts === expected, `${titleText}: got ${parts}`);
    }
  });

  test("a title with no article at its head is marked <NoPrefix/>, and needs no review", () => {
    const w = render(FIXTURE);
    for (const titleText of ["<TitleText>Theatre of Blood</TitleText>", "<TitleText>The</TitleText>", "<TitleText>Anathem</TitleText>"]) {
      const { change, parts } = titleOutcome(w, titleText, ["eng"]);
      assert(change.code === "title.no-article" && change.grade === "automatic", `${titleText}: ${change.code}`);
      assert(parts.startsWith("<NoPrefix/><TitleWithoutPrefix>"), `${titleText}: got ${parts}`);
    }
  });

  test("the title's language comes from itself, then the product, then the header", () => {
    const w = render(FIXTURE);
    const own = titleOutcome(w, '<TitleText language="fre">La Peste</TitleText>', ["eng"]);
    assert(own.change.data.language === "French", `its own attribute should win: ${own.change.data.language}`);
    const header = titleOutcome(w, "<TitleText>A Tale</TitleText>", [], "<DefaultLanguageOfText>eng</DefaultLanguageOfText>");
    assert(header.change.code === "title.split", `the header's default should apply: ${header.change.code}`);
    const several = titleOutcome(w, "<TitleText>The Tale</TitleText>", ["eng", "fre"]);
    assert(several.change.code === "title.language-unknown" && several.change.grade === "review",
      `two languages of text say nothing about the title's: ${several.change.code}`);
    assert(several.parts === "<NoPrefix/><TitleWithoutPrefix>The Tale</TitleWithoutPrefix>", several.parts);
  });

  test("the title's attributes follow it, collationkey to the part it files under", () => {
    const w = render(FIXTURE);
    const split = titleOutcome(w, '<TitleText textcase="01" collationkey="hippo">The Hippo</TitleText>', ["eng"]);
    assert(split.parts === '<TitlePrefix textcase="01">The</TitlePrefix>' +
      '<TitleWithoutPrefix textcase="01" collationkey="hippo">Hippo</TitleWithoutPrefix>', split.parts);
    const bare = titleOutcome(w, '<TitleText language="eng" textcase="01">Hippo</TitleText>', []);
    assert(bare.parts === '<NoPrefix/><TitleWithoutPrefix language="eng" textcase="01">Hippo</TitleWithoutPrefix>',
      `<NoPrefix/> takes none of the language attributes: ${bare.parts}`);
  });

  test("a <TitleText> beside the split form is dropped, not split again", () => {
    const w = render(FIXTURE);
    const { change, parts } = titleOutcome(w,
      "<TitlePrefix>The</TitlePrefix><TitleWithoutPrefix>Hippo</TitleWithoutPrefix><TitleText>The Hippo</TitleText>", ["eng"]);
    assert(change.code === "title.redundant" && change.grade === "automatic", change.code);
    assert(parts === "<TitlePrefix>The</TitlePrefix><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>", parts);
  });

  // ---- the other rules -----------------------------------------------------------

  function dated(dateFormat, date) {
    return "<Publisher><PublishingRole>01</PublishingRole><PublisherName>Hippo House</PublisherName></Publisher>" +
      `<PublishingStatus>04</PublishingStatus><PublishingDate><PublishingDateRole>01</PublishingDateRole>${dateFormat}${date}</PublishingDate>`;
  }

  test("<DateFormat> becomes the attribute unless the attribute already says otherwise", () => {
    const w = render(FIXTURE);
    const title = titled("<NoPrefix/><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>");
    const cases = [
      ["<DateFormat>01</DateFormat>", "<Date>202601</Date>", "dateformat.attribute", '<Date dateformat="01">202601</Date>'],
      ["<DateFormat>01</DateFormat>", '<Date dateformat="01">202601</Date>', "dateformat.same", '<Date dateformat="01">202601</Date>'],
      ["<DateFormat></DateFormat>", "<Date>20260101</Date>", "dateformat.empty", "<Date>20260101</Date>"],
      ["<DateFormat>05</DateFormat>", '<Date dateformat="01">202601</Date>', "dateformat.conflict", "<DateFormat>05</DateFormat>"],
    ];
    for (const [dateFormat, date, code, expected] of cases) {
      const converted = convert(w, message(title, dated(dateFormat, date)));
      const change = converted.changes.find((candidate) => candidate.code.startsWith("dateformat."));
      assert(change && change.code === code, `${dateFormat}${date}: ${change && change.code}`);
      assert(serialize(w, converted.document).includes(expected), `${dateFormat}${date}: expected ${expected}`);
    }
  });

  test("<AudienceCode> already given as an <Audience> is simply dropped", () => {
    const w = render(FIXTURE);
    const detail = titled("<NoPrefix/><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>") +
      "<AudienceCode>02</AudienceCode><Audience><AudienceCodeType>01</AudienceCodeType><AudienceCodeValue>02</AudienceCodeValue></Audience>";
    const converted = convert(w, message(detail));
    assert(changeList(w, converted).includes("automatic audience.duplicate <AudienceCode>"), changeList(w, converted).join("; "));
    assert(converted.document.getElementsByTagName("Audience").length === 1, "one <Audience> should remain");
  });

  test("<Conference> keeps its role and renames its sponsor, child for child", () => {
    const w = render(FIXTURE);
    const detail = titled("<NoPrefix/><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>") +
      "<Conference><ConferenceRole>02</ConferenceRole><ConferenceName>Hippo Days</ConferenceName>" +
      "<ConferenceSponsor><ConferenceSponsorIdentifier><ConferenceSponsorIDType>01</ConferenceSponsorIDType>" +
      "<IDTypeName>House</IDTypeName><IDValue>42</IDValue></ConferenceSponsorIdentifier></ConferenceSponsor></Conference>";
    const converted = convert(w, message(detail));
    const xml = serialize(w, converted.document);
    assert(xml.includes("<Event><EventRole>02</EventRole><EventName>Hippo Days</EventName><EventSponsor><EventSponsorIdentifier>" +
      "<EventSponsorIDType>01</EventSponsorIDType><IDTypeName>House</IDTypeName><IDValue>42</IDValue>" +
      "</EventSponsorIdentifier></EventSponsor></Event>"), xml);
    assert(verdict(w, converted).total === 0, "and the result should be valid 3.1");
  });

  test("a repeat 3.1 forbids goes when identical, and stays for a person when not", () => {
    const w = render(FIXTURE);
    const title = titled("<NoPrefix/><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>");
    const publishing = (second) => dated("", "<Date>20260101</Date>").replace("</PublishingDate>",
      `</PublishingDate><PublishingDate><PublishingDateRole>01</PublishingDateRole><Date>${second}</Date></PublishingDate>`);
    const same = convert(w, message(title, publishing("20260101")));
    assert(changeList(w, same).includes("automatic duplicate.removed <PublishingDate>"), changeList(w, same).join("; "));
    assert(verdict(w, same).total === 0, "the identical repeat should be gone");
    const different = convert(w, message(title, publishing("20270101")));
    assert(!changeList(w, different).some((line) => line.includes("duplicate")), "a differing repeat is not the engine's to drop");
    assert(verdict(w, different).findings.some((finding) => finding.code === "unique.duplicate"), "and is left as a finding");
  });

  test("an element 3.1 removed is reported once, not again for each of its children", () => {
    const w = render(FIXTURE);
    const supply = `<ProductSupply><SupplyDetail><Supplier><SupplierRole>01</SupplierRole><SupplierName>Hippo</SupplierName></Supplier>
      <ProductAvailability>21</ProductAvailability><Reissue><ReissueDate>20270101</ReissueDate>
      <ReissueDescription>New cover</ReissueDescription></Reissue><UnpricedItemType>01</UnpricedItemType></SupplyDetail></ProductSupply>`;
    const xml = message(titled("<NoPrefix/><TitleWithoutPrefix>Hippo</TitleWithoutPrefix>")).replace("</Product>", `${supply}</Product>`);
    const converted = convert(w, xml);
    const manual = changeList(w, converted).filter((line) => line.startsWith("manual"));
    assert(manual.join() === "manual reissue.kept <Reissue>", manual.join("; "));
    assert(w.OnixViewerMigration.message(converted.changes.find((change) => change.code === "reissue.kept"))
      .includes("use start and end dates"), "EDItEUR's advice should come along");
  });

  // ---- dialects and coverage ---------------------------------------------------------

  test("a short-tag file converts to the same document in short tags", () => {
    const w = render(FIXTURE);
    const reference = fs.readFileSync(path.join(FIXTURES, FIXTURE), "utf8");
    const fromReference = serialize(w, convert(w, reference).document);
    const fromShort = convert(w, shortTwin(w, reference));
    const translated = serialize(w, w.OnixViewerOnix.translateNode(fromShort.document, "reference"));
    assert(translated === fromReference, "the two conversions should differ only in their names");
    assert(fromShort.changes.every((change) => !/<[A-Z]/.test(w.OnixViewerMigration.message(change).replace(/<ONIXmessage>/, ""))),
      "messages should name short tags");
  });

  const documents = fs.readdirSync(FIXTURES).map((f) => path.join(FIXTURES, f))
    .concat(fs.readdirSync(SAMPLES).map((f) => path.join(SAMPLES, f)))
    .filter((file) => file.endsWith(".xml"));

  test("no 3.0 document gains an error from conversion it was not told about", () => {
    let checked = 0;
    const w = render(FIXTURE);
    for (const file of documents) {
      const xml = fs.readFileSync(file, "utf8");
      for (const source of [xml, shortTwin(w, xml)]) {
        const doc = parse(w, source);
        const onixCtx = w.OnixViewerOnix.detect(doc);
        if (onixCtx.version !== "3.0" || onixCtx.messageType !== "product") continue;
        const before = w.OnixViewerValidation.run(doc, onixCtx);
        const converted = w.OnixViewerMigration.convert(doc, onixCtx);
        const after = verdict(w, converted);
        assert(after.errors <= before.errors + converted.counts.manual,
          `${path.basename(file)}: ${before.errors} errors as 3.0, ${after.errors} as 3.1 with ${converted.counts.manual} manual`);
        checked++;
      }
    }
    assert(checked >= 20, `expected every 3.0 document in both dialects, checked ${checked}`);
  });

  // ---- the viewer ----------------------------------------------------------------

  function choose(window, value) {
    const select = window.document.getElementById("oxv-release");
    select.value = value;
    select.dispatchEvent(new window.Event("change"));
    return select;
  }

  test("the release selector offers the conversion on a 3.0 document only", () => {
    const offers = (fixture) => [...render(fixture).document.querySelectorAll("#oxv-release option")]
      .some((option) => option.value === "convert");
    assert(offers(FIXTURE), "a 3.0 message should be offered the conversion");
    assert(offers("onix-3.0-short.xml"), "in either dialect");
    assert(!offers("onix-3.1-valid.xml"), "a 3.1 message has nothing to convert");
    assert(!offers("onix-3.0-acknowledgement.xml"), "nor has an Acknowledgement");
  });

  test("choosing it opens the conversion and leaves the selector where it was", () => {
    const w = render(FIXTURE);
    const select = choose(w, "convert");
    const modal = w.document.getElementById("oxv-conversion");
    assert(modal && !modal.hidden, "the conversion should open");
    assert(select.value === "3.0", `the selector should stay on the release judged; got ${select.value}`);
    assert(modal.querySelector(".px-popup-title").textContent === "18 changes: 9 automatic, 5 to review, 4 manual",
      modal.querySelector(".px-popup-title").textContent);
    assert(modal.querySelectorAll(".px-conversion-item").length === 18, "one entry per change");
    assert(modal.querySelectorAll(".px-conversion-after").length === 12, "what is kept or dropped has no after");
    assert(modal.querySelectorAll(".px-conversion-choice").length === 9, "one set of options per decision");
    assert(modal.querySelector(".px-conversion-verdict").textContent ===
      "The converted document has 4 errors as ONIX 3.1", modal.querySelector(".px-conversion-verdict").textContent);
    assert(w.document.activeElement === modal.querySelector(".px-popup-close"), "focus should move into the dialog");
  });

  test("Copy XML and Download hand over the converted document with its declaration", () => {
    const w = render(FIXTURE);
    choose(w, "convert");
    const copied = stubClipboard(w);
    w.document.querySelector('[data-action="copy-converted"]').click();
    assert(copied.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<ONIXMessage release="3.1"'), copied.text.slice(0, 120));
    const saved = {};
    w.Blob = function (parts) { saved.text = parts.join(""); };
    w.URL.createObjectURL = () => "blob:https://example.com/oxv-test";
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { saved.name = this.download; };
    w.document.querySelector('[data-action="download-converted"]').click();
    assert(saved.name === "onix-3.0-conversion-3.1.xml", `name: ${saved.name}`);
    assert(saved.text === copied.text, "the download should be what Copy XML copies");
  });

  test("only what differs is marked: the words of an edited line, the text of a line taken out or put in", () => {
    const w = render(FIXTURE);
    choose(w, "convert");
    const entry = (name) => [...w.document.querySelectorAll("#oxv-conversion .px-conversion-item")]
      .find((item) => item.dataset.oxvElement === name);
    const marked = (item, side) => [...item.querySelectorAll(`.px-conversion-${side} .px-conversion-changed`)].map((mark) => mark.textContent);

    const date = entry("DateFormat");
    assert(marked(date, "before").join("|") === "<DateFormat>05</DateFormat>", `before: ${marked(date, "before").join("|")}`);
    assert(marked(date, "after").join("|") === 'dateformat="05"', `after: ${marked(date, "after").join("|")}`);
    assert(date.querySelector(".px-conversion-after").textContent.startsWith("<PublishingDate>\n  <PublishingDateRole>01"),
      "the block's text should be the snippet unchanged");

    const conference = entry("Conference");
    assert(marked(conference, "before").join("|") === "Conference|ConferenceName|ConferenceName|ConferenceNumber|ConferenceNumber|Conference",
      `before: ${marked(conference, "before").join("|")}`);
    assert(marked(conference, "after").join("|") === "Event|<EventRole>01</EventRole>|EventName|EventName|EventNumber|EventNumber|Event",
      `after: ${marked(conference, "after").join("|")}`);

    const title = entry("TitleText");
    assert(marked(title, "before").join("|") === "<TitleText>The Happy Hippo</TitleText>", `before: ${marked(title, "before").join("|")}`);
    assert(marked(title, "after").join("|") === "<TitlePrefix>The</TitlePrefix>|<TitleWithoutPrefix>Happy Hippo</TitleWithoutPrefix>",
      `after: ${marked(title, "after").join("|")}`);
  });

  test("a pick converts again, and the reader stays where they were", () => {
    const w = render(FIXTURE);
    choose(w, "convert");
    const modal = w.document.getElementById("oxv-conversion");
    const zone = [...modal.querySelectorAll(".px-conversion-choice input")].find((input) =>
      input.name.includes("currencyzone") && input.value === "territory");
    zone.checked = true;
    zone.dispatchEvent(new w.Event("change"));
    assert(modal.querySelector(".px-popup-title").textContent === "18 changes: 9 automatic, 5 to review, 3 manual, 1 chosen",
      modal.querySelector(".px-popup-title").textContent);
    assert(modal.querySelector(".px-conversion-verdict").textContent === "The converted document has 3 errors as ONIX 3.1",
      modal.querySelector(".px-conversion-verdict").textContent);
    const focused = w.document.activeElement;
    assert(focused && focused.name === zone.name && focused.value === "territory" && focused.checked,
      "the rebuilt option should be checked and have focus");
    assert(focused.closest(".px-conversion-item").querySelector(".px-conversion-grade").textContent === "Your choice",
      "and its change graded as the reader's");
    const copied = stubClipboard(w);
    w.document.querySelector('[data-action="copy-converted"]').click();
    assert(copied.text.includes("<CountriesIncluded>AT BE BG"), "Copy XML should follow the pick");
  });

  test("the conversion window resizes from its corner", () => {
    const rule = viewerCss.match(/\.px-conversion \{[^}]*\}/);
    assert(rule && /resize: both/.test(rule[0]) && /min-width/.test(rule[0]) && /max-height/.test(rule[0]), rule && rule[0]);
  });

  test("what 3.1 still reports is listed, and each finding leads to its change", () => {
    const w = render(FIXTURE);
    choose(w, "convert");
    const modal = w.document.getElementById("oxv-conversion");
    const section = modal.querySelector(".px-conversion-remaining");
    const items = [...section.querySelectorAll(".px-findings-item")];
    assert(!section.hidden && items.length === 4, `four findings should be listed; got ${items.length}`);
    assert(items.map((item) => item.querySelector(".px-findings-where").textContent).join() ===
      "<SalesRestriction>,<PromotionContact>,<CurrencyZone>,<Reissue>", items.map((item) => item.textContent).join(" | "));
    items[2].click();
    const current = modal.querySelector(".px-conversion-item-current");
    assert(!modal.hidden, "the window should stay open");
    assert(current && current.dataset.oxvElement === "CurrencyZone",
      `the <CurrencyZone> change should be singled out; got ${current && current.textContent.slice(0, 40)}`);
    assert(w.document.activeElement === current.querySelector(".px-conversion-choice input:checked"),
      "and its pick given focus, the thing to act on");
    modal.querySelector("button.px-conversion-verdict").click();
    assert(w.document.activeElement === items[0], "the verdict should lead to the list");
  });

  test("a clean conversion lists nothing still to do, and its verdict is no button", () => {
    const w = render("onix-3.0-short-codelists.xml");
    choose(w, "convert");
    const modal = w.document.getElementById("oxv-conversion");
    assert(modal.querySelector(".px-conversion-remaining").hidden, "nothing should be listed");
    const verdict = modal.querySelector(".px-conversion-verdict");
    assert(verdict.tagName === "DIV" && verdict.textContent === "The converted document is valid ONIX 3.1", verdict.outerHTML);
  });

  test("a resize that ends on the backdrop leaves the window open", () => {
    // The corner handle's drag starts inside and ends outside, and the
    // browser fires its click on the backdrop; only a press there closes.
    const w = render(FIXTURE);
    choose(w, "convert");
    const overlay = w.document.getElementById("oxv-conversion");
    overlay.querySelector(".px-popup").dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
    overlay.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    assert(!overlay.hidden, "still open after a press inside released outside");
    overlay.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
    overlay.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    assert(overlay.hidden, "a press on the backdrop itself closes it");
  });

  test("an entry's element takes the reader to its row, and Escape closes", () => {
    const w = render(FIXTURE);
    choose(w, "convert");
    const modal = w.document.getElementById("oxv-conversion");
    const gender = [...modal.querySelectorAll(".px-conversion-item")].find((item) => item.dataset.oxvElement === "Gender")
      .querySelector(".px-conversion-where");
    assert(gender.textContent === "Show in file" && gender.getAttribute("aria-label") === "Show <Gender> in the file",
      `the link should say where it goes: ${gender.getAttribute("aria-label")}`);
    gender.click();
    assert(modal.hidden, "the conversion should close");
    const active = w.document.querySelector("#oxv-root .px-active .px-tag-name");
    assert(active && active.textContent === "Gender", `the <Gender> row should be active; got ${active && active.textContent}`);
    choose(w, "convert");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    assert(modal.hidden, "Escape should close it");
  });
});
