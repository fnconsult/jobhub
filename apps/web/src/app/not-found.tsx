import type { Metadata } from "next";
import Link from "next/link";
import { getServerT } from "@/i18n/server";

// Without this file Next serves its built-in English 404 with inline styles,
// bypassing the French catalogue and the design tokens.
export function generateMetadata(): Metadata {
  const t = getServerT();
  return { title: `${t("notFound.title")} · ${t("app.name")}` };
}

export default function NotFound() {
  const t = getServerT();
  return (
    <main className="page">
      <header className="page-header">
        <span className="brand">{t("app.name")}</span>
      </header>
      <h1>{t("notFound.title")}</h1>
      <p>{t("notFound.message")}</p>
      <p>
        <Link href="/">{t("notFound.backHome")}</Link>
      </p>
    </main>
  );
}
