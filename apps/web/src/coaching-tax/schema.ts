import { XmlDocument, XsdValidator, XmlBufferInputProvider, xmlRegisterInputProvider, ParseOption } from "libxml2-wasm";
import official from "./schema-2026.generated.json";
export interface SchemaBundle {
  entry: string | null;
  files: Record<string, string>;
}
/** All imports are resolved from known in-memory files; never register a filesystem/network provider. */
export function fiscalSchemaValidator(bundle: SchemaBundle) {
  let validator: XsdValidator | null = null;
  return (xml: string) => {
    if (!bundle.entry || !Object.keys(bundle.files).length || xml.length > 100 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return false;
    let document: XmlDocument | null = null;
    try {
      if (!validator) {
        const files = Object.fromEntries(Object.entries(bundle.files).map(([name, value]) => ["/dac7-schema/" + name, new TextEncoder().encode(value)]));
        xmlRegisterInputProvider(new XmlBufferInputProvider(files));
        const schema = XmlDocument.fromString(bundle.files[bundle.entry]!, { url: "/dac7-schema/" + bundle.entry, option: ParseOption.XML_PARSE_NONET });
        try {
          validator = XsdValidator.fromDoc(schema);
        } finally {
          schema.dispose();
        }
      }
      document = XmlDocument.fromString(xml, { option: ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE });
      validator.validate(document);
      return true;
    } catch {
      return false;
    } finally {
      document?.dispose();
    }
  };
}
const validate = fiscalSchemaValidator(official);
export const officialFiscalSchemaAvailable = () => Boolean(official.archiveSha256 && official.entry && Object.keys(official.files).length);
export async function validateFiscalXml(xml: string) {
  return officialFiscalSchemaAvailable() && validate(xml);
}
