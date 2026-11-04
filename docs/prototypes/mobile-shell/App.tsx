// PROTOTYPE — throwaway, branch prototype/mobile-shell, never merged into main.
// Question: how should the Jobbbox native shell navigate, phone and tablet alike?
// Three variants of the navigation, switchable from the dark bar at the very bottom (and `?variant=` on the web):
//   A · Tiroir (Claude)   — the agreed design: a drawer on a phone, a Sidebar column on a wide screen.
//   B · Onglets           — a bottom tab bar on a phone, a labelled rail on a wide screen.
//   C · Sans chrome       — no drawer, no tabs: destinations as chips above the composer.
// All three share the conversation-as-the-page (ADR-0070) and the panes (Fiche, Activité, Work Pane): full screen below 64rem,
// a column beside the conversation from 64rem, decided by the window width in rem (OS text size included).
import { StatusBar } from "expo-status-bar";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { applications, replies, Status } from "./src/data";
import { COL, Layout, useLayout } from "./src/layout";
import { ActiviteContent, appOf, Ctx, FicheContent, MENUS, WorkContent, NavList, pageOf, parentOf, Screen, titleOf, WebViewStandIn } from "./src/screens";
import { colorsFor, ThemeContext, useTheme } from "./src/theme";
import { Btn, Conversation, Drawer, FullPane, Msg, TopBar } from "./src/ui";

type Variant = "A" | "B" | "C";
const VARIANTS: { key: Variant; name: string }[] = [
  { key: "A", name: "Tiroir (Claude)" },
  { key: "B", name: "Onglets" },
  { key: "C", name: "Sans chrome" },
];

