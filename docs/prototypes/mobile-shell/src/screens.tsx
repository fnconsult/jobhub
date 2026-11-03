// PROTOTYPE (throwaway). What each page shows: its title, its Introduction, its card in the thread, its suggestions.
import { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { agenda, applications, Application, freeConversations, humanCoaches, offers, Status, STATUSES } from "./data";
import { tokens, useTheme } from "./theme";
import { Btn, Card, Pill, Row, T } from "./ui";

export type Screen = string; // home | candidatures | recherches | digests | agenda | coachs | coach | conv:<id> | app:<id> | compte | espace-coach

export type Ctx = {
  go: (s: Screen) => void;
  statuses: Record<string, Status>;
  setStatus: (id: string, s: Status) => void;
  offerState: Record<string, "saved" | "dismissed">;
  setOffer: (id: string, s: "saved" | "dismissed") => void;
  alert: (text: string) => void;
};

export const MENUS: { key: Screen; label: string; icon: string }[] = [
  { key: "home", label: "Accueil", icon: "⌂" },
  { key: "candidatures", label: "Mes candidatures", icon: "▤" },
  { key: "recherches", label: "Recherches d'offres", icon: "⌕" },
  { key: "digests", label: "Job Digests", icon: "✉" },
  { key: "agenda", label: "Agenda", icon: "◷" },
  { key: "coachs", label: "Mes coachs humains", icon: "☺" },
];

const tone = (s: Status) => (s === "Entretien" || s === "Offre" ? "success" : s === "Refusée" ? "danger" : s === "Envoyée" ? "accent" : "warn");

export function appOf(screen: Screen): Application | undefined {
  return screen.startsWith("app:") ? applications.find((a) => "app:" + a.id === screen) : undefined;
}

export function titleOf(screen: Screen): string {
  const app = appOf(screen);
  if (app) return app.company;
  if (screen.startsWith("conv:")) return freeConversations.find((c) => "conv:" + c.id === screen)?.title ?? "Nouvelle conversation";
  if (screen === "coach") return "Coach";
  if (screen === "compte") return "Mon compte";
  if (screen === "espace-coach") return "Espace coach";
  return MENUS.find((m) => m.key === screen)?.label ?? screen;
}

export const parentOf = (screen: Screen): Screen | undefined => (screen.startsWith("app:") ? "candidatures" : screen.startsWith("conv:") ? "coach" : undefined);

const INTRO = "Je suis le coach IA de Jobbbox, pas une personne. Un coach humain peut être réservé dans « Mes coachs humains ».";

export function pageOf(screen: Screen, ctx: Ctx): { intro: string; card?: ReactNode; suggestions: string[]; replyKey: string } | { webview: string } {
  const app = appOf(screen);
  if (screen === "compte") return { webview: "jobbbox.ai/compte" };
  if (screen === "espace-coach") return { webview: "jobbbox.ai/espace-coach" };
  if (app)
    return {
      intro: `${INTRO} Ici, on parle de votre candidature « ${app.title} ».`,
      suggestions: ["Prépare mon entretien", "Relis ma lettre", "Que dois-je relancer ?"],
      replyKey: "application",
    };
  const appsTable = (rows: Application[]) => (
    <Card title="Mes candidatures">
      {rows.map((a) => (
        <Row key={a.id} title={`${a.company} · ${a.title}`} sub={a.next ?? `Match ${a.match} %`} right={<Pill label={ctx.statuses[a.id]} tone={tone(ctx.statuses[a.id])} />} onPress={() => ctx.go("app:" + a.id)} />
      ))}
    </Card>
  );
  switch (screen) {
    case "home":
      return { intro: `Bonjour Marie. ${INTRO}`, card: appsTable(applications.filter((a) => ctx.statuses[a.id] !== "Refusée").slice(0, 2)), suggestions: ["Que dois-je faire aujourd'hui ?", "Trouver des offres", "Préparer un entretien"], replyKey: "default" };
    case "candidatures":
      return { intro: INTRO, card: appsTable(applications), suggestions: ["Lesquelles relancer ?", "Ajouter une candidature"], replyKey: "default" };
    case "recherches":
      return {
        intro: INTRO,
        card: (
          <Card title="Recherche « Qualité, Occitanie » · 3 nouveaux résultats">
            {offers.filter((o) => ctx.offerState[o.id] !== "dismissed").map((o) => (
              <Row
                key={o.id}
                title={o.title}
                sub={`${o.company} · ${o.city} · Match ${o.match} %`}
                right={ctx.offerState[o.id] === "saved" ? <Pill label="Enregistrée" tone="success" /> : (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Btn small label="Écarter" onPress={() => ctx.setOffer(o.id, "dismissed")} />
                    <Btn small kind="primary" label="Garder" onPress={() => ctx.setOffer(o.id, "saved")} />
                  </View>
                )}
              />
            ))}
            <View style={{ padding: 12 }}><Btn small label="Relancer la recherche" onPress={() => ctx.alert("Relance d'une Recherche d'offres (quota du Plan)")} /></View>
          </Card>
        ),
        suggestions: ["Pourquoi ce Match Score ?", "Élargir à la Nouvelle-Aquitaine"],
        replyKey: "default",
      };
    case "digests":
      return { intro: INTRO, card: <Card title="Job Digests · chaque lundi"><Row title="Lundi 3 novembre" sub="7 offres · 2 au-dessus de 80 %" onPress={() => ctx.go("recherches")} /><Row title="Lundi 27 octobre" sub="5 offres" onPress={() => ctx.go("recherches")} /></Card>, suggestions: ["Changer la fréquence"], replyKey: "default" };
    case "agenda":
      return {
        intro: INTRO,
        card: (
          <>
            <Card title="À planifier">{agenda.toSchedule.map((g) => <Row key={g.id} title={g.title} sub={g.detail} onPress={() => ctx.alert("Lien de réservation du coach (navigateur intégré)")} />)}</Card>
            {agenda.days.map((d) => (
              <Card key={d.day} title={d.day}>
                {d.items.map((g) => <Row key={g.id} title={`${g.time} · ${g.title}`} sub={g.detail} right={<Btn small label="Ajouter au calendrier" onPress={() => ctx.alert("Feuille « Nouvel événement » du système, pré-remplie")} />} />)}
              </Card>
            ))}
          </>
        ),
        suggestions: ["Qu'ai-je cette semaine ?"],
        replyKey: "default",
      };
    case "coachs":
      return {
        intro: INTRO,
        card: <Card title="Coachs humains">{humanCoaches.map((h) => <Row key={h.id} title={h.name} sub={h.focus} right={<Btn small kind="primary" label="Réserver" onPress={() => ctx.alert("Stripe Checkout dans le navigateur intégré, retour par lien universel")} />} />)}</Card>,
        suggestions: ["Quel coach me conviendrait ?"],
        replyKey: "default",
      };
    case "coach":
      return {
        intro: INTRO,
        card: <Card title="Vos conversations">{freeConversations.map((f) => <Row key={f.id} title={f.title} onPress={() => ctx.go("conv:" + f.id)} />)}</Card>,
        suggestions: ["Préparer mon pitch", "Négocier le salaire"],
        replyKey: "default",
      };
    default:
      return { intro: INTRO, suggestions: [], replyKey: "default" };
  }
}

export function FicheContent({ app, ctx }: { app: Application; ctx: Ctx }) {
  const { c } = useTheme();
  const status = ctx.statuses[app.id];
  return (
    <View style={{ gap: 12 }}>
      <View>
        <T size="h3" weight="700">{app.title}</T>
        <T color={c.secondary}>{app.company}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Pill label={status} tone={tone(status)} />
        <Btn small label="Changer le statut" onPress={() => ctx.setStatus(app.id, STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length])} />
      </View>
      <View>
        <T size="meta" color={c.meta}>Match Score</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surface }}>
            <View style={{ width: `${app.match}%`, height: 8, borderRadius: 4, backgroundColor: c.chart1 }} />
          </View>
          <T weight="600">{app.match} %</T>
        </View>
      </View>
      <Card title="Sections">
        {["Entretiens (1)", "CV adapté", "Lettre de motivation", "Relances", "Dossier entreprise"].map((s) => (
          <Row key={s} title={s} onPress={() => ctx.alert(`« ${s} » s'ouvre dans le Work Pane`)} />
        ))}
      </Card>
      <Card title="Activité">
        <View style={{ padding: 14, gap: 6 }}>
          <T size="meta" color={c.secondary}>Contexte : 12 messages sur 40 · 18 k jetons sur 120 k</T>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surface }}>
            <View style={{ width: "15%", height: 6, borderRadius: 3, backgroundColor: c.accent }} />
          </View>
        </View>
      </Card>
    </View>
  );
}

