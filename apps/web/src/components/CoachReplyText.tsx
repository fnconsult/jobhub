import type { ReactNode } from "react";
import { coachReplyBlocks, type Inline, type LinkPolicy } from "@/coach/reply-text";

/**
 * An AI Coach reply set as paragraphs, lists and bold or italic text, never raw Markdown (#164). Its links are shown as
 * their text, unless `links` keeps them: a Help Article in the Help Centre (#552), never an AI reply.
 */
export function CoachReplyText({ text, links }: { text: string; links?: LinkPolicy }) {
  const line = (inlines: Inline[]) =>
    inlines.map((part, i) => {
      let node: ReactNode = part.text;
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
              <li key={i}>{lines(item)}</li>
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
