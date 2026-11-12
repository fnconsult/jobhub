"use client";
import Cal, { getCalApi } from "@calcom/embed-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Note } from "@/design/Note";
import { useCalTheme } from "./cal-theme";
import "./cal-embed.css";
const ORIGIN = "https://cal.com",
  NAMESPACE = "jobbbox-paid-session",
  LAYOUT = "month_view",
  SUCCESS = "bookingSuccessfulV2";
/** SDK events refresh the owned server read; only the signed webhook can date the paid session. */
export function BookingEmbed({ bookingUrl, token }: { bookingUrl: string; token: string }) {
  const router = useRouter(),
    { t } = useTranslation(),
    [submitted, setSubmitted] = useState(false),
    theme = useCalTheme(NAMESPACE);
  useEffect(() => {
    let active = true,
      unsubscribe: (() => void) | undefined;
    const callback = () => {
      if (active) setSubmitted(true);
    };
    void getCalApi({ namespace: NAMESPACE }).then((cal) => {
      if (!active) return;
      cal("on", { action: SUCCESS, callback });
      unsubscribe = () => cal("off", { action: SUCCESS, callback });
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    if (!submitted) return;
    let n = 0;
    const id = setInterval(() => {
      if (++n <= 30) router.refresh();
      else clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [submitted, router]);
  return (
    <>
      {submitted ? (
        <Note tone="info" role="status">
          {t("coachingBooking.waitingBooking")}
        </Note>
      ) : null}
      <Cal
        calLink={new URL(bookingUrl).pathname.slice(1)}
        calOrigin={ORIGIN}
        namespace={NAMESPACE}
        config={{ "metadata[jobbbox_session]": token, layout: LAYOUT, theme }}
        className="cal-embed cal-embed--booking"
      />
    </>
  );
}
