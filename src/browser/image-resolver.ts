import type { ImageResolver, ResolvedImage, SupportedImageType } from "../core/types.js";
import { detectImageType, readImageSize } from "../images/detect.js";

export interface BrowserImageResolverOptions {
  /** Délai maximal par image ; évite qu'un serveur muet bloque la conversion. */
  readonly timeoutMs?: number;
  /** Garde-fou mémoire : au-delà, l'image est ignorée. */
  readonly maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const FALLBACK_SIZE = { width: 600, height: 400 } as const;

/**
 * Charge les images côté navigateur.
 *
 * Limites structurelles, volontairement non contournées :
 *  - un chemin relatif (`./schema.png`) n'est pas résolvable — le navigateur
 *    n'a pas accès au dossier du fichier déposé ;
 *  - une image distante n'est récupérable que si le serveur autorise le CORS.
 *
 * Dans les deux cas la conversion se poursuit et un avertissement est remonté :
 * une illustration manquante ne doit pas coûter le document entier.
 */
export class BrowserImageResolver implements ImageResolver {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly cache = new Map<string, ResolvedImage | null>();

  constructor(options: BrowserImageResolverOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async resolve(url: string): Promise<ResolvedImage | null> {
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;

    const image = await this.load(url).catch(() => null);
    this.cache.set(url, image);
    return image;
  }

  private async load(url: string): Promise<ResolvedImage | null> {
    if (!isFetchable(url)) return null;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      credentials: "omit",
      redirect: "follow",
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (blob.size === 0 || blob.size > this.maxBytes) return null;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const detected = detectImageType(bytes);

    if (detected === "png" || detected === "jpg" || detected === "gif" || detected === "bmp") {
      const size = readImageSize(bytes, detected) ?? (await measure(blob));
      return { data: bytes, type: detected, ...(size ?? FALLBACK_SIZE) };
    }

    // WebP, SVG et formats exotiques n'existent pas en OOXML : on les rastérise
    // en PNG plutôt que de les perdre.
    return transcodeToPng(blob);
  }
}

function isFetchable(url: string): boolean {
  try {
    const protocol = new URL(url, window.location.href).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "data:" || protocol === "blob:";
  } catch {
    return false;
  }
}

async function measure(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

async function transcodeToPng(blob: Blob): Promise<ResolvedImage | null> {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadHtmlImage(objectUrl);
    // Un SVG sans dimensions intrinsèques rapporte 0 : on lui impose une taille
    // de rendu raisonnable plutôt que d'échouer.
    const width = image.naturalWidth || FALLBACK_SIZE.width;
    const height = image.naturalHeight || FALLBACK_SIZE.height;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;

    return {
      data: new Uint8Array(await png.arrayBuffer()),
      type: "png" satisfies SupportedImageType,
      width,
      height,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image illisible : ${src}`));
    image.src = src;
  });
}
