import type { ConversionOutcome } from "./pipeline.js";
import type { Logger } from "./logger.js";

/**
 * Restitue le résultat d'une conversion.
 *
 * Les avertissements ne sont pas décoratifs : ils signalent ce qui a été perdu
 * (image introuvable, HTML brut ignoré). Les blocages de sécurité sont
 * distingués des simples échecs, parce que la cause et l'action à mener ne sont
 * pas les mêmes.
 */
export function reportOutcome(logger: Logger, outcome: ConversionOutcome, origin: string): void {
  const { stats } = outcome;
  const details = [
    `${stats.headings} titre${plural(stats.headings)}`,
    stats.tables > 0 ? `${stats.tables} tableau${stats.tables > 1 ? "x" : ""}` : null,
    stats.images > 0 ? `${stats.images} image${plural(stats.images)}` : null,
    stats.codeBlocks > 0 ? `${stats.codeBlocks} bloc${plural(stats.codeBlocks)} de code` : null,
  ].filter((part): part is string => part !== null);

  logger.ok(`${origin} → ${outcome.outputPath}  (${details.join(", ")})`);

  for (const warning of outcome.warnings) {
    logger.warn(`  ${warning.message}`);
  }

  if (outcome.blockedImages.length > 0) {
    logger.warn(
      `  ${outcome.blockedImages.length} image${plural(outcome.blockedImages.length)} non intégrée${plural(outcome.blockedImages.length)} par sécurité : ${outcome.blockedImages
        .slice(0, 3)
        .map(shorten)
        .join(", ")}`,
    );
    logger.warn("  (images distantes : relancer avec --allow-remote-images si la source est sûre)");
  }
}

function shorten(url: string): string {
  return url.length <= 60 ? url : `${url.slice(0, 57)}...`;
}

function plural(count: number): string {
  return count > 1 ? "s" : "";
}
