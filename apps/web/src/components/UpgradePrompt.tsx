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
