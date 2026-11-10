"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
export function BookingWait() {
  const router = useRouter(),
    { t } = useTranslation();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      if (++n <= 30) router.refresh();
      else clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  }, [router]);
  return <p role="status">{t("coachingBooking.waiting")}</p>;
}
