import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageResolver, ResolvedImage, SupportedImageType } from "../core/types.js";
import { detectImageType, readImageSize } from "../images/detect.js";

const REMOTE_TIMEOUT_MS = 10_000;
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Résolveur pour l'exécution en ligne de commande : contrairement au
 * navigateur, on peut lire les images voisines du fichier Markdown, ce qui
 * couvre le cas courant `![schéma](images/schema.png)`.
 *
 * Aucune rastérisation possible ici (pas de moteur de rendu) : SVG et WebP sont
 * signalés comme non intégrés plutôt que convertis.
 */
export class NodeImageResolver implements ImageResolver {
  private readonly cache = new Map<string, ResolvedImage | null>();

  constructor(
    private readonly baseDir: string,
    private readonly allowRemote = true,
  ) {}

  async resolve(url: string): Promise<ResolvedImage | null> {
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;

    const image = await this.load(url).catch(() => null);
    this.cache.set(url, image);
    return image;
  }

  private async load(url: string): Promise<ResolvedImage | null> {
    const bytes = await this.readBytes(url);
    if (bytes === null || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

    const type = detectImageType(bytes);
    if (type !== "png" && type !== "jpg" && type !== "gif" && type !== "bmp") return null;

    const size = readImageSize(bytes, type satisfies SupportedImageType);
    if (size === null || size.width <= 0 || size.height <= 0) return null;

    return { data: bytes, type, ...size };
  }

  private async readBytes(url: string): Promise<Uint8Array | null> {
    if (url.startsWith("data:")) return decodeDataUri(url);

    if (/^https?:\/\//i.test(url)) {
      if (!this.allowRemote) return null;
      const response = await fetch(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    }

    if (url.startsWith("file://")) return new Uint8Array(await readFile(fileURLToPath(url)));

    // Tout autre schéma (`mailto:`, `ftp:`…) n'a pas de sens pour une image.
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;

    const path = isAbsolute(url) ? url : resolvePath(this.baseDir, decodeURIComponent(url));
    return new Uint8Array(await readFile(path));
  }
}

function decodeDataUri(uri: string): Uint8Array | null {
  const comma = uri.indexOf(",");
  if (comma === -1) return null;

  const header = uri.slice(0, comma);
  const payload = uri.slice(comma + 1);

  if (!header.includes(";base64")) {
    return new TextEncoder().encode(decodeURIComponent(payload));
  }
  return new Uint8Array(Buffer.from(payload, "base64"));
}
