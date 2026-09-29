import sharp from 'sharp';

/**
 * An uploaded picture, turned into what the product shows: a JPEG cropped
 * to the size the client asked for (the identity screen asks 320 x 320,
 * quality 85, crop "attention" so a face survives an off-aspect photo).
 *
 * The client's numbers are clamped, never trusted as given, and anything
 * that is not a picture sharp can read is refused with a sentence the
 * screen can show as it is.
 */
/** The identity screen allows photos up to 8 MB (ClaimIdentityStep); the server takes the same. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export class ImageRejected extends Error {}

export interface ResizeAsk {
  width?: unknown;
  height?: unknown;
  quality?: unknown;
  crop?: unknown;
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** The upload body the extension sends: base64 without the data: prefix, plus its type. */
export function decodeUpload(body: unknown): Buffer {
  const b = (body ?? {}) as { file?: unknown; contentType?: unknown };
  const type = typeof b.contentType === 'string' ? b.contentType.toLowerCase().trim() : '';
  if (!ACCEPTED.has(type)) throw new ImageRejected('Choose a JPEG, PNG, WebP or GIF picture.');
  if (typeof b.file !== 'string' || b.file.length === 0) throw new ImageRejected('The picture did not arrive. Try again.');
  if (b.file.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4) {
    throw new ImageRejected('That picture is too large. Choose one under 8 MB.');
  }
  const bytes = Buffer.from(b.file, 'base64');
  if (bytes.length === 0) throw new ImageRejected('The picture did not arrive. Try again.');
  return bytes;
}

export async function toJpeg(input: Buffer, ask: ResizeAsk): Promise<Buffer> {
  const width = clampInt(ask.width, 320, 16, 1024);
  const height = clampInt(ask.height, width, 16, 1024);
  const quality = clampInt(ask.quality, 85, 40, 95);
  const position = ask.crop === 'entropy' ? sharp.strategy.entropy : sharp.strategy.attention;
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate() // honour the camera's orientation before cropping
      .resize(width, height, { fit: 'cover', position })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new ImageRejected('That file could not be read as a picture. Choose another one.');
  }
}
