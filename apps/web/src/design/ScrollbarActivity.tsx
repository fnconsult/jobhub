"use client";

import { useEffect } from "react";
import { trackScrolling } from "@jobhub/shared/design";

/** Shows each scrollbar only while its area scrolls (ADR-0053); renders nothing. */
export function ScrollbarActivity() {
  useEffect(() => trackScrolling(document), []);
  return null;
}
