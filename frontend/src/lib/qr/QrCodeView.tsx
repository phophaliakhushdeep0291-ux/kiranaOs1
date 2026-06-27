import { useMemo } from "react";
import { encodeQrMatrix, type QrEccLevel } from "./qr-encoder";

export interface QrCodeViewProps {
  /** The text/URL to encode. */
  value: string;
  level?: QrEccLevel;
  /** Quiet-zone width in modules (spec recommends 4). */
  border?: number;
  /** Rendered pixel size (square). */
  size?: number;
  dark?: string;
  light?: string;
  className?: string;
  title?: string;
}

/**
 * Renders a QR Code as a crisp, scalable SVG (one <path> of dark modules over a light rect).
 * Pure/offline — no network, no library beyond the vendored encoder.
 */
export function QrCodeView({
  value,
  level = "M",
  border = 4,
  size = 240,
  dark = "#0b1424",
  light = "#ffffff",
  className,
  title = "QR code",
}: QrCodeViewProps) {
  const { path, dim } = useMemo(() => {
    const matrix = encodeQrMatrix(value, level);
    const n = matrix.length;
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (matrix[y][x]) d += `M${x + border},${y + border}h1v1h-1z`;
      }
    }
    return { path: d, dim: n + border * 2 };
  }, [value, level, border]);

  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title}
      className={className}
    >
      <rect width={dim} height={dim} fill={light} />
      <path d={path} fill={dark} />
    </svg>
  );
}
