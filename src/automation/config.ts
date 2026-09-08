/**
 * Réglages du mode automatique.
 *
 * Le mode manuel (interface web, CLI) traite un contenu que l'utilisateur a lu
 * et choisi. Le mode automatique, lui, traite tout ce qui atterrit dans un
 * dossier surveillé : la frontière de confiance n'est plus la même, d'où les
 * plafonds et le verrouillage des images distantes par défaut.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Plafond de taille d'un Markdown traité sans supervision.
 * Une réponse de conversation dépasse rarement 200 Ko ; au-delà de 5 Mo il
 * s'agit d'autre chose, et charger le fichier en mémoire n'a plus de sens.
 */
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

export interface AutomationConfig {
  /** Dossiers surveillés. */
  readonly watchDirs: readonly string[];
  /** Destination des .docx produits. */
  readonly outputDir: string;
  /** Ouvre le document dans l'application associée dès qu'il est écrit. */
  readonly openAfterConvert: boolean;
  readonly tableOfContents: boolean;
  readonly pageHeader: boolean;
  /**
   * Autorise le téléchargement des images distantes.
   * Désactivé par défaut : un Markdown inconnu ne doit pas déclencher de
   * requête sortante à l'insu de l'utilisateur.
   */
  readonly allowRemoteImages: boolean;
  readonly maxFileBytes: number;
  /** Traite aussi les fichiers déjà présents au démarrage du service. */
  readonly backfill: boolean;
  /** Journal persistant, indispensable quand le service tourne sans fenêtre. */
  readonly logFile: string | null;
}

export const DEFAULT_WATCH_DIR = join(homedir(), "Downloads");
export const DEFAULT_OUTPUT_DIR = join(homedir(), "Documents", "Markdown en Word");
export const DEFAULT_STATE_DIR = join(
  process.env["LOCALAPPDATA"] ?? join(homedir(), ".local", "state"),
  "md2docx",
);

export function defaultConfig(): AutomationConfig {
  return {
    watchDirs: [DEFAULT_WATCH_DIR],
    outputDir: DEFAULT_OUTPUT_DIR,
    openAfterConvert: true,
    tableOfContents: false,
    pageHeader: true,
    allowRemoteImages: false,
    maxFileBytes: MAX_MARKDOWN_BYTES,
    backfill: false,
    logFile: null,
  };
}
