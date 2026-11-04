# Tatsächlich ausgeführte Prüfungen

Stand: 4. November 2026, Git Cloner **3.3.0**. Prüfungen mit GitHub-Antworten aus Test-Fixtures und tatsächliche Plattformläufe werden getrennt ausgewiesen.

## Lokale Prüfung von Version 3.3

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| Node 24, `npm run check` | ESLint und **218 Kern-/Integrationstests erfolgreich**, keine übersprungenen Tests. |
| Node 22.23.4 | Dieselben **218 Tests erfolgreich**, keine übersprungenen Tests. |
| Echte Electron-Oberfläche auf Linux/Xvfb | **49 Tests erfolgreich**, einschließlich dreizehn neuer Abläufe für Auswahl, Gruppen/Favoriten, Bulk-Vorschau, Neustart, große Schrift und erhaltenen Tastaturfokus. |
| Echte private Forgejo-Installation | Forgejo 17.0.1 über HTTPS erfolgreich: zusätzlich die private, nach tatsächlicher Konto-ID begrenzte Suche des Repository-Browsers. Snapshots/Mirrors, Metadaten, Wiki und authentifizierte Release-Dateien bleiben geprüft. |
| Echte HTTP-Unterbrechungen | Unverschlüsselte und verschlüsselte Dateiteile über eine neue Cache-Instanz fortgesetzt. Range/If-Range, ETag-Wechsel, sichere HTTP-Änderungsdaten, fehlende Kennungen, ignorierte Bereiche und vollständige Cache-Wiederverwendung geprüft. |
| Echter öffentlicher macOS-Release | `storytold/wordcraft` v0.15.1: DMG (128.335.727 Byte), CLI-ZIP (100.320.244 Byte) und `SHA256SUMS.txt` über den Produktions-Client vollständig heruntergeladen. GitHub-Digests und offizielle SHA256SUMS stimmen. Sichtbare Ablage und GUI-Ordneraktion zusätzlich automatisiert geprüft. |
| Schutz und Wiederanlauf | Tatsächlich verschlüsseltes Repository-Archiv nach fehlgeschlagenem Release-Download erhalten und anschließend mit fortgesetztem Download vollständig wiederhergestellt. Beschädigte Teile, falsche Passwörter, ENOSPC, fremde Dateien und unterbrochene Journalübergänge geprüft. |
| Gepackte Linux-x64-App | `build:dir` und echter Start erfolgreich: Version 3.3.0, leere Quellen/Gruppen, Preload, Repository-Browser, Verlauf, OS-Erkennung und Meldungseinstellungen. Alle **54 Anwendungsdateien** stimmen mit dem ASAR überein. |
| Produktionsabhängigkeiten | `npm audit --omit=dev`: **keine gemeldeten Schwachstellen** zum Prüfzeitpunkt. |

Die 44 zusätzlichen Kernprüfungen verwenden echte lokale Git-Repositories, temporäre Laufwerke, tatsächlich verschlüsselte Archive sowie einen lokalen HTTP-Server mit absichtlich unterbrochenen Übertragungen. Die Browser-API-Tests prüfen Pagination, private Quellen, Suchbegrenzungen, Anbieter-/Token-Bindungen, Abbruch veralteter Anfragen und ausdrücklich ausgewählte Repositories. Bulk-Prüfungen decken Unterschiede zwischen Quellen, veraltete Vorschauen und unveränderte Sicherungsdateien ab. Bei Vorschau und abgebrochener Auswahl werden keine Zielkennungen erzeugt.

Die dreizehn neuen GUI-Prüfungen kontrollieren Auswahl über Suchbegriffe und Seiten, ausdrücklich neu zu ladende Eigentümerangaben, Persistenz von Gruppen/Favoriten, vollständige Vorher-/Nachher-Übernahme und den Schutz vor veralteten Vorschauen. Benachbarte Eingabefelder werden auf gleiche Position und Höhe geprüft. Dunkelmodus und große Schrift erzeugen keinen horizontalen Seitenüberlauf; Fortschrittsmeldungen entfernen den Fokus nicht aus der Quellensuche.

Zusätzliche Prüfungen sichern URL-Bereinigung, wiederholte Sammelquellenimporte, neue Repositories und pausierte Einzelregeln ab. Release-Tests prüfen sichtbare Originalnamen, geschützte Repository-Ordner, die Migration der alten versteckten Ablage, verschlüsselte Wiederherstellung und die Ablehnung ausgetauschter Ordnerlinks. Komprimierte HTTP-Antworten werden vollständig geprüft; ihre kodierten Offsets werden nicht zum Fortsetzen dekodierter Inhalte verwendet.

