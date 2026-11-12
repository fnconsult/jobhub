import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Brain,
  Briefcase,
  Building2,
  Calendar,
  ChartLine,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CircleHelp,
  CircleUser,
  CornerDownLeft,
  ClipboardList,
  Copy,
  CreditCard,
  Download,
  Ellipsis,
  Eraser,
  ExternalLink,
  FileQuestionMark,
  FileSearch,
  Folder,
  Flag,
  Funnel,
  Globe,
  IdCard,
  Info,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Menu,
  MessageCircleQuestion,
  MessageSquare,
  Minus,
  Network,
  NotebookText,
  PackageCheck,
  Palette,
  PanelLeftClose,
  Plus,
  Puzzle,
  RefreshCw,
  Scale,
  Sparkles,
  Search,
  SearchCheck,
  ServerCrash,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  SquarePen,
  Tag,
  Target,
  TriangleAlert,
  Undo2,
  Upload,
  User,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * The interface's icons, from Lucide only (ISC licence, ADR-0053), drawn inline at stroke 1.7. Decoration only:
 * each one sits beside its label in words (ADR-0009: no icon-only function, but AI Activity's stop icon, the
 * Sidebar's Signalement icon and the message box's Send while the Candidate writes, #933, named by their label), so it is hidden from screen readers. The Activity glyphs
 * and the Signalement glyphs are not here: they stay our own (ActivityGlyph, signalement-glyphs).
 */
const LUCIDE = {
  menu: Menu,
  close: X,
  collapse: PanelLeftClose,
  applications: Briefcase,
  agenda: Calendar,
  jobSearches: Search,
  jobDigests: Mail,
  account: CircleUser,
  subscription: CreditCard,
  profile: User,
  chevron: ChevronDown,
  back: ChevronLeft,
  // A clipboard: a Human Coach's own space.
  coachSpace: ClipboardList,
  // A shield: the Back Office.
  admin: Shield,
  signOut: LogOut,
  coach: MessageSquare,
  // A list of ticked tasks: AI Activity (#332).
  aiActivity: ListChecks,
  // Stop an AI action under way (#333): a square.
  stop: Square,
  // A tick: an AI action done (#333), « ✓ Dernière recherche · 16 s ».
  done: Check,
  // The Enter key: « Envoyer au coach » once the Candidate writes (#933, ADR-0009's amendment).
  enter: CornerDownLeft,
  add: Plus,
  conversations: MessageSquare,
  searchAgain: RefreshCw,
  // The Back Office's sections (#204). A flag on its pole: the Signalements (#376).
  signalements: Flag,
  // An arrow turning back: the Withdrawals (#511).
  withdrawals: Undo2,
  // Stacked layers: the Plans (#206).
  plans: Layers,
  planQuotas: ChartNoAxesColumn,
  // A price tag.
  coupons: Tag,
  humanCoaches: Users,
  coachCost: CircleDollarSign,
  // An open book: the Coaching Playbooks (#225).
  coachingPlaybooks: BookOpen,
  // A shield with a tick: the Guardrails (#228).
  guardrails: ShieldCheck,
  // A question mark in a speech bubble: the Unanswered Questions (#344).
  unansweredQuestions: MessageCircleQuestion,
  searchSites: Globe,
  // A key: Provider Secrets (#208).
  providerSecrets: KeyRound,
  // Sliders: the Platform Settings (#298).
  platformSettings: SlidersHorizontal,
  signInProviders: LogIn,
  // Tiles: the Back Office Dashboard (#408).
  dashboard: LayoutDashboard,
  // A rising line on axes: AI consumption (#218).
  aiUsage: ChartLine,
  // A page under a magnifier: the AI Message Log, Activité › Appels IA (#218).
  aiMessages: FileSearch,
  // A pulse line: Activité, what happened (#404).
  activity: Activity,
  // A magnifier: Activité › Recherches, the Job discovery runs (#404).
  discoveryRuns: SearchCheck,
  // An envelope: Activité › Emails reçus, Email intake's Received offer emails (#449).
  receivedEmails: Mail,
  // A puzzle piece, as browsers draw their extensions: Activité › Extension, the Extension Events (#925).
  extensionEvents: Puzzle,
  tools: Wrench,
  // A parcel ticked: Livraison, what is built and where it runs.
  deliveryStatus: PackageCheck,
  // A palette: the Design System page (#463).
  designSystem: Palette,
  administrators: ShieldCheck,
  journal: NotebookText,
  // The error pages (#542): a page not found, a page reserved for another role, a page that failed, the copy button.
  notFound: FileQuestionMark,
  forbidden: Lock,
  serverError: ServerCrash,
  // The Exit Page: a link that leaves Jobbbox.
  exit: ExternalLink,
  copy: Copy,
  // The Design System's Notes and Stats (#462).
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: CircleCheck,
  trendUp: ArrowUpRight,
  trendDown: ArrowDownRight,
  download: Download,
  upload: Upload,
  minus: Minus,
  /** The public Légal, from the Back Office (#544). */
  legal: Scale,
  // « Nouvelle conversation », a conversation's actions and « Effacer » (#601).
  newConversation: SquarePen,
  more: Ellipsis,
  clear: Eraser,
  // « Mémoire du coach » in the Sidebar and « Aide » in the Top Bar (#602).
  memory: Brain,
  help: CircleHelp,
  // « Nouveautés » in Mon compte's menu, beside Aide and Légal.
  nouveautes: Sparkles,
  // « Fiche » in the Top Bar of an object's page (#603); the side panel's views there since #980: the object's card, its
  // Job Offer (as an agent harness's preview) and its Results (as its files).
  fiche: IdCard,
  offer: Globe,
  results: Folder,
  // Recherches d'offres' filter in the compact Top Bar (#898): the Offer box's count and source chips behind it.
  filter: Funnel,
  // The Job discovery sources, as the onboarding's search card pictures them (#1001): no third party's logo.
  sourceFranceTravail: Landmark,
  sourceCareerSites: Building2,
  sourceAtsApis: Network,
  sourceTargetCompanies: Target,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof LUCIDE;

/** Lucide's stroke, thinner than its default 2 (ADR-0053). */
export const ICON_STROKE = 1.7;

function icon(name: IconName) {
  const Glyph = LUCIDE[name];
  function Icon() {
    return <Glyph className="icon" strokeWidth={ICON_STROKE} aria-hidden focusable={false} />;
  }
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

/** One component per icon, e.g. `<Icons.close />`. */
export const Icons = {} as Record<IconName, () => React.JSX.Element>;
for (const name of Object.keys(LUCIDE) as IconName[]) Icons[name] = icon(name);
