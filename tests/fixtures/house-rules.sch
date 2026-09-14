<?xml version="1.0" encoding="UTF-8"?>
<!-- A house rule set: what one publisher demands of its own feeds beyond the
     schema. Written in reference names, unprefixed, whatever the dialect of
     the file it runs against. -->
<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt">
  <title>Eksempelforlaget house rules</title>

  <pattern id="identifiers">
    <rule context="ProductIdentifier[ProductIDType = '15']">
      <assert id="isbn-prefix" test="starts-with(IDValue, '97882')" role="warning">
        ISBN <value-of select="IDValue"/> is outside the 978-82 prefix
      </assert>
    </rule>
    <rule context="ProductIdentifier[ProductIDType = '01']">
      <assert id="proprietary-scheme" test="IDTypeName">
        A proprietary <name/> must name its scheme in IDTypeName
      </assert>
    </rule>
  </pattern>

  <pattern id="contributors">
    <rule context="Contributor">
      <assert id="sequence-present" test="SequenceNumber">
        <name/> in <name path=".."/> has no SequenceNumber
      </assert>
      <report id="sequence-gap"
              test="SequenceNumber and number(SequenceNumber) != count(preceding-sibling::Contributor) + 1">
        Contributor <value-of select="SequenceNumber"/> is out of sequence:
        expected <value-of select="count(preceding-sibling::Contributor) + 1"/>
      </report>
    </rule>
  </pattern>

  <pattern id="prices">
    <rule context="Price[Tax]">
      <assert id="tax-arithmetic"
              test="number(PriceAmount) = sum(Tax/TaxableAmount) + sum(Tax/TaxAmount)">
        PriceAmount <value-of select="PriceAmount"/> is not the taxable amounts plus the tax
      </assert>
    </rule>
  </pattern>
</schema>
