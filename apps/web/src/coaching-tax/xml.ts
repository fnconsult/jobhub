import { z } from "zod";
import type { TaxIdentity, TaxQuarter } from "./model";
const text = z.string().trim().min(1).max(200);
export const taxOperatorSchema = z
  .object({
    legalName: text,
    tin: z.string().regex(/^\d{9}$/),
    platformName: text,
    street: text,
    postalCode: text,
    city: text,
    vat: z.string().trim().max(40).default(""),
  })
  .strict();
export type TaxOperator = z.infer<typeof taxOperatorSchema>;
export interface AnnualSeller {
  sellerId: string;
  docRefId: string;
  identity: TaxIdentity;
  quarters: TaxQuarter[];
}
export interface AnnualTaxDocument {
  id: string;
  year: number;
  createdAt: string;
  operator: TaxOperator;
  sellers: AnnualSeller[];
  schemaVersion: "DGFiP-2026-v1.7";
  fileSequence: number;
}
export function xmlText(value: string) {
  for (const char of value) {
    const n = char.codePointAt(0)!;
    if (!(n === 9 || n === 10 || n === 13 || (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff)))
      throw Error("Invalid XML character");
  }
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}
const tag = (name: string, value: string, attributes = "") => `<dpi:${name}${attributes}>${xmlText(value)}</dpi:${name}>`;
const money = (name: string, cents: number) => tag(name, String(Math.round(cents / 100)), ' currCode="EUR"');
const address = (x: { street: string; postalCode: string; city: string }, country: string, type: string) =>
  `<dpi:Address legalAddressType="${type}">${tag("CountryCode", country)}<dpi:AddressFix>${tag("Street", x.street)}${tag("PostCode", x.postalCode)}${tag("City", x.city)}</dpi:AddressFix></dpi:Address>`;
const docSpec = (id: string) => `<dpi:DocSpec><stf:DocTypeIndic>OECD1</stf:DocTypeIndic><stf:DocRefId>${xmlText(id)}</stf:DocRefId></dpi:DocSpec>`;
export function taxXml(document: AnnualTaxDocument) {
  const op = taxOperatorSchema.parse(document.operator),
    prefix = `OP_${document.year}_${op.tin}_`;
  const sellers = document.sellers
    .map((seller) => {
      const x = seller.identity,
        individual = x.kind === "individual";
      const name = individual
        ? `<dpi:Name nameType="OECD202">${tag("FirstName", x.firstName)}${tag("LastName", x.lastName)}</dpi:Name>`
        : tag("Name", x.legalName, ' nameType="OECD207"');
      const id =
        tag("ResCountryCode", x.residence) +
        tag("TIN", x.tin, ` issuedBy="${x.tinCountry}"`) +
        (individual ? "" : tag("IN", x.siret, ' issuedBy="FR" INType="BRN"')) +
        (x.vat ? tag("VAT", x.vat) : "") +
        name +
        address(x, x.addressCountry, individual ? "OECD301" : "OECD302") +
        (individual
          ? `<dpi:BirthInfo>${tag("BirthDate", x.birthDate!)}</dpi:BirthInfo>`
          : x.permanentEstablishments.length
            ? `<dpi:PermanentEstablishments>${x.permanentEstablishments.map((country) => tag("PermanentEstablishment", country)).join("")}</dpi:PermanentEstablishments>`
            : "");
      const financial = `<dpi:FinancialIdentifier>${tag("Identifier", x.iban, ' AccountNumberType="IBAN"')}${tag("AccountHolderName", x.accountHolder)}</dpi:FinancialIdentifier>`;
      const identity = `<dpi:Identity><dpi:${individual ? "IndividualSeller" : "EntitySeller"}><dpi:Standard><dpi:${individual ? "IndSellerID" : "EntSellerID"}>${id}</dpi:${individual ? "IndSellerID" : "EntSellerID"}>${financial}</dpi:Standard></dpi:${individual ? "IndividualSeller" : "EntitySeller"}></dpi:Identity>`;
      const activity = `<dpi:RelevantActivities><dpi:PersonalServices><dpi:Consideration>${seller.quarters.map((q) => money(`ConsQ${q.quarter}`, q.consideration)).join("")}</dpi:Consideration><dpi:NumberOfActivities>${seller.quarters.map((q) => tag(`NumbQ${q.quarter}`, String(q.activities))).join("")}</dpi:NumberOfActivities><dpi:Fees>${seller.quarters.map((q) => money(`FeesQ${q.quarter}`, q.fees)).join("")}</dpi:Fees><dpi:Taxes>${seller.quarters.map((q) => money(`TaxesQ${q.quarter}`, q.taxes)).join("")}</dpi:Taxes></dpi:PersonalServices></dpi:RelevantActivities>`;
      return `<dpi:ReportableSeller>${identity}${activity}${docSpec(seller.docRefId)}</dpi:ReportableSeller>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><dpi:DPI_OECD xmlns:dpi="urn:oecd:ties:dpi" xmlns:stf="urn:oecd:ties:dpistf"><dpi:MessageSpec>${tag("TransmittingCountry", "FR")}${tag("ReceivingCountry", "FR")}${tag("MessageType", "DPI")}${tag("MessageRefId", prefix + document.id)}${tag("MessageTypeIndic", "DPI401")}${tag("ReportingPeriod", document.year + "-12-31")}${tag("Timestamp", document.createdAt)}</dpi:MessageSpec><dpi:DPIBody><dpi:PlatformOperator>${tag("ResCountryCode", "FR")}${tag("TIN", op.tin, ' issuedBy="FR"')}${tag("IN", op.tin, ' issuedBy="FR" INType="BRN"')}${op.vat ? tag("VAT", op.vat) : ""}${tag("Name", op.legalName)}${tag("PlatformBusinessName", op.platformName)}${address(op, "FR", "OECD304")}${tag("Nexus", "RPONEX1")}${tag("AssumedReporting", "false")}${docSpec(prefix + document.id + "-operator")}</dpi:PlatformOperator>${sellers}</dpi:DPIBody></dpi:DPI_OECD>`;
}
export function taxFilename(document: AnnualTaxDocument) {
  return `DPIDAC7_${document.year}_${document.operator.tin}_${String(document.fileSequence).padStart(3, "0")}_${document.createdAt.replace(/[^0-9]/g, "").slice(0, 14)}.xml`;
}
