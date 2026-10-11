/** Pure helpers for sizing the device-mirror (ws-scrcpy) iframe inside its pane. */

export interface MirrorSize {
  w: number;
  h: number;
}

export interface MirrorSizePreset extends MirrorSize {
  id: string;
  label: string;
}

/** Default matches this repo's redroid.sh (REDROID_WIDTH × REDROID_HEIGHT). */
export const DEFAULT_MIRROR_SIZE: MirrorSize = { w: 1280, h: 720 };

export const MIRROR_SIZE_PRESETS: ReadonlyArray<MirrorSizePreset> = [
  { id: "1280x720", label: "1280 × 720 · redroid", w: 1280, h: 720 },
  { id: "720x1280", label: "720 × 1280", w: 720, h: 1280 },
  { id: "1920x1080", label: "1920 × 1080", w: 1920, h: 1080 },
  { id: "1080x1920", label: "1080 × 1920", w: 1080, h: 1920 },
  { id: "2400x1080", label: "2400 × 1080", w: 2400, h: 1080 },
  { id: "1080x2400", label: "1080 × 2400", w: 1080, h: 2400 },
  { id: "1440x3120", label: "1440 × 3120", w: 1440, h: 3120 },
];

/** Width/height aspect (w/h) of a chosen device size. */
export function mirrorAspect(size: MirrorSize): number {
  return size.w > 0 && size.h > 0 ? size.w / size.h : 16 / 9;
}

/** The preset matching a size exactly, if any. */
export function presetForSize(size: MirrorSize): MirrorSizePreset | undefined {
  return MIRROR_SIZE_PRESETS.find((p) => p.w === size.w && p.h === size.h);
}

/** Rotate a size by swapping width and height. */
export function swapSize(size: MirrorSize): MirrorSize {
  return { w: size.h, h: size.w };
}

/** Parses "1280x720" / "1280 × 720" into a size, or null when invalid. */
export function parseMirrorSize(value: string | null | undefined): MirrorSize | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

export function formatMirrorSize(size: MirrorSize): string {
  return `${size.w}x${size.h}`;
}

/**
 * Largest box of `aspect` (w/h) that fits inside `availW x availH`
 * (the classic "contain" fit). Returns null when there is nothing to measure.
 */
export function containSize(
  availW: number,
  availH: number,
  aspect: number,
): { w: number; h: number } | null {
  if (!(availW > 0) || !(availH > 0) || !(aspect > 0)) return null;
  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }
  return { w: Math.floor(w), h: Math.floor(h) };
}
