#!/usr/bin/env tsx
/**
 * Conversion Markdown → Word en ligne de commande.
 *
 *   npm run convert -- rapport.md
 *   npm run convert -- docs/*.md --out build --toc --header --author "Service Qualité"
 *
 * Réutilise exactement le même cœur que l'interface web : ce qui est validé ici
 * l'est aussi dans le navigateur.
 */
import { Packer } from "docx";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { ConversionError } from "../src/core/types.js";
import { buildDocument } from "../src/docx/document.js";
import { NodeImageResolver } from "../src/node/image-resolver.js";
import { readFile } from "node:fs/promises";

interface CliOptions {
  readonly inputs: string[];
  readonly outDir: string | null;
  readonly tableOfContents: boolean;
  readonly pageHeader: boolean;
  readonly title: string | null;
  readonly author: string | null;
}

const USAGE = `Usage : npm run convert -- <fichier.md...> [options]

Options :
  --out <dossier>     Dossier de sortie (défaut : à côté du fichier source)
  --toc               Insère une table des matières
  --header            Ajoute en-tête (titre) et pied de page (pagination)
  --title <texte>     Force le titre du document
  --author <texte>    Renseigne la propriété « Auteur »
  --help              Affiche cette aide`;

async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${USAGE}`);
    return 2;
  }

  if (options.inputs.length === 0) {
    console.error(USAGE);
    return 2;
  }

  let failures = 0;

  for (const input of options.inputs) {
    try {
      const outputPath = await convertFile(input, options);
      console.log(`✓ ${input} → ${outputPath}`);
    } catch (error) {
      failures += 1;
      const reason = error instanceof ConversionError || error instanceof Error
        ? error.message
        : String(error);
      console.error(`✗ ${input} : ${reason}`);
    }
  }

  return failures === 0 ? 0 : 1;
}

async function convertFile(input: string, options: CliOptions): Promise<string> {
  const inputPath = resolve(input);
  const markdown = await readFile(inputPath, "utf8");

  const { document, fileName, warnings } = await buildDocument(markdown, {
    baseName: basename(inputPath, extname(inputPath)),
    tableOfContents: options.tableOfContents,
    pageHeader: options.pageHeader,
    imageResolver: new NodeImageResolver(dirname(inputPath)),
    metadata: {
      ...(options.title ? { title: options.title } : {}),
      ...(options.author ? { creator: options.author } : {}),
    },
  });

  const targetDir = options.outDir ? resolve(options.outDir) : dirname(inputPath);
  await mkdir(targetDir, { recursive: true });

  const outputPath = join(targetDir, fileName);
  await writeFile(outputPath, await Packer.toBuffer(document));

  for (const warning of warnings) {
    const location = warning.line === undefined ? "" : ` (ligne ${warning.line})`;
    console.warn(`  ⚠ ${warning.message}${location}`);
  }

  return outputPath;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const inputs: string[] = [];
  let outDir: string | null = null;
  let title: string | null = null;
  let author: string | null = null;
  let tableOfContents = false;
  let pageHeader = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      case "--toc":
        tableOfContents = true;
        break;
      case "--header":
        pageHeader = true;
        break;
      case "--out":
        outDir = requireValue(argv, ++index, "--out");
        break;
      case "--title":
        title = requireValue(argv, ++index, "--title");
        break;
      case "--author":
        author = requireValue(argv, ++index, "--author");
        break;
      default:
        if (arg === undefined) break;
        if (arg.startsWith("-")) throw new Error(`Option inconnue : ${arg}`);
        inputs.push(arg);
    }
  }

  return { inputs, outDir, tableOfContents, pageHeader, title, author };
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`L'option ${flag} attend une valeur.`);
  }
  return value;
}

process.exitCode = await main(process.argv.slice(2));
