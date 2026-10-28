"use client";

import { useTranslation } from "react-i18next";
import "./Amount.css";

/**
 * An amount of money in the interface's language (« 1 774,66 € »), in tabular figures, its cents (and the currency
 * after them, in French) raised and set as metadata, as Mercury writes them. `fractionDigits`: 2 by default, more
 * for a cost of a fraction of a cent (« 0,0396 € »).
 */
export function Amount({ value, currency = "EUR", fractionDigits = 2 }: { value: number; currency?: string; fractionDigits?: number }) {
  const { i18n } = useTranslation();
  const parts = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).formatToParts(value);
  const decimal = parts.findIndex((part) => part.type === "decimal");
  const text = (from: number, to?: number) =>
    parts
      .slice(from, to)
      .map((part) => part.value)
      .join("");
  return (
    <data className="ds-amount" value={value}>
      {decimal < 0 ? (
        text(0)
      ) : (
        <>
          {text(0, decimal)}
          <span className="ds-amount__cents" data-cents>
            {text(decimal)}
          </span>
        </>
      )}
    </data>
  );
}
