# Tatsächlich ausgeführte Prüfungen

Stand: 4. November 2026, Git Cloner **3.1.0**. Prüfungen mit GitHub-Antworten aus Test-Fixtures und tatsächliche Plattformläufe werden getrennt ausgewiesen.

## Lokale Prüfung von Version 3.1

| Umgebung / Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| Node 24.22.1, `npm run check` | ESLint und **139 Kern-/Integrationstests erfolgreich**, keine übersprungenen Tests. |
| Node 22.23.4 | Dieselben **139 Tests erfolgreich**, keine übersprungenen Tests. |
| Echte Electron-GUI auf Linux/Xvfb | **29 Tests erfolgreich**. Alle sechs neuen Ansichten wurden zusätzlich als echte Screenshots aufgenommen. |
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
- Veröffentlichungswiederholung nach einer unklaren HTTP-502-Antwort, identische bereits veröffentlichte Releases, Ablehnung falscher Dateihashes und Schutz eines Releases mit anderem Quellcommit.

Die GUI-Prüfung kontrolliert leere Quellen beim ersten Start, deutsche und englische Texte, dunkle Darstellung, große Schrift ohne horizontalen Seitenüberlauf, hohen Kontrast, Tastatursteuerung und gleich hohe benachbarte Felder. Weitere Abläufe prüfen Setup, Probelauf, Pause über Neustarts, vollständige und selektive verschlüsselte Wiederherstellung sowie alle neuen Version-3.1-Ansichten.

Die Versionsüberwachung wird über mehrere App-Neustarts geprüft: Dieselbe übersprungene Version bleibt verborgen, erst eine höhere Version meldet sich wieder. Die Auswahl kann ausdrücklich zurückgesetzt werden. Es gibt weiterhin keine automatische Update-Installation.

## CI und Veröffentlichung

Die [CI-Läufe](https://github.com/Ujap1994/Git-Cloner/actions/workflows/ci.yml) prüfen native Windows-x64-/ARM64- und macOS-Intel-/ARM64-Runner, Linux, Node 22 sowie Fedora-, Mint-, Arch- und CachyOS-Container. Jeder native Hauptjob führt Kernprüfungen, echte Electron-GUI-Tests und einen Paketierungscheck aus. Distro-Jobs nehmen die zusätzliche allgemeine Screenshot-Spezifikation aus; die Funktions- und Layouttests laufen dort ebenfalls. Windows lässt zwei ausdrücklich unzutreffende Unix-/Symlink-Prüfungen aus.

Die [Release-Läufe](https://github.com/Ujap1994/Git-Cloner/actions/workflows/release.yml) starten nach erfolgreicher CI und bauen die Dateien aus deren konkretem Commit. Die offizielle Freigabe erfolgt erst, nachdem alle Paketjobs bestanden haben und Namen, Größen sowie GitHub-SHA256-Digests sämtlicher Dateien gegen das veröffentlichte Prüfsummenmanifest geprüft wurden. Ein Entwurf kann bei einem vorübergehenden GitHub-Fehler fortgesetzt werden. Der Abschlussstatus und die Logs jedes tatsächlichen Laufs stehen in Actions; ein angelegter Workflow allein gilt nicht als erfolgreiche Prüfung.

Die [Release-Seite](https://github.com/Ujap1994/Git-Cloner/releases) enthält die Pakete, `SHA256SUMS.txt` und aus den echten Dateien erzeugte Homebrew-, winget-, AUR- und Flathub-Katalogvorlagen. Öffentliche Einreichung und Annahme in diesen Verzeichnissen sind nicht erfolgt.

## Vorherige Version 3.0

Die abschließende [CI für Version 3.0](https://github.com/Ujap1994/Git-Cloner/actions/runs/41810930639) und der [Release-Lauf für Version 3.0](https://github.com/Ujap1994/Git-Cloner/actions/runs/41811357061) bestanden jeweils **alle zehn Jobs**. Version 3.0 ist mit 23 Release-Dateien veröffentlicht. Die 22 Manifest-Einträge wurden gegen die tatsächlichen GitHub-Asset-Digests geprüft. Ein echter Abruf durch die Versionsüberwachung wurde ebenfalls erfolgreich ausgeführt.

Lokale Version-3.0-Prüfungen umfassten 109 Kern-/Integrationstests auf Node 22 und 24, 22 GUI-Tests und Linux-x64-Pakete als AppImage, DEB, RPM, TAR.GZ und Pacman-Archiv. Die entpackte Anwendung und das AppImage wurden gestartet. Fedora wurde zusätzlich lokal in einem Container geprüft. Diese älteren Paket- und Containerergebnisse werden nicht als lokale Version-3.1-Installationstests ausgegeben.

## Grenzen der Prüfung

GUI-Tests verwenden virtuelle Bildschirme beziehungsweise die nativen CI-Desktops. Der isolierte Container-Harness benötigt testbezogen `--no-sandbox`; der reguläre Produktstart behält seine Sandbox-Einstellungen. Paketbau und automatisierter App-Start ersetzen keine interaktive Installation, Deinstallation, Hardware-Autostartprüfung oder Prüfung realer Betriebssystembenachrichtigungen auf jedem Zielgerät.

Laufwerksprüfungen verwenden temporäre Ordner und simulierte Mountlisten. Sie testen die Zuordnungslogik und unveränderte Sicherungsdaten, keine USB-Hardware. Die Kennung identifiziert einen Sicherungsordner, keine physische Seriennummer. WLAN-Namen können unter macOS durch Datenschutzregeln verborgen sein; Linux benötigt NetworkManager, und im Flatpak kann die Ermittlung fehlen. Eine ausdrücklich aktivierte WLAN-Regel wartet dann auf einen ermittelbaren erlaubten Namen.

Der GitHub-Schreibzugang wurde am 4. November 2026 erfolgreich geprüft. Veröffentlichten Quelltext vergleichen wir mit dem lokalen Git-Baumhash. Der frühere HTTP-403-Fehler ist behoben; die vorherige lokale Entwicklungshistorie bleibt im Archivbranch und Git-Bundle erhalten. Siehe [GITHUB-ZUGRIFF.md](GITHUB-ZUGRIFF.md).

Verifizierte Herausgebersignierung, Notarisierung und automatische Update-Installation bleiben auf ausdrücklichen Wunsch ausgeschlossen.
