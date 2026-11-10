import { expect, it, vi } from "vitest";
import { enrolmentFormData } from "./http";
it("parses bounded multipart data", async () => {
  const body = new FormData();
  body.set("email", "sophie@example.test");
  body.set("proof", new File(["%PDF-document"], "proof.pdf", { type: "application/pdf" }));
  const form = await enrolmentFormData(new Request("http://localhost/api/coach-enrolments", { method: "POST", body }), 4096);
  expect(form?.get("email")).toBe("sophie@example.test");
  expect((form?.get("proof") as File).name).toBe("proof.pdf");
});
it("cancels oversized chunked data before parsing", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(101));
    },
    cancel,
  });
  const request = new Request("http://localhost/api/coach-enrolments", { method: "POST", body, duplex: "half" } as RequestInit & { duplex: "half" });
  expect(await enrolmentFormData(request, 100)).toBeNull();
  expect(cancel).toHaveBeenCalled();
});
it("rejects a declared oversized body without reading", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const request = new Request("http://localhost/api/coach-enrolments", {
    method: "POST",
    headers: { "content-length": "1000" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect(await enrolmentFormData(request, 100)).toBeNull();
  expect(cancel).toHaveBeenCalled();
});