Eine gezielt verzögerte Kontospeicherung reproduziert den in der ersten Arch-CI gefundenen Aktualisierungsfehler. Der zusätzliche GUI-Test prüft, dass ein bereits geöffnetes Quellenformular das neue Konto erhält, ohne Text oder Tastaturfokus zu verlieren.

Die macOS-Paketmatrix montiert x64, ARM64 und Universal auf Intel-Runnern. Die native ARM64-CI bleibt unverändert erforderlich. Dadurch wird eine Veröffentlichung weniger von der Kapazität zusätzlicher ARM64-Paketrunner abhängig. Tatsächliche plattformübergreifende Version-3.3-Läufe sind unter den unten verlinkten Actions sichtbar; lokale Linux-Prüfungen werden nicht als Mac-/Windows-Installationstests ausgegeben.

## Frühere Prüfung von Version 3.2

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| Node 24, `npm run check` | ESLint und **174 Kern-/Integrationstests erfolgreich**, keine übersprungenen Tests. |
| Node 22.23.4 | Dieselben **174 Tests erfolgreich**, keine übersprungenen Tests. |
| Echte Electron-Oberfläche auf Linux/Xvfb | **36 Tests erfolgreich**, einschließlich der sieben zusätzlichen Bedienabläufe für Version 3.2. |
| Echte private Forgejo-Installation | **Forgejo 17.0.1 über HTTPS erfolgreich geprüft**: privater Snapshot/Mirror, Branches, eigene Repository-Liste, Issues/Kommentare, Pull Requests, Wiki, authentifizierter Release-Download und LFS-Empfehlung. Lokales Testzertifikat wird nur dem Testprozess hinzugefügt; TLS-Prüfung bleibt aktiv. |
| Echte öffentliche GitLab-API | Projekt-Normalisierung, Dateigröße/Blob-ID über HEAD und Blob-Abruf erfolgreich geprüft. Keine privaten GitLab-Zugangsdaten oder Installation vorausgesetzt. |
| Produktionsabhängigkeiten | `npm audit --omit=dev`: **keine gemeldeten Schwachstellen** zum Prüfzeitpunkt. |
| Gepackte Linux-x64-App | `build:dir` und echter Start erfolgreich: Version 3.2.0, Preload, leere Quellen, Verlauf, Leistungsregeln, OS-Erkennung, Release-Filter und Meldungseinstellungen geprüft. Alle 49 Anwendungsdateien entsprechen dem gepackten ASAR. Die Release-Pipeline baut ihre Pakete aus dem zugehörigen geprüften Quellcommit. |

Die neuen Prüfungen verwenden echte lokale Git-Repositories und tatsächlich verschlüsselte Archive. Sie prüfen getrennte Anbieterpfade, HTTPS-/Token-Bindungen, Pagination einschließlich Forgejo-Git-Dateibäumen, private Asset-Weiterleitungen ohne Tokenweitergabe und die Ablehnung von HTML-Anmeldeseiten. GitLab-/Forgejo-Metadaten und Diff-Ansichten werden zusätzlich mit kontrollierten API-Antworten geprüft.

Speicherprüfungen simulieren ENOSPC, öffnen das gespeicherte Profil erneut, unterlassen bei fehlendem Platz weitere API-Aufrufe und verifizieren, dass fertige Ziele beim Fortsetzen nicht erneut laufen. Andere ausführbare Aufgaben werden vor der Wartephase abgeschlossen. Passwortprüfungen decken echte verschlüsselte Mirrors, falsche Passwörter, unterbrochene Austausche, fremde temporäre Dateien, Schreibfehler, bewusstes Stoppen und ältere Schlüssel über einen erneuten Vault-Start ab. Eine beim Programmstart fehlende Platte kann später wieder verbunden werden; der nächste Lauf schließt dann einen unterbrochenen Passwortaustausch vor der Sicherung ab, auch bei deaktivierter Laufwerksneuzuordnung. Die gewöhnliche Passwortentsperrung authentifiziert ein verfügbares Archiv, bevor ein Passwort übernommen wird.

Die GUI-Prüfungen kontrollieren die Anbieter-/Serverauswahl, Forgejo-Kontozuordnung, Verlaufssuche/Fehlerhilfe, sichtbare Speicherpausen, tatsächlichen Passwortwechsel mit anschließender Wiederherstellung sowie das bewusste Übernehmen von LFS-Empfehlungen. Benachbarte Felder werden auf gleiche Position/Höhe geprüft; Englisch, Dunkelmodus und große Schrift bleiben ohne horizontalen Seitenüberlauf verwendbar.

Der zusätzliche CI-Servicejob lädt ausschließlich die fest gepinnte Forgejo-Testversion und prüft den eingebetteten SHA256-Wert vor dem Start. Er setzt keine Forgejo-Installation beim Benutzer voraus. Aktuelle tatsächliche Plattform- und Release-Ergebnisse sind unter den unten verlinkten Actions-Läufen sichtbar.

