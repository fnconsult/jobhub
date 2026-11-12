"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { Amount } from "./Amount";
import { Button } from "./Button";
import { Card, Stat, Stats, type Trend } from "./Card";
import { ConfirmDialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { EmptyState } from "./EmptyState";
import { Checkbox, Field, KeyValueRow, Radio, SegmentedControl, Select, Switch, Textarea, TextInput } from "./Field";
import { Note } from "./Note";
import { PageHeader } from "./PageHeader";
import { Pill, Status } from "./Pill";
import { Ring } from "./Ring";
import { Table, type Column } from "./Table";
import { Tabs } from "./Tabs";
import { ToastProvider, useToast } from "./Toast";
import "./ComponentGallery.css";

type Provider = { id: string; name: string; key: "connected" | "keyMissing" | "testFailed"; cost: number };

/** The radio group's name. */
const REMOTE = "ds-gallery-remote";

const PROVIDERS = {
  active: [{ id: "perplexity", name: "Perplexity", key: "connected", cost: 1774.66 }],
  available: [
    { id: "brave", name: "Brave Search", key: "keyMissing", cost: 0 },
    { id: "tavily", name: "Tavily", key: "testFailed", cost: 0.04 },
  ],
} satisfies Record<string, Provider[]>;

const KEY_TONE = { connected: "success", keyMissing: "warn", testFailed: "danger" } as const;

/** What the fields hold: sample values a Candidate or an Administrator would have typed. */
const SAMPLE = {
  jobTitle: "Head of BU · Professional Services",
  locations: [
    { value: "idf", label: "Île-de-France" },
    { value: "75", label: "Paris (75)" },
  ],
  salary: "quatre-vingt",
  message: "ESN",
  budget: "2,00 €",
  model: "mistral-small",
  threshold: "70",
  key: "••••a91f",
  failures: "65,5 %",
  found: "128",
  matchScore: { label: "Match Score", value: 82 },
  atsScore: { label: "ATS Score", value: 64 },
  toastHref: "/candidatures",
  helpHref: "#ds-empty",
} as const;

const UP_BAD: Trend = { direction: "up", tone: "danger", text: "" };
const UP_GOOD: Trend = { direction: "up", tone: "success", text: "" };

/**
 * Every Design System component (#462), each in its states, as the components' test page and the Design System page
 * (#463) show them, in the Density and theme of what holds it. Interactive: the switch, the segmented control, the
 * tabs, the rows, the Toast, the Drawer and the Dialog work. `head` comes first, in its place: the components' test
 * page's own PageHeader (its level-1 heading) unless the page gives another.
 */
export function ComponentGallery({ head }: { head?: ReactNode }) {
  return (
    <ToastProvider>
      <Gallery head={head} />
    </ToastProvider>
  );
}

function Gallery({ head }: { head?: ReactNode }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [digest, setDigest] = useState(true);
  const [period, setPeriod] = useState("week");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);

  const periods = (["week", "month", "year"] as const).map((value) => ({ value, label: t(`designSystem.gallery.${value}`) }));
  const tabs = (
    [
      ["web", "webSearch", "webSearchPanel"],
      ["ai", "ai", "aiPanel"],
      ["email", "email", "emailPanel"],
    ] as const
  ).map(([value, label, panel]) => ({ value, label: t(`designSystem.gallery.${label}`), content: <p>{t(`designSystem.gallery.${panel}`)}</p> }));
  const failuresTrend: Trend = { ...UP_BAD, text: t("designSystem.gallery.failuresTrend") };
  const foundTrend: Trend = { ...UP_GOOD, text: t("designSystem.gallery.foundTrend") };
  const showToast = () => toast({ message: t("designSystem.gallery.toast"), link: { label: t("designSystem.gallery.toastLink"), href: SAMPLE.toastHref } });

  const columns: Column<Provider>[] = [
    { key: "name", header: t("designSystem.gallery.provider"), cell: (row) => row.name },
    { key: "key", header: t("designSystem.gallery.key"), cell: (row) => <Status tone={KEY_TONE[row.key]}>{t(`designSystem.gallery.${row.key}`)}</Status> },
    { key: "cost", header: t("designSystem.gallery.monthCost"), numeric: true, cell: (row) => <Amount value={row.cost} /> },
  ];

  return (
    <div className="ds-gallery">
      {head ?? (
        <PageHeader
          eyebrow={t("designSystem.gallery.eyebrow")}
          title={t("designSystem.gallery.title")}
          subtitle={t("designSystem.gallery.subtitle")}
          actions={<Button icon={<Icons.add />}>{t("designSystem.gallery.add")}</Button>}
        />
      )}

      <section className="ds-gallery__section" aria-labelledby="ds-buttons">
        <h2 id="ds-buttons">{t("designSystem.gallery.buttons")}</h2>
        <div className="ds-gallery__row">
          <Button variant="primary" icon={<Icons.add />}>
            {t("designSystem.gallery.primary")}
          </Button>
          <Button>{t("designSystem.gallery.secondary")}</Button>
          <Button variant="quiet">{t("designSystem.gallery.quiet")}</Button>
          <Button variant="danger">{t("designSystem.gallery.danger")}</Button>
          <Button variant="dangerSolid">{t("designSystem.gallery.dangerSolid")}</Button>
          <Button variant="primary" disabled>
            {t("designSystem.gallery.disabled")}
          </Button>
          <Button busy>{t("designSystem.gallery.busy")}</Button>
        </div>
        <div className="ds-gallery__row">
          <Button variant="primary" size="sm">
            {t("designSystem.gallery.small")}
          </Button>
          <Button size="sm">{t("designSystem.gallery.small")}</Button>
          <Button variant="quiet" size="sm">
            {t("designSystem.gallery.small")}
          </Button>
        </div>
      </section>

      <section className="ds-gallery__section" aria-labelledby="ds-fields">
        <h2 id="ds-fields">{t("designSystem.gallery.fields")}</h2>
        <div className="ds-gallery__grid">
          <Card>
            <div className="ds-gallery__stack">
              <Field label={t("designSystem.gallery.jobTitle")} hint={t("designSystem.gallery.jobTitleHint")}>
                <TextInput defaultValue={SAMPLE.jobTitle} />
              </Field>
              <Field label={t("designSystem.gallery.location")}>
                <Select defaultValue={SAMPLE.locations[0].value}>
                  {SAMPLE.locations.map((location) => (
                    <option key={location.value} value={location.value}>
                      {location.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("designSystem.gallery.salary")} error={t("designSystem.gallery.salaryError")}>
                <TextInput defaultValue={SAMPLE.salary} />
              </Field>
              <Field label={t("designSystem.gallery.message")}>
                <Textarea defaultValue={SAMPLE.message} />
              </Field>
            </div>
          </Card>
          <Card>
            <div className="ds-gallery__stack">
              <Checkbox label={t("designSystem.gallery.permanent")} defaultChecked />
              <Checkbox label={t("designSystem.gallery.freelance")} />
              <Radio name={REMOTE} label={t("designSystem.gallery.remote")} defaultChecked />
              <Radio name={REMOTE} label={t("designSystem.gallery.onSite")} />
              <Switch label={t("designSystem.gallery.digest")} checked={digest} onCheckedChange={setDigest} />
              <SegmentedControl label={t("designSystem.gallery.period")} value={period} onValueChange={setPeriod} options={periods} />
              <KeyValueRow label={t("designSystem.gallery.budget")} source={<Pill tone="success">{t("designSystem.gallery.fromBackOffice")}</Pill>}>
                <TextInput defaultValue={SAMPLE.budget} />
              </KeyValueRow>
              <KeyValueRow label={t("designSystem.gallery.model")} source={<Pill tone="accent">{t("designSystem.gallery.fromEnv")}</Pill>}>
                <TextInput defaultValue={SAMPLE.model} />
              </KeyValueRow>
              <KeyValueRow label={t("designSystem.gallery.threshold")} source={<Pill>{t("designSystem.gallery.fromCode")}</Pill>}>
                <TextInput defaultValue={SAMPLE.threshold} />
              </KeyValueRow>
            </div>
          </Card>
        </div>
      </section>

      <section className="ds-gallery__section" aria-labelledby="ds-statuses">
        <h2 id="ds-statuses">{t("designSystem.gallery.statuses")}</h2>
        <div className="ds-gallery__row">
          <Status tone="success">{t("designSystem.gallery.connected")}</Status>
          <Status tone="warn">{t("designSystem.gallery.keyMissing")}</Status>
          <Status tone="danger">{t("designSystem.gallery.testFailed")}</Status>
          <Status>{t("designSystem.gallery.neverTested")}</Status>
        </div>
        <div className="ds-gallery__row">
          <Pill tone="accent">{t("designSystem.gallery.interview")}</Pill>
          <Pill tone="success">{t("designSystem.gallery.offer")}</Pill>
          <Pill tone="warn">{t("designSystem.gallery.followUp")}</Pill>
          <Pill tone="danger">{t("designSystem.gallery.refused")}</Pill>
          <Pill>{t("designSystem.gallery.draft")}</Pill>
        </div>
      </section>

      <section className="ds-gallery__section" aria-labelledby="ds-tables">
        <h2 id="ds-tables">{t("designSystem.gallery.tablesAndTabs")}</h2>
        <Tabs label={t("designSystem.gallery.tabsLabel")} tabs={tabs} />
        <Table
          label={t("designSystem.gallery.tableLabel")}
          columns={columns}
          groups={[
            { label: t("designSystem.gallery.active"), rows: PROVIDERS.active },
            { label: t("designSystem.gallery.available"), rows: PROVIDERS.available },
          ]}
          rowKey={(row) => row.id}
          onRowActivate={(row) => setOpened(row.name)}
        />
        <p role="status">{opened ? t("designSystem.gallery.openedRow", { name: opened }) : null}</p>
      </section>

      <section className="ds-gallery__section" aria-labelledby="ds-figures">
        <h2 id="ds-figures">{t("designSystem.gallery.figures")}</h2>
        <Stats>
          <Stat label={t("designSystem.gallery.spend")} value={<Amount value={0.0396} fractionDigits={4} />} meta={t("designSystem.gallery.spendMeta")} progress={2} />
          <Stat label={t("designSystem.gallery.failures")} value={SAMPLE.failures} meta={t("designSystem.gallery.failuresMeta")} trend={failuresTrend} />
          <Stat label={t("designSystem.gallery.found")} value={SAMPLE.found} meta={t("designSystem.gallery.foundMeta")} trend={foundTrend} />
        </Stats>
        <Card title={t("designSystem.gallery.chartCard")} actions={<Button size="sm">{t("designSystem.gallery.month")}</Button>}>
          <p>{t("designSystem.gallery.chartText")}</p>
        </Card>
        <h3>{t("designSystem.gallery.scores")}</h3>
        <div className="ds-gallery__row">
          <Ring {...SAMPLE.matchScore} />
          <Ring {...SAMPLE.atsScore} />
        </div>
      </section>

      <section className="ds-gallery__section" aria-labelledby="ds-messages">
        <h2 id="ds-messages">{t("designSystem.gallery.messages")}</h2>
        <div className="ds-gallery__grid">
          <Note tone="info" title={t("designSystem.gallery.infoTitle")}>
            {t("designSystem.gallery.infoText")}
          </Note>
          <Note tone="warn" title={t("designSystem.gallery.warnTitle")}>
            {t("designSystem.gallery.warnText")}
          </Note>
          <Note tone="danger" title={t("designSystem.gallery.dangerTitle")}>
            {t("designSystem.gallery.dangerText")}
          </Note>
          <Note tone="success" title={t("designSystem.gallery.successTitle")}>
            {t("designSystem.gallery.successText")}
          </Note>
        </div>
        <div className="ds-gallery__row">
          <Button onClick={showToast}>{t("designSystem.gallery.showToast")}</Button>
        </div>
      </section>

      <section className="ds-gallery__section" aria-labelledby="ds-empty">
        <h2 id="ds-empty">{t("designSystem.gallery.empty")}</h2>
        <EmptyState
          headingLevel={3}
          title={t("designSystem.gallery.emptyTitle")}
          actions={<Button variant="primary">{t("designSystem.gallery.emptyAction")}</Button>}
          help={<a href={SAMPLE.helpHref}>{t("designSystem.gallery.emptyHelp")}</a>}
        >
          {t("designSystem.gallery.emptyText")}
        </EmptyState>
      </section>

      <section className="ds-gallery__section" aria-labelledby="ds-overlays">
        <h2 id="ds-overlays">{t("designSystem.gallery.overlays")}</h2>
        <div className="ds-gallery__row">
          <Drawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            trigger={<Button>{t("designSystem.gallery.openDrawer")}</Button>}
            title={t("designSystem.gallery.drawerTitle")}
            footer={
              <Button variant="primary" onClick={() => setDrawerOpen(false)}>
                {t("designSystem.gallery.makeActive")}
              </Button>
            }
          >
            <p>{t("designSystem.gallery.drawerText")}</p>
            <KeyValueRow label={t("designSystem.gallery.key")} source={<Status tone="success">{t("designSystem.gallery.connected")}</Status>}>
              <TextInput defaultValue={SAMPLE.key} />
            </KeyValueRow>
          </Drawer>
          <ConfirmDialog
            trigger={<Button variant="danger">{t("designSystem.gallery.openDialog")}</Button>}
            title={t("designSystem.gallery.dialogTitle")}
            confirmLabel={t("designSystem.gallery.dialogConfirm")}
            tone="danger"
            onConfirm={() => toast({ message: t("designSystem.gallery.confirmed") })}
          >
            {t("designSystem.gallery.dialogText")}
          </ConfirmDialog>
        </div>
      </section>
    </div>
  );
}
