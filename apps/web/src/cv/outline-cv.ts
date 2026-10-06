/**
 * Rule-based reading of a CV's text into Master CV sections. Used when the AI
 * Coach's reading is unavailable or unusable: the Candidate reviews and
 * corrects the result either way, so a rough outline beats an empty form.
 * Recognises French and English section headings.
 */
import type { CvEducation, CvExperience, CvLanguage, MasterCvContent } from "@jobhub/shared";

type Section = "summary" | "experience" | "education" | "skills" | "languages" | "other";

const HEADINGS: Record<Section, string[]> = {
  summary: ["profil", "profil professionnel", "resume", "a propos", "objectif", "summary", "profile", "about me", "about"],
  experience: [
    "experience",
    "experiences",
    "experience professionnelle",
    "experiences professionnelles",
    "parcours professionnel",
    "parcours",
    "professional experience",
    "work experience",
    "employment history",
  ],
  education: ["formation", "formations", "diplomes", "etudes", "formation et diplomes", "education"],
  skills: ["competences", "competences cles", "savoir-faire", "skills", "key skills"],
  languages: ["langues", "languages"],
  other: ["centres d'interet", "loisirs", "interets", "interests", "hobbies", "certifications", "references"],
};

const normalize = (line: string) =>
  line
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[:\s]+$/, "")
    .trim();

function headingOf(line: string): Section | undefined {
  const key = normalize(line);
  return (Object.keys(HEADINGS) as Section[]).find((section) => HEADINGS[section].includes(key));
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /(\+33\s?|0)[1-9]([\s.-]?\d{2}){4}/;
const POSTCODE = /\b\d{5}\b|\(\d{2,5}\)/;
const YEAR = /\b(19|20)\d{2}\b/;
/** "2015 – 2024", "2015 - aujourd'hui", "01/2015 – 12/2024", "1998". */
const PERIOD = /((\d{1,2}\/)?(19|20)\d{2})(\s*[-–—à]\s*((\d{1,2}\/)?(19|20)\d{2}|aujourd'hui|présent|present|ce jour|now|today))?/i;
const SEPARATORS = /\s+[—–|-]\s+|\s*,\s+/;

const splitFields = (line: string) =>
  line
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean);

function experienceFrom(header: string): CvExperience {
  const period = header.match(PERIOD)?.[0] ?? "";
  const [title = "", employer = "", location = ""] = splitFields(header.replace(period, "")).filter((part) => !/^[-–—]$/.test(part));
  return { title, employer, location, period, description: "" };
}

function educationFrom(line: string): CvEducation {
  const year = line.match(PERIOD)?.[0] ?? "";
  const [degree = "", institution = ""] = splitFields(line.replace(year, ""));
  return { degree, institution, year };
}

function languageFrom(item: string): CvLanguage {
  const [name = "", level = ""] = item.split(/\s*[:(–—-]\s*/).map((part) => part.replace(/\)$/, "").trim());
  return { name, level };
}

const listItems = (lines: string[]) =>
  lines
    .flatMap((line) => line.split(/\s*[,;•·|]\s*/))
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

export function outlineCv(text: string): MasterCvContent {
  const sections: Record<Section | "header", string[]> = {
    header: [],
    summary: [],
    experience: [],
    education: [],
    skills: [],
    languages: [],
    other: [],
  };
  let current: Section | "header" = "header";
  for (const line of text.split("\n")) {
    const heading = headingOf(line);
    if (heading) current = heading;
    else sections[current].push(line);
  }

  const header = sections.header;
  const email = header.join(" ").match(EMAIL)?.[0] ?? "";
  const phone = header.join(" ").match(PHONE)?.[0] ?? "";
  const contactLine = (line: string) => EMAIL.test(line) || PHONE.test(line);
  const location = header.find((line) => !contactLine(line) && POSTCODE.test(line)) ?? "";
  const [fullName = "", headline = ""] = header.filter((line) => !contactLine(line) && line !== location);

  const experience: CvExperience[] = [];
  for (const line of sections.experience) {
    const last = experience.at(-1);
    if (YEAR.test(line) || !last) experience.push(experienceFrom(line));
    else last.description = last.description ? `${last.description}\n${line}` : line;
  }

  return {
    fullName,
    headline,
    email,
    phone,
    location,
    summary: sections.summary.join("\n"),
    experience,
    education: sections.education.map(educationFrom),
    skills: listItems(sections.skills),
    languages: listItems(sections.languages).map(languageFrom),
  };
}
