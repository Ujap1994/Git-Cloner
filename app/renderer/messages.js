// English texts for messages created by the core in German. The window shows them translated when the interface is
// English; error-help texts and the interface itself are bilingual at their source.
(function () {
  const exact = {
    'Ungültige DMG-Variante.': 'Invalid DMG variant.',
    'Die Archivdatei fehlt oder ist unvollständig.': 'The archive file is missing or incomplete.',
    'Das Dateiverzeichnis der Sicherung ist beschädigt.': 'The backup file manifest is damaged.',
    'Die Release-Dateizuordnung ist unvollständig.': 'The release file mapping is incomplete.',
    'Unsicherer Release-Dateipfad.': 'Unsafe release file path.',
    'Eine gesicherte Release-Datei fehlt oder ist unvollständig.': 'A backed-up release file is missing or incomplete.',

    'Das Archivpasswort muss mindestens 12 Zeichen enthalten.':
      'The archive password must contain at least 12 characters.',
    'Der Entschlüsselungsordner existiert bereits.': 'The decryption folder already exists.',
    'Ungültiger Archivkopf.': 'Invalid archive header.',
    'Nicht unterstützte Archivverschlüsselung.': 'Unsupported archive encryption.',
    'Das Archiv ist unvollständig.': 'The archive is incomplete.',
    'Falsches Passwort oder beschädigtes Archiv.': 'Incorrect password or damaged archive.',
    'Autostart ist erst in der installierten App verfügbar.':
      'Start at sign-in is only available in the installed app.',
    'Autostart konnte vom Betriebssystem nicht übernommen werden.':
      'The operating system did not accept the start at sign-in setting.',
    'Eine fremde temporäre Kennung blockiert die Sicherung.': 'A foreign temporary marker blocks the backup.',
    'Ein fremder temporärer Ordner blockiert die Sicherung.': 'A foreign temporary folder blocks the backup.',
    'Die verschlüsselte Sicherung wurde verändert oder beschädigt.': 'The encrypted backup was modified or damaged.',
    'Eine fremde Anbieter-Sicherung wird nicht überschrieben.': 'A backup of another provider is not overwritten.',
    'Das Wiki konnte nicht aktualisiert werden. Die vorhandene Sicherung bleibt erhalten.':
      'The wiki could not be updated. The existing backup is kept.',
    'Archiv beschädigt.': 'Archive damaged.',
    'Commit verändert.': 'Commit modified.',
    'Bitte zuerst das Archivpasswort in den Einstellungen entsperren.':
      'Unlock the archive password in Settings first.',
    'Der neue Stand enthält keinen gültigen Commit.': 'The new state contains no valid commit.',
    'Reservierte temporäre Sicherungspfade überschneiden sich.': 'Reserved temporary backup paths overlap.',
    'Sicherungsordner dürfen nicht ineinander verschachtelt werden.':
      'Backup folders must not be nested inside each other.',
    'Zu viele Sicherungsziele. Bitte Quellen mit Filtern auf höchstens 100000 Ziele begrenzen.':
      'Too many backup targets. Limit sources with filters to at most 100000 targets.',
    'Kein Durchlauf zum Pausieren vorhanden.': 'There is no run to pause.',
    'Bitte zuerst den Durchlauf pausieren.': 'Pause the run first.',
    'Kein pausierter Durchlauf vorhanden.': 'There is no paused run.',
    'Der Passwortwechsel ist noch nicht abgeschlossen. Das Sicherungslaufwerk verbinden und den Assistenten erneut öffnen.':
      'The password change is not complete yet. Connect the backup drive and open the assistant again.',
    'Warte auf die Freigabe des API-Limits. Erledigte Sicherungen bleiben erhalten.':
      'Waiting for the API limit to reset. Completed backups are kept.',
    'Warte auf genügend freien Speicher. Bestehende Sicherungen bleiben erhalten.':
      'Waiting for enough free space. Existing backups are kept.',
    'Die gespeicherte Git-Dateiliste ist ungültig.': 'The saved Git file list is invalid.',
    'Die Datei ist für diese Vorschau zu groß oder wurde verändert.':
      'The file is too large for this preview or was modified.',
    'Die Git-Prüfsumme der Vorschau stimmt nicht.': 'The Git checksum of the preview does not match.',
    'Bitte zuerst die bestehende Änderungsvorschau schließen.': 'Close the existing change preview first.',
    'Das GitHub-Repository enthält noch keinen Commit.': 'The GitHub repository has no commit yet.',
    'Der Git-Server hat keine gültige Dateiliste geliefert.': 'The Git server did not return a valid file list.',
    'Die GitHub-Dateiliste ist für eine vollständige Vorschau zu groß. Die Sicherung kann weiterhin ausgeführt werden.':
      'The GitHub file list is too large for a complete preview. The backup can still run.',
    'Die Änderungsvorschau ist abgelaufen. Bitte erneut öffnen.': 'The change preview has expired. Open it again.',
    'Ungültige Vorschauseite.': 'Invalid preview page.',
    'Diese Datei gehört nicht zur Änderungsvorschau.': 'This file is not part of the change preview.',
    'Die GitHub-Datei kann nicht als Textvorschau geladen werden.':
      'The GitHub file cannot be loaded as a text preview.',
    'Für große Dateien und Submodule wird nur die Dateiliste angezeigt.':
      'Large files and submodules show the file list only.',
    'Für Binär- und LFS-Dateien wird keine Textvorschau angezeigt.': 'Binary and LFS files have no text preview.',
    'Zu viele Textänderungen für eine schnelle Vorschau.': 'Too many text changes for a quick preview.',
    'Bitte eine GitHub-Quelle angeben.': 'Enter a GitHub source.',
    'Ungültiger GitHub-Name.': 'Invalid GitHub name.',
    'Ungültiger Quellentyp.': 'Invalid source type.',
    'Ungültige oder doppelte Quellen-ID.': 'Invalid or duplicate source ID.',
    'Ungültiger Favoritenstatus.': 'Invalid favorite status.',
    'Die zugewiesene Quellengruppe fehlt.': 'The assigned source group is missing.',
    'Diese Quelle ist bereits eingetragen.': 'This source has already been added.',
    'Bitte einen absoluten Zielordner auswählen.': 'Choose an absolute destination folder.',
    'Ungültiger Quellenstatus.': 'Invalid source status.',
    'Ungültige Laufwerkskennung.': 'Invalid drive identity.',
    'Ungültiges GitHub-Konto.': 'Invalid GitHub account.',
    'Ungültige Benachrichtigungsregel.': 'Invalid notification rule.',
    'Beginn und Ende der Ruhezeit müssen verschieden sein.': 'Quiet hours must start and end at different times.',
    'Ungültige Einstellung für Programm-Updates.': 'Invalid setting for program updates.',
    'Ungültiges oder doppeltes Konto.': 'Invalid or duplicate account.',
    'Ungültiger Git-Benutzername.': 'Invalid Git user name.',
    'Für Forgejo-Zugangsdaten den eigenen Benutzernamen angeben.': 'Enter your own user name for Forgejo credentials.',
    'Ein zugewiesenes GitHub-Konto fehlt.': 'An assigned GitHub account is missing.',
    'Zugangsdaten und Quelle müssen denselben Anbieter und Server verwenden.':
      'Credentials and source must use the same provider and server.',
    'Ungültige Darstellung.': 'Invalid appearance.',
    'Ungültige Leistungs- oder Netzwerkeinstellung.': 'Invalid performance or network setting.',
    'Ungültige Netzwerkregel.': 'Invalid network rule.',
    'Ungültiges Zeitfenster für die Bandbreite.': 'Invalid bandwidth time window.',
    'Ungültige Einstellung für pausierte Sicherungen.': 'Invalid setting for paused backups.',
    'Ungültiger Einrichtungsstatus.': 'Invalid setup status.',
    'Ungültige Zeitplanoption.': 'Invalid schedule option.',
    'Ungültige Laufwerksoption.': 'Invalid drive option.',
    'Ungültige OAuth-Client-ID.': 'Invalid OAuth client ID.',
    'Ungültige oder doppelte Quellengruppe.': 'Invalid or duplicate source group.',
    'Gruppennamen müssen eindeutig sein und 1 bis 60 Zeichen enthalten.':
      'Group names must be unique and contain 1 to 60 characters.',
    'Ungültiger Sicherungsmodus.': 'Invalid backup mode.',
    'Ungültige Auswahl für Release-Dateien.': 'Invalid selection for release assets.',
    'Ungültige Sicherungsoption.': 'Invalid backup option.',
    'Submodule benötigen den Modus Arbeitskopie.': 'Submodules require working copy mode.',
    'Speicherreserve muss zwischen 64 und 1048576 MB liegen.': 'The storage reserve must be between 64 and 1048576 MB.',
    'Ungültige Metadatenoption.': 'Invalid metadata option.',
    'Ungültiges zusätzliches Sicherungsziel.': 'Invalid additional backup target.',
    'Ungültiger Laufwerkspfad.': 'Invalid drive path.',
    'Laufwerkskennung und Zielordner passen nicht zusammen.': 'Drive identity and destination folder do not match.',
    'Bitte 1 bis 24 Prüfungen pro Tag auswählen.': 'Choose 1 to 24 checks per day.',
    'Für jede Prüfung eine eigene, gültige Uhrzeit eintragen.': 'Enter a separate, valid time for every check.',
    'Ungültiger Repository-Filter.': 'Invalid repository filter.',
    'Filter erlauben Namen und die Platzhalter * und ?.': 'Filters allow names and the wildcards * and ?.',
    'Der Zielordner muss ein vorhandener Ordner sein und darf kein symbolischer Link sein.':
      'The destination must be an existing folder and must not be a symbolic link.',
    'Das ausgewählte Laufwerk fehlt oder seine Kennung wurde entfernt. Zielordner bitte erneut auswählen.':
      'The selected drive is missing or its identity was removed. Choose the destination folder again.',
    'Ungültige Laufwerkskennung im Zielordner.': 'Invalid drive identity in the destination folder.',
    'An diesem Pfad ist ein anderes Laufwerk angeschlossen.': 'A different drive is connected at this path.',
    'Nicht genug freier Speicher für den neuen Stand und die eingestellte Reserve.':
      'Not enough free space for the new state and the configured reserve.',
    'Für die Geräteanmeldung ist die Client-ID einer GitHub-OAuth-App erforderlich.':
      'Device sign-in requires the client ID of a GitHub OAuth app.',
    'Eine Anmeldung läuft bereits.': 'A sign-in is already in progress.',
    'Ungültige Geräteanmeldung von GitHub.': 'Invalid device sign-in from GitHub.',
    'Die Anmeldung wurde auf GitHub abgelehnt.': 'The sign-in was declined on GitHub.',
    'Die GitHub-Anmeldung konnte nicht abgeschlossen werden.': 'The GitHub sign-in could not be completed.',
    'Der Anmeldecode ist abgelaufen.': 'The sign-in code has expired.',
    'Ungültiger Download-Verlaufseintrag.': 'Invalid download history entry.',
    'Der Download-Verlauf ist beschädigt.': 'The download history is damaged.',
    'Ungültiger Download-Verlauf.': 'Invalid download history.',
    'Ungültiger Download-Verlaufsfilter.': 'Invalid download history filter.',
    'Eine fremde oder ungültige Download-Kennung bleibt erhalten.': 'A foreign or invalid download marker is kept.',
    'Sicherungslaufwerk nicht erreichbar oder Kennung geändert.': 'Backup drive unavailable or identity changed.',
    'Ungültiger Download-Eintrag.': 'Invalid download entry.',
    'Ungültiger Teildownload bleibt erhalten.': 'An invalid partial download is kept.',
    'Ungültige Dateiliste.': 'Invalid file list.',
    'Eine fremde Download-Datei bleibt erhalten.': 'A foreign download file is kept.',
    'Die Dateiliste ist unvollständig.': 'The file list is incomplete.',
    'Die Downloads wurden inzwischen geändert. Bitte die Vorschau erneuern.':
      'The downloads have changed in the meantime. Refresh the preview.',
    'Git ist nicht installiert oder nicht im PATH. Bitte Git installieren und die App neu starten.':
      'Git is not installed or not in PATH. Install Git and restart the app.',
    'Das Repository hat noch keinen Standardbranch.': 'The repository has no default branch yet.',
    'Git LFS ist nicht installiert. Bitte Git LFS installieren oder die LFS-Option deaktivieren.':
      'Git LFS is not installed. Install Git LFS or turn off the LFS option.',
    'Ungültiger GitHub-Endpunkt.': 'Invalid GitHub endpoint.',
    'GitHub-Zugriff begrenzt. Token/Berechtigungen prüfen oder später erneut versuchen.':
      'GitHub access is limited. Check the token and permissions or try again later.',
    'GitHub-Token ist ungültig oder abgelaufen.': 'The GitHub token is invalid or has expired.',
    'GitHub-Quelle nicht gefunden oder keine Zugriffsberechtigung.': 'GitHub source not found or no access permission.',
    'Ungültige Repository-Seite von GitHub.': 'Invalid repository page from GitHub.',
    'Ungültige Repository-Liste von GitHub.': 'Invalid repository list from GitHub.',
    'Zu viele Repositories für einen einzelnen Durchlauf.': 'Too many repositories for a single run.',
    'Ungültige GitHub-Liste.': 'Invalid GitHub list.',
    'Zu viele Metadaten für einen Durchlauf.': 'Too much metadata for one run.',
    'Ungültige Asset-Weiterleitung.': 'Invalid asset redirect.',
    'Ungültiges Release-Asset.': 'Invalid release asset.',
    'Ungültige Größe einer Release-Datei.': 'Invalid size of a release asset.',
    'Release-Datei konnte nicht geladen werden.': 'The release asset could not be downloaded.',
    'Release-Datei ist größer als von GitHub angegeben.': 'The release asset is larger than GitHub reported.',
    'Release-Datei ist unvollständig.': 'The release asset is incomplete.',
    'Die SHA256-Prüfsumme der Release-Datei stimmt nicht.': 'The SHA256 checksum of the release asset does not match.',
    'Ungültiger Verlaufsfilter.': 'Invalid history filter.',
    'Ungültiger Zeitraum.': 'Invalid period.',
    'Der Beginn muss vor dem Ende liegen.': 'The start must be before the end.',
    'Ungültige Verlaufsauswahl.': 'Invalid history selection.',
    'Ungültige Verlaufsseite.': 'Invalid history page.',
    'Der Lauf ist nicht mehr im gespeicherten Verlauf.': 'The run is no longer in the saved history.',
    'Ungültiger API-Endpunkt.': 'Invalid API endpoint.',
    'Ungültige Repository- oder Metadatenliste.': 'Invalid repository or metadata list.',
    'Die API-Dateiliste ist zu umfangreich.': 'The API file list is too large.',
    'Zu viele API-Seiten für einen Durchlauf.': 'Too many API pages for one run.',
    'GitLab-Gruppe nicht gefunden oder keine Zugriffsberechtigung.': 'GitLab group not found or no access permission.',
    'GitLab-Konto nicht gefunden.': 'GitLab account not found.',
    'Der Git-Server liefert keine gültige Konto-ID.': 'The Git server returns no valid account ID.',
    'Ungültige Repository-Seite.': 'Invalid repository page.',
    'Ungültige Git-Dateiliste.': 'Invalid Git file list.',
    'Der Git-Server liefert keine eindeutigen Dateiseiten.': 'The Git server returns no unique file pages.',
    'Die Git-Dateiliste ist unvollständig.': 'The Git file list is incomplete.',
    'Die Dateigröße konnte nicht sicher ermittelt werden.': 'The file size could not be determined safely.',
    'Die API liefert keine sichere Dateigröße.': 'The API returns no safe file size.',
    'Ungültige Release-Adresse.': 'Invalid release address.',
    'Release-Dateien benötigen eine HTTPS-Adresse ohne Zugangsdaten.':
      'Release assets require an HTTPS address without credentials.',
    'Lokale externe Release-Adressen sind nicht erlaubt.': 'Local external release addresses are not allowed.',
    'Eine externe Release-Adresse verweist auf ein lokales Netzwerk.':
      'An external release address points to a local network.',
    'Ungültige Release-Dateigröße.': 'Invalid release asset size.',
    'Der Server liefert eine HTML-Anmeldeseite statt der Release-Datei. Token und Download-Berechtigungen prüfen.':
      'The server returns an HTML sign-in page instead of the release asset. Check the token and download permissions.',
    'Release-Datei ist größer als angegeben.': 'The release asset is larger than reported.',
    'Ungültige Merge-/Pull-Request-Nummer.': 'Invalid merge or pull request number.',
    'Wiki nicht vorhanden oder nicht zugänglich.': 'Wiki missing or not accessible.',
    'Nicht unterstützter Dateityp in der Sicherung.': 'Unsupported file type in the backup.',
    'Die Integritätsprüfung hat fehlende oder veränderte Dateien erkannt.':
      'Integrity verification detected missing or modified files.',
    'Ungültiger Passwortwechsel-Zustand.': 'Invalid password change state.',
    'Ein fremdes temporäres Archiv blockiert den Passwortwechsel.':
      'A foreign temporary archive blocks the password change.',
    'Der Passwortwechsel benötigt eine manuelle Prüfung. Es wird kein Archiv überschrieben.':
      'The password change needs a manual check. No archive is overwritten.',
    'Ein fremdes temporäres Archiv bleibt erhalten.': 'A foreign temporary archive is kept.',
    'Ungültige Archivseite.': 'Invalid archive page.',
    'Sicherungsformat wurde verändert.': 'The backup format was modified.',
    'Bitte 1 bis 1000 Archive auswählen.': 'Choose 1 to 1000 archives.',
    'Verschlüsselte Sicherung nicht gefunden.': 'Encrypted backup not found.',
    'Eine Sicherung läuft bereits in einem anderen Prozess.': 'A backup is already running in another process.',
    'Ungültiger Programmpfad für die System-Zeitplanung.': 'Invalid program path for system scheduling.',
    'Ungültige System-Prüfzeiten.': 'Invalid system check times.',
    'Die unabhängige Zeitplanung benötigt eine installierte native App.':
      'Independent scheduling requires an installed native application.',
    'Die System-Zeitplanung konnte nicht aktiviert werden. Benutzeranmeldung und Systemdienst prüfen.':
      'System scheduling could not be enabled. Check the user sign-in and the system service.',
    'Kein Ordner.': 'Not a folder.',
    'Nicht unterstützter Windows-Dateiname.': 'Unsupported Windows file name.',
    'Das Programmarchiv enthält zu viele Dateien.': 'The program archive contains too many files.',
    'Das Programmarchiv ist zu groß oder verschlüsselt.': 'The program archive is too large or encrypted.',
    'Nicht unterstützter Dateityp im Programmarchiv.': 'Unsupported file type in the program archive.',
    'Programmarchive mit Links werden unter Windows nicht installiert.':
      'Program archives with links are not installed on Windows.',
    'Ungültiger Programm-Link.': 'Invalid program link.',
    'Die ZIP-Prüfsumme stimmt nicht.': 'The ZIP checksum does not match.',
    'Ein Programm-Link verlässt das Archiv.': 'A program link leaves the archive.',
    'Das Programm enthält zu viele Dateien.': 'The program contains too many files.',
    'Ein Link verlässt den Programmordner.': 'A link leaves the program folder.',
    'Ungültiger Programmdateityp.': 'Invalid program file type.',
    'Mehr als 100 Programme im Archiv. Bitte eine kleinere Release-Datei auswählen.':
      'More than 100 programs in the archive. Choose a smaller release asset.',
    'Die Release-Datei besitzt kein passendes Programmformat.': 'The release asset has no matching program format.',
    'Das AppImage passt nicht zur Prozessorarchitektur.': 'The AppImage does not match the processor architecture.',
    'Ungültiger Windows-Programmkopf.': 'Invalid Windows program header.',
    'Das Windows-Programm passt nicht zur Prozessorarchitektur.':
      'The Windows program does not match the processor architecture.',
    'Ungültiges macOS-Programmbundle.': 'Invalid macOS app bundle.',
    'Das macOS-Programm enthält keine gültige ausführbare Datei.': 'The macOS app contains no valid executable.',
    'Das macOS-Programm passt nicht zur Prozessorarchitektur.':
      'The macOS app does not match the processor architecture.',
    'Das DMG enthält kein lesbares Laufwerk.': 'The DMG contains no readable volume.',
    'Kein unterstütztes Programm im Archiv gefunden.': 'No supported program found in the archive.',
    'Die Programmauswahl passt nicht zum Release. Bitte die Programme aus der Sicherung erneut auswählen.':
      'The program selection does not match the release. Select the programs from the backup again.',
    'Ein fremder Programmordner bleibt erhalten.': 'A foreign program folder is kept.',
    'Eine fremde Installation wird nicht ersetzt.': 'A foreign installation is not replaced.',
    'Zusätzliche Dateien im Programmordner bleiben erhalten. Bitte getrennt ablegen.':
      'Additional files in the program folder are kept. Store them separately.',
    'Ein fremder Programmpfad bleibt erhalten.': 'A foreign program path is kept.',
    'Das Programm läuft noch. Es wird installiert, sobald es beendet ist.':
      'The program is still running. It is installed as soon as it quits.',
    'Die Programminstallation ist für diese Quelle ausgeschaltet.':
      'Program installation is turned off for this source.',
    'Es ist keine vorherige Programmversion vorhanden.': 'There is no previous program version.',
    'Eine unterbrochene Installation muss zuerst abgeschlossen werden.':
      'An interrupted installation must be completed first.',
    'Keine gesicherte Release-Datei für die Programminstallation vorhanden.':
      'No backed-up release asset is available for program installation.',
    'Die Release-Dateizuordnung ist beschädigt.': 'The release asset mapping is damaged.',
    'Die Programmdatei hat ihre Integritätsprüfung nicht bestanden.': 'The program file failed its integrity check.',
    'Programmziel und Sicherungsordner müssen auch nach Auflösen von Links getrennt liegen.':
      'Program destination and backup folder must stay separate, also after resolving links.',
    'Eine fremde temporäre Programmkennung bleibt erhalten.': 'A foreign temporary program marker is kept.',
    'Ein fremder Installationspfad bleibt erhalten.': 'A foreign installation path is kept.',
    'Ein fremder temporärer Programmordner bleibt erhalten.': 'A foreign temporary program folder is kept.',
    'Ungültiger gespeicherter Programmpfad.': 'Invalid saved program path.',
    'Ungültige Programminstallation.': 'Invalid program installation.',
    'Ungültige Programmauswahl.': 'Invalid program selection.',
    'Bitte einen absoluten Ordner für Programmverknüpfungen wählen.':
      'Choose an absolute folder for program shortcuts.',
    'Bitte einen absoluten Programm-Zielordner wählen.': 'Choose an absolute program destination folder.',
    'Automatische Installation ist nur für einzelne Repositories möglich.':
      'Automatic installation is only possible for single repositories.',
    'Für die Programminstallation müssen Release-Dateien gesichert werden.':
      'Program installation requires backing up release assets.',
    'Programmziel und Sicherungsordner müssen getrennt liegen.':
      'Program destination and backup folder must be separate.',
    'Kein installierbares Programm für dieses System gefunden. Unterstützt: macOS DMG/App-ZIP, Windows Portable-EXE/ZIP, Linux AppImage.':
      'No installable program found for this system. Supported: macOS DMG/app ZIP, Windows portable EXE/ZIP, Linux AppImage.',
    'Mehrere Programme passen. Bitte den Release-Dateinamen in der Quelle genauer eingrenzen.':
      'Several programs match. Narrow the release file name in the source.',
    'Der Verknüpfungspfad enthält nicht unterstützte Steuerzeichen.':
      'The shortcut path contains unsupported control characters.',
    'Eine fremde Programmverknüpfung bleibt erhalten.': 'A foreign program shortcut is kept.',
    'Windows-Verknüpfungen benötigen die native Electron-Anwendung.':
      'Windows shortcuts require the native Electron application.',
    'Windows konnte die Programmverknüpfung nicht erstellen.': 'Windows could not create the program shortcut.',
    'Verknüpfungen bitte außerhalb der Sicherungs- und Programmablage speichern.':
      'Store shortcuts outside the backup and program folders.',
    'Ein fremder Verknüpfungsordner bleibt erhalten.': 'A foreign shortcut folder is kept.',
    'Unbekannte Verknüpfungszuordnung.': 'Unknown shortcut assignment.',
    'Ungültige vorbereitete Verknüpfung.': 'Invalid prepared shortcut.',
    'Eine veränderte Verknüpfung bleibt erhalten.': 'A modified shortcut is kept.',
    'Eine vom Benutzer geänderte Verknüpfung bleibt erhalten.': 'A shortcut changed by the user is kept.',
    'Eine fremde Programmverknüpfung wird nicht ersetzt.': 'A foreign program shortcut is not replaced.',
    'Die Programmverknüpfung konnte nicht erstellt werden.': 'The program shortcut could not be created.',
    'Ungültiger Programmpfad für die Verknüpfung.': 'Invalid program path for the shortcut.',
    'Die Serveradresse ist zu lang.': 'The server address is too long.',
    'Ungültiger Serverpfad.': 'Invalid server path.',
    'Bitte eine vollständige HTTPS-Serveradresse angeben.': 'Enter a complete HTTPS server address.',
    'Der Git-Server benötigt HTTPS ohne Zugangsdaten, Abfrage oder Fragment.':
      'The Git server requires HTTPS without credentials, query or fragment.',
    'Bitte eine Git-Quelle angeben.': 'Enter a Git source.',
    'Ungültige Repository-Adresse.': 'Invalid repository address.',
    'Die Quelle muss zum ausgewählten HTTPS-Server gehören.': 'The source must belong to the selected HTTPS server.',
    'Ungültiger Konto-, Gruppen- oder Repository-Pfad.': 'Invalid account, group or repository path.',
    'Das Repository gehört nicht zu dieser Quelle.': 'The repository does not belong to this source.',
    'Der Git-Server liefert keine gültige Dateiliste.': 'The Git server returns no valid file list.',
    'Die Attributdatei ist zu groß.': 'The attributes file is too large.',
    'Die Git-Prüfsumme der Attributdatei stimmt nicht.': 'The Git checksum of the attributes file does not match.',
    'Ungültige Release-Dateiliste.': 'Invalid release asset list.',
    'Ungültige Release-Datei.': 'Invalid release asset.',
    'Ungültiger Architektur- oder Dateitypfilter.': 'Invalid architecture or file type filter.',
    'Eine fremde Datei oder ein Link blockiert den Teildownload.':
      'A foreign file or link blocks the partial download.',
    'Ein fremder Ordner oder Link blockiert den Teildownload-Cache.':
      'A foreign folder or link blocks the partial download cache.',
    'Ein fremder Ordner blockiert den Teildownload-Cache.': 'A foreign folder blocks the partial download cache.',
    'Das Sicherungslaufwerk für den Teildownload fehlt oder wurde ausgetauscht.':
      'The backup drive for the partial download is missing or was replaced.',
    'Der Teildownload ist zu umfangreich.': 'The partial download is too large.',
    'Die Kennung eines Teildownloads ist beschädigt.': 'The marker of a partial download is damaged.',
    'Eine Teildownload-Datei ist zu groß.': 'A partial download file is too large.',
    'Eine fremde Datei blockiert den Teildownload.': 'A foreign file blocks the partial download.',
    'Ein gespeicherter Teildownload wurde verändert oder beschädigt.':
      'A saved partial download was modified or damaged.',
    'Der verschlüsselte Teildownload kann mit diesem Archivpasswort nicht authentifiziert werden.':
      'The encrypted partial download cannot be authenticated with this archive password.',
    'Ein gespeicherter Teildownload ist unvollständig.': 'A saved partial download is incomplete.',
    'Ein Teildownload ist unvollständig.': 'A partial download is incomplete.',
    'Eine fremde Datei im Teildownload-Cache wird nicht gelöscht.':
      'A foreign file in the partial download cache is not deleted.',
    'Der Server liefert eine HTML-Anmeldeseite statt der Release-Datei.':
      'The server returns an HTML sign-in page instead of the release asset.',
    'Komprimierte HTTP-Teilantworten können nicht sicher zusammengesetzt werden.':
      'Compressed partial HTTP responses cannot be combined safely.',
    'Die Fortsetzungsantwort des Servers passt nicht zum Teildownload.':
      "The server's resume response does not match the partial download.",
    'Unerwartete Antwort für den Release-Download.': 'Unexpected response for the release download.',
    'Die Dateigröße der Serverantwort stimmt nicht.': 'The file size of the server response does not match.',
    'Zu viele Teilantworten für einen Release-Download.': 'Too many partial responses for one release download.',
    'Ein fremder Teildownload-Ordner wird nicht entfernt.': 'A foreign partial download folder is not removed.',
    'Die Teildownload-Kennung ist zu umfangreich.': 'The partial download marker is too large.',
    'Eine fremde Teildownload-Kennung wird nicht entfernt.': 'A foreign partial download marker is not removed.',
    'Ungültige Teildownload-Kennung.': 'Invalid partial download marker.',
    'Eine fremde Teildownload-Datei wird nicht entfernt.': 'A foreign partial download file is not removed.',
    'Kein freier Ordner für Release-Dateien vorhanden.': 'No free folder for release assets available.',
    'Die Laufwerkszuordnung würde zwei Sicherungen zusammenführen. Bitte den Speicherort manuell auswählen.':
      'The drive assignment would merge two backups. Choose the location manually.',
    'Die gespeicherte Laufwerkszuordnung ist ungültig.': 'The saved drive assignment is invalid.',
    'Bitte einen gültigen neuen Ordnernamen eingeben.': 'Enter a valid new folder name.',
    'Der Zielordner existiert bereits. Es werden keine Dateien überschrieben.':
      'The destination already exists. No files will be overwritten.',
    'Das Archiv muss eine reguläre Datei sein.': 'The archive must be a regular file.',
    'Das Archiv enthält keine Git-Cloner-Sicherung.': 'The archive contains no Git Cloner backup.',
    'Bitte eine Sicherung oder ein Archiv auswählen.': 'Choose a backup or an archive.',
    'Der Zielordner wurde inzwischen angelegt.': 'The destination folder has been created in the meantime.',
    'Der sichere Schlüsselspeicher ist nicht verfügbar. GitHub-Token kann nicht entschlüsselt werden.':
      'The secure key store is unavailable. The GitHub token cannot be decrypted.',
    'Ungültiges GitHub-Token.': 'Invalid GitHub token.',
    'Kein sicherer Schlüsselspeicher verfügbar. Unter Linux bitte einen Secret-Service/Keyring aktivieren.':
      'No secure key store is available. On Linux, enable a Secret Service or keyring.',
    'Ungültiger Auswahlpfad.': 'Invalid selection path.',
    'Dieser Dateiname wird von Windows nicht unterstützt. Bitte die vollständige Mirror-Sicherung verwenden.':
      'Windows does not support this file name. Use the complete mirror backup.',
    'Ein Link blockiert den Auswahlpfad.': 'A link blocks the selection path.',
    'Git-Dateiliste konnte nicht gelesen werden.': 'The Git file list could not be read.',
    'Zu viele Dateien für die Dateiauswahl. Bitte die vollständige Sicherung wiederherstellen.':
      'Too many files for file selection. Restore the complete backup.',
    'Git-Datei konnte nicht exportiert werden.': 'The Git file could not be exported.',
    'Die exportierte Git-Datei ist beschädigt.': 'The exported Git file is damaged.',
    'Bitte zuerst die bisherige Dateiauswahl schließen.': 'Close the previous file selection first.',
    'Ungültiger Wiederherstellungsumfang.': 'Invalid restore scope.',
    'Das Archiv ist beschädigt.': 'The archive is damaged.',
    'Bitte eine Sicherung auswählen.': 'Choose a backup.',
    'Das Dateimanifest ist beschädigt.': 'The file manifest is damaged.',
    'Diese ältere Sicherung hat kein Dateimanifest. Bitte zunächst vollständig wiederherstellen.':
      'This older backup has no file manifest. Restore it completely first.',
    'Diese Sicherung enthält keine Release-Dateien.': 'This backup contains no release assets.',
    'Die Dateiauswahl ist abgelaufen. Bitte erneut öffnen.': 'The file selection has expired. Open it again.',
    'Die Auswahl wird gerade wiederhergestellt.': 'The selection is being restored.',
    'Ungültige Seite.': 'Invalid page.',
    'Bitte 1 bis 1000 Dateien oder Ordner auswählen.': 'Choose 1 to 1000 files or folders.',
    'Die Auswahl enthält unbekannte Dateien.': 'The selection contains unknown files.',
    'Die Sicherung wurde seit der Dateiauswahl verändert.': 'The backup has changed since the file selection.',
    'LFS-Inhalt fehlt oder ist beschädigt.': 'LFS content is missing or damaged.',
    'Die Quelldatei wurde verändert.': 'The source file was modified.',
    'Die Integritätsprüfung hat eine veränderte ausgewählte Datei erkannt.':
      'Integrity verification detected a modified selected file.',
    'Bitte 1 bis 100 unterschiedliche Quellen auswählen.': 'Choose 1 to 100 different sources.',
    'Eine ausgewählte Quelle wurde inzwischen entfernt.': 'A selected source has been removed in the meantime.',
    'Ungültige Organisation der Quellen.': 'Invalid organization of sources.',
    'Ungültige Quellengruppe.': 'Invalid source group.',
    'Quellengruppe nicht gefunden.': 'Source group not found.',
    'Bitte eine Änderung auswählen.': 'Choose a change.',
    'Ungültige gemeinsame Quellenänderung.': 'Invalid shared source change.',
    'Ungültige gemeinsame Sicherungsoptionen.': 'Invalid shared backup options.',
    'Ungültige gemeinsame Filter.': 'Invalid shared filters.',
    'Zugangsdaten und Anbieter passen nicht zusammen.': 'Credentials and provider do not match.',
    'Die Repository-Auswahl ist abgelaufen. Bitte erneut öffnen.':
      'The repository selection has expired. Open it again.',
    'Ungültige Repository-Suche oder Seite.': 'Invalid repository search or page.',
    'Der Anbieter liefert keine gültige Repository-Seite.': 'The provider returns no valid repository page.',
    'Der Anbieter liefert ein Repository außerhalb der ausgewählten Quelle.':
      'The provider returns a repository outside the selected source.',
    'Die Auswahl enthält sehr viele Einträge. Bitte den Browser neu öffnen und die Suche eingrenzen.':
      'The selection contains very many entries. Reopen the browser and narrow the search.',
    'Bitte 1 bis 100 unterschiedliche Repositories auswählen.': 'Choose 1 to 100 different repositories.',
    'Ein Repository gehört nicht zur geladenen Auswahl.': 'A repository is not part of the loaded selection.',
    'Ungültige Einstellungsdatei.': 'Invalid settings file.',
    'Die Versionsnummer des Releases ist ungültig.': 'The release version number is invalid.',
    'Keine neuere Version zum Überspringen vorhanden.': 'There is no newer version to skip.',
    'Der sichere Schlüsselspeicher ist nicht verfügbar.': 'The secure key store is unavailable.',
    'Ungültige gespeicherte Zugangsdaten.': 'Invalid saved credentials.',
    'Kein sicherer Schlüsselspeicher verfügbar.': 'No secure key store is available.',
    'Nicht erlaubte Anfrage.': 'Request not allowed.',
    'Bitte den laufenden Vorgang abwarten.': 'Please wait for the running operation.',
    'Bitte zuerst eine Quelle hinzufügen und aktivieren.': 'Add and enable a source first.',
    'Kein Anmeldecode vorhanden.': 'No sign-in code available.',
    'Bitte das Archiv über den Dateidialog auswählen.': 'Choose the archive with the file dialog.',
    'Die Einstellungsdatei ist zu groß.': 'The settings file is too large.',
    'Ziel nicht gefunden.': 'Target not found.',
    'Kein installiertes Programm vorhanden.': 'No installed program available.',
    'Programmordner nicht verfügbar.': 'Program folder unavailable.',
    'Bitte Downloadreste auswählen.': 'Choose leftover downloads.',
    'Die Downloadübersicht bitte neu laden.': 'Reload the download overview.',
    'Die Bereinigungsvorschau ist abgelaufen.': 'The cleanup preview has expired.',
    'Die Sicherungsziele wurden inzwischen geändert.': 'The backup targets have changed in the meantime.',
    'Bitte ein einzelnes gespeichertes Repository auswählen.': 'Choose a single saved repository.',
    'Bitte zuerst die Quelle speichern und ihre Release-Dateien mit Jetzt prüfen sichern.':
      'Save the source first and back up its release assets with Check now.',
    'Sicherung nicht gefunden.': 'Backup not found.',
    'Release-Dateien liegen im verschlüsselten Archiv. Bitte über die Wiederherstellung entsperren.':
      'Release assets are in the encrypted archive. Unlock them through Restore.',
    'Bitte die Quelle erneut prüfen, um Release-Dateien im sichtbaren Ordner abzulegen.':
      'Check the source again to store release assets in the visible folder.',
    'Die gespeicherte Warteschlange ist beschädigt.': 'The saved queue is damaged.',
    'Bitte das Programm zuerst beenden.': 'Quit the program first.',
    'Für die unabhängige Zeitplanung muss das Archivpasswort im sicheren Schlüsselspeicher hinterlegt sein.':
      'Independent scheduling requires the archive password in the secure key store.',
    'Bitte zuerst den pausierten Durchlauf fortsetzen oder verwerfen.': 'Resume or discard the paused run first.',
    'Quelle nicht gefunden.': 'Source not found.',
    'Die Quellen wurden inzwischen geändert. Bitte die Vorschau erneut prüfen.':
      'The sources have changed in the meantime. Review the preview again.',
    'Vor einem Serverwechsel die gespeicherten Zugangsdaten entfernen.':
      'Remove the saved credentials before changing the server.',
    'Bitte zuerst den pausierten Durchlauf fortsetzen oder verwerfen, bevor Quellen oder Sicherungsumfang geändert werden.':
      'Resume or discard the paused run before changing sources or backup content.',
    'Bitte zuerst das Archivpasswort setzen oder entsperren.': 'Set or unlock the archive password first.',
    'Konto nicht gefunden.': 'Account not found.',
    'Die Anmeldung benötigt einen sicheren Schlüsselspeicher.': 'Sign-in requires a secure key store.',
    'Für GitLab und Forgejo ein passendes Lesetoken speichern.': 'Save a matching read token for GitLab and Forgejo.',
    'Bitte zuerst die Client-ID einer GitHub-OAuth-App mit aktiviertem Device Flow eintragen. Alternativ ein Personal Access Token verwenden.':
      'First enter the client ID of a GitHub OAuth app with Device Flow enabled, or use a personal access token.',
    'Git-Vorgang hat das Zeitlimit überschritten.': 'The Git operation timed out.',
    'Git-Vorgang fehlgeschlagen. Netzwerk, freien Speicher und Zugriffsrechte prüfen.':
      'The Git operation failed. Check the network, free space and permissions.',
    'Das Programm läuft noch. Die Installation wird bei der nächsten Prüfung erneut versucht.':
      'The program is still running. The installation is retried at the next check.',
    'Das Programm läuft noch. Die Installation wird bei einer späteren Prüfung erneut versucht.':
      'The program is still running. The installation is retried at a later check.',
    'Zugriff nicht erlaubt. Token und Repository-Berechtigungen prüfen.':
      'Access not allowed. Check the token and repository permissions.',
    'Git-Quelle nicht gefunden oder keine Zugriffsberechtigung.': 'Git source not found or no access permission.'
  };
  // Messages with values. Each pattern keeps the value and translates the surrounding sentence.
  const patterns = [
    [/^Ein fremder Ordner oder Link blockiert das Ziel: (.+)$/, 'A foreign folder or link blocks the destination: $1'],
    [/^Ein fremder Ordner wird nicht überschrieben: (.+)$/, 'A foreign folder is not overwritten: $1'],
    [/^Ungültige Einstellung: (.+)$/, 'Invalid setting: $1'],
    [/^Ziellaufwerk nicht erreichbar: (.+)$/, 'Destination drive unavailable: $1'],
    [/^Nicht portabler Ordnername: (.+)$/, 'Folder name not portable: $1'],
    [/^GitHub antwortet vorübergehend mit HTTP (\d+)\.$/, 'GitHub temporarily answers with HTTP $1.'],
    [/^GitHub antwortet mit HTTP (\d+)\.$/, 'GitHub answers with HTTP $1.'],
    [/^Der Git-Server antwortet mit HTTP (\d+)\.$/, 'The Git server answers with HTTP $1.'],
    [
      /^Die Signaturprüfung von (.+?) ist fehlgeschlagen(?: \((.+)\))?\. Unsignierte oder veränderte Programme werden nicht automatisch installiert\.$/,
      (_m, name, detail) =>
        `The signature check of ${name} failed${detail ? ` (${detail})` : ''}. Unsigned or modified programs are not installed automatically.`
    ],
    [
      /^Das DMG konnte nicht geöffnet werden(?:: (.+))?\.$/,
      (_m, detail) => `The DMG could not be opened${detail ? `: ${detail}` : ''}.`
    ],
    [
      /^(.+)-API-Limit erreicht \(HTTP (\d+)\)\. Der Lauf wartet bis zur Freigabe\.$/,
      '$1 API limit reached (HTTP $2). The run waits for the reset.'
    ],
    [
      /^(.+)-API-Kontingent fast aufgebraucht \((\d+) von (\d+) Anfragen übrig\)\. Der Lauf pausiert bis zur Freigabe\.$/,
      '$1 API quota nearly used up ($2 of $3 requests left). The run pauses until the reset.'
    ],
    [
      /^Datei kann nicht gelesen werden: (.+?)\. (.+)$/,
      (_m, file, detail) => `File cannot be read: ${file}. ${translate(detail)}`
    ]
  ];
  // Warnings join several messages; each part is translated on its own.
  const prefixes = [
    ['Programminstallation: ', 'Program installation: '],
    ['Programmverknüpfungen: ', 'Program shortcuts: '],
    ['Download-Verlauf: ', 'Download history: ']
  ];
  function single(text) {
    if (exact[text]) return exact[text];
    for (const [pattern, replacement] of patterns) if (pattern.test(text)) return text.replace(pattern, replacement);
    for (const [de, en] of prefixes) if (text.startsWith(de)) return en + single(text.slice(de.length));
    return text;
  }
  function translate(text) {
    if (typeof text !== 'string' || !text) return text;
    return text
      .split(/ (?=Programminstallation: |Programmverknüpfungen: |Download-Verlauf: )/)
      .map(single)
      .join(' ');
  }
  // Shows a message from the main process in the language of the interface; t is the window's translation helper.
  function display(text, t) {
    const message = String(text ?? '').replace(/^Error invoking remote method '[^']+': Error: /, '');
    return t(message, translate(message));
  }
  window.gitClonerMessages = { translate, display };
})();
