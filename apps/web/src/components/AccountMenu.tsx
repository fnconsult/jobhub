"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useTranslation } from "react-i18next";
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

/**
 * « Mon compte » in the Candidate's Sidebar foot: a menu button (Radix, ADR-0018) opening upwards, over the sidebar.
 * Its menu holds « Aide et légal » (#544: the public Aide, Légal and Nouveautés), then Mon compte's page and, nearest the
 * button, « Se déconnecter ». `account` is Mon compte's page; `onNavigate` closes the drawer on a phone.
 */
export function AccountMenu({ account, onNavigate }: { account: { href: string; current: boolean }; onNavigate: () => void }) {
  const { t } = useTranslation();
  const signOut = useSignOut();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="sidebar-link account-menu-button" data-current={account.current || undefined}>
        <Icons.account />
        <span className="sidebar-link-text">{t("nav.account")}</span>
        <Icons.chevron />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="account-menu" side={SIDE} align={ALIGN} sideOffset={4} collisionPadding={4}>
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
            <Link href={account.href} aria-current={account.current ? CURRENT : undefined} onClick={onNavigate}>
              <Icons.account />
              {t("nav.account")}
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
