import { encode } from "uqr";

/**
 * A QR code drawn here, in SVG, from `text`: an authenticator app's `otpauth://` address holds its secret, so it is
 * never sent to a QR code service. Dark modules on a light ground with its quiet zone, whatever the theme, so a camera
 * reads it.
 */
export function QrCode({ text, label, size = 192 }: { text: string; label: string; size?: number }) {
  const { data, size: modules } = encode(text, { ecc: "M", border: 4 });
  const path = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
  return (
    <svg className="qr-code" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${modules} ${modules}`} shapeRendering="crispEdges">
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
