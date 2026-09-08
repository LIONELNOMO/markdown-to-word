import type { TemplateId, TemplateSpec } from "./types.js";

/**
 * Les deux modèles graphiques.
 *
 * Les polices sont choisies parmi celles réellement installées avec Office :
 * une police absente est remplacée par le lecteur, et toute la mise en page se
 * décale. Calibri et Calibri Light sont présentes sur Windows comme sur macOS
 * dès lors qu'Office l'est ; Georgia est une police système historique,
 * disponible sur les deux.
 */

const AZUR: TemplateSpec = {
  id: "azur",
  name: "Azur",
  description: "Clair et sobre. Filets fins, grandes marges, bleu institutionnel.",
  dark: false,
  palette: {
    background: "FFFFFF",
    surface: "F4F6FA",
    accent: "2F5496",
    accentSoft: "C7D5EE",
    text: "1B2333",
    muted: "5B6472",
    onAccent: "FFFFFF",
  },
  fonts: {
    title: "Calibri Light",
    body: "Calibri",
  },
};

const NOCTURNE: TemplateSpec = {
  id: "nocturne",
  name: "Nocturne",
  description: "Sombre et contrasté. Encarts, accents lumineux, grandes typographies.",
  dark: true,
  palette: {
    background: "0B1220",
    surface: "162034",
    accent: "5B9CFF",
    accentSoft: "2A3F66",
    text: "F1F5FB",
    muted: "93A3BC",
    onAccent: "0B1220",
  },
  fonts: {
    title: "Calibri Light",
    body: "Calibri",
  },
};

export const TEMPLATES: readonly TemplateSpec[] = [AZUR, NOCTURNE];

export function templateById(id: TemplateId): TemplateSpec {
  return TEMPLATES.find((template) => template.id === id) ?? AZUR;
}

export function isTemplateId(value: unknown): value is TemplateId {
  return TEMPLATES.some((template) => template.id === value);
}
