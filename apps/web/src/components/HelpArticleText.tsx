import type { HelpArticle } from "@jobhub/help";
import { CoachReplyText } from "@/components/CoachReplyText";
import type { LinkPolicy } from "@/coach/reply-text";
import { MicroAnimation } from "@/design/MicroAnimation";

/**
 * A Help Article's text with its Micro-animations (#569): a Tutorial's « Voir comment » after its numbered step, a
 * FAQ's after its answer. `text` is the body as shown (its contact address filled in, #552).
 */
export function HelpArticleText({ article, text = article.body, links }: { article: HelpArticle; text?: string; links?: LinkPolicy }) {
  const at = (step: number | null) => article.microAnimations.filter((shown) => shown.step === step).map(({ id }) => <MicroAnimation key={id} id={id} />);
  return (
    <>
      <CoachReplyText text={text} links={links} afterStep={at} />
      {at(null)}
    </>
  );
}
