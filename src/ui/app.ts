import { convertToDocx, downloadBlob, type BrowserConversionResult } from "../browser/convert.js";
import { ConversionError, type ConversionOptions, type ConversionWarning } from "../core/types.js";

/** Extensions acceptées ; une extension inconnue est probablement une erreur de dépôt. */
const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".txt"];
/** Au-delà, on est presque sûrement face à un fichier qui n'est pas du Markdown. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Bornes la mémoire retenue par les blobs conservés pour re-téléchargement. */
const MAX_RESULTS = 10;

interface Elements {
  readonly dropzone: HTMLButtonElement;
  readonly fileInput: HTMLInputElement;
  readonly markdownInput: HTMLTextAreaElement;
  readonly titleInput: HTMLInputElement;
  readonly authorInput: HTMLInputElement;
  readonly fileNameInput: HTMLInputElement;
  readonly pageHeaderInput: HTMLInputElement;
  readonly tocInput: HTMLInputElement;
  readonly convertButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly results: HTMLElement;
  readonly resultsList: HTMLUListElement;
  readonly warnings: HTMLElement;
  readonly warningsList: HTMLUListElement;
}

export function initApp(): void {
  const el = collectElements();
  let busy = false;

  const setBusy = (value: boolean): void => {
    busy = value;
    el.convertButton.disabled = value;
    el.dropzone.setAttribute("aria-disabled", String(value));
  };

  const setStatus = (message: string, kind: "info" | "error" | "success" = "info"): void => {
    el.status.textContent = message;
    el.status.classList.toggle("is-error", kind === "error");
    el.status.classList.toggle("is-success", kind === "success");
  };

  const readOptions = (): Omit<ConversionOptions, "imageResolver" | "baseName"> => {
    const title = el.titleInput.value.trim();
    const creator = el.authorInput.value.trim();

    return {
      tableOfContents: el.tocInput.checked,
      pageHeader: el.pageHeaderInput.checked,
      metadata: {
        ...(title !== "" ? { title } : {}),
        ...(creator !== "" ? { creator } : {}),
      },
    };
  };

  /**
   * `allowExplicitName` est faux en conversion par lot : appliquer le nom saisi
   * à tous les fichiers les ferait se recouvrir les uns les autres.
   */
  const runConversion = async (
    markdown: string,
    baseName: string | undefined,
    allowExplicitName = true,
  ): Promise<BrowserConversionResult> => {
    const explicit = allowExplicitName ? el.fileNameInput.value.trim() : "";
    return convertToDocx(markdown, {
      ...readOptions(),
      ...(explicit !== "" ? { baseName: explicit } : baseName ? { baseName } : {}),
    });
  };

  const convertPastedMarkdown = async (): Promise<void> => {
    if (busy) return;

    const markdown = el.markdownInput.value;
    if (markdown.trim() === "") {
      setStatus("Déposez un fichier ou collez du Markdown avant de convertir.", "error");
      el.markdownInput.focus();
      return;
    }

    setBusy(true);
    setStatus("Conversion en cours…");

    try {
      const result = await runConversion(markdown, undefined);
      downloadBlob(result.blob, result.fileName);
      addResult(el, result);
      renderWarnings(el, result.warnings);
      setStatus(`${result.fileName} — ${describeStats(result)}`, "success");
    } catch (error) {
      setStatus(toUserMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const convertFiles = async (files: readonly File[]): Promise<void> => {
    if (busy || files.length === 0) return;

    const [accepted, rejected] = partition(files, isMarkdownFile);
    if (accepted.length === 0) {
      setStatus(
        `Aucun fichier Markdown exploitable (${ACCEPTED_EXTENSIONS.join(", ")}, 5 Mo maximum).`,
        "error",
      );
      return;
    }

    // Un fichier unique : on le charge dans l'éditeur pour permettre une
    // relecture ou un ajustement avant conversion.
    const single = accepted.length === 1 ? accepted[0] : undefined;
    if (single) {
      const markdown = await single.text();
      el.markdownInput.value = markdown;
      if (el.fileNameInput.value.trim() === "") {
        el.fileNameInput.value = stripExtension(single.name);
      }
    }

    setBusy(true);
    const warnings: ConversionWarning[] = [];
    let converted = 0;

    try {
      for (const [index, file] of accepted.entries()) {
        setStatus(`Conversion ${index + 1}/${accepted.length} — ${file.name}…`);

        try {
          const result = await runConversion(
            await file.text(),
            stripExtension(file.name),
            single !== undefined,
          );
          addResult(el, result);
          warnings.push(...result.warnings);
          converted += 1;
          // Les navigateurs bloquent les téléchargements automatiques en
          // rafale : en lot, l'utilisateur récupère les fichiers à la demande.
          if (single) downloadBlob(result.blob, result.fileName);
        } catch (error) {
          warnings.push({ message: `${file.name} : ${toUserMessage(error)}` });
        }
      }

      renderWarnings(el, warnings);
      setStatus(summarize(converted, accepted.length, rejected.length), converted > 0 ? "success" : "error");
    } finally {
      setBusy(false);
      // Permet de redéposer le même fichier après modification.
      el.fileInput.value = "";
    }
  };

  el.convertButton.addEventListener("click", () => void convertPastedMarkdown());
  el.dropzone.addEventListener("click", () => {
    if (!busy) el.fileInput.click();
  });
  el.fileInput.addEventListener("change", () => {
    void convertFiles([...(el.fileInput.files ?? [])]);
  });

  bindDragAndDrop(el.dropzone, (files) => void convertFiles(files));
}

function bindDragAndDrop(zone: HTMLElement, onDrop: (files: File[]) => void): void {
  // Sans ces deux écouteurs globaux, un fichier lâché à côté de la zone est
  // ouvert par le navigateur et la page disparaît.
  for (const type of ["dragover", "drop"] as const) {
    window.addEventListener(type, (event) => event.preventDefault());
  }

  zone.addEventListener("dragenter", () => zone.classList.add("is-active"));
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    zone.classList.add("is-active");
  });
  zone.addEventListener("dragleave", (event) => {
    // `dragleave` se déclenche aussi en passant sur un enfant : on ne retire le
    // surlignage que lorsque le curseur quitte réellement la zone.
    if (!zone.contains(event.relatedTarget as Node | null)) zone.classList.remove("is-active");
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("is-active");
    if (zone.getAttribute("aria-disabled") === "true") return;
    onDrop([...(event.dataTransfer?.files ?? [])]);
  });
}

function addResult(el: Elements, result: BrowserConversionResult): void {
  const item = document.createElement("li");

  const label = document.createElement("span");
  const name = document.createElement("span");
  name.className = "result__name";
  name.textContent = result.fileName;

  const meta = document.createElement("span");
  meta.className = "result__meta";
  meta.textContent = `${formatBytes(result.blob.size)} — ${describeStats(result)}`;

  label.append(name, meta);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--link";
  button.textContent = "Télécharger";
  button.addEventListener("click", () => downloadBlob(result.blob, result.fileName));

  item.append(label, button);
  el.resultsList.prepend(item);

  while (el.resultsList.childElementCount > MAX_RESULTS) {
    el.resultsList.lastElementChild?.remove();
  }
  el.results.hidden = false;
}

function renderWarnings(el: Elements, warnings: readonly ConversionWarning[]): void {
  el.warningsList.replaceChildren();
  el.warnings.hidden = warnings.length === 0;

  for (const warning of warnings) {
    const item = document.createElement("li");
    // textContent, jamais innerHTML : ces messages contiennent des fragments du
    // document source, qui n'est pas de confiance.
    item.textContent =
      warning.line === undefined ? warning.message : `Ligne ${warning.line} — ${warning.message}`;
    el.warningsList.append(item);
  }
}

function describeStats({ stats }: BrowserConversionResult): string {
  const parts = [plural(stats.headings, "titre", "titres")];
  if (stats.tables > 0) parts.push(plural(stats.tables, "tableau", "tableaux"));
  if (stats.images > 0) parts.push(plural(stats.images, "image", "images"));
  if (stats.codeBlocks > 0) parts.push(plural(stats.codeBlocks, "bloc de code", "blocs de code"));
  if (stats.footnotes > 0) parts.push(plural(stats.footnotes, "note", "notes"));
  return parts.join(", ");
}

function summarize(converted: number, total: number, rejected: number): string {
  const base =
    converted === total
      ? `${plural(converted, "fichier converti", "fichiers convertis")}.`
      : `${converted}/${total} fichiers convertis.`;
  return rejected > 0 ? `${base} ${plural(rejected, "fichier ignoré", "fichiers ignorés")}.` : base;
}

function plural(count: number, singular: string, many: string): string {
  return `${count} ${count > 1 ? many : singular}`;
}

function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.size <= MAX_FILE_BYTES && ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} Ko`
    : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function partition<T>(items: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const item of items) (predicate(item) ? kept : dropped).push(item);
  return [kept, dropped];
}

function toUserMessage(error: unknown): string {
  if (error instanceof ConversionError) return error.message;
  console.error("Échec de la conversion", error);
  return "La conversion a échoué. Vérifiez le contenu du fichier, puis réessayez.";
}

function collectElements(): Elements {
  return {
    dropzone: requireElement("dropzone", HTMLButtonElement),
    fileInput: requireElement("file-input", HTMLInputElement),
    markdownInput: requireElement("markdown-input", HTMLTextAreaElement),
    titleInput: requireElement("title-input", HTMLInputElement),
    authorInput: requireElement("author-input", HTMLInputElement),
    fileNameInput: requireElement("filename-input", HTMLInputElement),
    pageHeaderInput: requireElement("page-header-input", HTMLInputElement),
    tocInput: requireElement("toc-input", HTMLInputElement),
    convertButton: requireElement("convert-button", HTMLButtonElement),
    status: requireElement("status", HTMLElement),
    results: requireElement("results", HTMLElement),
    resultsList: requireElement("results-list", HTMLUListElement),
    warnings: requireElement("warnings", HTMLElement),
    warningsList: requireElement("warnings-list", HTMLUListElement),
  };
}

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Élément « ${id} » introuvable ou de type inattendu.`);
  }
  return element;
}
