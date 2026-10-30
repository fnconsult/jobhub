"use client";

import { createI18n } from "@jobhub/shared/i18n";
import { useEffect, useState } from "react";
import { DocumentHead } from "@/design/document-head";
import "@/design/Button.css";
import { ErrorView } from "@/design/ErrorView";
import "./app.css";

// Replaces the root layout when it fails, so it renders its own document. Without it Next shows its built-in English
// error page with inline styles. What failed may be the language or the session, so it reads neither: French first
// (authoritative), English under it (#542). No shell, no Signalement: the digest is what support asks for.
const fr = createI18n("fr").t;
const en = createI18n("en").t;
/** Each line in French, then « · » and English, for the buttons and the digest. */
const both = (key: Parameters<typeof fr>[0]) => `${fr(key)} · ${en(key)}`;
const COPY = {
  documentTitle: `${fr("errorPage.error.title")} · ${COPY.wordmark}`,
  wordmark: fr("app.name"),
  title: fr("errorPage.error.title"),
  message: fr("errorPage.error.message"),
  titleEn: `${en("errorPage.error.title")}.`,
  messageEn: en("errorPage.error.message"),
  retry: both("errorPage.actions.retry"),
  home: both("errorPage.actions.home"),
  digest: both("errorPage.digest.label"),
  copy: both("errorPage.digest.copy"),
  copied: both("errorPage.digest.copied"),
};

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="fr" data-text-size="standard" suppressHydrationWarning>
      <head>
        <DocumentHead />
        <meta name="robots" content="noindex" />
        <title>{COPY.documentTitle}</title>
      </head>
      <body>
        <main id="main" className="ds-error-page">
          <a className="ds-error-page__wordmark" href="/">
            {COPY.wordmark}
          </a>
          <ErrorView
            code={500}
            title={COPY.title}
            actions={
              <>
                <div className="ds-error__actions">
                  <button className="ds-button ds-button--primary" type="button" onClick={() => retry()}>
                    {COPY.retry}
                  </button>
                  <a className="ds-button ds-button--secondary" href="/">
                    {COPY.home}
                  </a>
                </div>
                {error.digest ? (
                  <p className="ds-error__digest">
                    <span>{COPY.digest}</span>
                    <code>{error.digest}</code>
                    <button
                      className="ds-button ds-button--quiet ds-button--sm"
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(error.digest ?? "").then(() => setCopied(true), () => undefined)}
                    >
                      {copied ? COPY.copied : COPY.copy}
                    </button>
                  </p>
                ) : null}
              </>
            }
          >
            <p>{COPY.message}</p>
            <p lang="en">
              <strong>{COPY.titleEn}</strong> {COPY.messageEn}
            </p>
          </ErrorView>
        </main>
      </body>
    </html>
  );
}
