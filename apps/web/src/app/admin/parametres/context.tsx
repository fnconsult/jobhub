import type { ProviderId } from "@jobhub/ai";
import type { ReactNode } from "react";
import type { AdministratorAccess } from "@/admin/administrators";
import type { getServerT } from "@/i18n/server";
import type { PlatformSettingType } from "@/platform-settings/catalog";
import type { ParametresTab } from "@/platform-settings/parametres";
import { FORM } from "./notices";

export type T = Awaited<ReturnType<typeof getServerT>>;

/** What every part of a Paramètres tab is drawn with: the tab, who reads it and what they may change. */
export interface Ctx {
  t: T;
  locale: string;
  tab: ParametresTab;
  /** The provider whose sheet is open, if any. */
  sheet?: string;
  access: AdministratorAccess;
  can: {
    /** Platform Settings: values, « Rétablir », « Rendre actif ». */
    settings: boolean;
    /** Provider Secrets: replace, clear, test (super-admins, ADR-0020). */
    secrets: boolean;
    /** Provider Secrets read: their source, last 4 characters and last test. */
    readSecrets: boolean;
    /** Job discovery sources and sites, Job Sites. */
    sites: boolean;
    /** Sign-in Providers and Require SSO. */
    signIn: boolean;
    /** A Playbook Agent's model and effort: a draft Playbook Version (Playbook editors, #402). */
    playbooks: boolean;
  };
  /** Whether Provider Secrets can be saved: SECRETS_MASTER_KEYS is set. */
  canSaveSecrets: boolean;
  at: Intl.DateTimeFormat;
  /** What a setting takes, as its notices and help say it. */
  rule: (type: PlatformSettingType) => string;
  /** The provider whose model each model setting names, and the models each provider is known to serve (#301). */
  modelProviders: Record<string, ProviderId>;
  models: Map<ProviderId, string[]>;
}

/** The fields saying which tab, and which sheet, a form was sent from: the action comes back there. */
export function Here({ ctx, sheet = ctx.sheet }: { ctx: Ctx; sheet?: string }) {
  return (
    <>
      <input type="hidden" name={FORM.tab} value={ctx.tab.slug} />
      {sheet ? <input type="hidden" name={FORM.sheet} value={sheet} /> : null}
    </>
  );
}

/** A table's scrolling frame, reachable by keyboard and named by the table it holds, so it can be scrolled without a mouse (WCAG 2.1.1). */
export function ScrollFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
