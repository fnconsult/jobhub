/** Lower case, without accents or punctuation, single-spaced and padded with a space: "Trésorerie" → " tresorerie ". */
export function normalise(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()} `;
}
