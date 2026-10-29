// Image helpers (sharp): raw pixels for the QR scan, and the one compressed JPEG sent to Gemini.
import sharp from "sharp";

/** Longest side of the picture sent to Gemini. */
export const AI_IMAGE_PX = 1600;

/** Upright RGBA pixels, shrunk so the longest side is at most `maxSide`. */
export async function rawPixels(bytes: Uint8Array, maxSide: number) {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: new Uint8ClampedArray(data) };
}

/** Photo / page render → JPEG, 1600 px on the longest side (fewer tokens, same legibility). */
export async function compressForAi(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(bytes)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: AI_IMAGE_PX, height: AI_IMAGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return new Uint8Array(out);
}
