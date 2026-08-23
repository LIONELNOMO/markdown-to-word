import type { Definition, FootnoteDefinition } from "mdast";
import type { INumberingOptions } from "docx";
import type { ConversionWarning, ResolvedImage } from "../core/types.js";
import { NUMBERING_REF, bulletLevels, orderedLevels } from "./styles.js";

/**
 * Gère les définitions de numérotation OOXML.
 *
 * Deux besoins distincts :
 *  - chaque liste doit repartir de 1 → on alloue une *instance* par liste ;
 *  - une liste `5.` doit démarrer à 5 → OOXML ne sait pas le faire au niveau de
 *    l'instance, il faut une *définition* dédiée, créée à la demande et mise en
 *    cache par valeur de départ.
 */
export class NumberingRegistry {
  private instanceCounter = 0;
  private readonly startRefs = new Map<number, string>();

  nextInstance(): number {
    return ++this.instanceCounter;
  }

  /** Référence de numérotation ordonnée démarrant à `start`. */
  orderedRef(start: number): string {
    if (start <= 1) return NUMBERING_REF.ordered;

    const cached = this.startRefs.get(start);
    if (cached !== undefined) return cached;

    const reference = `${NUMBERING_REF.ordered}-${start}`;
    this.startRefs.set(start, reference);
    return reference;
  }

  build(): INumberingOptions {
    const config: INumberingOptions["config"][number][] = [
      { reference: NUMBERING_REF.bullet, levels: bulletLevels() },
      { reference: NUMBERING_REF.ordered, levels: orderedLevels() },
    ];

    for (const [start, reference] of this.startRefs) {
      config.push({ reference, levels: orderedLevels(start) });
    }

    return { config };
  }
}

export interface RenderContext {
  /** Images pré-résolues, indexées par URL brute. `null` = échec de chargement. */
  readonly images: ReadonlyMap<string, ResolvedImage | null>;
  /** Définitions de liens de référence (`[texte][id]`), clé normalisée. */
  readonly definitions: ReadonlyMap<string, Definition>;
  /** Notes de bas de page : identifiant Markdown → identifiant OOXML (1..n). */
  readonly footnoteIds: ReadonlyMap<string, number>;
  readonly footnoteDefinitions: ReadonlyMap<string, FootnoteDefinition>;
  readonly numbering: NumberingRegistry;
  readonly maxImageWidthPx: number;
  readonly warnings: ConversionWarning[];
}

export function addWarning(ctx: RenderContext, message: string, line?: number): void {
  // Un même défaut peut apparaître des dizaines de fois (ex. balise HTML
  // répétée) : on ne conserve qu'une occurrence par message pour garder le
  // rapport lisible.
  if (ctx.warnings.some((warning) => warning.message === message)) return;
  ctx.warnings.push(line === undefined ? { message } : { message, line });
}
