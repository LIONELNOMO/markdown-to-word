// Lanceur silencieux (JScript, hote Windows Script Host).
//
// Execute par wscript.exe, il n'ouvre aucune fenetre : c'est ce qui permet a la
// surveillance de tourner en fond et au raccourci clavier d'agir sans rien
// afficher. PowerShell n'est volontairement pas utilise : il est indisponible
// sur le poste cible (arret immediat, code 0xC0000409).
//
// Aucun separateur de chemin n'est ecrit en dur : BuildPath s'en charge.
//
//   wscript //E:JScript lancer.js watch    demarre la surveillance
//   wscript //E:JScript lancer.js clip     convertit le presse-papiers

var shell = new ActiveXObject("WScript.Shell");
var fso = new ActiveXObject("Scripting.FileSystemObject");

var racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));
var tache = WScript.Arguments.Length > 0 ? String(WScript.Arguments(0)) : "watch";

if (tache !== "clip" && tache !== "watch") {
  shell.Popup("T\u00e2che inconnue : " + tache, 10, "Markdown vers Word", 48);
  WScript.Quit(2);
}

var dossierJournal = fso.BuildPath(shell.ExpandEnvironmentStrings("%LOCALAPPDATA%"), "md2docx");
if (!fso.FolderExists(dossierJournal)) fso.CreateFolder(dossierJournal);
var journal = fso.BuildPath(dossierJournal, tache + ".log");

shell.CurrentDirectory = racine;
var commande = 'cmd /c npm run --silent ' + tache + ' -- --log "' + journal + '"';

if (tache === "watch") {
  // Service permanent : on ne l'attend pas. Le verrou d'instance unique se
  // charge d'ecarter un second demarrage.
  shell.Run(commande, 0, false);
} else {
  // Conversion ponctuelle : on attend le resultat pour pouvoir signaler un
  // echec, sans quoi un raccourci clavier sans fenetre resterait muet.
  var code = shell.Run(commande, 0, true);
  if (code !== 0) {
    shell.Popup(
      "La conversion du presse-papiers a \u00e9chou\u00e9.\n\nJournal : " + journal,
      15,
      "Markdown vers Word",
      48
    );
  }
}

WScript.Quit(0);
