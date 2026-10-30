import Link from "next/link";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";

/**
 * Shown where a Plan Quota stops the Candidate: what they reached, and the Plan that lets them go on. The quota-reached
 * card (#469): the Design System's Card, announced as an alert, its way to Mon abonnement the primary button.
 */
export function UpgradePrompt({ prompt }: { prompt: Prompt }) {
  return (
    <div className="upgrade-prompt" role="alert">
      <Card title={prompt.title}>
        <p>{prompt.message}</p>
        {prompt.action ? (
          <Link className={buttonClass({ variant: "primary" })} href={prompt.href}>
            {prompt.action}
          </Link>
        ) : null}
      </Card>
    </div>
  );
}

/** The Upgrade Prompt in an API reply's body (`{ prompt }`), or null if there is none. */
export function upgradePromptIn(body: unknown): Prompt | null {
  const prompt: unknown = typeof body === "object" && body !== null && "prompt" in body ? body.prompt : null;
  if (typeof prompt !== "object" || prompt === null) return null;
  const { title, message, href } = prompt as Partial<Prompt>;
  return typeof title === "string" && typeof message === "string" && typeof href === "string" ? (prompt as Prompt) : null;
}
