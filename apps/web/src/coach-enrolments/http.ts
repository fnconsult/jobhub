/** Bound multipart bodies before parsing, including a chunked upload with no trustworthy Content-Length. */
export async function enrolmentFormData(request: Request, limit: number): Promise<FormData | null> {
  if (Number(request.headers.get("content-length")) > limit) {
    await request.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(new Uint8Array(next.value));
    }
    return await new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
