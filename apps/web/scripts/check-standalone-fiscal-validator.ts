/** The fiscal validator is externalized: verify the actual standalone copy, not a fallback to the checkout's node_modules. */
import path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const entry = path.resolve(".next/standalone/node_modules/libxml2-wasm/lib/index.mjs");
if (!existsSync(entry)) throw Error("Standalone fiscal validator is missing");
const { XmlDocument, XsdValidator } = (await import(pathToFileURL(entry).href)) as typeof import("libxml2-wasm");
const schema = XmlDocument.fromString(
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="amount" type="xs:nonNegativeInteger"/></xs:schema>',
  ),
  validator = XsdValidator.fromDoc(schema),
  valid = XmlDocument.fromString("<amount>1</amount>"),
  invalid = XmlDocument.fromString("<amount>-1</amount>");
try {
  validator.validate(valid);
  let refused = false;
  try {
    validator.validate(invalid);
  } catch {
    refused = true;
  }
  if (!refused) throw Error("Standalone fiscal validation did not reject invalid XML");
  process.stdout.write("Standalone fiscal XML validator loads and rejects invalid XML.\n");
} finally {
  invalid.dispose();
  valid.dispose();
  validator.dispose();
  schema.dispose();
}
