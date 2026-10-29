"use client";

import { designTokens, type Density, type Theme } from "@jobhub/shared/design";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "./Card";
import { ComponentGallery } from "./ComponentGallery";
import { designSystemHref, tokenCatalogue, type ColorEntry, type TypeStep } from "./design-system-page";
import { SegmentedControl } from "./Field";
import { OverlayScope } from "./overlay";
import { PageHeader } from "./PageHeader";
import { Table, type Column } from "./Table";
import "./DesignSystemPage.css";

type View = { theme: Theme; density: Density };

const THEMES: Theme[] = ["light", "dark"];
const DENSITIES: Density[] = ["confort", "compact"];

const CATALOGUE = tokenCatalogue(designTokens);

/**
 * The Design System page's content (#463, ADR-0053): every colour token with its light and dark values, the type
 * scale in both Densities, then every component in its states (the ComponentGallery). Its two toggles set the theme and
 * the Density of this content only, the Back Office around it unchanged; the address follows them, so a reload, or a
 * link, shows the same. Its Drawers, Dialog and Toast open inside it, in its theme and Density.
 */
export function DesignSystemPage({ initial }: { initial: View }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState(initial);
  const px = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });

  function change(next: View) {
    setView(next);
    window.history.replaceState(window.history.state, "", designSystemHref(next));
  }

  const colorColumns: Column<ColorEntry>[] = [
    { key: "token", header: t("designSystem.page.token"), cell: (color) => <code>{color.variable}</code> },
    { key: "swatch", header: t("designSystem.page.swatch"), cell: (color) => <span className="ds-system__swatch" style={{ background: `var(${color.variable})` }} /> },
    { key: "light", header: t("designSystem.page.lightValue"), cell: (color) => <code>{color.light}</code> },
    { key: "dark", header: t("designSystem.page.darkValue"), cell: (color) => <code>{color.dark}</code> },
  ];
  const typeColumns: Column<TypeStep>[] = [
    { key: "style", header: t("designSystem.page.style"), cell: (step) => t(`designSystem.page.styles.${step.style}`) },
    {
      key: "sample",
      header: t("designSystem.page.sample"),
      cell: (step) => (
        <span className="ds-system__sample" data-style={step.style} style={{ fontSize: `var(${step.variable})` }}>
          {t(`designSystem.page.samples.${step.style}`)}
        </span>
      ),
    },
    { key: "confort", header: t("designSystem.page.confort"), numeric: true, cell: (step) => t("designSystem.page.px", { size: px.format(step.confort) }) },
    { key: "compact", header: t("designSystem.page.compact"), numeric: true, cell: (step) => t("designSystem.page.px", { size: px.format(step.compact) }) },
  ];
  const body = CATALOGUE.typeScale.find((step) => step.style === "body")!;

  const head = (
    <>
      <div className="ds-system__bar">
        <p className="ds-system__intro">{t("designSystem.page.intro")}</p>
        <div className="ds-system__toggles">
          <SegmentedControl
            label={t("designSystem.page.theme")}
            value={view.theme}
            onValueChange={(theme) => change({ ...view, theme })}
            options={THEMES.map((value) => ({ value, label: t(`designSystem.page.${value}`) }))}
          />
          <SegmentedControl
            label={t("designSystem.page.density")}
            value={view.density}
            onValueChange={(density) => change({ ...view, density })}
            options={DENSITIES.map((value) => ({ value, label: t(`designSystem.page.${value}`) }))}
          />
        </div>
      </div>

      <section className="ds-gallery__section" aria-labelledby="ds-foundations">
        <h2 id="ds-foundations">{t("designSystem.page.foundations")}</h2>
        <Card title={t("designSystem.page.colors")} headingLevel={3}>
          <Table label={t("designSystem.page.colors")} columns={colorColumns} rows={CATALOGUE.colors} rowKey={(color) => color.token} />
        </Card>
        <Card
          title={t("designSystem.page.typography")}
          headingLevel={3}
          actions={<span className="ds-system__meta">{t("designSystem.page.typeShown", { density: t(`designSystem.page.${view.density}`), size: px.format(body[view.density]) })}</span>}
        >
          <Table label={t("designSystem.page.typography")} columns={typeColumns} rows={CATALOGUE.typeScale} rowKey={(step) => step.style} />
        </Card>
      </section>

      <PageHeader headingLevel={2} eyebrow={t("admin.sections.designSystem")} title={t("designSystem.page.components")} subtitle={t("designSystem.page.componentsSubtitle")} />
    </>
  );

  return (
    <OverlayScope className="ds-system" data-theme={view.theme} data-density={view.density} data-design-system-preview="">
      <ComponentGallery head={head} />
    </OverlayScope>
  );
}
