import { createAiLayer, type OfferEmailReading, type TextInput } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { describe, expect, it } from "vitest";
import { createGuardrails, DEFAULT_GUARDRAIL_MESSAGES, GUARDRAIL_IDS, type EmailGuardRequest, type GuardrailId, type GuardrailSetting, type GuardrailTrigger } from "./index";

const AT = new Date("2026-10-28T10:00:00Z");

/** A fictional alert, as Email intake keeps its text (each link written after its words). */
const ALERT = [
  "Votre alerte emploi pour « directeur financier »",
  "Responsable contrôle de gestion <https://www.exemple-emploi.fr/offre/1001?utm_source=alerte>",
  "Exemple Industrie · Lyon",
  "Contrôleur financier <https://www.exemple-emploi.fr/offre/1002?utm_source=alerte>",
  "Démo Logistique · Villeurbanne",
  "Pour toute question, contactez Claire Martin au 04 72 00 00 00 ou claire.martin@exemple-emploi.fr.",
].join("\n");

const READING: OfferEmailReading = {
  kind: "alert",
  offers: [
    { title: "Responsable contrôle de gestion", employer: "Exemple Industrie", location: "Lyon", link: "https://www.exemple-emploi.fr/offre/1001?utm_source=alerte" },
    { title: "Contrôleur financier", employer: "Démo Logistique", location: "Villeurbanne", link: "https://www.exemple-emploi.fr/offre/1002?utm_source=alerte" },
  ],
};

/** `verdict`: what the model check answers, as the model writes it. */
function setUp(options: { verdict?: string; setting?: GuardrailSetting } = {}) {
  const checked: string[] = [];
  const provider = createFakeProvider({
    id: "mistral",
    reply: (input: TextInput) => {
      if (!input.system?.startsWith("Tu contrôles un email")) return "{}";
      checked.push(input.messages.at(-1)?.content ?? "");
      return options.verdict ?? `{"email_injection": false}`;
    },
  });
  const ai = createAiLayer({ providers: [provider], routes: { guardrail: "mistral" }, usage: createMemoryUsageLog() });
  const triggers: GuardrailTrigger[] = [];
  const guardrails = createGuardrails({
    ai,
    config: {
      current: async () => ({
        settings: { ...Object.fromEntries(GUARDRAIL_IDS.map((id) => [id, "block"])), ...(options.setting ? { email_injection: options.setting } : {}) } as Record<GuardrailId, GuardrailSetting>,
        messages: DEFAULT_GUARDRAIL_MESSAGES,
      }),
    },
    triggers: { record: (trigger) => void triggers.push(trigger) },
    now: () => AT,
  });
  return { guardrails, triggers, checked };
}

/** A reading that gives `reading`, counting its calls. */
function reader(reading: OfferEmailReading = READING) {
  const calls: number[] = [];
  return { calls, read: async () => (calls.push(1), reading) };
}

const request = (text: string, read: EmailGuardRequest["read"], extra: Partial<EmailGuardRequest["email"]> = {}): EmailGuardRequest => ({
  candidateId: "marie",
  email: { text, authenticated: true, ...extra },
  read,
});

describe("the fixed rules on Email intake's reading, always on", () => {
  it("lets a reading through when it only says what the email offers", async () => {
    const { guardrails } = setUp();

    await expect(guardrails.guardEmail(request(ALERT, reader().read))).resolves.toMatchObject({ outcome: "read", reading: READING });
  });

  it("sets aside a reading that holds a phone number", async () => {
    const { guardrails } = setUp();
    const withPhone = { ...READING, offers: [{ ...READING.offers[0]!, excerpt: "Appelez le 04 72 00 00 00." }] };

    await expect(guardrails.guardEmail(request(ALERT, reader(withPhone).read))).resolves.toMatchObject({ outcome: "set_aside" });
  });

  it("sets aside a reading whose link is not in the email as is, one the email holds passing", async () => {
    const { guardrails } = setUp();
    const elsewhere = { ...READING, offers: [{ ...READING.offers[0]!, link: "https://piege.example/offre/1001" }] };
    const retracked = { ...READING, offers: [{ ...READING.offers[0]!, link: "https://www.exemple-emploi.fr/offre/1001?utm_source=piege" }] };

    await expect(guardrails.guardEmail(request(ALERT, reader(elsewhere).read))).resolves.toMatchObject({ outcome: "set_aside" });
    await expect(guardrails.guardEmail(request(ALERT, reader(retracked).read))).resolves.toMatchObject({ outcome: "set_aside" });
  });

  it("sets aside a reading that holds an email address or the name of a person the email names", async () => {
    const { guardrails } = setUp();
    const withEmail = { ...READING, offers: [{ ...READING.offers[0]!, excerpt: "Écrire à claire.martin@exemple-emploi.fr" }] };
    const withName = { ...READING, offers: [{ ...READING.offers[0]!, intermediary: "Claire Martin" }] };

    await expect(guardrails.guardEmail(request(ALERT, reader(withEmail).read))).resolves.toMatchObject({ outcome: "set_aside" });
    await expect(guardrails.guardEmail(request(ALERT, reader(withName).read))).resolves.toMatchObject({ outcome: "set_aside" });
  });

  it("sets aside a reading of more than 30 offers; 30 pass", async () => {
    const { guardrails } = setUp();
    const offers = (count: number): OfferEmailReading => ({ kind: "alert", offers: Array.from({ length: count }, (_, index) => ({ title: `Contrôleur financier ${index + 1}` })) });

    await expect(guardrails.guardEmail(request(ALERT, reader(offers(30)).read))).resolves.toMatchObject({ outcome: "read" });
    await expect(guardrails.guardEmail(request(ALERT, reader(offers(31)).read))).resolves.toMatchObject({ outcome: "set_aside" });
  });

  it("applies them even with the email Guardrail switched off, and records no Guardrail Trigger", async () => {
    const { guardrails, triggers } = setUp({ setting: "off" });
    const withPhone = { ...READING, offers: [{ ...READING.offers[0]!, excerpt: "Appelez le 04 72 00 00 00." }] };

    await expect(guardrails.guardEmail(request(ALERT, reader(withPhone).read))).resolves.toMatchObject({ outcome: "set_aside" });
    expect(triggers).toEqual([]);
  });
});