const isWeb = Platform.OS === "web";
const initialVariant = (): Variant => {
  if (!isWeb) return "A";
  const v = new URLSearchParams(window.location.search).get("variant");
  return v === "B" || v === "C" ? v : "A";
};

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const system = useColorScheme();
  const [schemePref, setSchemePref] = useState<"auto" | "light" | "dark">("auto");
  const scheme = schemePref === "auto" ? (system === "dark" ? "dark" : "light") : schemePref;
  const c = colorsFor(scheme);
  const insets = useSafeAreaInsets();

  const [variant, setVariantState] = useState<Variant>(initialVariant);
  const [showState, setShowState] = useState(true);
  const [screen, setScreen] = useState<Screen>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarWanted, setSidebarWanted] = useState(true);
  const [pane, setPane] = useState<PaneKind | null>(null);
  const [work, setWork] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>(() => Object.fromEntries(applications.map((a) => [a.id, a.status])));
  const [offerState, setOfferState] = useState<Record<string, "saved" | "dismissed">>({});
  const [toast, setToast] = useState<string | null>(null);
  const [convs, setConvs] = useState<Record<string, Msg[]>>(() => ({
    "conv:c1": [
      { from: "me", text: "Aide-moi à me présenter en deux minutes pour un poste de responsable qualité." },
      { from: "coach", text: "Avec plaisir. Commençons par ce que vous voulez que le recruteur retienne : en une phrase, quel est le résultat dont vous êtes le plus fier ?" },
    ],
  }));
  const [streamingKey, setStreamingKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const app = appOf(screen);
  const isConversation = !("webview" in pageOf(screen, { go: () => {}, statuses: {}, setStatus: () => {}, offerState: {}, setOffer: () => {}, alert: () => {}, openWork: () => {} }));
  const paneShown: PaneKind | null = pane === "fiche" && !app ? null : pane === "activite" && !isConversation ? null : pane;
  const layout = useLayout({ sidebarWanted, ficheOpen: !!paneShown || !!work, hasSidebar: variant === "A" });

  const setVariant = (v: Variant) => {
    setVariantState(v);
    setDrawerOpen(false);
    if (isWeb) window.history.replaceState(null, "", `?variant=${v}`);
  };
  const cycle = (d: 1 | -1) => setVariant(VARIANTS[(VARIANTS.findIndex((x) => x.key === variant) + d + VARIANTS.length) % VARIANTS.length].key);

  const go = (s: Screen) => {
    setScreen(s);
    setDrawerOpen(false);
    setWork(null);
    if (!layout.wide) setPane(null);
  };
  const alert = (text: string) => {
    setToast(text);
    setTimeout(() => setToast((t) => (t === text ? null : t)), 2600);
  };
  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setStreamingKey(null);
  }, []);
  const send = (key: string, replyKey: string, text: string) => {
    const reply = replies[replyKey] ?? replies.default;
    setConvs((p) => ({ ...p, [key]: [...(p[key] ?? []), { from: "me", text }, { from: "coach", text: "" }] }));
    setStreamingKey(key);
    let i = 0;
    // Stands in for POST /api/coach with `Accept: application/x-ndjson`: one event per chunk.
    timer.current = setInterval(() => {
      i += 4;
      setConvs((p) => {
        const arr = [...(p[key] ?? [])];
        arr[arr.length - 1] = { from: "coach", text: reply.slice(0, i) };
        return { ...p, [key]: arr };
      });
      if (i >= reply.length) stop();
    }, 28);
  };
  const newConversation = () => {
    stop();
    setConvs((p) => ({ ...p, coach: [] }));
    go("coach");
  };

  // Hardware keyboard (web here; iPad and Android tablets need a key-command module in the real app).
  useEffect(() => {
    if (!isWeb) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "\\") { e.preventDefault(); layout.wide ? setSidebarWanted((v) => !v) : setDrawerOpen((v) => !v); }
      else if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); setPane((v) => (v ? null : app ? "fiche" : "activite")); }
      else if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); setWork(null); }
      else if (e.key === "Escape") { setDrawerOpen(false); if (work) setWork(null); else if (!layout.ficheAsColumn) setPane(null); }
      else if (!typing && e.key === "ArrowLeft") cycle(-1);
      else if (!typing && e.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ctx: Ctx = {
    go,
    statuses,
    setStatus: (id, s) => setStatuses((p) => ({ ...p, [id]: s })),
    offerState,
    setOffer: (id, s) => setOfferState((p) => ({ ...p, [id]: s })),
    alert,
    openWork: (item) => setWork(item),
  };

  const shell: Shell = { screen, go, ctx, layout, app, isConversation, pane: paneShown, setPane, work, setWork, drawerOpen, setDrawerOpen, sidebarWanted, setSidebarWanted, newConversation, convs, streamingKey, send, stop };

  return (
    <ThemeContext.Provider value={{ c, scheme }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: c.background, paddingTop: insets.top }}>
        <View style={{ flex: 1 }}>
          {variant === "A" ? <VariantA s={shell} /> : variant === "B" ? <VariantB s={shell} /> : <VariantC s={shell} />}
          {toast ? (
            <View pointerEvents="none" style={{ position: "absolute", left: 16, right: 16, bottom: 110, alignItems: "center" }}>
              <View style={{ backgroundColor: c.inverse, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 480 }}>
                <Text style={{ color: c.onInverse, fontSize: 15 }}>{toast}</Text>
              </View>
            </View>
          ) : null}
        </View>
        <PrototypeBar
          variant={variant}
          cycle={cycle}
          schemePref={schemePref}
          setSchemePref={setSchemePref}
          showState={showState}
          setShowState={setShowState}
          state={`${Math.round(layout.width)}pt × échelle texte ${layout.fontScale.toFixed(2)} = ${layout.widthRem.toFixed(1)}rem · ${layout.why} · volet : ${work ? "Work Pane" : paneShown ?? "aucun"}${work || paneShown ? (layout.ficheAsColumn ? " en colonne" : " en pleine page") : ""} · thème ${scheme}`}
          bottomInset={insets.bottom}
        />
      </View>
    </ThemeContext.Provider>
  );
}

type Shell = {
  screen: Screen;
  go: (s: Screen) => void;
  ctx: Ctx;
  layout: Layout;
  app: ReturnType<typeof appOf>;
  isConversation: boolean;
  pane: PaneKind | null;
  setPane: (p: PaneKind | null | ((v: PaneKind | null) => PaneKind | null)) => void;
  work: string | null;
  setWork: (w: string | null) => void;
  drawerOpen: boolean;
  setDrawerOpen: (f: boolean | ((v: boolean) => boolean)) => void;
  sidebarWanted: boolean;
  setSidebarWanted: (f: (v: boolean) => boolean) => void;
  newConversation: () => void;
  convs: Record<string, Msg[]>;
  streamingKey: string | null;
  send: (key: string, replyKey: string, text: string) => void;
  stop: () => void;
};

// ——— The page: its conversation (or a WebView), with the Fiche as a column or a sheet ———

