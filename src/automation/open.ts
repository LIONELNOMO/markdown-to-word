import { spawn } from "node:child_process";

/**
 * Ouvre un fichier avec l'application qui lui est associée.
 *
 * Le chemin est passé en argument d'un processus, jamais concaténé dans une
 * ligne de commande interprétée par un shell : le nom de fichier est dérivé du
 * titre du document, donc d'un contenu non maîtrisé, et ne doit en aucun cas
 * pouvoir devenir une instruction.
 */
export function openInDefaultApp(filePath: string): void {
  const { command, args } = launcherFor(process.platform, filePath);

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  // Un échec d'ouverture n'a aucune conséquence : le document est déjà écrit.
  child.on("error", () => undefined);
  child.unref();
}

function launcherFor(platform: string, filePath: string): { command: string; args: string[] } {
  switch (platform) {
    // `explorer.exe` délègue à l'application par défaut sans passer par cmd.
    case "win32":
      return { command: "explorer.exe", args: [filePath] };
    case "darwin":
      return { command: "open", args: [filePath] };
    default:
      return { command: "xdg-open", args: [filePath] };
  }
}
