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

  it("leaves a letter that is only its body as it is", () => {
    expect(coverLetterBody(body, candidate)).toBe(body);
  });

  it("leaves out the signature and contact details after an English closing", () => {
    const letter = "# Cover letter\n\nDear Hiring Manager,\n\nI am applying for the *CFO* position.\n\nYours faithfully,\n\nHélène Durand-Lefèvre\nhelene@example.fr | 06 12 34 56 78";

    expect(coverLetterBody(letter, candidate)).toBe("Dear Hiring Manager,\n\nI am applying for the CFO position.\n\nYours faithfully,");
  });

  it("leaves out the frame before the first paragraph when there is no salutation", () => {
    const letter = "**Hélène Durand-Lefèvre**\n[Email] | [Téléphone]\n\nObjet : Candidature DAF\n\nVotre offre a retenu toute mon attention.\n\n[Signature]";

    expect(coverLetterBody(letter, candidate)).toBe("Votre offre a retenu toute mon attention.");
  });

  it("takes a placeholder left in a sentence out of it", () => {
    const letter = "Madame, Monsieur,\n\nVotre agence de [Ville] recrute, et je serais ravie de la rejoindre [le plus tôt possible].";

    expect(coverLetterBody(letter, candidate)).toBe("Madame, Monsieur,\n\nVotre agence de recrute, et je serais ravie de la rejoindre.");
  });
});
