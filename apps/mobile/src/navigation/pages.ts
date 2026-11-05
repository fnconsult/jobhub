import type { TFunction } from "i18next";
import { Briefcase, Calendar, Mail, Search, Users, type LucideIcon } from "lucide-react-native";
import { SAMPLE_APPLICATIONS, SAMPLE_FREE_CONVERSATIONS } from "../sample-data";
import type { ShellPage } from "../shell/Shell";

/** An Application's Interviews Section, as its address names it (the web's APPLICATION_SECTIONS). */
export const INTERVIEWS = "entretiens";

/** The app's addresses, the web's own (apps/web/src/routes.ts), so a universal link opens the same page. */
export const paths = {
  home: "/",
  applications: "/candidatures",
  application: (id: string) => `/candidatures/${encodeURIComponent(id)}`,
  /** One of an Application's Sections: an Interview on the Agenda leads to its « entretiens ». */
  applicationSection: (id: string, section: typeof INTERVIEWS) => `/candidatures/${encodeURIComponent(id)}/${section}`,
  agenda: "/agenda",
  jobSearches: "/recherches",
  jobOffer: (jobSearchId: string, id: string) => `/recherches/${encodeURIComponent(jobSearchId)}/offres/${encodeURIComponent(id)}`,
  jobDigests: "/job-digests",
  humanCoaches: "/coachs",
  /** A Coaching Session on its Human Coaches page: where it leads from the Agenda. */
  coachingSession: (id: string) => `/coachs#seance-${encodeURIComponent(id)}`,
  conversation: (id: string) => `/conversations/${encodeURIComponent(id)}`,
  account: "/compte",
  coachSpace: "/espace-coach",
  /** Réglages de l'app, the device's own settings: the app's alone, the web has no such page. */
  appSettings: "/reglages",
} as const;

/** A new Free conversation: created at its first message (ADR-0070), so it has no id until then. */
export const NEW_CONVERSATION = "nouvelle";

type MenuKey = "applications" | "agenda" | "jobSearches" | "jobDigests" | "humanCoaches";

/** The Sidebar's menus, in the web's order (apps/web/src/components/sidebar-nav.ts), each a conversation (ADR-0070). */
export const MENUS: readonly { key: MenuKey; path: string; label: "nav.applications" | "sidebar.agenda" | "sidebar.jobSearches" | "sidebar.jobDigests" | "account.humanCoaches"; icon: LucideIcon }[] = [
  { key: "applications", path: paths.applications, label: "nav.applications", icon: Briefcase },
  { key: "agenda", path: paths.agenda, label: "sidebar.agenda", icon: Calendar },
  { key: "jobSearches", path: paths.jobSearches, label: "sidebar.jobSearches", icon: Search },
  { key: "jobDigests", path: paths.jobDigests, label: "sidebar.jobDigests", icon: Mail },
  { key: "humanCoaches", path: paths.humanCoaches, label: "account.humanCoaches", icon: Users },
];

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/** Whether `path`'s entry in the Sidebar is the page shown, or one under it. */
export const isCurrent = (pathname: string, path: string) => (path === paths.home ? pathname === path : under(pathname, path));

/**
 * The page at `pathname` as the shell shows it: its title, and its column, the Fiche on an object's page (an
 * Application's), Activité alone on the home page, a menu or a Free conversation, none on Mon compte, the Coach space or Réglages de l'app.
 */
export function pageFor(pathname: string, t: TFunction): ShellPage {
  const page = (title: string, pane: ShellPage["pane"]): ShellPage => ({ key: pathname, title, pane });
  const [, section, id] = pathname.split("/").map((part) => decodeURIComponent(part));
  if (section === "candidatures" && id) return page(SAMPLE_APPLICATIONS.find((application) => application.id === id)?.title ?? t("nav.applications"), "fiche");
  if (section === "conversations" && id) {
    const title = SAMPLE_FREE_CONVERSATIONS.find((conversation) => conversation.id === id)?.title;
    return page(title ?? t("conversationFirst.newConversation"), "activite");
  }
  const menu = MENUS.find((candidate) => under(pathname, candidate.path));
  if (menu) return page(t(menu.label), "activite");
  if (under(pathname, paths.account)) return page(t("nav.account"), null);
  if (under(pathname, paths.coachSpace)) return page(t("account.coachSpace"), null);
  if (under(pathname, paths.appSettings)) return page(t("mobile.appSettings"), null);
  return page(t("mobile.homeTitle"), "activite");
}
