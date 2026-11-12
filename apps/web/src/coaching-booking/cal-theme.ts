"use client";
import { getCalApi } from "@calcom/embed-react";
import { useEffect, useRef } from "react";
import { useDocumentTheme } from "@/design/ThemedHtml";

/**
 * The theme a Cal.com embed is drawn in: the page's (<html data-theme>), for its config. Cal.com reads its config once,
 * so a theme changed afterwards (Préférences, or the device under Système) is sent through its API.
 */
export function useCalTheme(namespace: string): "dark" | "light" {
  const theme = useDocumentTheme();
  const sent = useRef(theme);
  useEffect(() => {
    if (theme === sent.current) return;
    sent.current = theme;
    void getCalApi({ namespace }).then((cal) => cal("ui", { theme }));
  }, [namespace, theme]);
  return theme;
}
