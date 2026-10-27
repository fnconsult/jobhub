import { resources } from "@jobhub/shared/i18n";
import type { ExplainedContext } from "@/components/ExplainableLabel";
import { ExplainableLabel } from "@/components/ExplainableLabel";
import type { Ctx } from "./context";

const LABELS = resources.fr.translation.admin.platformSettings.labels;
type LabelledSetting = keyof typeof LABELS;
const isLabelled = (name: string): name is LabelledSetting => Object.hasOwn(LABELS, name);

/** A setting's words on Paramètres (« Pays »), or none: its env name stands for it. */
export function settingLabel(ctx: Ctx, name: string): string | null {
  return isLabelled(name) ? ctx.t(`admin.platformSettings.labels.${name}`) : null;
}

/** The tab a Paramètres item is on, in words, for the Back Office Assistant (#407). */
export const tabNameOf = (ctx: Ctx): string => ctx.t(`admin.platformSettings.tabs.${ctx.tab.id}`);

/**
 * A setting's name in its row (#407): its words as an Explainable label, then its env name; a setting without words is
 * explained by its env name. `item`: what the row shows of it, its value, source and state.
 */
export function SettingName({ ctx, name, item }: { ctx: Ctx; name: string; item: Omit<ExplainedContext, "kind" | "id" | "tab"> }) {
  const label = settingLabel(ctx, name);
  const explained: ExplainedContext = { ...item, kind: "setting", id: name, tab: tabNameOf(ctx) };
  if (!label) {
    return (
      <ExplainableLabel item={explained} code>
        {name}
      </ExplainableLabel>
    );
  }
  return (
    <>
      <ExplainableLabel item={explained}>{label}</ExplainableLabel> <code className="setting-name">{name}</code>
    </>
  );
}
