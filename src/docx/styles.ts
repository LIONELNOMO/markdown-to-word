import {
  AlignmentType,
  BorderStyle,
  LevelFormat,
  ShadingType,
  UnderlineType,
  convertMillimetersToTwip,
  type IBorderOptions,
  type ILevelsOptions,
  type IStylesOptions,
} from "docx";

/*
 * Unités OOXML utilisées ici :
 *  - taille de police : demi-points  (22 = 11 pt)
 *  - espacement/indentation : twips  (1440 = 1 pouce, 720 = 0,5 pouce)
 *  - épaisseur de bordure : huitièmes de point (8 = 1 pt)
 */

export const FONT_BODY = "Calibri";
export const FONT_MONO = "Consolas";

const COLOR_TEXT = "24292F";
const COLOR_MUTED = "57606A";
const COLOR_HEADING_MAIN = "1F3864";
const COLOR_HEADING_SUB = "2F5496";
const COLOR_LINK = "0563C1";
const COLOR_BORDER = "D0D7DE";
const FILL_CODE = "F6F8FA";
const FILL_TABLE_HEADER = "F2F4F7";

/** Page A4, marges 25 mm — standard bureautique francophone. */
export const PAGE = {
  width: convertMillimetersToTwip(210),
  height: convertMillimetersToTwip(297),
  margin: convertMillimetersToTwip(25),
} as const;

/**
 * Largeur utile en pixels @96 dpi (210 - 2×25 = 160 mm ≈ 605 px), arrondie à la
 * baisse : une image plus large déborderait de la zone de texte.
 */
export const CONTENT_WIDTH_PX = 600;

/** Décalage horizontal appliqué par niveau de citation ou de liste. */
export const INDENT_STEP = 360;

/** Identifiants des styles personnalisés, référencés depuis les renderers. */
export const STYLE_ID = {
  codeBlock: "MdCodeBlock",
  quote: "MdQuote",
  inlineCode: "MdInlineCode",
  tableHeader: "MdTableHeader",
  tableCell: "MdTableCell",
} as const;

export const NUMBERING_REF = {
  bullet: "md-bullet",
  ordered: "md-ordered",
} as const;

export const MAX_LIST_LEVEL = 4;

const codeBorder: IBorderOptions = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: COLOR_BORDER,
  space: 4,
};

export const documentStyles: IStylesOptions = {
  default: {
    document: {
      run: { font: FONT_BODY, size: 22, color: COLOR_TEXT },
      paragraph: { spacing: { after: 160, line: 276 } },
    },
    heading1: {
      run: { font: FONT_BODY, size: 32, bold: true, color: COLOR_HEADING_MAIN },
      paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, outlineLevel: 0 },
    },
    heading2: {
      run: { font: FONT_BODY, size: 28, bold: true, color: COLOR_HEADING_SUB },
      paragraph: { spacing: { before: 320, after: 140 }, keepNext: true, outlineLevel: 1 },
    },
    heading3: {
      run: { font: FONT_BODY, size: 25, bold: true, color: COLOR_HEADING_SUB },
      paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 2 },
    },
    heading4: {
      run: { font: FONT_BODY, size: 23, bold: true, color: COLOR_TEXT },
      paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 3 },
    },
    heading5: {
      run: { font: FONT_BODY, size: 22, bold: true, color: COLOR_MUTED },
      paragraph: { spacing: { before: 220, after: 100 }, keepNext: true, outlineLevel: 4 },
    },
    heading6: {
      run: { font: FONT_BODY, size: 22, bold: true, italics: true, color: COLOR_MUTED },
      paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 5 },
    },
    hyperlink: {
      run: { color: COLOR_LINK, underline: { type: UnderlineType.SINGLE } },
    },
  },
  paragraphStyles: [
    {
      id: STYLE_ID.codeBlock,
      name: "Markdown Code Block",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      run: { font: FONT_MONO, size: 19, color: COLOR_TEXT },
      paragraph: {
        spacing: { before: 0, after: 0, line: 240 },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: FILL_CODE },
        indent: { left: INDENT_STEP },
        border: { left: codeBorder },
        keepLines: true,
      },
    },
    {
      id: STYLE_ID.quote,
      name: "Markdown Quote",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      run: { color: COLOR_MUTED },
      paragraph: {
        indent: { left: INDENT_STEP * 2 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: COLOR_BORDER, space: 8 } },
      },
    },
    {
      id: STYLE_ID.tableHeader,
      name: "Markdown Table Header",
      basedOn: "Normal",
      next: "Normal",
      run: { bold: true },
      paragraph: { spacing: { before: 40, after: 40, line: 240 } },
    },
    {
      id: STYLE_ID.tableCell,
      name: "Markdown Table Cell",
      basedOn: "Normal",
      next: "Normal",
      paragraph: { spacing: { before: 40, after: 40, line: 240 } },
    },
  ],
  characterStyles: [
    {
      id: STYLE_ID.inlineCode,
      name: "Markdown Inline Code",
      basedOn: "DefaultParagraphFont",
      quickFormat: true,
      run: {
        font: FONT_MONO,
        size: 19,
        color: "9A3412",
        shading: { type: ShadingType.CLEAR, color: "auto", fill: FILL_CODE },
      },
    },
  ],
};

/** Puces et numérotations, sur 5 niveaux d'imbrication. */
function levelIndent(level: number): ILevelsOptions["style"] {
  return {
    paragraph: {
      indent: { left: INDENT_STEP * 2 * (level + 1), hanging: INDENT_STEP },
      spacing: { before: 0, after: 60 },
    },
  };
}

const BULLET_CHARS = ["•", "◦", "▪", "•", "◦"] as const;
const ORDERED_FORMATS = [
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
  LevelFormat.LOWER_ROMAN,
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
] as const;

export function bulletLevels(): ILevelsOptions[] {
  return BULLET_CHARS.map((char, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: char,
    alignment: AlignmentType.LEFT,
    style: levelIndent(level),
  }));
}

/** `start` permet de respecter une liste ordonnée qui ne commence pas à 1. */
export function orderedLevels(start = 1): ILevelsOptions[] {
  return ORDERED_FORMATS.map((format, level) => ({
    level,
    format,
    text: `%${level + 1}.`,
    alignment: AlignmentType.LEFT,
    start: level === 0 ? start : 1,
    style: levelIndent(level),
  }));
}

export const TABLE_HEADER_FILL = FILL_TABLE_HEADER;
export const TABLE_BORDER_COLOR = COLOR_BORDER;
export const MUTED_COLOR = COLOR_MUTED;
