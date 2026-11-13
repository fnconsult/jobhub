import { it, expect } from "vitest";
import { fiscalSchemaValidator } from "./schema";
it("validates against its supplied offline schema and rejects invalid XML and entities", () => {
  const validate = fiscalSchemaValidator({
    entry: "root.xsd",
    files: { "root.xsd": '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="amount" type="xs:nonNegativeInteger"/></xs:schema>' },
  });
  expect(validate("<amount>123</amount>")).toBe(true);
  expect(validate("<amount>-1</amount>")).toBe(false);
  expect(validate("<other/>")).toBe(false);
  expect(validate('<!DOCTYPE amount [<!ENTITY secret SYSTEM "file:///etc/passwd">]><amount>&secret;</amount>')).toBe(false);
});
it("does not pretend an absent official bundle is a validated schema", () => {
  expect(fiscalSchemaValidator({ entry: null, files: {} })("<amount>123</amount>")).toBe(false);
});
