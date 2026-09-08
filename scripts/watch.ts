#!/usr/bin/env tsx
/**
 * Service de conversion automatique.
 *
 * Surveille le dossier des téléchargements : dès qu'un fichier Markdown y
 * arrive et que son écriture est terminée, il est converti en .docx et ouvert.
 *
 *   npm run watch
 *   npm run watch -- --dir "D:\Echanges" --toc --no-open
 */
import { stat, readFile } from "node:fs/promises";
import { basename, extname, dirname, join } from "node:path";
import { COMMON_OPTIONS, UsageError, parseAutomationArgs, wantsHelp } from "../src/automation/cli.js";
import { DEFAULT_STATE_DIR, type AutomationConfig } from "../src/automation/config.js";
import { acquireSingleInstanceLock } from "../src/automation/lock.js";
import { Logger } from "../src/automation/logger.js";
import { convertToWord } from "../src/automation/pipeline.js";
import { isMarkdownCandidate } from "../src/automation/policy.js";
import { reportOutcome } from "../src/automation/report.js";
import { FolderWatcher, type DetectedFile } from "../src/automation/watcher.js";
import { ConversionError } from "../src/core/types.js";

const USAGE = `Surveillance automatique : un .md déposé devient un .docx.

Usage : npm run watch [-- options]

${COMMON_OPTIONS}`;

const LOCK_FILE = join(DEFAULT_STATE_DIR, "watch.lock");

async function main(argv: readonly string[]): Promise<number> {
  if (wantsHelp(argv)) {
    console.log(USAGE);
    return 0;
  }

  let config: AutomationConfig;
  try {
    config = parseAutomationArgs(argv);
  } catch (error) {
    console.error(error instanceof UsageError ? error.message : String(error));
    console.error(`\n${USAGE}`);
    return 2;
  }

  const logger = new Logger(config.logFile);

  // Une seule instance : le service peut être lancé au démarrage de session
  // *et* à la main ; deux surveillants convertiraient chaque fichier deux fois.
  const lock = await acquireSingleInstanceLock(LOCK_FILE);
  if (!lock.acquired) {
    const who = lock.holderPid === null ? "" : ` (processus ${String(lock.holderPid)})`;
    logger.error(`Une surveillance est déjà en cours${who}. Rien à faire.`);
    await logger.flush();
    return 1;
  }

  const usable = await keepExistingDirectories(config.watchDirs, logger);
  if (usable.length === 0) {
    logger.error("Aucun dossier surveillable. Précisez-en un avec --dir.");
    await lock.release();
    await logger.flush();
    return 1;
  }

  // Sans --backfill, les fichiers déjà présents sont ignorés : au premier
  // lancement, personne ne souhaite voir s'ouvrir cent documents d'un coup.
  const since = config.backfill ? 0 : Date.now();

  const watchers = usable.map(
    (directory) =>
      new FolderWatcher({
        directory,
        since,
        accept: isMarkdownCandidate,
        onFile: (file) => handleFile(file, config, logger),
        onError: (error, path) =>
          logger.error(path === undefined ? "Surveillance" : `Surveillance de ${path}`, error),
      }),
  );

  await Promise.all(watchers.map((watcher) => watcher.start()));

  announce(logger, config, usable);

  await waitForShutdown();

  logger.info("Arrêt demandé, fin des conversions en cours…");
  await Promise.all(watchers.map((watcher) => watcher.stop()));
  await lock.release();
  await logger.flush();
  return 0;
}

async function handleFile(
  file: DetectedFile,
  config: AutomationConfig,
  logger: Logger,
): Promise<void> {
  const name = basename(file.path);

  if (file.size > config.maxFileBytes) {
    const limit = Math.round(config.maxFileBytes / 1024 / 1024);
    logger.warn(`${name} ignoré : ${formatSize(file.size)} dépasse la limite de ${limit} Mo.`);
    return;
  }

  try {
    const markdown = await readFile(file.path, "utf8");
    const outcome = await convertToWord(
      {
        markdown,
        baseDir: dirname(file.path),
        fallbackName: basename(name, extname(name)),
      },
      config,
    );
    reportOutcome(logger, outcome, name);
  } catch (error) {
    // Une conversion ratée est une information, pas un arrêt du service.
    const reason = error instanceof ConversionError || error instanceof Error ? error.message : String(error);
    logger.error(`${name} non converti`, reason);
  }
}

async function keepExistingDirectories(
  directories: readonly string[],
  logger: Logger,
): Promise<string[]> {
  const usable: string[] = [];

  for (const directory of directories) {
    const info = await stat(directory).catch(() => null);
    if (info?.isDirectory() === true) usable.push(directory);
    else logger.warn(`Dossier introuvable, ignoré : ${directory}`);
  }

  return usable;
}

function announce(logger: Logger, config: AutomationConfig, directories: readonly string[]): void {
  logger.info(`Surveillance active — ${directories.join(" | ")}`);
  logger.info(`Sortie : ${config.outputDir}`);

  const traits = [
    config.pageHeader ? "en-tête + pagination" : "sans en-tête",
    config.tableOfContents ? "table des matières" : null,
    config.openAfterConvert ? "ouverture automatique" : null,
    config.allowRemoteImages ? "images distantes AUTORISÉES" : "images distantes bloquées",
  ].filter((trait): trait is string => trait !== null);

  logger.info(`Réglages : ${traits.join(", ")}`);
  logger.info("Ctrl+C pour arrêter.");
}

/** Résout sur SIGINT/SIGTERM afin de libérer proprement le verrou. */
function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolve();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

process.exitCode = await main(process.argv.slice(2));
