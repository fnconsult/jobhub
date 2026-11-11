"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Select, TextInput } from "@/design/Field";
import type { TaxIdentity } from "./model";
import { TAX_FIELDS, TAX_KINDS } from "./fields";
export function TaxIdentityForm({
  sellerId,
  year,
  initial,
  siret,
  association,
}: {
  sellerId: string;
  year: number;
  initial: TaxIdentity | null;
  siret: string;
  association: boolean;
}) {
  const { t } = useTranslation(),
    [kind, setKind] = useState<"individual" | "entity">(initial?.kind ?? (association ? "entity" : "individual")),
    [working, setWorking] = useState(false),
    [status, setStatus] = useState<"saved" | "error" | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      identity = Object.fromEntries(
        TAX_FIELDS.filter((field) => kind === "individual" || !["firstName", "lastName", "birthDate"].includes(field)).map((field) => [
          field,
          form.get(field) ?? "",
        ]),
      );
    if (!identity.birthDate) delete identity.birthDate;
    setWorking(true);
    setStatus(null);
    try {
      const response = await fetch("/api/account/coaching/tax-identity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellerId,
          year,
          identity: {
            ...identity,
            kind,
            permanentEstablishments: String(form.get("permanentEstablishments") ?? "")
              .split(",")
              .map((x) => x.trim().toUpperCase())
              .filter(Boolean),
          },
        }),
      });
      if (!response.ok) throw Error();
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setWorking(false);
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="stack">
      <p>{t("coachTax.identityIntro", { year })}</p>
      <Field label={t("coachTax.kind")}>
        <Select value={kind} disabled={association} onChange={(event) => setKind(event.target.value as "individual" | "entity")}>
          {TAX_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`coachTax.kinds.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      {TAX_FIELDS.filter((field) => kind === "individual" || !["firstName", "lastName", "birthDate"].includes(field)).map((field) => (
        <Field key={field} label={t(`coachTax.fields.${field}`)}>
          <TextInput
            name={field}
            type={field === "birthDate" ? "date" : "text"}
            defaultValue={initial?.[field] ?? (field === "siret" ? siret : ["residence", "tinCountry", "addressCountry"].includes(field) ? "FR" : "")}
            required={field !== "vat"}
            maxLength={field === "iban" ? 34 : 200}
            autoComplete="off"
          />
        </Field>
      ))}
      {kind === "entity" ? (
        <Field label={t("coachTax.permanentEstablishments")}>
          <TextInput name="permanentEstablishments" defaultValue={initial?.permanentEstablishments.join(",") ?? ""} />
        </Field>
      ) : null}
      <button className="button" type="submit" disabled={working}>
        {t("coachTax.saveIdentity")}
      </button>
      {status ? <p role={status === "error" ? "alert" : "status"}>{t(`coachTax.${status}`)}</p> : null}
    </form>
  );
}