## Frühere lokale Prüfung von Version 3.1

| Umgebung / Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| Node 24.22.1, `npm run check` | ESLint und **141 Kern-/Integrationstests erfolgreich**, keine übersprungenen Tests. |
| Node 22.23.4 | Dieselben **141 Tests erfolgreich**, keine übersprungenen Tests. |
| Echte Electron-GUI auf Linux/Xvfb | **29 Tests erfolgreich**. Alle sechs neuen Ansichten wurden zusätzlich als echte Screenshots aufgenommen. |
| Schnelle Quellenänderungen | Deaktivieren und Entfernen in derselben Ereignisfolge: **zwölf Wiederholungen ohne Retries erfolgreich**; bestehende Dateien und die übrige Quelle bleiben erhalten, auch nach einem Neustart der Oberfläche. |
| Gepackte Linux-x64-App | `build:dir` und echter Start erfolgreich: Version 3.1.0, `isPackaged`, Preload, leere Quellen, Leistungsregeln, OS-Erkennung, Release-Filter und Meldungseinstellungen geprüft. Neue Module und die Diff-Abhängigkeit sind im ASAR enthalten. |
| Produktionsabhängigkeiten | `npm audit --omit=dev`: zum Prüfzeitpunkt **keine gemeldeten Schwachstellen**. |
| Konfiguration und Dokumentation | Builder-/Workflow-YAML geparst, Shellskripte syntaktisch geprüft und 64 lokale Dokumentations-/Bildverweise auf vorhandene Dateien geprüft. |

Die Kernprüfungen verwenden echte lokale Git-Repositories, lokale Laufwerksordner und Git LFS. GitHub-Antworten für kontrollierte Release-, API- und Fehlerszenarien sind Fixtures; sie erzeugen keine fiktiven offiziellen Veröffentlichungen.

Die zusätzlichen Prüfungen für Version 3.1 umfassen:

- Quellenzeitpläne, globale Pause, unabhängige Prüfstände und native Windows-Aufgaben mit begrenzter Triggerzahl.
- Vorrang einzelner Repository-Regeln auch dann, wenn nur die übergeordnete Kontoquelle fällig ist.
- OS-Filter für Windows/macOS/Linux, mehrdeutige Dateinamen, gemeinsame Prüfsummen und den ungefilterten Modus.
- Wechsel des neuesten Releases und der OS-Auswahl; Dateigrößen und SHA256; ein fehlgeschlagener Download erhält den bisherigen erfolgreichen Stand und schützt fremde Dateien.
- Release-Dateien getrennt wiederherstellen, einschließlich eines tatsächlich verschlüsselten Mirrors.
- Echte Git-Diffs mit erhaltenen Leerzeichen, verzögertes Laden, Binär-/Größenbegrenzung, HTML-Escaping, verschlüsselte Vorschau, Abbruch einer wartenden Anfrage und Freigabe der Prozesssperre nach Fehlern.
- Laufwerkspfadänderungen, mehrdeutige kopierte Ordnerkennungen, unterbrochene Metadatenänderungen und abgeschlossene Aufgaben in pausierten Warteschlangen.
- Benachrichtigungsregeln bei manuellen und automatischen Läufen sowie Fortsetzen; Ruhezeitgrenzen über Mitternacht und nachgeholte Versionsmeldungen ohne doppelte Meldung.
- Begrenzung des GitHub-ETag-Caches.
- Veröffentlichungswiederholung nach einer unklaren HTTP-502-Antwort, identische bereits veröffentlichte Releases, Ablehnung falscher Dateihashes, Schutz eines Releases mit anderem Quellcommit und Entwürfe, die über den Tag-Endpunkt noch nicht erreichbar sind.

Die GUI-Prüfung kontrolliert leere Quellen beim ersten Start, deutsche und englische Texte, dunkle Darstellung, große Schrift ohne horizontalen Seitenüberlauf, hohen Kontrast, Tastatursteuerung und gleich hohe benachbarte Felder. Weitere Abläufe prüfen Setup, Probelauf, Pause über Neustarts, vollständige und selektive verschlüsselte Wiederherstellung sowie alle neuen Version-3.1-Ansichten.

Die Versionsüberwachung wird über mehrere App-Neustarts geprüft: Dieselbe übersprungene Version bleibt verborgen, erst eine höhere Version meldet sich wieder. Die Auswahl kann ausdrücklich zurückgesetzt werden. Es gibt weiterhin keine automatische Update-Installation.

## CI und Veröffentlichung

