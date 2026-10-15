import { describe, expect, it } from "vitest";
import { coverLetterBody } from "./cover-letter-body";

const candidate = { fullName: "Hélène Durand-Lefèvre" };

/** A letter as the AI Coach wrote it in QA #63: Markdown, placeholders, its own sender block, date, subject and signature. */
const drafted = `**Hélène Durand-Lefèvre**
[Adresse]
[Code postal, Ville]
[Email] | [Téléphone]

Agence Rhône-Alpes
[Adresse de l'agence]

Lyon, le [Date]

**Objet : Candidature au poste de Directrice administrative et financière**

**À l'attention du service recrutement**

Madame, Monsieur,

Directrice financière depuis quinze ans, j'ai piloté la **consolidation IFRS** d'un groupe industriel.

Je serais heureuse de vous exposer ma démarche lors d'un entretien.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

**Hélène Durand-Lefèvre**`;

const body = `Madame, Monsieur,

Directrice financière depuis quinze ans, j'ai piloté la consolidation IFRS d'un groupe industriel.

Je serais heureuse de vous exposer ma démarche lors d'un entretien.

Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.`;

describe("the body of a Cover Letter", () => {
  it("is the letter from its salutation to its closing, in plain text: no sender block, placeholders, date, subject, Markdown or signature", () => {
    expect(coverLetterBody(drafted, candidate)).toBe(body);
  });
});
