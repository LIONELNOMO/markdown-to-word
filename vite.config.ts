import { defineConfig } from "vite";

export default defineConfig({
  // Chemins relatifs : le build peut être ouvert depuis n'importe quel dossier
  // (y compris en double-cliquant sur dist/index.html) ou servi sous un sous-chemin.
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    // Le poids vient de `docx` (génération OOXML) et de `remark` (analyse
    // Markdown) : ce sont les deux raisons d'être de l'outil, et tout est chargé
    // localement. Découper ce bundle n'apporterait rien de mesurable ici.
    chunkSizeWarningLimit: 700,
  },
  server: {
    open: true,
  },
});
