import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Script JScript compagnon, exécuté par l'hôte de scripts Windows. */
const READER_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "clipboard-read.js");

const TIMEOUT_MS = 15_000;

/**
 * Lit le presse-papiers système sous forme de texte.
 *
 * Sous Windows, `Get-Clipboard` de PowerShell serait la voie évidente ; elle a
 * été écartée après constat : powershell.exe échoue au démarrage sur le poste
 * cible (arrêt immédiat, code 0xC0000409), ce qui rendrait la fonction
 * inutilisable. `cscript.exe` et l'objet COM `htmlfile` appartiennent au socle
 * Windows et n'ont pas cette dépendance.
 *
 * Le texte transite par un fichier UTF-16LE plutôt que par la sortie standard :
 * l'encodage d'une console Windows n'est pas garanti et mutilerait les accents.
 */
export async function readClipboardText(): Promise<string> {
  switch (process.platform) {
    case "win32":
      return readWindowsClipboard();
    case "darwin":
      return capture("pbpaste", [], null);
    default:
      return capture("xclip", ["-selection", "clipboard", "-o"], null);
  }
}

async function readWindowsClipboard(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "md2docx-"));
  const target = join(directory, "presse-papiers.txt");

  try {
    await capture(
      "cscript.exe",
      ["//NoLogo", "//E:JScript", READER_SCRIPT, target],
      "Lecture du presse-papiers impossible. L'hôte de scripts Windows (cscript) est requis.",
    );

    const raw = await readFile(target, "utf16le").catch(() => "");
    return stripBom(raw);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** L'écriture Unicode de Windows précède le texte d'un marqueur d'ordre. */
function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function capture(
  command: string,
  args: readonly string[],
  unavailableMessage: string | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Aucun shell : les arguments sont transmis tels quels au processus.
    const child = spawn(command, [...args], { windowsHide: true, timeout: TIMEOUT_MS });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    child.on("error", () => reject(new Error(unavailableMessage ?? `${command} est introuvable.`)));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} a échoué (code ${String(code)}).`));
    });
  });
}
