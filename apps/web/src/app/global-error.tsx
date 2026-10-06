"use client";

import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { DocumentHead } from "@/design/document-head";
import "./app.css";

// Replaces the root layout when it fails, so it renders its own document.
// Without it Next shows its built-in English error page with inline styles.
const { t } = createI18n(DEFAULT_LOCALE);

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang={DEFAULT_LOCALE} data-text-size="standard" suppressHydrationWarning>
      <head>
        <DocumentHead />
        <title>{`${t("error.title")} · ${t("app.name")}`}</title>
      </head>
      <body>
        <main className="page">
          <header className="page-header">
            <span className="brand">{t("app.name")}</span>
          </header>
          <h1>{t("error.title")}</h1>
          <p>{t("error.message")}</p>
          <p>
            <button type="button" className="button" onClick={() => reset()}>
              {t("error.retry")}
            </button>
          </p>
        </main>
      </body>
    </html>
  );
}
