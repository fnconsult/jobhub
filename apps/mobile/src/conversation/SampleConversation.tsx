import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Conversation, type Message } from "./Conversation";

/** Stands in for the Coach's reply until #690 streams the real one from `POST /api/coach` (NDJSON). */
const SAMPLE_REPLY =
  "Avec plaisir. Commençons par ce que vous voulez que le recruteur retienne : en une phrase, quel est le résultat dont vous êtes le plus fier ?";
const CHUNK = 4;
const CHUNK_MS = 28;

/** The conversation on sample data, the reply streamed a few letters at a time, as the real one will be. */
export function SampleConversation() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>(() => [{ id: "disclosure", from: "coach", text: t("coachPanel.aiDisclosure") }]);
  const [streaming, setStreaming] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setStreaming(false);
  };
  useEffect(() => stop, []);

  const send = (text: string) => {
    const id = String(Date.now());
    let shown = 0;
    setMessages((current) => [...current, { id: `${id}-q`, from: "candidate", text }, { id: `${id}-r`, from: "coach", text: "" }]);
    setStreaming(true);
    timer.current = setInterval(() => {
      shown += CHUNK;
      setMessages((current) => current.map((message) => (message.id === `${id}-r` ? { ...message, text: SAMPLE_REPLY.slice(0, shown) } : message)));
      if (shown >= SAMPLE_REPLY.length) stop();
    }, CHUNK_MS);
  };

  return <Conversation messages={messages} streaming={streaming} onSend={send} onStop={stop} onAttach={() => {}} />;
}
