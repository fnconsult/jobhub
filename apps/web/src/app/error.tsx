"use client";

import { FailedPage } from "@/components/FailedPage";

/** A page that failed, under the root layout (#542). */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <FailedPage error={error} retry={retry} />;
}
