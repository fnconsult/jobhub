"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ForwardingSetup } from "@/email-intake/forwarding-setup";
import { guideOf, MAILBOX_PROVIDERS, wizardSteps, type MailboxProvider, type WizardStep } from "@/email-intake/forwarding-wizard";
import { routes } from "@/routes";
import { SendingAddresses } from "./SendingAddresses";

/** How often the wizard asks whether Gmail's code or the first email arrived. */
const POLL_MS = 2000;

/** The setup as GET /api/account/email-intake/setup answers it, its dates read back. */
function readSetup(given: { address: string; activatedAt: string; confirmation: { code: string | null; link: string | null; receivedAt: string } | null; firstEmail: { outcome: string; receivedAt: string } | null }): ForwardingSetup {
  return {
    address: given.address,
    activatedAt: new Date(given.activatedAt),
    confirmation: given.confirmation ? { ...given.confirmation, receivedAt: new Date(given.confirmation.receivedAt) } : null,
    firstEmail: given.firstEmail ? { ...given.firstEmail, receivedAt: new Date(given.firstEmail.receivedAt) } : null,
  };
}

async function fetchSetup(): Promise<ForwardingSetup | null> {
  const response = await fetch("/api/account/email-intake/setup", { cache: "no-store" });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(String(response.status));
  return readSetup(await response.json());
}

/**
 * The step-by-step forwarding setup wizard (#451): the Candidate chooses their mailbox provider, switches Email intake
 * on (what is read, kept, processed by AI; the date recorded), copies their Forwarding address, follows their provider's
 * guide (for Gmail: adding the address, the confirmation code Jobbbox received, then the filter on alert senders; for
 * Orange and « Autre »: forwarding by hand, from their own sending addresses), then waits for the first email.
 * A short CSS animation shows where a mailbox's settings usually are; none runs with reduced motion.
 */
