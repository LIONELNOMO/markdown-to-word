import { Packer } from "docx";
import type { ConversionOptions, ConversionWarning } from "../core/types.js";
import { buildDocument } from "../docx/document.js";
import type { DocumentStats } from "../markdown/inspect.js";
import { BrowserImageResolver } from "./image-resolver.js";

export interface BrowserConversionResult {
  readonly blob: Blob;
  readonly fileName: string;
  readonly warnings: readonly ConversionWarning[];
  readonly stats: DocumentStats;
}

/** Résolveur partagé : son cache évite de retélécharger les mêmes illustrations. */
const defaultImageResolver = new BrowserImageResolver();

export async function convertToDocx(
  markdown: string,
  options: Omit<ConversionOptions, "imageResolver"> = {},
): Promise<BrowserConversionResult> {
  const { document, fileName, warnings, stats } = await buildDocument(markdown, {
    ...options,
    imageResolver: defaultImageResolver,
  });

  return { blob: await Packer.toBlob(document), fileName, warnings, stats };
}

