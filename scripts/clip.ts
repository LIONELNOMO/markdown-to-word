#!/usr/bin/env tsx
/**
 * Conversion du presse-papiers.
 *
 * Destiné à être déclenché par un raccourci clavier : on copie le Markdown dans
 * la conversation (Ctrl+C), on presse le raccourci, le document Word s'ouvre.
 *
 *   npm run clip
 *   npm run clip -- --toc
 */
import { COMMON_OPTIONS, UsageError, parseAutomationArgs, wantsHelp } from "../src/automation/cli.js";
import { readClipboardText } from "../src/automation/clipboard.js";
import type { AutomationConfig } from "../src/automation/config.js";
import { Logger } from "../src/automation/logger.js";
import { convertToWord } from "../src/automation/pipeline.js";
import { reportOutcome } from "../src/automation/report.js";
import { ConversionError } from "../src/core/types.js";

const USAGE = `Convertit le contenu du presse-papiers en document Word.

Usage : npm run clip [-- options]

${COMMON_OPTIONS}`;

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

  try {
    const clipboard = await readClipboardText();

    if (clipboard.trim() === "") {
      logger.warn("Le presse-papiers est vide : copiez d'abord le Markdown (Ctrl+C).");
      await logger.flush();
      return 1;
    }

    const size = Buffer.byteLength(clipboard, "utf8");
    if (size > config.maxFileBytes) {
      const limit = Math.round(config.maxFileBytes / 1024 / 1024);
      logger.error(`Contenu trop volumineux (${(size / 1024 / 1024).toFixed(1)} Mo > ${limit} Mo).`);
      await logger.flush();
      return 1;
    }

    const outcome = await convertToWord(
      {
        markdown: clipboard,
        // Le presse-papiers n'a pas d'emplacement sur disque : aucune image
        // relative n'est résolvable, et aucun accès fichier n'est accordé.
        baseDir: null,
        fallbackName: `Presse-papiers ${stamp()}`,
      },
      config,
    );

    reportOutcome(logger, outcome, "Presse-papiers");
    await logger.flush();
    return 0;
  } catch (error) {
    const reason =
      error instanceof ConversionError || error instanceof Error ? error.message : String(error);
    logger.error("Conversion impossible", reason);
    await logger.flush();
    return 1;
  }
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}h${pad(now.getMinutes())}`;
}

process.exitCode = await main(process.argv.slice(2));
