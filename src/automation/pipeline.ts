import { Packer } from "docx";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversionWarning } from "../core/types.js";
import { buildDocument, sanitizeFileName } from "../docx/document.js";
import type { DocumentStats } from "../markdown/inspect.js";
import type { AutomationConfig } from "./config.js";
import { openInDefaultApp } from "./open.js";
import { SandboxedImageResolver, candidateFileName } from "./policy.js";

/** Nombre de suffixes « (n) » tentés avant de se rabattre sur un horodatage. */
const MAX_NAME_ATTEMPTS = 50;

export interface ConversionSource {
  readonly markdown: string;
  /**
   * Dossier de référence des images relatives ; `null` quand la source n'existe
   * pas sur disque (presse-papiers).
   */
  readonly baseDir: string | null;
  /** Nom de repli lorsque le document ne porte aucun titre. */
  readonly fallbackName: string | null;
}

export interface ConversionOutcome {
  readonly outputPath: string;
  readonly warnings: readonly ConversionWarning[];
  /** Images écartées par la politique de sécurité du mode automatique. */
  readonly blockedImages: readonly string[];
  readonly stats: DocumentStats;
}

/**
 * Convertit un contenu Markdown et écrit le .docx dans le dossier de sortie.
 *
 * Le nom de fichier vient du **titre du document**, pas du nom du fichier
 * source : un export de conversation s'appelle souvent `document.md` ou
 * `réponse.md`, alors que son titre de niveau 1 décrit réellement le contenu.
 */
export async function convertToWord(
  source: ConversionSource,
  config: AutomationConfig,
): Promise<ConversionOutcome> {
  const resolver = new SandboxedImageResolver({
    baseDir: source.baseDir,
    allowRemote: config.allowRemoteImages,
  });

  const result = await buildDocument(source.markdown, {
    tableOfContents: config.tableOfContents,
    pageHeader: config.pageHeader,
    imageResolver: resolver,
  });

  const baseName = sanitizeFileName(
    result.metadata.title?.trim() ||
      result.firstHeading?.trim() ||
      source.fallbackName?.trim() ||
      "document",
  );

  const buffer = await Packer.toBuffer(result.document);
  await mkdir(config.outputDir, { recursive: true });
  const outputPath = await writeWithoutOverwriting(config.outputDir, baseName, buffer);

  if (config.openAfterConvert) openInDefaultApp(outputPath);

  return {
    outputPath,
    warnings: result.warnings,
    blockedImages: resolver.blocked,
    stats: result.stats,
  };
}

/**
 * Écrit le document sans jamais écraser un fichier existant.
 *
 * Le drapeau `wx` échoue si la cible existe : le test et l'écriture sont un
 * seul geste, ce qui reste correct même si deux conversions visent le même nom
 * en même temps — contrairement à un « si le fichier existe, alors… ».
 */
async function writeWithoutOverwriting(
  directory: string,
  baseName: string,
  data: Buffer,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const target = join(directory, candidateFileName(baseName, attempt));
    try {
      await writeFile(target, data, { flag: "wx" });
      return target;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  // Cinquante homonymes : on cesse de compter et on horodate.
  const target = join(directory, `${baseName} ${fileStamp()}.docx`);
  await writeFile(target, data);
  return target;
}

function fileStamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    `${pad(now.getHours())}h${pad(now.getMinutes())}m${pad(now.getSeconds())}`,
  ].join("-");
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EEXIST"
  );
}
