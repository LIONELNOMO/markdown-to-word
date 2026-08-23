import type { DocumentMetadata } from "../core/types.js";

/**
 * Lecture volontairement minimaliste du front matter : uniquement les paires
 * `clé: valeur` de premier niveau.
 *
 * Choix assumé — embarquer un parseur YAML complet (~50 ko) pour lire trois
 * champs de métadonnées serait disproportionné. Les structures imbriquées et les
 * listes sont ignorées silencieusement : elles n'ont pas d'équivalent dans les
 * propriétés d'un document Word.
 */
export function parseFrontmatter(raw: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Commentaires, lignes vides et éléments de liste : hors périmètre.
    if (line === "" || line.startsWith("#") || line.startsWith("-")) continue;
    // Une clé indentée appartient à une structure imbriquée : ignorée.
    if (/^\s/.test(rawLine)) continue;

    const separator = line.indexOf(":");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = unquote(line.slice(separator + 1).trim());
    if (key !== "" && value !== "") entries.set(key, value);
  }

  return entries;
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/** Projette les clés usuelles du front matter sur les propriétés d'un .docx. */
export function metadataFromFrontmatter(entries: Map<string, string>): DocumentMetadata {
  const metadata: DocumentMetadata = {};

  const title = entries.get("title") ?? entries.get("titre");
  const creator = entries.get("author") ?? entries.get("auteur") ?? entries.get("creator");
  const subject = entries.get("subject") ?? entries.get("sujet");
  const description = entries.get("description") ?? entries.get("summary");
  const keywords = entries.get("keywords") ?? entries.get("tags") ?? entries.get("mots-cles");

  if (title !== undefined) metadata.title = title;
  if (creator !== undefined) metadata.creator = creator;
  if (subject !== undefined) metadata.subject = subject;
  if (description !== undefined) metadata.description = description;
  if (keywords !== undefined) metadata.keywords = keywords;

  return metadata;
}
