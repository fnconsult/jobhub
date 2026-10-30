"use client";

import { FailedPage } from "@/components/FailedPage";
import { routes } from "@/routes";

/** A Back Office page that failed (#542): in the Compact Density, leading back to the Back Office. */
export default function BackOfficeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div data-density="compact" className="density-scope">
      <FailedPage error={error} retry={retry} home={routes.admin} />
    </div>
  );
}
