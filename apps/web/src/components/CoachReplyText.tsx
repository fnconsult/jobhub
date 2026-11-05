import type { CSSProperties, ReactNode } from "react";
import { coachReplyBlocks, type Inline, type LinkPolicy } from "@/coach/reply-text";

/** A text's words and the spaces between them, in order. */
const wordsOf = (text: string) => text.split(/(\s+)/).filter(Boolean);
const isWord = (part: string) => !/^\s+$/.test(part);

/** How many words an AI Coach reply shows, as `reveal` numbers them (#788): what its reveal lasts. */
export function replyWordCount(text: string): number {
  return coachReplyBlocks(text)
    .flatMap((block) => (block.kind === "paragraph" ? block.lines : block.items.flat()))
    .flat()
    .reduce((count, part) => count + wordsOf(part.text).filter(isWord).length, 0);
}

/**
 * An AI Coach reply set as paragraphs, lists and bold or italic text, never raw Markdown (#164). Its links are shown as
 * their text, unless `links` keeps them: a Help Article in the Help Centre (#552), never an AI reply. `afterStep` puts
 * something after a numbered item, by its number: a Tutorial step's « Voir comment » (#569). `reveal` (#788): each word
 * in a `.coach-word` numbered by `--word`, in reading order, so the page fades each in at its place, the whole text in
 * the page all along.
 */
export function CoachReplyText({ text, links, afterStep, reveal = false }: { text: string; links?: LinkPolicy; afterStep?: (step: number) => ReactNode; reveal?: boolean }) {
  let word = 0;
  const words = (text: string): ReactNode =>
    reveal
      ? wordsOf(text).map((part, i) =>
          isWord(part) ? (
            <span key={i} className="coach-word" style={{ "--word": word++ } as CSSProperties}>
              {part}
            </span>
          ) : (
            part
          ),
        )
      : text;
  const line = (inlines: Inline[]) =>
    inlines.map((part, i) => {
      let node: ReactNode = words(part.text);
      if (part.emphasis) node = <em>{node}</em>;
      if (part.strong) node = <strong>{node}</strong>;
      if (part.href) node = <a href={part.href}>{node}</a>;
      return <span key={i}>{node}</span>;
    });
  const lines = (list: Inline[][]) =>
    list.map((inlines, i) => (
      <span key={i}>
        {i > 0 ? <br /> : null}
        {line(inlines)}
      </span>
    ));
  return (
    <>
      {coachReplyBlocks(text, { links }).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>{lines(block.lines)}</p>
        ) : block.ordered ? (
          <ol key={index} start={block.start}>
            {block.items.map((item, i) => (
              <li key={i}>
                {lines(item)}
                {afterStep?.(block.start + i)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{lines(item)}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}
