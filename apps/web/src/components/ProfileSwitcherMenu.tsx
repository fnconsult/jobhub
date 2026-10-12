"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { routes } from "@/routes";

type SwitcherProfile = { id: string; name: string };

/** `aria-current` of the item for the Profile being shown. */
const CURRENT = "page";
/** The menu lines up with the button's start edge. */
const ALIGN = "start";

/**
 * The Profile switcher's menu button (ADR-0018): a Radix dropdown menu, so it
 * follows the WAI-ARIA menu button pattern (arrow keys, Home/End, typeahead,
 * Escape returning focus to the button) for keyboard and screen-reader users
 * (ADR-0009). The button names `current`, the Profile being shown (it may be
 * archived, so missing from `profiles`); the menu lists the active `profiles`,
 * marks `current` among them, and ends with "add a Profile" when `canAdd`.
 */
export function ProfileSwitcherMenu({
  profiles,
  current,
  canAdd,
}: {
  profiles: ReadonlyArray<SwitcherProfile>;
  current?: SwitcherProfile | undefined;
  canAdd: boolean;
}) {
  const { t } = useTranslation();
  return (
    <nav className="profile-switcher" aria-label={t("profileSwitcher.label")}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="profile-switcher-button">
          <Icons.profile />
          <span className="profile-switcher-name">{current ? t("profileSwitcher.current", { name: current.name }) : t("profileSwitcher.choose")}</span>
          <Icons.chevron />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="profile-switcher-menu" align={ALIGN} sideOffset={8} collisionPadding={16}>
            {profiles.map((profile) => (
              <DropdownMenu.Item key={profile.id} asChild>
                <Link href={routes.profile(profile.id)} aria-current={profile.id === current?.id ? CURRENT : undefined}>
                  {profile.name}
                </Link>
              </DropdownMenu.Item>
            ))}
            {canAdd ? (
              <DropdownMenu.Item asChild>
                <Link href={routes.newProfile}>{t("profiles.add")}</Link>
              </DropdownMenu.Item>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </nav>
  );
}
