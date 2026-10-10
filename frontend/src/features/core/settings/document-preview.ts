/** Stored preferences can arrive through sync or restore; never interpolate them as HTML. */
export function documentPreview(value: { type: string; dataUrl?: string }): { tag: "iframe" | "img"; url: string } | null {
  const { type, dataUrl } = value;
  if (!dataUrl || dataUrl.length > 4 * Math.ceil((4 * 1024 * 1024) / 3) + 128) return null;
  if (type !== "application/pdf" && !/^image\/[a-z0-9.+-]+$/i.test(type)) return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || match[1] !== type || !match[2] || match[2].length % 4 !== 0) return null;
  return { tag: type === "application/pdf" ? "iframe" : "img", url: dataUrl };
}
