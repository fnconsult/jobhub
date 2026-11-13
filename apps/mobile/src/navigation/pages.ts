import type { TFunction } from "i18next";
import { Briefcase, Calendar, Mail, Search, Users, type LucideIcon } from "lucide-react-native";
import { SHARE_PATH } from "@jobhub/shared";
import type { ApplicationResponse, ProfileResponse } from "@jobhub/shared/reads";
import type { ShellPage } from "../shell/Shell";

/** An Application's Interviews Section, as its address names it (the web's APPLICATION_SECTIONS). */
export const INTERVIEWS = "entretiens";

/** The app's addresses, the web's own (apps/web/src/routes.ts), so a universal link opens the same page. */
export const paths = {
  home: "/",
  applications: "/candidatures",
  application: (id: string) => `/candidatures/${encodeURIComponent(id)}`,
  /** One of an Application's Sections the app shows (#691): an Interview on the Agenda leads to its « entretiens ». */
  applicationSection: (id: string, section: "correspondance" | typeof INTERVIEWS | "dossier" | "contacts" | "offre") => `/candidatures/${encodeURIComponent(id)}/${section}`,
  agenda: "/agenda",
  jobSearches: "/recherches",
  /** A Job Search's page (#692): its Job Offers, where « Lancer une recherche » lands. */
  jobSearch: (id: string) => `/recherches/${encodeURIComponent(id)}`,
  jobOffer: (jobSearchId: string, id: string) => `/recherches/${encodeURIComponent(jobSearchId)}/offres/${encodeURIComponent(id)}`,
  /** An Offer box entry's Job Offer (ADR-0090): the web's « Lire l'offre », in the Work Pane beside the Offer box. */
  offerBoxOffer: (jobOfferId: string) => `/recherches?offre=${encodeURIComponent(jobOfferId)}`,
  jobDigests: "/job-digests",
  /** A Job Digest sent and its Job Offers (#692). */
  jobDigest: (id: string) => `/job-digests/${encodeURIComponent(id)}`,
  jobDigestOffer: (jobDigestId: string, id: string) => `/job-digests/${encodeURIComponent(jobDigestId)}/offres/${encodeURIComponent(id)}`,
  humanCoaches: "/coachs",
  /** The Order of a Coaching Session with a Human Coach, before Stripe Checkout (#694): the web's Order page's address. */
  coachingOrder: (coachId: string) => `/coachs/commande?coach=${encodeURIComponent(coachId)}`,
  /** A Coaching Session on its Human Coaches page: where it leads from the Agenda. */
  coachingSession: (id: string) => `/coachs#seance-${encodeURIComponent(id)}`,
  conversation: (id: string) => `/conversations/${encodeURIComponent(id)}`,
  profile: (id: string) => `/profils/${encodeURIComponent(id)}`,
  account: "/compte",
  /** Mon compte's pages, the web app's inside the app (#689): every section, Sécurité, Mes données, then Account deletion on it. */
  accountSections: "/compte/rubriques",
  accountSecurity: "/compte/securite",
  accountData: "/compte/donnees",
  /** Rappels: the reminders and the Push notifications' switches, the web's; the device's own permission above it (#699). */
  accountReminders: "/compte/rappels",
  accountDeletion: "/compte/supprimer",
  subscription: "/abonnement",
  /** « Renoncer au contrat ici »: the web's Withdrawal form of a contract (`plan`, `coaching-session:<id>`), in a WebView. */
  withdrawal: (contract: string) => `/abonnement/retractation?contrat=${encodeURIComponent(contract)}`,
  legal: "/legal",
  coachSpace: "/espace-coach",
  associationSpace:"/espace-association",
  /** Réglages de l'app, the device's own settings: the app's alone, the web has no such page. */
  appSettings: "/reglages",
  /** The capture screen of Share capture (#697), which the share sheet opens: the app's alone too. */
  share: SHARE_PATH,
} as const;

/** The web app's pages some of the app's open, where their address is not the app's own (#689). */
export const webPaths = {
  /** `/compte/rubriques` in the app: the web's Mon compte, listing every section. */
  accountSections: "/compte",
  /** `/compte/supprimer` in the app: Mes données, opened on Account deletion. */
  accountDeletion: "/compte/donnees#supprimer",
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

const segments = (pathname: string) => pathname.split("/").map((part) => decodeURIComponent(part));

/** The id of the Profile whose page is at `pathname`; null on any other page. */
export function profileIdOf(pathname: string): string | null {
  const [, section, id] = segments(pathname);
  return section === "profils" && id ? id : null;
}

/** The id of the Application whose page (or one of its Sections) is at `pathname`; null on any other page. */
export function applicationIdOf(pathname: string): string | null {
  const [, section, id] = segments(pathname);
  return section === "candidatures" && id ? id : null;
}

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

/** Whether `path`'s entry in the Sidebar is the page shown, or one under it. */
export const isCurrent = (pathname: string, path: string) => (path === paths.home ? pathname === path : under(pathname, path));

/**
 * The page at `pathname` as the shell shows it: its title, and its column, the Fiche on an object's page (an
 * Application's, a Profile's), Activité alone on the home page, a menu or a Free conversation, none on Mon compte, the
 * subscription, the Legal Texts, the Coach space, Réglages de l'app or the capture screen of Share capture.
 * An Application's page is titled with its Job Offer once `read.application` has it (`GET /api/applications/:id`),
 * « Candidature » until then, and its title leads back to Mes candidatures (`up`, as iOS's back arrow does); a
 * Profile's page with its name once `read.profile` has it (`GET /api/profiles/:id`), « Profil » until then; a Free
 * conversation's with its title, as `read.conversationTitle` gives it (the drawer's list).
 */
export function pageFor(
  pathname: string,
  t: TFunction,
  read: {
    application?: Pick<ApplicationResponse, "id"> & { jobOffer: Pick<ApplicationResponse["jobOffer"], "title"> };
    profile?: Pick<ProfileResponse, "id" | "name">;
    conversationTitle?: (id: string) => string | undefined;
  } = {},
): ShellPage {
  const page = (title: string, pane: ShellPage["pane"]): ShellPage => ({ key: pathname, title, pane });
  const [, section, id] = segments(pathname);
  if (section === "candidatures" && id) return { ...page(read.application?.id === id ? read.application.jobOffer.title : t("application.kind"), "fiche"), up: { path: paths.applications, label: t("application.backToApplications") } };
  if (section === "profils" && id) return page(read.profile?.id === id ? read.profile.name : t("mobile.profiles.title"), "fiche");
  if (section === "conversations" && id) {
    const title = read.conversationTitle?.(id);
    return page(title ?? t("conversationFirst.newConversation"), "activite");
  }
  const menu = MENUS.find((candidate) => under(pathname, candidate.path));
  if (menu) return page(t(menu.label), "activite");
  if (under(pathname, paths.account)) return page(t("nav.account"), null);
  if (under(pathname, paths.subscription)) return page(t("account.plan"), null);
  if (under(pathname, paths.legal)) return page(t("legal.documentsNav"), null);
  if (under(pathname, paths.associationSpace)) return page(t("association.title"),null);
  if (under(pathname, paths.coachSpace)) return page(t("account.coachSpace"), null);
  if (under(pathname, paths.appSettings)) return page(t("mobile.appSettings"), null);
  if (under(pathname, paths.share)) return page(t("shareCapture.title"), null);
  return page(t("mobile.homeTitle"), "activite");
}
