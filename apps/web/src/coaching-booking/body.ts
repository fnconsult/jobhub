/** Bound the stream even when an untrusted sender omits Content-Length. */
export async function bookingBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > 65536) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
