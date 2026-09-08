import { resolve } from "node:path";
import { defaultConfig, type AutomationConfig } from "./config.js";

export const COMMON_OPTIONS = `Options :
  --dir <dossier>          Dossier surveillé (répétable). Défaut : Téléchargements
  --out <dossier>          Dossier de sortie des .docx
  --toc                    Ajoute une table des matières cliquable
  --no-header              Supprime l'en-tête et le pied de page
  --no-open                N'ouvre pas le document une fois créé
  --allow-remote-images    Autorise le téléchargement des images distantes
  --backfill               Traite aussi les fichiers déjà présents au démarrage
  --log <fichier>          Journal persistant (utile en service silencieux)
  --help                   Affiche cette aide`;

export class UsageError extends Error {}

/**
 * Analyse les arguments communs aux deux modes.
 *
 * Toute valeur manquante est signalée immédiatement : un service qui démarre
 * avec une configuration à moitié comprise est pire qu'un service qui refuse
 * de démarrer.
 */
export function parseAutomationArgs(argv: readonly string[]): AutomationConfig {
  const base = defaultConfig();
  const watchDirs: string[] = [];

  let outputDir = base.outputDir;
  let tableOfContents = base.tableOfContents;
  let pageHeader = base.pageHeader;
  let openAfterConvert = base.openAfterConvert;
  let allowRemoteImages = base.allowRemoteImages;
  let backfill = base.backfill;
  let logFile = base.logFile;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--dir":
        watchDirs.push(resolve(requireValue(argv, ++index, "--dir")));
        break;
      case "--out":
        outputDir = resolve(requireValue(argv, ++index, "--out"));
        break;
      case "--log":
        logFile = resolve(requireValue(argv, ++index, "--log"));
        break;
      case "--toc":
        tableOfContents = true;
        break;
      case "--no-header":
        pageHeader = false;
        break;
      case "--no-open":
        openAfterConvert = false;
        break;
      case "--allow-remote-images":
        allowRemoteImages = true;
        break;
      case "--backfill":
        backfill = true;
        break;
      case undefined:
        break;
      default:
        throw new UsageError(`Option inconnue : ${arg}`);
    }
  }

  return {
    watchDirs: watchDirs.length > 0 ? watchDirs : base.watchDirs,
    outputDir,
    openAfterConvert,
    tableOfContents,
    pageHeader,
    allowRemoteImages,
    maxFileBytes: base.maxFileBytes,
    backfill,
    logFile,
  };
}

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new UsageError(`L'option ${flag} attend une valeur.`);
  }
  return value;
}
