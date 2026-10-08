import Link from "next/link";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";

/** Shown where a Plan Quota stops the Candidate: what they reached, and the Plan that lets them go on. */
export function UpgradePrompt({ prompt }: { prompt: Prompt }) {
  return (
    <section className="notice stack upgrade-prompt" role="alert">
      <h2>{prompt.title}</h2>
      <p>{prompt.message}</p>
      {prompt.action ? (
        <Link className="button button-primary" href={prompt.href}>
          {prompt.action}
        </Link>
      ) : null}
    </section>
  );
}

/** The Upgrade Prompt in an API reply's body (`{ prompt }`), or null if there is none. */
export function upgradePromptIn(body: unknown): Prompt | null {
  const prompt: unknown = typeof body === "object" && body !== null && "prompt" in body ? body.prompt : null;
  if (typeof prompt !== "object" || prompt === null) return null;
  const { title, message, href } = prompt as Partial<Prompt>;
  return typeof title === "string" && typeof message === "string" && typeof href === "string" ? (prompt as Prompt) : null;
}
