"use client";

import type { CvEducation, CvExperience, CvLanguage, MasterCvContent } from "@jobhub/shared";
import { useTranslation } from "react-i18next";
import { EntryList, TextField } from "./form-fields";

/**
 * Every section of a Master CV as form fields: identity and summary, then
 * experience, education, skills and languages, whose entries the Candidate can
 * add, edit, reorder and remove. Used to review a CV draft and to edit a Master CV.
 */
export function MasterCvFields({ value, onChange }: { value: MasterCvContent; onChange: (value: MasterCvContent) => void }) {
  const { t } = useTranslation();
  const set = (changes: Partial<MasterCvContent>) => onChange({ ...value, ...changes });
  return (
    <>
      <fieldset className="fieldset">
        <legend>{t("cvReview.identity")}</legend>
        <TextField label={t("cvReview.fullName")} value={value.fullName} onChange={(fullName) => set({ fullName })} />
        <TextField label={t("cvReview.headline")} value={value.headline} onChange={(headline) => set({ headline })} />
        <TextField label={t("cvReview.email")} value={value.email} onChange={(email) => set({ email })} type="email" />
        <TextField label={t("cvReview.phone")} value={value.phone} onChange={(phone) => set({ phone })} type="tel" />
        <TextField label={t("cvReview.cvLocation")} value={value.location} onChange={(location) => set({ location })} />
        <TextField label={t("cvReview.summary")} value={value.summary} onChange={(summary) => set({ summary })} multiline />
      </fieldset>

      <EntryList<CvExperience>
        legend={t("cvReview.experience")}
        items={value.experience}
        onChange={(experience) => set({ experience })}
        blank={{ title: "", employer: "", location: "", period: "", description: "" }}
        itemLabel={(number) => t("cvReview.experienceItem", { number })}
        addLabel={t("cvReview.addExperience")}
        removeLabel={(number) => t("cvReview.removeExperience", { number })}
        render={(item, replace) => (
          <>
            <TextField label={t("cvReview.jobTitle")} value={item.title} onChange={(title) => replace({ ...item, title })} />
            <TextField label={t("cvReview.employer")} value={item.employer} onChange={(employer) => replace({ ...item, employer })} />
            <TextField label={t("cvReview.jobLocation")} value={item.location} onChange={(location) => replace({ ...item, location })} />
            <TextField label={t("cvReview.period")} value={item.period} onChange={(period) => replace({ ...item, period })} />
            <TextField label={t("cvReview.description")} value={item.description} onChange={(description) => replace({ ...item, description })} multiline />
          </>
        )}
      />

      <EntryList<CvEducation>
        legend={t("cvReview.education")}
        items={value.education}
        onChange={(education) => set({ education })}
        blank={{ degree: "", institution: "", year: "" }}
        itemLabel={(number) => t("cvReview.educationItem", { number })}
        addLabel={t("cvReview.addEducation")}
        removeLabel={(number) => t("cvReview.removeEducation", { number })}
        render={(item, replace) => (
          <>
            <TextField label={t("cvReview.degree")} value={item.degree} onChange={(degree) => replace({ ...item, degree })} />
            <TextField label={t("cvReview.institution")} value={item.institution} onChange={(institution) => replace({ ...item, institution })} />
            <TextField label={t("cvReview.year")} value={item.year} onChange={(year) => replace({ ...item, year })} />
          </>
        )}
      />

      <EntryList<string>
        legend={t("cvReview.skills")}
        items={value.skills}
        onChange={(skills) => set({ skills })}
        blank=""
        itemLabel={(number) => t("cvReview.skillItem", { number })}
        addLabel={t("cvReview.addSkill")}
        removeLabel={(number) => t("cvReview.removeSkill", { number })}
        render={(item, replace) => <TextField label={t("cvReview.skill")} value={item} onChange={replace} />}
      />

      <EntryList<CvLanguage>
        legend={t("cvReview.languages")}
        items={value.languages}
        onChange={(languages) => set({ languages })}
        blank={{ name: "", level: "" }}
        itemLabel={(number) => t("cvReview.languageItem", { number })}
        addLabel={t("cvReview.addLanguage")}
        removeLabel={(number) => t("cvReview.removeLanguage", { number })}
        render={(item, replace) => (
          <>
            <TextField label={t("cvReview.language")} value={item.name} onChange={(name) => replace({ ...item, name })} />
            <TextField label={t("cvReview.level")} value={item.level} onChange={(level) => replace({ ...item, level })} />
          </>
        )}
      />
    </>
  );
}