function Page({ s, above }: { s: Shell; above?: ReactNode }) {
  const { c } = useTheme();
  const page = pageOf(s.screen, s.ctx);
  const body =
    "webview" in page ? (
      <View style={{ flex: 1 }}>
        <WebViewStandIn url={page.webview} />
        {above ? <View style={{ padding: 12 }}>{above}</View> : null}
      </View>
    ) : (
      <Conversation
        key={s.screen}
        intro={page.intro}
        card={page.card}
        above={above}
        suggestions={page.suggestions}
        messages={s.convs[s.screen] ?? []}
        streaming={s.streamingKey === s.screen}
        onSend={(t) => s.send(s.screen, page.replyKey, t)}
        onStop={s.stop}
        readingWidth={44 * s.layout.rem}
      />
    );
  const wide = s.layout.ficheAsColumn;
  const column = s.work ? "work" : s.pane;
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ flex: 1 }}>{body}</View>
      {wide && column ? (
        <View style={{ width: COL.fiche * s.layout.rem, marginLeft: COL.gutter * s.layout.rem, backgroundColor: c.nav }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, minHeight: 48 }}>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: c.text }}>{paneTitle(s, column)}</Text>
            <Btn kind="ghost" small label="✕" a11y="Fermer" onPress={() => (s.work ? s.setWork(null) : s.setPane(null))} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 14 }}>{paneBody(s, column)}</ScrollView>
        </View>
      ) : null}
    </View>
  );
}

type PaneKind = "fiche" | "activite";
const paneTitle = (s: Shell, k: PaneKind | "work") => (k === "work" ? s.work ?? "" : k === "fiche" ? "Fiche" : "Activité");
const paneBody = (s: Shell, k: PaneKind | "work") =>
  k === "work" ? <WorkContent item={s.work ?? ""} ctx={s.ctx} /> : k === "fiche" && s.app ? <FicheContent app={s.app} ctx={s.ctx} /> : <ActiviteContent />;

// Below 64rem: the Fiche, the Activité column and the Work Pane open full screen over the page, the Top Bar included.
function PhonePanes({ s }: { s: Shell }) {
  if (s.layout.ficheAsColumn) return null;
  return (
    <>
      <FullPane open={!!s.pane} title={s.pane ? paneTitle(s, s.pane) : ""} onClose={() => s.setPane(null)}>
        {s.pane ? paneBody(s, s.pane) : null}
      </FullPane>
      <FullPane open={!!s.work} title={s.work ?? ""} onClose={() => s.setWork(null)}>
        {s.work ? paneBody(s, "work") : null}
      </FullPane>
    </>
  );
}

const ficheButton = (s: Shell) => {
  if (!s.isConversation) return null;
  const kind: PaneKind = s.app ? "fiche" : "activite";
  return <Btn small kind={s.pane === kind ? "primary" : "secondary"} label={s.app ? "Fiche" : "Activité"} onPress={() => s.setPane((v) => (v === kind ? null : kind))} />;
};
const titlePress = (s: Shell) => {
  const parent = parentOf(s.screen);
  return parent ? () => s.go(parent) : undefined;
};

// ——— A · Tiroir (Claude) ———

function VariantA({ s }: { s: Shell }) {
  const { c } = useTheme();
  const nav = <NavList current={s.screen} go={s.go} onNew={s.newConversation} />;
  const menuButton = (
    <Btn kind="ghost" icon="☰" a11y={s.layout.sidebarPinned ? "Masquer la barre latérale" : "Menu"} onPress={() => (s.layout.wide && s.layout.sidebarPinned) || (s.layout.wide && !s.sidebarWanted) ? s.setSidebarWanted((v) => !v) : s.setDrawerOpen(true)} />
  );
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      {s.layout.sidebarPinned ? <View style={{ width: COL.sidebar * s.layout.rem, backgroundColor: c.nav }}>{nav}</View> : null}
      <View style={{ flex: 1 }}>
        <TopBar
          left={menuButton}
          title={titleOf(s.screen)}
          onTitlePress={titlePress(s)}
          right={<>{ficheButton(s)}{!s.layout.sidebarPinned ? <Btn kind="ghost" icon="✎" a11y="Nouvelle conversation" onPress={s.newConversation} /> : null}</>}
        />
        <Page s={s} />
      </View>
      <PhonePanes s={s} />
      {!s.layout.sidebarPinned ? (
        <Drawer open={s.drawerOpen} onClose={() => s.setDrawerOpen(false)} width={Math.min(s.layout.width * 0.86, COL.sidebar * s.layout.rem + 32)}>
          {nav}
        </Drawer>
      ) : null}
    </View>
  );
}

// ——— B · Onglets ———

const TABS: { key: Screen; label: string; icon: string }[] = [
  { key: "home", label: "Accueil", icon: "⌂" },
  { key: "candidatures", label: "Candidatures", icon: "▤" },
  { key: "recherches", label: "Offres", icon: "⌕" },
  { key: "agenda", label: "Agenda", icon: "◷" },
  { key: "coach", label: "Coach", icon: "✎" },
];
const tabOf = (screen: Screen): Screen =>
  screen.startsWith("app:") ? "candidatures" : screen.startsWith("conv:") || screen === "coachs" ? "coach" : screen === "digests" ? "recherches" : screen;

