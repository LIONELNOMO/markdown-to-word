// Retire les raccourcis installés par installer.js (JScript).
//
//   cscript //NoLogo //E:JScript tools\desinstaller.js

var shell = new ActiveXObject("WScript.Shell");
var fso = new ActiveXObject("Scripting.FileSystemObject");

var cibles = [
  fso.BuildPath(shell.SpecialFolders("Programs"), "Markdown vers Word (presse-papiers).lnk"),
  fso.BuildPath(shell.SpecialFolders("Startup"), "Markdown vers Word (surveillance).lnk"),
];

var retires = 0;
for (var i = 0; i < cibles.length; i++) {
  if (fso.FileExists(cibles[i])) {
    fso.DeleteFile(cibles[i]);
    WScript.Echo("  retire : " + cibles[i]);
    retires++;
  }
}

WScript.Echo(retires === 0 ? "Aucun raccourci a retirer." : "Termine.");
WScript.Echo("Une surveillance deja lancee continue jusqu'a la fermeture de session.");
WScript.Quit(0);
