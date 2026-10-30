"use client";

import { useServerInsertedHTML } from "next/navigation";
import { useRef } from "react";

/**
 * Puts `script` once in the <head> of whatever HTML Next sends for the request, its bare error shell included.
 * A page that calls `notFound()` (a 404 in its shell, #542) gets that shell, `<html id="__next_error__">` with an
 * empty head, and React draws the page on the client, where an inline `<script>` of ours never runs; Next still
 * writes there what was inserted with `useServerInsertedHTML` while the page was being drawn (#473).
 */
export function ErrorShellHead({ script }: { script: string }) {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <script dangerouslySetInnerHTML={{ __html: script }} />;
  });
  return null;
}
