"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { sidebarPlanLabel } from "@/billing/current-plan";
import type { PlanName } from "@/billing/plans";
import { calledName, fullNameOf, initialsOf } from "@/candidate-identity/names";
import { Icons } from "@/components/icons";
import { useSignOut } from "@/components/SignOutButton";
import { AIDE_ET_LEGAL } from "@/public-pages/public-shell";

/** `aria-current` of the item for the page shown. */
const CURRENT = "page";
/** The menu lines up with the button's start edge, above it. */
const ALIGN = "start";
const SIDE = "top";
/** Each of « Aide et légal »'s links has its icon, so every item's words line up. */
const HELP_ICONS = { aide: Icons.help, legal: Icons.legal, nouveautes: Icons.nouveautes } as const;
/** How the accessible name's parts are joined: « Mon compte, Mimi, Premium ». */
const PARTS = ", ";

/**
 * Who the Sidebar's foot shows (#923): the Candidate's names (#918), their sign-in email, and their Plan, `endsAt` when
 * its cancellation is scheduled (ISO); `plan` is null when billing could not be read.
 */
export type SidebarCandidate = {
  givenName: string | null;
  familyName: string | null;
  preferredName: string | null;
  email: string;
  plan: { name: PlanName; endsAt: string | null } | null;
};

type PageLink = { href: string; current: boolean };

/** No name and no Plan: the button reads « Mon compte » alone. */
const NOBODY: SidebarCandidate = { givenName: null, familyName: null, preferredName: null, email: "", plan: null };

/** The Candidate's initials, in place of the photo to come; the account's icon without a name. */
function Avatar({ candidate }: { candidate: SidebarCandidate }) {
  const initials = initialsOf(candidate);
  return initials ? (
    <span className="account-initials" aria-hidden="true">
      {initials}
    </span>
  ) : (
    <Icons.account />
  );
}

/**
 * « Mon compte » in the Candidate's Sidebar foot (#923, variant A of #914): a menu button (Radix, ADR-0018) on two lines,
 * the name they are called by (their Preferred Name, else their Given Name, else « Mon compte ») and their Plan, beside
 * their initials; named « Mon compte, Mimi, Premium ». Its menu, opening upwards over the sidebar, is headed by
 * « Prénom Nom » and the email, then holds « Aide et légal » (#544: the public Aide, Légal and Nouveautés), Mon compte's
 * page, « Mon abonnement » with the Plan's name and, nearest the button, « Se déconnecter ». `account` is Mon compte's
 * page (current on the Subscription's too), `subscription` the Subscription's; `onNavigate` closes the drawer on a phone.
 */
export function AccountMenu({
  account,
  subscription,
  candidate = NOBODY,
  onNavigate,
}: {
  account: PageLink;
  subscription: PageLink;
  candidate?: SidebarCandidate | undefined;
  onNavigate: () => void;
}) {
  const { t, i18n } = useTranslation();
  const signOut = useSignOut();
  const locale = i18n.language === "en" ? "en" : "fr";
  const plan = useMemo(
    () => (candidate.plan ? sidebarPlanLabel({ planName: candidate.plan.name, endsAt: candidate.plan.endsAt ? new Date(candidate.plan.endsAt) : null }, locale) : null),
    [candidate.plan, locale],
  );
  const name = calledName(candidate);
  const fullName = fullNameOf(candidate);
  const planText = plan ? [plan.plan, plan.until].filter(Boolean).join(" ") : null;
  const label = [t("nav.account"), name, planText].filter(Boolean).join(PARTS);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="sidebar-link account-menu-button" data-current={account.current || undefined} aria-label={label}>
        <Avatar candidate={candidate} />
        <span className="account-lines">
          <span className="account-name">{name ?? t("nav.account")}</span>
          {plan ? (
            <span className="account-plan">
              {plan.plan}
              {plan.until ? (
                <>
                  {" "}
                  <span className="account-plan-ending">{plan.until}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
        <Icons.chevron />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="account-menu" side={SIDE} align={ALIGN} sideOffset={4} collisionPadding={4}>
          {candidate.email ? (
            <>
              <DropdownMenu.Label className="account-menu-head">
                <Avatar candidate={candidate} />
                <span className="account-lines">
                  {fullName ? <span className="account-name">{fullName}</span> : null}
                  <span className="account-email">{candidate.email}</span>
                </span>
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="account-menu-separator" />
            </>
          ) : null}
          <DropdownMenu.Label className="account-menu-label">{t("sidebar.helpAndLegal")}</DropdownMenu.Label>
          {AIDE_ET_LEGAL.map((link) => {
            const HelpIcon = HELP_ICONS[link.key];
            return (
              <DropdownMenu.Item key={link.key} asChild>
                <Link href={link.href} onClick={onNavigate}>
                  <HelpIcon />
                  {t(link.label)}
                </Link>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="account-menu-separator" />
          <DropdownMenu.Item asChild>
            <Link href={account.href} aria-current={account.current && !subscription.current ? CURRENT : undefined} onClick={onNavigate}>
              <Icons.account />
              {t("nav.account")}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href={subscription.href} aria-current={subscription.current ? CURRENT : undefined} onClick={onNavigate}>
              <Icons.subscription />
              {t("account.plan")}
              {plan ? <span className="account-menu-aside">{plan.plan}</span> : null}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void signOut()}>
            <Icons.signOut />
            {t("account.signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
