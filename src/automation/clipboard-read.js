// JScript exécuté par cscript.exe — lit le presse-papiers texte et l'écrit
// dans le fichier passé en argument, encodé en UTF-16LE.
//
// Pourquoi pas PowerShell : `Get-Clipboard` est la voie évidente, mais
// powershell.exe est indisponible sur certains postes (stratégie, antivirus,
// installation abîmée). cscript et l'objet COM `htmlfile` font partie du socle
// Windows et n'ont pas cette fragilité.
var chemin = WScript.Arguments.Length > 0 ? WScript.Arguments(0) : "";
if (chemin === "") {
  WScript.StdErr.WriteLine("Chemin de sortie manquant.");
  WScript.Quit(2);
}

var texte = "";
try {
  var document = new ActiveXObject("htmlfile");
  var valeur = document.parentWindow.clipboardData.getData("Text");
  texte = valeur === null || valeur === undefined ? "" : String(valeur);
} catch (erreur) {
  WScript.StdErr.WriteLine("Presse-papiers illisible : " + erreur.message);
  WScript.Quit(3);
}

try {
  var fso = new ActiveXObject("Scripting.FileSystemObject");
  // -1 = Unicode (UTF-16LE) : préserve les accents sans dépendre de la page de
  // codes de la console.
  var flux = fso.OpenTextFile(chemin, 2, true, -1);
  flux.Write(texte);
  flux.Close();
} catch (erreur) {
  WScript.StdErr.WriteLine("\u00c9criture impossible : " + erreur.message);
  WScript.Quit(4);
}

WScript.Quit(0);
