const HELP = {
  space: { title:['Zu wenig freier Speicher','Not enough free space'], steps:[['Laufwerk und verfügbaren Platz prüfen.','Check the drive and available space.'],['Platz außerhalb bestehender Sicherungen freigeben oder eine kleinere Reserve einstellen.','Free space outside existing backups or reduce the reserve.'],['Der pausierte Lauf wird bei ausreichendem Platz fortgesetzt.','The paused run resumes when enough space is available.']] },
  authentication: { title:['Zugriff nicht erlaubt','Access denied'], steps:[['Server, Konto und Token-Zuordnung der Quelle prüfen.','Check the source server, account and token assignment.'],['Leserechte für Repository, LFS und gewählte Zusatzdaten prüfen; abgelaufene Tokens erneuern.','Check read permissions for the repository, LFS and selected metadata; renew expired tokens.']] },
  network: { title:['Verbindung unterbrochen','Connection interrupted'], steps:[['Internet, VPN und die Erreichbarkeit des eingetragenen Servers prüfen.','Check Internet, VPN and the configured server.'],['Proxy- und Firewall-Einstellungen kontrollieren und anschließend erneut prüfen.','Check proxy and firewall settings, then retry.']] },
  rate: { title:['API-Limit erreicht','API rate limit reached'], steps:[['Der Lauf pausiert und setzt nach der angezeigten Freigabezeit automatisch fort; erledigte Sicherungen bleiben erhalten.','The run pauses and resumes automatically after the displayed release time; finished backups are kept.'],['Bei öffentlichen Quellen kann ein passendes Lesetoken das API-Limit erhöhen.','A suitable read token can raise the API limit for public sources.']] },
  permissions: { title:['Dateizugriff nicht möglich','File access unavailable'], steps:[['Schreibrechte und den Schreibschutz des Ziellaufwerks prüfen.','Check destination permissions and write protection.'],['Unter macOS die Freigabe für Wechselmedien in den Systemeinstellungen prüfen.','On macOS, check removable-volume permissions in System Settings.']] },
  drive: { title:['Sicherungslaufwerk fehlt','Backup drive unavailable'], steps:[['Das richtige Laufwerk verbinden und Laufwerke wiederfinden ausführen.','Connect the correct drive and use Find drives.'],['Bei kopierten Kennungen den gewünschten Zielordner manuell auswählen.','For duplicate identities, choose the intended destination manually.']] },
  password: { title:['Archiv konnte nicht geöffnet werden','Archive could not be opened'], steps:[['Das zum Archiv gehörende Passwort verwenden; nach einem Wechsel kann ein älteres Passwort nötig sein.','Use the password for this archive; an older password may be needed after a change.'],['Das Original behalten und bei Bedarf eine unabhängige Sicherung prüfen.','Keep the original and check an independent backup if needed.']] },
  integrity: { title:['Sicherung prüfen','Review backup integrity'], steps:[['Die manuelle Integritätsprüfung ausführen.','Run the manual integrity check.'],['Beschädigte Originale behalten und intakte Dateien an einen neuen Ort wiederherstellen.','Keep damaged originals and restore intact files to a new location.']] },
  git: { title:['Git-Komponente prüfen','Check Git components'], steps:[['Git beziehungsweise Git LFS installieren und die App neu starten.','Install Git or Git LFS and restart the app.'],['Für Submodule Arbeitskopie und erreichbare HTTPS-Adressen verwenden.','Use snapshot mode and reachable HTTPS addresses for submodules.']] },
  conflict: { title:['Zielordner wird geschützt','Destination is protected'], steps:[['Einen eindeutigen vorhandenen Zielordner wählen und verschachtelte Sicherungsziele vermeiden.','Choose a unique existing destination and avoid nested backup targets.'],['Fremde Dateien und Verwaltungskennungen nicht ungeprüft löschen.','Keep unrelated files and do not delete management markers without checking.']] },
  unknown: { title:['Prüfung nicht abgeschlossen','Check did not complete'], steps:[['Die Meldung und den Status der Quelle prüfen.','Review the message and source status.'],['Ein anonymisiertes Diagnoseprotokoll für einen Fehlerbericht exportieren.','Export a redacted diagnostic log for an issue report.']] }
};
// Earlier versions stored API-limit responses as "vorübergehend mit HTTP 403", which also matched access errors.
const RATE = /API-Limit|rate limit|HTTP 429|vorübergehend mit HTTP 403/i;
function errorCode(error) {
  const value = String(error?.message ?? error ?? ''), code = error?.code;
  if (error?.rateLimited || RATE.test(value)) return 'rate';
  if (error?.helpCode && Object.hasOwn(HELP,error.helpCode)) return error.helpCode;
  if (code === 'ENOSPC' || /Nicht genug freier Speicher|No space left|disk full/i.test(value)) return 'space';
  if (['EACCES','EPERM','EROFS'].includes(code)) return 'permissions';
  if (/401|403|Token.*(?:ungültig|abgelaufen)|Zugriff.*(?:begrenzt|erlaubt)|Berechtigung|authentication/i.test(value)) return 'authentication';
  if (/429/.test(value)) return 'rate';
  if (/Ziellaufwerk|Laufwerk fehlt|Laufwerk angeschlossen|Kennung.*entfernt/i.test(value)) return 'drive';
  if (/Passwort|Archivkopf|Archivformat|cipher/i.test(value)) return 'password';
  if (/Integrität|SHA256|beschädigt|verändert|Prüfsumme|unvollständig/i.test(value)) return 'integrity';
  if (/nicht installiert|Git LFS|Submodule/i.test(value)) return 'git';
  if (/fremder|fremde|verschachtelt|denselben Ziel|Link blockiert|Reservierte|nicht überschrieben/i.test(value)) return 'conflict';
  if (['ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(code) || /fetch failed|Verbindung|Netzwerk|Zeitlimit|HTTP 5\d\d|TLS/i.test(value)) return 'network';
  return 'unknown';
}
function errorHelp(error) { const code=errorCode(error); return {code,...HELP[code]}; }
module.exports = { errorCode, errorHelp, HELP };
