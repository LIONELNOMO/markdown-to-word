import {
  AlignmentType,
  BorderStyle,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  VerticalAlign,
  WidthType,
  type ITableBordersOptions,
} from "docx";
import type { AlignType, Table as MdTable } from "mdast";
import type { RenderContext } from "./context.js";
import { renderInline } from "./inlines.js";
import { PAGE, STYLE_ID, TABLE_BORDER_COLOR, TABLE_HEADER_FILL } from "./styles.js";

const CONTENT_WIDTH_TWIPS = PAGE.width - PAGE.margin * 2;

const BORDERS: ITableBordersOptions = {
  top: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR },
  left: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR },
  right: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER_COLOR },
};

const ALIGNMENTS: Record<Exclude<AlignType, null>, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  right: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
};

export function renderTable(node: MdTable, ctx: RenderContext): Table {
  // Le Markdown autorise des lignes de longueurs inégales : on cadre sur la
  // ligne la plus large et on complète, sinon Word refuse d'ouvrir le fichier.
  const columnCount = Math.max(1, ...node.children.map((row) => row.children.length));
  const columnWidth = Math.floor(CONTENT_WIDTH_TWIPS / columnCount);

  const rows = node.children.map((row, rowIndex) => {
    const isHeader = rowIndex === 0;

    const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
      const cell = row.children[columnIndex];
      const children = cell ? renderInline(cell.children, ctx) : [];

      return new TableCell({
        width: { size: columnWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        ...(isHeader
          ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: TABLE_HEADER_FILL } }
          : {}),
        children: [
          new Paragraph({
            style: isHeader ? STYLE_ID.tableHeader : STYLE_ID.tableCell,
            alignment: alignmentFor(node.align?.[columnIndex]),
            children,
          }),
        ],
      });
    });

    return new TableRow({
      children: cells,
      // Rejoue la ligne d'en-tête en haut de chaque page.
      ...(isHeader ? { tableHeader: true } : {}),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: columnCount }, () => columnWidth),
    borders: BORDERS,
    rows,
  });
}

function alignmentFor(align: AlignType | undefined) {
  return align ? ALIGNMENTS[align] : AlignmentType.LEFT;
}
