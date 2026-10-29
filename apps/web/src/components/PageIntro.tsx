import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { pageIntro, type IntroPage } from "@/admin/page-intro";
import { ExplainableLabel, type ExplainedContext } from "@/components/ExplainableLabel";

/** What « En savoir plus » explains: the page, by its intro (#407). */
const INTRO: ExplainedContext["kind"] = "intro";

/**
 * A Back Office page's intro in the Compact Density (#465): one muted line under the title, then « En savoir plus »,
 * an Explainable label that asks the Back Office Assistant about the page (`subject`, its title) with the former long
 * intro as its context. `children`: a state the line goes with (« Lecture seule »), shown under it.
 */
export function PageIntro({ t, page, subject, values = {}, children }: { t: TFunction; page: IntroPage; subject: string; values?: Record<string, string>; children?: ReactNode }) {
  const intro = pageIntro(t, page, values);
  return (
    <div className="page-intro">
      <p>
        {intro.line}{" "}
        <ExplainableLabel subject={subject} item={{ kind: INTRO, id: page, state: intro.explanation }}>
          {intro.more}
        </ExplainableLabel>
      </p>
      {children}
    </div>
  );
}
