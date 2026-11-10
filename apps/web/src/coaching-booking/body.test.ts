import { it, expect } from "vitest";
import { bookingBody } from "./body";
it("bounds chunked signed webhook bodies without trusting Content-Length", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(40000));
      controller.enqueue(new Uint8Array(40000));
      controller.close();
    },
  });
  expect(await bookingBody(new Request("https://jobbbox.test/hook", { method: "POST", body: stream, duplex: "half" } as RequestInit))).toBeNull();
  expect(await bookingBody(new Request("https://jobbbox.test/hook", { method: "POST", body: '{"hello":"é"}' }))).toBe('{"hello":"é"}');
});
