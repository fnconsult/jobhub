/**
 * A text call's conversation once the model calls tools (#712, ADR-0077): messages made of text, tool calls and tool
 * results. What reads it as text (the AI Message Log, a provider without tool calling) and what rewrites every text
 * it holds at once (Redaction, putting the values back) go through here, so no block is ever left out of either.
 */
import type { ContentBlock, Message, TurnMessage } from "./types";

/** Whether any message is made of blocks rather than text. */
export const hasBlocks = (messages: readonly TurnMessage[]): boolean => messages.some((message) => typeof message.content !== "string");

/** One block as text: a tool call with its name, id and arguments as JSON, a result (or an error) with its call's id. */
function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "tool_call":
      return `[appel d'outil ${block.name} #${block.id}] ${JSON.stringify(block.arguments ?? null)}`;
    case "tool_result":
      return `[${block.error ? "erreur" : "résultat"} d'outil #${block.id}] ${block.content}`;
  }
}

/** A message's content as text: its blocks one per line (an empty one left out). */
export const contentText = (content: TurnMessage["content"]): string => (typeof content === "string" ? content : content.map(blockText).filter(Boolean).join("\n"));

/** The conversation as text messages: what the AI Message Log keeps of a call, and what a provider without tool calling is sent. */
export const said = (messages: readonly TurnMessage[]): Message[] => messages.map(({ role, content }) => ({ role, content: contentText(content) }));

/**
 * The conversation with every text it holds replaced at once by `map`'s: each text message, each text block, each string
 * inside a tool call's arguments and each tool result, in that order. `map` must give back as many texts as it was given.
 */
export function mapTexts(messages: readonly TurnMessage[], map: (texts: string[]) => string[]): TurnMessage[] {
  const texts: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  for (const { content } of messages) {
    if (typeof content === "string") texts.push(content);
    else for (const block of content) collect(block.type === "text" ? block.text : block.type === "tool_call" ? block.arguments : block.content);
  }
  const mapped = map(texts);
  let next = 0;
  const take = () => mapped[next++] ?? "";
  const rebuild = (value: unknown): unknown => {
    if (typeof value === "string") return take();
    if (Array.isArray(value)) return value.map(rebuild);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, rebuild(each)]));
    return value;
  };
  // Each message keeps its own fields: a call without tools sends what it always sent.
  return messages.map((message) => ({
    ...message,
    content:
      typeof message.content === "string"
        ? take()
        : message.content.map((block): ContentBlock => {
            switch (block.type) {
              case "text":
                return { ...block, text: take() };
              case "tool_call":
                return { ...block, arguments: rebuild(block.arguments) };
              case "tool_result":
                return { ...block, content: take() };
            }
          }),
  }));
}

/** Every text the conversation holds, in the order `mapTexts` gives them. */
export function textsIn(messages: readonly TurnMessage[]): string[] {
  let texts: string[] = [];
  mapTexts(messages, (all) => (texts = all));
  return texts;
}

/** How much of an earlier Tool round's result is resent, at most, to a provider that caches no prompt (#790). */
export const TOOL_RESULT_DIGEST_CHARS = 600;

/**
 * The conversation with the results of every Tool round but the latest cut to a digest (#790): their first
 * TOOL_RESULT_DIGEST_CHARS characters, ended at a space, and a mark saying the model read the whole of it at that round.
 * For a provider that caches no prompt, each Turn resending them in full otherwise; the latest round's results, and
 * every error, are sent whole. The same digest every Turn, so a provider's own prefix cache still matches.
 */
export function digestedToolResults(messages: readonly TurnMessage[]): TurnMessage[] {
  const rounds = messages.flatMap((message, index) => (typeof message.content !== "string" && message.content.some((block) => block.type === "tool_result") ? [index] : []));
  const latest = rounds.at(-1);
  return messages.map((message, index) => {
    const round = rounds.indexOf(index) + 1;
    if (round === 0 || index === latest || typeof message.content === "string") return message;
    return { ...message, content: message.content.map((block) => (block.type === "tool_result" && !block.error && block.content.length > TOOL_RESULT_DIGEST_CHARS ? { ...block, content: digestOf(block.content, round) } : block)) };
  });
}

function digestOf(content: string, round: number): string {
  const head = content.slice(0, TOOL_RESULT_DIGEST_CHARS);
  const space = head.search(/\s\S*$/);
  return `${space > 0 ? head.slice(0, space) : head} […] (résultat du tour ${round} abrégé ici : tu l'as lu en entier à ce tour-là, appuie-toi sur ce que tu en as retenu)`;
}