export function ForwardingWizard({ initial, sendingAddresses, locale }: { initial: ForwardingSetup | null; sendingAddresses: string[]; locale: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [provider, setProvider] = useState<MailboxProvider | null>(null);
  const [index, setIndex] = useState(0);
  const [setup, setSetup] = useState(initial);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<"copied" | "copyFailed" | null>(null);
  const [error, setError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const steps = wizardSteps(provider ?? "other");
  // The first email recorded ends the wizard.
  const reached: WizardStep = steps[index] ?? "provider";
  const step: WizardStep = reached === "firstEmail" && setup?.firstEmail ? "done" : reached;
  const at = steps.indexOf(step);
  const date = (at: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(at);

  const go = (to: number) => {
    moved.current = true;
    setStatus(null);
    setError(false);
    setIndex(Math.max(0, Math.min(to, steps.length - 1)));
  };

  // Each new step is announced by moving focus to its title.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  // Waiting for Gmail's code, or the first email: asked again every POLL_MS until it arrives (which moves on to « done »).
  const waiting = (step === "confirmation" && !setup?.confirmation) || (step === "firstEmail" && !setup?.firstEmail);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      fetchSetup().then(setSetup, () => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  function chooseProvider(event: FormEvent) {
    event.preventDefault();
    if (provider) go(1);
  }

  async function switchOn() {
    setWorking(true);
    setError(false);
    try {
      const response = await fetch("/api/account/email-intake", { method: "PUT" });
      if (!response.ok) throw new Error(String(response.status));
      setSetup(await fetchSetup());
      go(at + 1);
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  }

  async function copy() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.address);
      setStatus("copied");
    } catch {
      setStatus("copyFailed");
    }
  }

  const guide = step === "guide" || step === "filter" ? guideOf(provider ?? "other", step) : null;
  const title = guide ? t(`forwardingWizard.guides.${guide.name}.title`) : t(`forwardingWizard.steps.${step as Exclude<WizardStep, "guide" | "filter">}`);
  const notice =
    guide?.name === "manual"
      ? t(provider === "orange" ? "forwardingWizard.guides.manual.orangeNotice" : "forwardingWizard.guides.manual.otherNotice")
      : guide?.name === "outlook" || guide?.name === "icloud"
        ? t(`forwardingWizard.guides.${guide.name}.notice`)
        : null;
  const canGoOn = step !== "switchOn" || setup !== null;

  return (
    <section className="stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("forwardingWizard.title")}</h2>
      <p>{t("forwardingWizard.intro")}</p>
      <div className="wizard-step" key={step}>
        {at > 0 ? <p className="wizard-progress">{t("forwardingWizard.progress", { current: at + 1, total: steps.length })}</p> : null}
        <h3 id={`${id}-step`} ref={heading} tabIndex={-1}>
          {title}
        </h3>

        {step === "provider" ? (
          <form className="stack wizard-form" onSubmit={chooseProvider}>
            <fieldset className="fieldset">
              <legend>{t("forwardingWizard.provider.legend")}</legend>
              {MAILBOX_PROVIDERS.map((each) => (
                <div key={each} className="choice">
                  <input type="radio" id={`${id}-${each}`} name="provider" value={each} checked={provider === each} onChange={() => setProvider(each)} required />
                  <label htmlFor={`${id}-${each}`}>{t(`forwardingWizard.provider.names.${each}`)}</label>
                </div>
              ))}
            </fieldset>
            <button className="button button-primary" type="submit">
              {t("forwardingWizard.next")}
            </button>
          </form>
        ) : null}

        {step === "switchOn" ? (
          <>
            <ul className="wizard-list">
              <li>{t("forwardingWizard.switchOn.read")}</li>
              <li>{t("forwardingWizard.switchOn.kept")}</li>
              <li>{t("forwardingWizard.switchOn.ai")}</li>
              <li>{t("forwardingWizard.switchOn.date")}</li>
            </ul>
            <p role="status">{setup ? t("emailIntake.onSince", { date: date(setup.activatedAt) }) : t("forwardingWizard.switchOn.off")}</p>
            {setup ? null : (
              <button className="button button-primary" type="button" disabled={working} onClick={() => void switchOn()}>
                {t("forwardingWizard.switchOn.action")}
              </button>
            )}
          </>
        ) : null}

        {step === "address" && setup ? (
          <>
            <p>{t("forwardingWizard.address.explanation")}</p>
            <div className="field">
              <label htmlFor={`${id}-address`}>{t("emailIntake.addressLabel")}</label>
              <input id={`${id}-address`} className="input" type="text" readOnly value={setup.address} onFocus={(event) => event.target.select()} />
            </div>
            <button className="button" type="button" onClick={() => void copy()}>
              {t("emailIntake.copy")}
            </button>
            {status ? <p role="status">{t(`emailIntake.${status}`)}</p> : null}
          </>
        ) : null}

        {guide ? (
          <>
            <div className="forwarding-hint">
              <div className="forwarding-hint-window" aria-hidden="true">
                <span className="forwarding-hint-gear" />
              </div>
              <p>{t("forwardingWizard.hint.settings")}</p>
            </div>
            {notice ? <p className="notice">{notice}</p> : null}
            {setup ? (
              <dl className="wizard-address">
                <dt>{t("emailIntake.addressLabel")}</dt>
                <dd>{setup.address}</dd>
              </dl>
            ) : null}
            <ol className="wizard-list">
              {Array.from({ length: guide.steps }, (_, at) => (
                <li key={at}>{t(`forwardingWizard.guides.${guide.name}.steps.${at + 1}` as "forwardingWizard.guides.manual.steps.1")}</li>
              ))}
            </ol>
            {guide.name === "manual" ? <SendingAddresses initial={sendingAddresses} nested /> : null}
          </>
        ) : null}

        {step === "confirmation" ? (
          <>
            <p>{t("forwardingWizard.confirmation.explanation")}</p>
            {setup?.confirmation?.code ? (
              <dl className="wizard-address">
                <dt>{t("forwardingWizard.confirmation.codeLabel")}</dt>
                <dd className="wizard-code">{setup.confirmation.code}</dd>
              </dl>
            ) : null}
            {setup?.confirmation?.link ? (
              <a href={setup.confirmation.link} target="_blank" rel="noopener noreferrer">
                {t("forwardingWizard.confirmation.link")}
              </a>
            ) : null}
            {setup?.confirmation && !setup.confirmation.code && !setup.confirmation.link ? <p>{t("forwardingWizard.confirmation.unreadable")}</p> : null}
            {setup?.confirmation ? null : (
              <p role="status" className="wizard-waiting">
                {t("forwardingWizard.confirmation.waiting")}
              </p>
            )}
          </>
        ) : null}

        {step === "firstEmail" ? (
          <>
            <p>{t("forwardingWizard.firstEmail.explanation")}</p>
            <p role="status" className="wizard-waiting">
              {t("forwardingWizard.firstEmail.waiting")}
            </p>
          </>
        ) : null}

        {step === "done" ? (
          <>
            {setup?.firstEmail ? (
              <p role="status">
                {t("forwardingWizard.firstEmail.received", { date: date(setup.firstEmail.receivedAt) })}
                {setup.firstEmail.outcome === "unrecognised_sender" ? ` ${t("forwardingWizard.firstEmail.unrecognised")}` : null}
              </p>
            ) : null}
            <p>{t("forwardingWizard.done.explanation")}</p>
            <Link href={routes.accountEmailIntake}>{t("forwardingWizard.done.back")}</Link>
          </>
        ) : null}

        {step !== "provider" && step !== "done" ? (
          <div className="actions">
            <button className="button" type="button" onClick={() => go(at - 1)}>
              {t("forwardingWizard.back")}
            </button>
            {canGoOn ? (
              <button className="button button-primary" type="button" onClick={() => go(at + 1)}>
                {t("forwardingWizard.next")}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {t("forwardingWizard.error")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
