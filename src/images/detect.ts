import type { SupportedImageType } from "../core/types.js";

export type DetectedImageType = SupportedImageType | "svg" | "webp" | "unknown";

/**
 * Identification par signature binaire plutôt que par extension ou en-tête
 * `Content-Type` : les deux mentent régulièrement, et un `.docx` contenant une
 * image mal typée est refusé par Word.
 */
export function detectImageType(bytes: Uint8Array): DetectedImageType {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  if (isSvg(bytes)) return "svg";
  return "unknown";
}

/**
 * Dimensions natives lues dans l'en-tête du fichier, sans décodage complet.
 * Renvoie `null` si l'en-tête est tronqué ou non reconnu.
 */
export function readImageSize(
  bytes: Uint8Array,
  type: SupportedImageType,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  switch (type) {
    case "png":
      // IHDR est toujours le premier chunk : largeur/hauteur en offsets 16 et 20.
      if (bytes.byteLength < 24) return null;
      return { width: view.getUint32(16, false), height: view.getUint32(20, false) };

    case "gif":
      if (bytes.byteLength < 10) return null;
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };

    case "bmp":
      if (bytes.byteLength < 26) return null;
      // La hauteur est signée : négative pour un bitmap stocké de haut en bas.
      return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };

    case "jpg":
      return readJpegSize(view);

    default:
      return null;
  }
}

/**
 * Un JPEG est une suite de segments `FF xx <longueur>`. Les dimensions sont
 * portées par le marqueur SOFn ; il faut donc parcourir les segments jusqu'à
 * lui, en sautant les tables de quantification, les vignettes EXIF, etc.
 */
function readJpegSize(view: DataView): { width: number; height: number } | null {
  let offset = 2; // saute SOI (FF D8)

  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1; // resynchronisation sur un flux légèrement corrompu
      continue;
    }

    const marker = view.getUint8(offset + 1);

    // Marqueurs autonomes (sans longueur) : padding, RSTn, SOI, EOI.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      return {
        height: view.getUint16(offset + 5, false),
        width: view.getUint16(offset + 7, false),
      };
    }

    const segmentLength = view.getUint16(offset + 2, false);
    if (segmentLength < 2) return null; // longueur invalide : on abandonne
    offset += 2 + segmentLength;
  }

  return null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 256))
    .trimStart()
    .toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}