function VariantB({ s }: { s: Shell }) {
  const { c } = useTheme();
  const active = tabOf(s.screen);
  const tab = (t: (typeof TABS)[number], vertical: boolean) => {
    const on = active === t.key;
    return (
      <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => s.go(t.key)} style={{ flex: vertical ? undefined : 1, alignItems: "center", justifyContent: "center", minHeight: vertical ? 64 : 56, paddingVertical: 6, borderRadius: 12, backgroundColor: on && vertical ? c.hover : "transparent" }}>
        <Text style={{ fontSize: 20, color: on ? c.accent : c.secondary }}>{t.icon}</Text>
        <Text style={{ fontSize: 12, fontWeight: on ? "700" : "500", color: on ? c.accent : c.secondary }}>{t.label}</Text>
      </Pressable>
    );
  };
  const top = (
    <TopBar
      left={s.screen === "coach" || s.screen.startsWith("conv:") ? <Btn kind="ghost" icon="✎" a11y="Nouvelle conversation" onPress={s.newConversation} /> : undefined}
      title={titleOf(s.screen)}
      onTitlePress={titlePress(s)}
      right={<>{ficheButton(s)}<Btn kind="ghost" icon="◎" a11y="Mon compte" onPress={() => s.go("compte")} /></>}
    />
  );
  if (s.layout.wide)
    return (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: 6 * s.layout.rem, backgroundColor: c.nav, paddingTop: 12, paddingHorizontal: 6, gap: 4 }}>{TABS.map((t) => tab(t, true))}</View>
        <View style={{ flex: 1 }}>
          {top}
          <Page s={s} />
        </View>
        <PhonePanes s={s} />
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      {top}
      <Page s={s} />
      <View style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.nav }}>{TABS.map((t) => tab(t, false))}</View>
      <PhonePanes s={s} />
    </View>
  );
}

// ——— C · Sans chrome ———

function VariantC({ s }: { s: Shell }) {
  const destinations: { key: Screen; label: string }[] = [
    ...MENUS.filter((m) => m.key !== "home").map((m) => ({ key: m.key, label: m.label })),
    { key: "coach", label: "Conversations" },
    { key: "compte", label: "Mon compte" },
  ].filter((d) => d.key !== s.screen);
  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
      {destinations.map((d) => (
        <Btn key={d.key} small kind="ghost" label={`${d.label} ›`} onPress={() => s.go(d.key)} />
      ))}
    </ScrollView>
  );
  return (
    <View style={{ flex: 1 }}>
      <TopBar
        left={s.screen !== "home" ? <Btn kind="ghost" icon="⌂" a11y="Accueil" onPress={() => s.go("home")} /> : <Btn kind="ghost" icon="✎" a11y="Nouvelle conversation" onPress={s.newConversation} />}
        title={titleOf(s.screen)}
        onTitlePress={titlePress(s)}
        right={ficheButton(s)}
      />
      <Page s={s} above={chips} />
      <PhonePanes s={s} />
    </View>
  );
}

// ——— The prototype's own bar: deliberately not part of the design ———

function PrototypeBar(p: {
  variant: Variant; cycle: (d: 1 | -1) => void; schemePref: "auto" | "light" | "dark"; setSchemePref: (v: "auto" | "light" | "dark") => void;
  showState: boolean; setShowState: (v: boolean) => void; state: string; bottomInset: number;
}) {
  const name = VARIANTS.find((v) => v.key === p.variant)?.name;
  const nextScheme = { auto: "light", light: "dark", dark: "auto" } as const;
  const label = { auto: "Auto", light: "Clair", dark: "Sombre" }[p.schemePref];
  const pill = (text: string, onPress: () => void, a11y?: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? text} onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={{ backgroundColor: "#ff2d86", paddingBottom: p.bottomInset }}>
      {p.showState ? <Text style={{ color: "#fff", fontSize: 12, paddingHorizontal: 12, paddingTop: 6 }}>{p.state}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
        {pill("‹", () => p.cycle(-1), "Variante précédente")}
        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>{`PROTOTYPE · ${p.variant} (${name})`}</Text>
        {pill("›", () => p.cycle(1), "Variante suivante")}
        {pill(`Thème : ${label}`, () => p.setSchemePref(nextScheme[p.schemePref]), "Changer de thème")}
        {pill(p.showState ? "État ▾" : "État ▸", () => p.setShowState(!p.showState))}
      </View>
    </View>
  );
}
