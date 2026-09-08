// Installe l'automatisation dans Windows (JScript).
//
//   cscript //NoLogo //E:JScript tools/installer.js
//
// Cree deux raccourcis, sans droits administrateur et sans rien ecrire dans la
// base de registre :
//   1. Menu Demarrer  conversion du presse-papiers, touche Ctrl+Alt+W
//   2. Demarrage      surveillance du dossier des telechargements
//
// Un argument optionnel indique un autre dossier de destination, ce qui permet
// de verifier l'installation sans toucher au menu Demarrer.

var shell = new ActiveXObject("WScript.Shell");
var fso = new ActiveXObject("Scripting.FileSystemObject");

var racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));
var lanceur = fso.BuildPath(fso.BuildPath(racine, "tools"), "lancer.js");
var wscript = fso.BuildPath(
  fso.BuildPath(shell.ExpandEnvironmentStrings("%SystemRoot%"), "System32"),
  "wscript.exe"
);

var destination = WScript.Arguments.Length > 0 ? String(WScript.Arguments(0)) : null;
var dossierMenu = destination !== null ? destination : shell.SpecialFolders("Programs");
var dossierDemarrage = destination !== null ? destination : shell.SpecialFolders("Startup");

var NOM_CLIP = "Markdown vers Word (presse-papiers).lnk";
var NOM_SURVEILLANCE = "Markdown vers Word (surveillance).lnk";

function creerRaccourci(chemin, tache, description, raccourciClavier) {
  var lien = shell.CreateShortcut(chemin);
  // wscript.exe n'a pas de console : c'est lui qui rend le lancement invisible.
  lien.TargetPath = wscript;
  lien.Arguments = '//E:JScript "' + lanceur + '" ' + tache;
  lien.WorkingDirectory = racine;
  lien.Description = description;
  lien.WindowStyle = 7;
  if (raccourciClavier !== null) lien.HotKey = raccourciClavier;
  lien.Save();
  WScript.Echo("  cree : " + chemin);
}

if (!fso.FileExists(lanceur)) {
  WScript.StdErr.WriteLine("Lanceur introuvable : " + lanceur);
  WScript.Quit(1);
}

WScript.Echo("Installation depuis " + racine);

// Le raccourci clavier d'un .lnk n'est actif que depuis le menu Demarrer ou le
// bureau : c'est une contrainte de Windows, pas un choix.
creerRaccourci(
  fso.BuildPath(dossierMenu, NOM_CLIP),
  "clip",
  "Convertit le presse-papiers Markdown en document Word",
  "CTRL+ALT+W"
);

creerRaccourci(
  fso.BuildPath(dossierDemarrage, NOM_SURVEILLANCE),
  "watch",
  "Surveille le dossier des telechargements et convertit les fichiers Markdown",
  null
);

WScript.Echo("");
WScript.Echo("Termine.");
WScript.Echo("  Ctrl+Alt+W             convertit le presse-papiers");
WScript.Echo("  ouverture de session   demarre la surveillance");
WScript.Echo("");
WScript.Echo("Pour demarrer la surveillance sans attendre la prochaine session :");
WScript.Echo("  npm run watch");
WScript.Quit(0);
