"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { IDENTITY_NAME_MAX_LENGTH } from "@/candidate-identity/names";
import { Button } from "@/design/Button";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";

type NameField = "givenName" | "familyName" | "preferredName";
type Names = Record<NameField, string | null>;

const FIELDS: { field: NameField; autoComplete: string }[] = [
  { field: "givenName", autoComplete: "given-name" },
  { field: "familyName", autoComplete: "family-name" },
  { field: "preferredName", autoComplete: "nickname" },
];

const asText = (names: Names): Record<NameField, string> => ({ givenName: names.givenName ?? "", familyName: names.familyName ?? "", preferredName: names.preferredName ?? "" });

/**
 * Mon compte › Identité (#918): the Candidate's Given Name (« Prénom »), Family Name (« Nom ») and Preferred Name
 * (« Comment souhaitez-vous que les coachs vous appellent ? »), each optional, saved together; an emptied one is cleared.
 */
export function IdentityForm({ names }: { names: Names }) {
  const { t } = useTranslation();
  const [values, setValues] = useState(() => asText(names));
  const [working, setWorking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tooLong, setTooLong] = useState<NameField | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setSaved(false);
    setFailed(false);
    setTooLong(null);
    try {
      const response = await fetch("/api/account/identity", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const answer = (await response.json().catch(() => ({}))) as Partial<Names> & { error?: string; field?: NameField };
      if (answer.error === "too_long" && answer.field) setTooLong(answer.field);
      else if (!response.ok) throw new Error(String(response.status));
      else {
        setValues(asText({ givenName: answer.givenName ?? null, familyName: answer.familyName ?? null, preferredName: answer.preferredName ?? null }));
        setSaved(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)} noValidate>
      {FIELDS.map(({ field, autoComplete }) => (
        <Field
          key={field}
          label={t(`account.identity.${field}`)}
          hint={field === "preferredName" ? t("account.identity.preferredNameHint") : undefined}
          error={tooLong === field ? t("account.identity.tooLong") : undefined}
        >
          <TextInput
            name={field}
            autoComplete={autoComplete}
            maxLength={IDENTITY_NAME_MAX_LENGTH}
            value={values[field]}
            onChange={(event) => {
              const value = event.target.value;
              setValues((current) => ({ ...current, [field]: value }));
              setSaved(false);
            }}
          />
        </Field>
      ))}
      <div className="actions">
        <Button type="submit" variant="primary" busy={working}>
          {t("account.identity.save")}
        </Button>
      </div>
      <p role="status" className="account-status">
        {saved ? t("account.saved") : ""}
      </p>
      {failed ? (
        <Note tone="danger" role="alert">
          {t("account.identity.error")}
        </Note>
      ) : null}
    </form>
  );
}
