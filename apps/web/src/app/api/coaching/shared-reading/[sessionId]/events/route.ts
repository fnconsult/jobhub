import { NextResponse } from "next/server";
import { readingActor } from "@/shared-reading/actor";
import { getSharedReading } from "@/shared-reading/server";
/** One small SSE state each second; document bytes have their own time-bounded, no-store endpoint. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const actor = await readingActor();
  const { sessionId } = await params;
  const reading = getSharedReading();
  if (!actor || !(await reading.canUse(actor, sessionId))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const encoder = new TextEncoder();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const tick = async () => {
        try {
          if (stopped) return;
          const allowed = await reading.canUse(actor, sessionId);
          const state = allowed ? await reading.current(actor, sessionId) : null;
          if (stopped) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ state })}\n\n`));
          if (!allowed) {
            cleanup();
            controller.close();
            return;
          }
          timer = setTimeout(() => void tick(), 750);
        } catch {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already disconnected */
          }
        }
      };
      request.signal.addEventListener(
        "abort",
        () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
      void tick();
    },
    cancel: cleanup,
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "private, no-store", "x-accel-buffering": "no" } });
}
