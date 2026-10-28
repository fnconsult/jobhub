import { cleanup, render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";

// Each test starts from an empty document (Testing Library's cleanup needs vitest's globals otherwise).
afterEach(cleanup);

/** Renders `ui` as a French-speaking Candidate sees it, with the interface's catalogue. */
export function renderInFrench(ui: ReactNode): RenderResult {
  return render(<I18nProvider locale="fr">{ui}</I18nProvider>);
}