Die [CI-Läufe](https://github.com/Ujap1994/Git-Cloner/actions/workflows/ci.yml) prüfen native Windows-x64-/ARM64- und macOS-Intel-/ARM64-Runner, Linux, Node 22 sowie Fedora-, Mint-, Arch- und CachyOS-Container. Jeder native Hauptjob führt Kernprüfungen, echte Electron-GUI-Tests und einen Paketierungscheck aus. Distro-Jobs nehmen die zusätzliche allgemeine Screenshot-Spezifikation aus; die Funktions- und Layouttests laufen dort ebenfalls. Windows lässt zwei ausdrücklich unzutreffende Unix-/Symlink-Prüfungen aus.

Die [Release-Läufe](https://github.com/Ujap1994/Git-Cloner/actions/workflows/release.yml) starten nach erfolgreicher CI und bauen die Dateien aus deren konkretem Commit. Neue Hauptbranch-Änderungen stoppen überholte Paketbauten. Sporadische GUI-Fehler zählen auch nach erfolgreicher Wiederholung als CI-Fehler. Die offizielle Freigabe erfolgt erst, nachdem alle Paketjobs bestanden haben und Namen, Größen sowie GitHub-SHA256-Digests sämtlicher Dateien gegen das veröffentlichte Prüfsummenmanifest geprüft wurden. Ein Entwurf kann bei einem vorübergehenden GitHub-Fehler fortgesetzt werden. Der Abschlussstatus und die Logs jedes tatsächlichen Laufs stehen in Actions; ein angelegter Workflow allein gilt nicht als erfolgreiche Prüfung.

Die [Release-Seite](https://github.com/Ujap1994/Git-Cloner/releases) enthält die Pakete, `SHA256SUMS.txt` und aus den echten Dateien erzeugte Homebrew-, winget-, AUR- und Flathub-Katalogvorlagen. Öffentliche Einreichung und Annahme in diesen Verzeichnissen sind nicht erfolgt.

## Vorherige Version 3.0

Die abschließende [CI für Version 3.0](https://github.com/Ujap1994/Git-Cloner/actions/runs/41810930639) und der [Release-Lauf für Version 3.0](https://github.com/Ujap1994/Git-Cloner/actions/runs/41811357061) bestanden jeweils **alle zehn Jobs**. Version 3.0 ist mit 23 Release-Dateien veröffentlicht. Die 22 Manifest-Einträge wurden gegen die tatsächlichen GitHub-Asset-Digests geprüft. Ein echter Abruf durch die Versionsüberwachung wurde ebenfalls erfolgreich ausgeführt.

Lokale Version-3.0-Prüfungen umfassten 109 Kern-/Integrationstests auf Node 22 und 24, 22 GUI-Tests und Linux-x64-Pakete als AppImage, DEB, RPM, TAR.GZ und Pacman-Archiv. Die entpackte Anwendung und das AppImage wurden gestartet. Fedora wurde zusätzlich lokal in einem Container geprüft. Diese älteren Paket- und Containerergebnisse werden nicht als lokale Version-3.1-Installationstests ausgegeben.

## Grenzen der Prüfung

GUI-Tests verwenden virtuelle Bildschirme beziehungsweise die nativen CI-Desktops. Der isolierte Container-Harness benötigt testbezogen `--no-sandbox`; der reguläre Produktstart behält seine Sandbox-Einstellungen. Paketbau und automatisierter App-Start ersetzen keine interaktive Installation, Deinstallation, Hardware-Autostartprüfung oder Prüfung realer Betriebssystembenachrichtigungen auf jedem Zielgerät.

Laufwerksprüfungen verwenden temporäre Ordner und simulierte Mountlisten. Sie testen die Zuordnungslogik und unveränderte Sicherungsdaten, keine USB-Hardware. Die Kennung identifiziert einen Sicherungsordner, keine physische Seriennummer. WLAN-Namen können unter macOS durch Datenschutzregeln verborgen sein; Linux benötigt NetworkManager, und im Flatpak kann die Ermittlung fehlen. Eine ausdrücklich aktivierte WLAN-Regel wartet dann auf einen ermittelbaren erlaubten Namen.

Der GitHub-Schreibzugang wurde am 4. November 2026 erfolgreich geprüft. Veröffentlichten Quelltext vergleichen wir mit dem lokalen Git-Baumhash. Der frühere HTTP-403-Fehler ist behoben; die vorherige lokale Entwicklungshistorie bleibt im Archivbranch und Git-Bundle erhalten. Siehe [GITHUB-ZUGRIFF.md](GITHUB-ZUGRIFF.md).

Verifizierte Herausgebersignierung, Notarisierung und automatische Update-Installation bleiben auf ausdrücklichen Wunsch ausgeschlossen.
