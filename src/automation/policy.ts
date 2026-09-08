/**
 * Règles appliquées aux fichiers traités sans supervision humaine.
 *
 * En mode manuel l'utilisateur choisit et relit ce qu'il convertit. En mode
 * automatique, tout fichier `.md` déposé dans le dossier surveillé est traité —
 * y compris un fichier venu d'ailleurs. Deux vecteurs concrets en découlent :
 *
 *  - `![](https://tiers/pixel.png)` provoquerait une requête sortante silencieuse
 *    (pixel de traçage, ou requête vers le réseau local depuis le poste) ;
 *  - `![](file:///C:/Users/.../photo.jpg)` ou `![](../../secret.png)` ferait
 *    embarquer un fichier local dans le .docx produit.
 *
 * D'où : aucune image distante par défaut, et lecture strictement confinée au
 * dossier du fichier source.
 */
import { extname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import type { ImageResolver, ResolvedImage } from "../core/types.js";
import { NodeImageResolver } from "../node/image-resolver.js";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);

/** Extensions posées par les navigateurs pendant un téléchargement en cours. */
const TEMPORARY_SUFFIXES = [
  ".crdownload",
  ".part",
  ".partial",
  ".tmp",
  ".download",
  ".opdownload",
];

/**
 * Un nom de fichier mérite-t-il une conversion ?
 * Filtre volontairement strict : mieux vaut ignorer un fichier exotique que
 * réveiller la conversion sur n'importe quoi.
 */
export function isMarkdownCandidate(fileName: string): boolean {
  const name = fileName.toLowerCase();

  // `~$…` : fichiers verrous d'Office. `.…` : fichiers de service.
  if (name.startsWith("~$") || name.startsWith(".")) return false;
  if (TEMPORARY_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;

  return MARKDOWN_EXTENSIONS.has(extname(name));
}

/** `nom.docx`, puis `nom (2).docx`, `nom (3).docx`… Jamais d'écrasement. */
export function candidateFileName(baseName: string, attempt: number): string {
  return attempt === 0 ? `${baseName}.docx` : `${baseName} (${attempt + 1}).docx`;
}

export interface SandboxOptions {
  /**
   * Dossier de référence des images relatives.
   * `null` lorsque la source n'a pas d'emplacement sur disque (presse-papiers) :
   * aucun accès au système de fichiers n'est alors accordé.
   */
  readonly baseDir: string | null;
  readonly allowRemote: boolean;
}

/**
 * Enveloppe le résolveur Node d'un contrôle d'accès appliqué *avant* toute
 * lecture ou requête. Les URLs refusées sont conservées pour être signalées :
 * une image absente doit être visible dans le rapport, pas disparaître.
 */
export class SandboxedImageResolver implements ImageResolver {
  private readonly inner: ImageResolver | null;
  private readonly rejected = new Set<string>();

  constructor(private readonly options: SandboxOptions) {
    this.inner =
      options.baseDir === null && !options.allowRemote
        ? null
        : new NodeImageResolver(options.baseDir ?? "", options.allowRemote);
  }

  /** URLs écartées par la politique, dans l'ordre de rencontre. */
  get blocked(): readonly string[] {
    return [...this.rejected];
  }

  async resolve(url: string): Promise<ResolvedImage | null> {
    if (!this.isAllowed(url)) {
      this.rejected.add(url);
      return null;
    }
    return this.inner === null ? null : this.inner.resolve(url);
  }

  /**
   * Seule barrière de sécurité : rien ne doit atteindre le résolveur interne
   * sans être passé par ici.
   */
  private isAllowed(url: string): boolean {
    // Donnée déjà contenue dans le document : aucune E/S, aucun réseau.
    if (url.startsWith("data:")) return true;

    if (/^https?:\/\//i.test(url)) return this.options.allowRemote;

    // `file:`, `\serveur\partage`, et tout autre schéma : jamais.
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
    if (url.startsWith("\\\\") || url.startsWith("//")) return false;

    const { baseDir } = this.options;
    if (baseDir === null) return false;
    if (isAbsolute(url)) return false;

    let decoded: string;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      // Séquence d'échappement invalide : entrée malformée, on refuse.
      return false;
    }
    if (isAbsolute(decoded)) return false;

    // Le chemin final doit rester strictement sous le dossier source :
    // `../../` ne doit pas permettre de remonter dans l'arborescence.
    const target = resolvePath(baseDir, decoded);
    const inside = relative(baseDir, target);
    return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
  }
}
