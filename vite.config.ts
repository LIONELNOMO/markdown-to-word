import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (nom: string): string => fileURLToPath(new URL(nom, import.meta.url));

export default defineConfig({
  // Chemins relatifs : le build peut être ouvert depuis n'importe quel dossier
  // (y compris en double-cliquant sur dist/index.html) ou servi sous un sous-chemin.
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      // Deux pages indépendantes : convertir en Word, et composer une
      // présentation. Chacune ne charge que son propre code — la page Word
      // n'embarque pas le générateur PowerPoint, et réciproquement.
      input: {
        index: page("index.html"),
        presentation: page("presentation.html"),
      },
    },
    // Le poids vient de `docx` (génération OOXML) et de `remark` (analyse
    // Markdown) : ce sont les deux raisons d'être de l'outil, et tout est chargé
    // localement.
    chunkSizeWarningLimit: 700,
  },
  server: {
    open: true,
  },
});
