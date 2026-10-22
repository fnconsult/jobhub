/**
 * The « env » badge (#304): a Tool's settings that come from env and differ from the code's
 * default, named in its label (read aloud, and on hover).
 */
export function EnvBadge({ text, label }: { text: string; label: string }) {
  return (
    <span className="pill" data-tone="accent" title={label}>
      {text}
      <span className="visually-hidden"> ({label})</span>
    </span>
  );
}
