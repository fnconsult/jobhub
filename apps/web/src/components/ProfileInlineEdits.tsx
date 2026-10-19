"use client";

import { distinctLocations, type SearchCriteria } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileFieldError } from "@/profiles";
import { PROFILE_NAME_MAX_LENGTH } from "@/profiles/limits";
import { GrowingTextarea, InlineNotice, useInlineEdit, type InlineSaveResult } from "./InlineEdit";
import {
  ContractTypeChoices,
  criteriaFieldsOf,
  LocationFields,
  RemoteWorkChoices,
  searchCriteriaInput,
  type ChoicesProps,
  type CriteriaFields,
} from "./SearchCriteriaFields";

type Problem = ProfileFieldError | "archived" | "failed";

/** Sends one change of the Profile: null when saved, otherwise the problem with `field`. */
async function patchProfile(profileId: string, body: object, field: string): Promise<Problem | null> {
  try {
    const response = await fetch(`/api/profiles/${profileId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const result = await response.json().catch(() => ({}));
    const errors: ProfileFieldError[] = Array.isArray(result.errors) ? result.errors : [];
    return errors.find((each) => each.field === field) ?? errors[0] ?? (result.error === "archived" ? "archived" : "failed");
  } catch {
    return "failed";
  }
}

/** What to tell the Candidate about a refused change. */
function useProblemMessage() {
  const { t } = useTranslation();
  return (problem: Problem, maxLength?: number): string => {
    if (problem === "archived") return t("searchCriteriaEditor.archived");
    if (problem === "failed") return t("profileActions.error");
    if (problem.code === "too_long") return t("cvReview.tooLong", { max: maxLength });
    return problem.code === "required" ? t("cvReview.required") : t("cvReview.invalidValue");
  };
}

/**
 * The Profile's name as the page title, edited in place: it saves when the
 * Candidate leaves it (or presses Enter), and the sidebar follows.
 */
export function ProfileTitle({ profileId, name }: { profileId: string; name: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const messageOf = useProblemMessage();
  const edit = useInlineEdit({
    saved: name,
    required: true,
    save: async (value) => {
      const problem = await patchProfile(profileId, { name: value }, "name");
      if (problem) return { ok: false, message: messageOf(problem, PROFILE_NAME_MAX_LENGTH) };
      router.refresh();
      return { ok: true };
    },
  });
  return (
    <div className="title-field">
      <label className="visually-hidden" htmlFor={id}>
        {t("profileActions.name")}
      </label>
      <h1 tabIndex={-1}>
        <GrowingTextarea
          id={id}
          {...edit.field}
          className="inline-edit title-edit"
          rows={1}
          maxLength={PROFILE_NAME_MAX_LENGTH}
          aria-describedby={edit.notice?.kind === "error" ? `${id}-error` : undefined}
          onKeyDown={edit.onKeyDown}
        />
      </h1>
      <InlineNotice notice={edit.notice} savedLabel={t("profilePage.nameSaved")} id={`${id}-error`} />
    </div>
  );
}

/**
 * An active Profile's Search Criteria as a property list, each value edited in
 * place and saved on change: a text when the Candidate leaves it, a place when
 * they leave its input or remove it, a contract type or remote-work option as
 * soon as it is ticked or unticked. Changing them does not rename the Profile.
 */
export function SearchCriteriaProperties({ profileId, searchCriteria }: { profileId: string; searchCriteria: SearchCriteria }) {
  const { t } = useTranslation();
  const router = useRouter();
  const initial = criteriaFieldsOf(searchCriteria);
  // The criteria as last saved: each field saves them all with its own value changed.
  const saved = useRef<CriteriaFields>(initial);
  const messageOf = useProblemMessage();
  // One save at a time, in the order the changes were made: each builds on the one before.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveCriteria = (changes: Partial<CriteriaFields>, field: keyof CriteriaFields, maxLength?: number): Promise<InlineSaveResult> => {
    const saving = queue.current.then(async (): Promise<InlineSaveResult> => {
      const next = { ...saved.current, ...changes };
      const problem = await patchProfile(profileId, { searchCriteria: searchCriteriaInput(next) }, `searchCriteria.${field}`);
      if (problem) return { ok: false, message: messageOf(problem, maxLength) };
      saved.current = next;
      router.refresh();
      return { ok: true };
    });
    queue.current = saving;
    return saving;
  };
  const saves = {
    targetRole: (targetRole: string) => saveCriteria({ targetRole }, "targetRole", PROFILE_NAME_MAX_LENGTH),
    locations: (locations: string[]) => saveCriteria({ locations }, "locations"),
    minSalary: (minSalary: string) => saveCriteria({ minSalary }, "minSalary"),
    contractTypes: (contractTypes: CriteriaFields["contractTypes"]) => saveCriteria({ contractTypes }, "contractTypes"),
    remoteWorkOptions: (remoteWorkOptions: CriteriaFields["remoteWorkOptions"]) => saveCriteria({ remoteWorkOptions }, "remoteWorkOptions"),
  };
  return (
    <div role="group" aria-label={t("cvReview.searchCriteria")}>
      <dl className="props">
        <Property label={t("cvReview.targetRole")} required maxLength={PROFILE_NAME_MAX_LENGTH} saved={initial.targetRole} save={saves.targetRole} />
        <LocationsProperty saved={searchCriteria.locations} save={saves.locations} />
        <Property label={t("cvReview.minSalary")} numeric saved={initial.minSalary} save={saves.minSalary} />
        <ChoicesProperty
          label={t("cvReview.contractType")}
          Choices={ContractTypeChoices}
          saved={initial.contractTypes}
          save={saves.contractTypes}
        />
        <ChoicesProperty
          label={t("cvReview.remoteWork")}
          Choices={RemoteWorkChoices}
          saved={initial.remoteWorkOptions}
          save={saves.remoteWorkOptions}
          hint={t("searchCriteriaEditor.hint")}
        />
      </dl>
    </div>
  );
}

type Notice = { kind: "saved" } | { kind: "error"; message: string } | null;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The Search Criteria's places, up to five, on a property row. A place saves when the Candidate
 * leaves its input or removes it; with every place left blank, the saved ones come back (one is required).
 */
function LocationsProperty({ saved: initial, save }: { saved: string[]; save: (locations: string[]) => Promise<InlineSaveResult> }) {
  const { t } = useTranslation();
  const [locations, setLocations] = useState(initial.length ? initial : [""]);
  const saved = useRef(initial);
  const [notice, setNotice] = useState<Notice>(null);
  async function commit(next: string[]) {
    const kept = distinctLocations(next);
    if (kept.length === 0) {
      setLocations(saved.current.length ? saved.current : [""]);
      return;
    }
    if (sameList(kept, saved.current)) return;
    setNotice(null);
    const result = await save(kept);
    if (result.ok) {
      saved.current = kept;
      setNotice({ kind: "saved" });
    } else {
      setNotice({ kind: "error", message: result.message });
    }
  }
  return (
    <>
      <dt>{t("cvReview.locations")}</dt>
      <dd>
        <LocationFields
          inline
          value={locations}
          onChange={setLocations}
          onLeave={(next) => void commit(next)}
          onRemove={(next) => {
            setLocations(next);
            void commit(next);
          }}
        />
        <InlineNotice notice={notice} savedLabel={t("profilePage.criteriaSaved")} />
      </dd>
    </>
  );
}

/**
 * Contract types or remote-work options on a property row, as checkboxes: each tick or untick
 * saves at once; a refused one puts the saved choice back.
 */
function ChoicesProperty<T extends string>(props: {
  label: string;
  Choices: ComponentType<ChoicesProps<T>>;
  saved: T[];
  save: (value: T[]) => Promise<InlineSaveResult>;
  hint?: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<T[]>(props.saved);
  const saved = useRef(props.saved);
  const [notice, setNotice] = useState<Notice>(null);
  const { Choices, save } = props;
  const change = async (next: T[]) => {
    setValue(next);
    setNotice(null);
    const result = await save(next);
    if (result.ok) {
      saved.current = next;
      setNotice({ kind: "saved" });
    } else {
      setValue(saved.current);
      setNotice({ kind: "error", message: result.message });
    }
  };
  return (
    <>
      <dt>{props.label}</dt>
      <dd>
        <Choices inline value={value} onChange={(next) => void change(next)} />
        <InlineNotice notice={notice} savedLabel={t("profilePage.criteriaSaved")} />
        {props.hint ? <span className="hint">{props.hint}</span> : null}
      </dd>
    </>
  );
}

type PropertyProps = {
  label: string;
  saved: string;
  save: (value: string) => Promise<InlineSaveResult>;
  required?: boolean;
  numeric?: boolean;
  maxLength?: number;
  hint?: string;
};

function Property(props: PropertyProps) {
  const { t } = useTranslation();
  const id = useId();
  const edit = useInlineEdit({ saved: props.saved, required: props.required ?? false, save: props.save });
  const described = [props.hint ? `${id}-hint` : "", edit.notice?.kind === "error" ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <dt>
        <label htmlFor={id}>{props.label}</label>
      </dt>
      <dd>
        <input
          id={id}
          type="text"
          {...edit.field}
          required={props.required}
          maxLength={props.maxLength}
          inputMode={props.numeric ? "numeric" : undefined}
          aria-describedby={described}
          onKeyDown={edit.onKeyDown}
        />
        <InlineNotice notice={edit.notice} savedLabel={t("profilePage.criteriaSaved")} id={`${id}-error`} />
        {props.hint ? (
          <span className="hint" id={`${id}-hint`}>
            {props.hint}
          </span>
        ) : null}
      </dd>
    </>
  );
}
