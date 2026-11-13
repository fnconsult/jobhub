export const TAX_FIELDS = [
  "legalName",
  "firstName",
  "lastName",
  "birthDate",
  "residence",
  "tin",
  "tinCountry",
  "siret",
  "vat",
  "street",
  "postalCode",
  "city",
  "addressCountry",
  "iban",
  "accountHolder",
] as const;
export const TAX_KINDS = ["individual", "entity"] as const;
