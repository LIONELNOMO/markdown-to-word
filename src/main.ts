import "./ui/styles.css";
import { initApp } from "./ui/app.js";
import { initPwa } from "./ui/pwa.js";

// L'interface est initialisée en premier : l'intégration système lui délègue
// les fichiers reçus, elle doit donc être prête à les traiter.
initPwa(initApp());
