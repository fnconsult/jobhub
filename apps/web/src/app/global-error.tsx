"use client";

import { createI18n } from "@jobhub/shared/i18n";
import { useEffect, useState } from "react";
import { DocumentHead } from "@/design/document-head";
import "@/design/Button.css";
import { ErrorView } from "@/design/ErrorView";
import { ThemedHtml } from "@/design/ThemedHtml";
import "./app.css";

// Replaces the root layout when it fails, so it renders its own document. Without it Next shows its built-in English
// error page with inline styles. What failed may be the language or the session, so it reads neither: French first
// (authoritative), English under it (#542). No shell, no Signalement: the digest is what support asks for.
const fr = createI18n("fr").t;
const en = createI18n("en").t;
const COPY = {
  documentTitle: `${fr("errorPage.error.title")} · ${fr("app.name")}`,
  wordmark: fr("app.name"),
  title: fr("errorPage.error.title"),
  message: fr("errorPage.error.message"),
  titleEn: `${en("errorPage.error.title")}.`,
  messageEn: en("errorPage.error.message"),
  retry: `${fr("errorPage.actions.retry")} · ${en("errorPage.actions.retry")}`,
  home: `${fr("errorPage.actions.home")} · ${en("errorPage.actions.home")}`,
  digest: `${fr("errorPage.digest.label")} · ${en("errorPage.digest.label")}`,
  copy: `${fr("errorPage.digest.copy")} · ${en("errorPage.digest.copy")}`,
  copied: `${fr("errorPage.digest.copied")} · ${en("errorPage.digest.copied")}`,
};

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ThemedHtml lang="fr" suppressHydrationWarning>
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
    </ThemedHtml>
  );
}