export function NavList({ current, go, onNew, compact }: { current: Screen; go: (s: Screen) => void; onNew: () => void; compact?: boolean }) {
  const { c } = useTheme();
  const item = (key: Screen, label: string, icon?: string) => {
    const on = current === key || (key === "candidatures" && current.startsWith("app:"));
    return (
      <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => go(key)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 12, borderRadius: tokens.radius.md + 4, backgroundColor: on ? c.hover : pressed ? c.hover : "transparent" })}>
        {icon ? <Text style={{ width: 20, textAlign: "center", fontSize: 16, color: c.secondary }}>{icon}</Text> : null}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontWeight: on ? "700" : "400", color: c.text }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, minHeight: 56 }}>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "800", color: c.text }}>Jobbbox</Text>
        <Btn kind="ghost" icon="✎" a11y="Nouvelle conversation" onPress={onNew} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12, gap: 2 }}>
        {MENUS.map((m) => item(m.key, m.label, m.icon))}
        <Text style={{ fontSize: 13, fontWeight: "600", color: c.meta, paddingHorizontal: 12, paddingTop: 18, paddingBottom: 6 }}>COACH</Text>
        {item("coach", "Nouvelle conversation", "✎")}
        {freeConversations.map((f) => item("conv:" + f.id, f.title))}
      </ScrollView>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, padding: 8, gap: 2 }}>
        {item("espace-coach", "Espace coach", "⇄")}
        {item("compte", compact ? "Compte" : "Mon compte · Marie D.", "◎")}
      </View>
    </View>
  );
}

export function WebViewStandIn({ url }: { url: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10, backgroundColor: c.surface }}>
      <T size="h3" weight="700">WebView</T>
      <T color={c.secondary} style={{ textAlign: "center" }}>{`Ici, la page web ${url}, avec le cookie de session posé pour jobbbox.ai seulement.`}</T>
    </View>
  );
}
