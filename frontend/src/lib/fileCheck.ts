// Client-side checks before anything is uploaded. The backend repeats them (it trusts no client),
// these just give an instant, specific answer.

export const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

export type Kind = "jpeg" | "png" | "webp" | "pdf";

/** Detect the real file type from its first bytes (the name and browser MIME type can lie). */
export function sniff(b: Uint8Array): Kind | "heic" | "other" {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(0, 5) === "%PDF-") return "pdf";
  if (ascii(4, 4) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1|heif)$/.test(ascii(8, 4))) return "heic";
  return "other";
}

/** null = fine, otherwise an error code that describeError() knows. */
export async function checkFile(f: Blob, maxMb: number): Promise<{ code: string; kind?: Kind } | { code: null; kind: Kind }> {
  if (f.size === 0) return { code: "empty_file" };
  if (f.size > maxMb * 1024 * 1024) return { code: "too_large" };
  const kind = sniff(new Uint8Array(await f.slice(0, 16).arrayBuffer()));
  if (kind === "heic") return { code: "heic_unsupported" };
  if (kind === "other") return { code: "unsupported_type" };
  if (kind !== "pdf") {
    try {
      const bmp = await createImageBitmap(f);
      bmp.close();
    } catch {
      return { code: "corrupt" };
    }
  }
  return { code: null, kind };
}

/** A small JPEG thumbnail (data URL) for History, so entries are recognisable. PDFs get none. */
export async function thumbnail(f: Blob, size = 96): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(f);
    const s = size / Math.max(bmp.width, bmp.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return c.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
