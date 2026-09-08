import "./ui/styles.css";
import "./ui/deck.css";
import { initDeckApp } from "./ui/deck.js";
import { initPwa } from "./ui/pwa.js";

initDeckApp();

// La page de présentation appartient à la même application installable ; elle
// ne reçoit en revanche aucun fichier du système, d'où l'API vide.
initPwa({ convertFiles: async () => undefined });
