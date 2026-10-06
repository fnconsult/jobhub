"use client";

import {
  CONTRACT_TYPES,
  REMOTE_WORK_OPTIONS,
  type CvEducation,
  type CvExperience,
  type CvLanguage,
  type MasterCvContent,
} from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CvDraft, CvFileErrorCode } from "@/cv";
import type { ProfileFieldError } from "@/profiles";
import { routes } from "@/routes";

/** Search Criteria as the review form holds them: what the inputs show. */
interface CriteriaFields {
  targetRole: string;
  location: string;
  minSalary: string;
  contractType: string;
  remoteWork: string;
}

type Step =
  | { kind: "upload"; reading: boolean; error?: CvFileErrorCode | "unknown" }
  | { kind: "review"; masterCv: MasterCvContent; criteria: CriteriaFields; saving: boolean; errors: ProfileFieldError[]; failed: boolean };

const FILE_ERRORS = new Set<string>(["unsupported_format", "too_large", "unreadable", "empty"]);

/**
 * Creating a Profile from a CV: the Candidate uploads a PDF or Word CV, then
 * reviews and corrects the Master CV and Search Criteria read from it before
 * anything is saved.
 */
export function CvOnboarding() {
  const { t } = useTranslation();
  const router = useRouter();
  const fileId = useId();
  const [step, setStep] = useState<Step>({ kind: "upload", reading: false });

  async function readCv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStep({ kind: "upload", reading: true });
    try {
      const response = await fetch("/api/cv/draft", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStep({ kind: "upload", reading: false, error: FILE_ERRORS.has(body.error) ? body.error : "unknown" });
        return;
      }
      const draft = body as CvDraft;
      setStep({
        kind: "review",
        masterCv: draft.masterCv,
        criteria: { ...draft.searchCriteria, minSalary: "", contractType: "", remoteWork: "" },
        saving: false,
        errors: [],
        failed: false,
      });
    } catch {
      setStep({ kind: "upload", reading: false, error: "unknown" });
    }
  }

  if (step.kind === "upload") {
    return (
      <form className="stack" onSubmit={readCv}>
        <label htmlFor={fileId}>{t("cvUpload.fileLabel")}</label>
        <p id={`${fileId}-hint`} className="hint">
          {t("cvUpload.fileHint")}
        </p>
        <input
          id={fileId}
          className="input"
          name="cv"
          type="file"
          required
          aria-describedby={`${fileId}-hint`}
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        />
        <button className="button button-primary" type="submit" disabled={step.reading}>
          {step.reading ? t("cvUpload.reading") : t("cvUpload.submit")}
        </button>
        {step.reading ? (
          <p className="notice" role="status">
            {t("cvUpload.reading")}
          </p>
        ) : null}
        {step.error ? (
          <p className="notice" role="alert">
            {t(`cvUpload.errors.${step.error}`)}
          </p>
        ) : null}
      </form>
    );
  }

  const review = step;
  const update = (changes: Partial<Extract<Step, { kind: "review" }>>) => setStep({ ...review, ...changes });
  const setCv = (changes: Partial<MasterCvContent>) => update({ masterCv: { ...review.masterCv, ...changes } });
  const setCriteria = (changes: Partial<CriteriaFields>) => update({ criteria: { ...review.criteria, ...changes } });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { criteria, masterCv } = review;
    const salary = criteria.minSalary.replace(/[\s.]/g, "");
    const searchCriteria = {
      targetRole: criteria.targetRole,
      location: criteria.location,
      ...(salary ? { minSalary: /^\d+$/.test(salary) ? Number(salary) : salary } : {}),
      ...(criteria.contractType ? { contractType: criteria.contractType } : {}),
      ...(criteria.remoteWork ? { remoteWork: criteria.remoteWork } : {}),
    };
    update({ saving: true, failed: false });
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masterCv, searchCriteria }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 201) {
        router.push(routes.profile(body.id));
        return;
      }
      update({ saving: false, errors: Array.isArray(body.errors) ? body.errors : [], failed: !Array.isArray(body.errors) });
    } catch {
      update({ saving: false, failed: true });
    }
  }

  const criteriaError = Object.fromEntries(
    review.errors.flatMap((error) => (error.field.startsWith("searchCriteria.") ? [[error.field.slice("searchCriteria.".length), error]] : [])),
  ) as Partial<Record<keyof CriteriaFields, ProfileFieldError>>;
  const fieldLabels: Record<string, string> = {
    "searchCriteria.targetRole": t("cvReview.targetRole"),
    "searchCriteria.location": t("cvReview.location"),
    "searchCriteria.minSalary": t("cvReview.minSalary"),
    "searchCriteria.contractType": t("cvReview.contractType"),
    "searchCriteria.remoteWork": t("cvReview.remoteWork"),
  };
  const invalidFields = [...new Set(review.errors.map((error) => fieldLabels[error.field] ?? error.field))];

  return (
    <form className="stack review" onSubmit={save} noValidate>
      <h2>{t("cvReview.title")}</h2>
      <p>{t("cvReview.intro")}</p>

      <fieldset className="fieldset">
        <legend>{t("cvReview.searchCriteria")}</legend>
        <TextField label={t("cvReview.targetRole")} value={review.criteria.targetRole} onChange={(targetRole) => setCriteria({ targetRole })} error={criteriaError.targetRole} required />
        <TextField label={t("cvReview.location")} value={review.criteria.location} onChange={(location) => setCriteria({ location })} error={criteriaError.location} required />
        <TextField label={t("cvReview.minSalary")} value={review.criteria.minSalary} onChange={(minSalary) => setCriteria({ minSalary })} error={criteriaError.minSalary} numeric />
        <SelectField
          label={t("cvReview.contractType")}
          value={review.criteria.contractType}
          onChange={(contractType) => setCriteria({ contractType })}
          options={CONTRACT_TYPES.map((value) => [value, t(`cvReview.contractTypes.${value}`)])}
          error={criteriaError.contractType}
        />
        <SelectField
          label={t("cvReview.remoteWork")}
          value={review.criteria.remoteWork}
          onChange={(remoteWork) => setCriteria({ remoteWork })}
          options={REMOTE_WORK_OPTIONS.map((value) => [value, t(`cvReview.remoteWorkOptions.${value}`)])}
          error={criteriaError.remoteWork}
        />
      </fieldset>

      <fieldset className="fieldset">
        <legend>{t("cvReview.identity")}</legend>
        <TextField label={t("cvReview.fullName")} value={review.masterCv.fullName} onChange={(fullName) => setCv({ fullName })} />
        <TextField label={t("cvReview.headline")} value={review.masterCv.headline} onChange={(headline) => setCv({ headline })} />
        <TextField label={t("cvReview.email")} value={review.masterCv.email} onChange={(email) => setCv({ email })} type="email" />
        <TextField label={t("cvReview.phone")} value={review.masterCv.phone} onChange={(phone) => setCv({ phone })} type="tel" />
        <TextField label={t("cvReview.cvLocation")} value={review.masterCv.location} onChange={(location) => setCv({ location })} />
        <TextField label={t("cvReview.summary")} value={review.masterCv.summary} onChange={(summary) => setCv({ summary })} multiline />
      </fieldset>

      <EntryList<CvExperience>
        legend={t("cvReview.experience")}
        items={review.masterCv.experience}
        onChange={(experience) => setCv({ experience })}
        blank={{ title: "", employer: "", location: "", period: "", description: "" }}
        itemLabel={(number) => t("cvReview.experienceItem", { number })}
        addLabel={t("cvReview.addExperience")}
        removeLabel={(number) => t("cvReview.removeExperience", { number })}
        render={(item, set) => (
          <>
            <TextField label={t("cvReview.jobTitle")} value={item.title} onChange={(title) => set({ title })} />
            <TextField label={t("cvReview.employer")} value={item.employer} onChange={(employer) => set({ employer })} />
            <TextField label={t("cvReview.jobLocation")} value={item.location} onChange={(location) => set({ location })} />
            <TextField label={t("cvReview.period")} value={item.period} onChange={(period) => set({ period })} />
            <TextField label={t("cvReview.description")} value={item.description} onChange={(description) => set({ description })} multiline />
          </>
        )}
      />

      <EntryList<CvEducation>
        legend={t("cvReview.education")}
        items={review.masterCv.education}
        onChange={(education) => setCv({ education })}
        blank={{ degree: "", institution: "", year: "" }}
        itemLabel={(number) => t("cvReview.educationItem", { number })}
        addLabel={t("cvReview.addEducation")}
        removeLabel={(number) => t("cvReview.removeEducation", { number })}
        render={(item, set) => (
          <>
            <TextField label={t("cvReview.degree")} value={item.degree} onChange={(degree) => set({ degree })} />
            <TextField label={t("cvReview.institution")} value={item.institution} onChange={(institution) => set({ institution })} />
            <TextField label={t("cvReview.year")} value={item.year} onChange={(year) => set({ year })} />
          </>
        )}
      />

      <fieldset className="fieldset">
        <legend>{t("cvReview.skills")}</legend>
        <TextField
          label={t("cvReview.skills")}
          hint={t("cvReview.skillsHint")}
          value={review.masterCv.skills.join("\n")}
          onChange={(skills) => setCv({ skills: skills.split("\n") })}
          multiline
        />
      </fieldset>

      <EntryList<CvLanguage>
        legend={t("cvReview.languages")}
        items={review.masterCv.languages}
        onChange={(languages) => setCv({ languages })}
        blank={{ name: "", level: "" }}
        itemLabel={(number) => t("cvReview.languageItem", { number })}
        addLabel={t("cvReview.addLanguage")}
        removeLabel={(number) => t("cvReview.removeLanguage", { number })}
        render={(item, set) => (
          <>
            <TextField label={t("cvReview.language")} value={item.name} onChange={(name) => set({ name })} />
            <TextField label={t("cvReview.level")} value={item.level} onChange={(level) => set({ level })} />
          </>
        )}
      />

      {invalidFields.length > 0 ? (
        <p className="notice" role="alert">
          {t("cvReview.invalid", { fields: invalidFields.join(", ") })}
        </p>
      ) : null}
      {review.failed ? (
        <p className="notice" role="alert">
          {t("cvReview.error")}
        </p>
      ) : null}
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={review.saving}>
          {review.saving ? t("cvReview.saving") : t("cvReview.save")}
        </button>
        <button className="button" type="button" onClick={() => setStep({ kind: "upload", reading: false })}>
          {t("cvReview.startOver")}
        </button>
      </div>
    </form>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: ProfileFieldError | undefined;
  required?: boolean;
  multiline?: boolean;
  type?: "text" | "email" | "tel";
  /** Shows a numeric keypad on phones. */
  numeric?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const described = [props.hint ? `${id}-hint` : "", props.error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    className: "input",
    value: props.value,
    required: props.required,
    "aria-invalid": props.error ? true : undefined,
    "aria-describedby": described,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.hint ? (
        <p id={`${id}-hint`} className="hint">
          {props.hint}
        </p>
      ) : null}
      {props.multiline ? (
        <textarea {...common} rows={4} onChange={(event) => props.onChange(event.target.value)} />
      ) : (
        <input {...common} type={props.type ?? "text"} inputMode={props.numeric ? "numeric" : undefined} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {props.error ? (
        <p id={`${id}-error`} className="field-error">
          {t(props.error.code === "required" ? "cvReview.required" : "cvReview.invalidValue")}
        </p>
      ) : null}
    </div>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  error?: ProfileFieldError | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} className="input" value={props.value} aria-invalid={props.error ? true : undefined} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">{t("cvReview.notSpecified")}</option>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function EntryList<T extends object>(props: {
  legend: string;
  items: T[];
  onChange: (items: T[]) => void;
  blank: T;
  itemLabel: (number: number) => string;
  addLabel: string;
  removeLabel: (number: number) => string;
  render: (item: T, set: (changes: Partial<T>) => void) => ReactNode;
}) {
  const { items, onChange } = props;
  return (
    <fieldset className="fieldset">
      <legend>{props.legend}</legend>
      {items.map((item, index) => (
        <fieldset className="fieldset entry" key={index}>
          <legend>{props.itemLabel(index + 1)}</legend>
          {props.render(item, (changes) => onChange(items.map((other, i) => (i === index ? { ...other, ...changes } : other))))}
          <button className="button" type="button" onClick={() => onChange(items.filter((_, i) => i !== index))}>
            {props.removeLabel(index + 1)}
          </button>
        </fieldset>
      ))}
      <button className="button" type="button" onClick={() => onChange([...items, { ...props.blank }])}>
        {props.addLabel}
      </button>
    </fieldset>
  );
}
