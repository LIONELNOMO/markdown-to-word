/**
 * Intégration en tant qu'application installable.
 *
 * Trois apports, indépendants les uns des autres — si le navigateur n'en gère
 * aucun, l'application reste exactement ce qu'elle était :
 *
 *  1. **Hors ligne** : la conversion est entièrement locale, le réseau ne sert
 *     qu'à charger le code. Le mettre en cache est donc cohérent.
 *  2. **Gestionnaire de fichiers** : une fois installée, l'application est
 *     enregistrée auprès du système pour les fichiers `.md`. Un double-clic sur
 *     un Markdown produit le document Word — c'est l'équivalent en ligne le plus
 *     proche d'une surveillance de dossier.
 *  3. **Invitation à installer** maîtrisée, plutôt que celle du navigateur.
 */
import type { AppApi } from "./app.js";

/** Fichiers transmis au lancement par le système. */
interface LaunchParams {
  readonly files: readonly FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** Événement propre à Chromium, absent des définitions standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }
}

export function initPwa(app: AppApi): void {
  registerServiceWorker();
  handleLaunchedFiles(app);
  bindInstallPrompt();
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  // En développement, un service worker servirait l'ancienne version depuis son
  // cache et masquerait les modifications en cours.
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error: unknown) => {
      // L'application reste parfaitement utilisable sans lui.
      console.warn("Service worker non enregistré.", error);
    });
  });
}

/**
 * Reçoit les fichiers avec lesquels le système a lancé l'application.
 *
 * Le consommateur doit être posé au démarrage : le système met le lancement en
 * file d'attente et ne le délivre qu'une fois quelqu'un prêt à le recevoir.
 */
function handleLaunchedFiles(app: AppApi): void {
  const queue = window.launchQueue;
  if (queue === undefined) return;

  queue.setConsumer((params) => {
    void (async () => {
      const files: File[] = [];

      for (const handle of params.files) {
        // Un fichier illisible (déplacé, permission refusée) ne doit pas
        // empêcher la conversion des autres.
        const file = await handle.getFile().catch(() => null);
        if (file !== null) files.push(file);
      }

      if (files.length > 0) await app.convertFiles(files);
    })();
  });
}

function bindInstallPrompt(): void {
  const button = document.getElementById("install-button");
  if (!(button instanceof HTMLButtonElement)) return;

  let invitation: BeforeInstallPromptEvent | null = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    // Sans cela le navigateur affiche sa propre invite, au moment qu'il choisit.
    event.preventDefault();
    invitation = event as BeforeInstallPromptEvent;
    button.hidden = false;
  });

  button.addEventListener("click", () => {
    void (async () => {
      const courante = invitation;
      if (courante === null) return;

      button.disabled = true;
      try {
        await courante.prompt();
        await courante.userChoice;
      } finally {
        // L'invitation n'est utilisable qu'une fois, acceptée ou non.
        invitation = null;
        button.hidden = true;
        button.disabled = false;
      }
    })();
  });

  window.addEventListener("appinstalled", () => {
    invitation = null;
    button.hidden = true;
  });
}
