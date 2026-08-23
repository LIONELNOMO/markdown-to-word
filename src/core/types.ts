/**
 * Contrats partagés entre le cœur de conversion, l'interface web et la CLI.
 *
 * Le cœur ne dépend d'aucune API navigateur : tout ce qui touche au réseau ou au
 * système de fichiers passe par `ImageResolver`, injecté par l'appelant. C'est ce
 * qui permet d'exécuter exactement le même pipeline dans le navigateur, dans Node
 * et dans les tests.
 */

/** Formats bitmap acceptés par le format OOXML via la librairie `docx`. */
export type SupportedImageType = "png" | "jpg" | "gif" | "bmp";

export interface ResolvedImage {
  readonly data: Uint8Array;
  readonly type: SupportedImageType;
  /** Dimensions natives en pixels, utilisées pour préserver le ratio. */
  readonly width: number;
  readonly height: number;
}

/**
 * Charge une image référencée par le Markdown.
 * Doit renvoyer `null` (et non lever) lorsqu'une image est introuvable ou
 * invalide : une image cassée ne doit jamais faire échouer une conversion.
 */
export interface ImageResolver {
  resolve(url: string): Promise<ResolvedImage | null>;
}

export interface DocumentMetadata {
  title?: string;
  creator?: string;
  subject?: string;
  description?: string;
  keywords?: string;
}

export interface ConversionOptions {
  /** Nom de fichier souhaité, sans extension. Déduit du contenu si absent. */
  baseName?: string;
  /** Complète/écrase les métadonnées issues du front matter YAML. */
  metadata?: DocumentMetadata;
  /** Insère un champ « Table des matières » (niveaux 1 à 3) en tête de document. */
  tableOfContents?: boolean;
  /** En-tête de page (titre du document) + pied de page (pagination). */
  pageHeader?: boolean;
  /** Chargement des images ; sans résolveur, seul le texte alternatif est rendu. */
  imageResolver?: ImageResolver;
  /** Largeur maximale d'une image en pixels @96dpi (défaut : largeur utile A4). */
  maxImageWidthPx?: number;
}

export interface ConversionWarning {
  /** Ligne du Markdown source, si connue. */
  readonly line?: number;
  readonly message: string;
}

/** Erreur métier destinée à être affichée telle quelle à l'utilisateur. */
export class ConversionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConversionError";
  }
}
