# Tatsächlich ausgeführte Prüfungen

Stand: 4. November 2026, Git Cloner **3.0.0**. Diese Übersicht trennt ausgeführte lokale Prüfungen, vorbereitete Workflows und externe Veröffentlichungsschritte.

## Aktuelle Version 3

| Umgebung / Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| Node 24.22.1, `npm run check` | ESLint und **109 Kern-/Integrationstests erfolgreich**, keine übersprungenen Tests. |
| Node 22.23.4 | Dieselben **109 Tests erfolgreich**, keine übersprungenen Tests. |
| Lokale Electron-GUI | **22 Tests erfolgreich**, einschließlich Setup, Probelauf, Layout, Kontrast, Tastatur, Pause über Neustarts und vollständiger/selektiver verschlüsselter Wiederherstellung. |
| Fedora 45 Container | **109 Kern-/Integrationstests und 20 GUI-Tests erfolgreich**, keine übersprungenen oder instabilen Tests. Die separate allgemeine Screenshot-Spezifikation ist hier ausgenommen. |
| Node-Codeabdeckung | Bericht für den geladenen Node-Code erstellt. Er umfasst auch Testcode und ist keine kombinierte Abdeckung der Electron-Oberfläche. |
| Echter GitHub-Transport | Öffentliches Repository über den gemeinsam auf 256 KiB/s begrenzten HTTPS-Tunnel geklont und mit Git-fsck geprüft. Netzwerkdaten wurden tatsächlich gemessen; TLS-Prüfung blieb aktiv. Keine Quelle wurde in der App voreingestellt. |
| Produktionsabhängigkeiten | `npm audit --omit=dev`: zum Prüfzeitpunkt keine gemeldeten Schwachstellen. |
| Konfiguration | Electron-Builder-, CI- und Release-YAML geparst; lokale Dokumentationslinks und Screenshots werden vor Übergabe geprüft. |

Die Kernprüfungen verwenden echte lokale Git-Repositories und Git LFS. Sie prüfen Mirrors und Refs, inkrementelle Aktualisierung, Integrität, fremde Dateien, Laufwerkswechsel, Absturzerholung, Verschlüsselung, falsche Passwörter, veränderte Archive, Metadaten, Konten, Filter, ETags, Device Flow, Prozesssperren und native Zeitplanvorlagen.

Zusätzliche Version-3-Prüfungen decken ab:

- Pausieren nach aktiven Aufgaben, Wiederaufnahme aus einem tatsächlich neu geöffneten Profil und Überspringen bereits abgeschlossener Ziele.
- Parallelitätsgrenzen und exklusive Verarbeitung aufwendiger Backups.
- Ressourcenregeln vor der ersten API-Abfrage und automatisches Fortsetzen nach Freigabe der Stromregel.
- Reales Download-Limit mit gemeinsamem Budget, Backoff und Begrenzung verschachtelter Wiederholungen.
- Abgebrochene Release-Streams, Schutz bestehender Dateien und Entfernen von Zugangsdaten bei Asset-Weiterleitungen.
- Freigabe des Prozess-Lease bei Schreibfehlern sowie Abwarten laufender Jobs vor Freigabe nach unerwarteten Fehlern.
- Kollisionen zwischen Repo-Zielen und temporären Staging-/Rollback-Pfaden.
- Selektive Wiederherstellung aus Snapshots, verschlüsselten Archiven und Mirror-HEAD, einschließlich ausführbarer Dateien und echter LFS-Inhalte.
- Schutz vor Pfad-Traversal, Windows-Gerätenamen/ADS, veränderten Manifesten und geänderten ausgewählten Dateien.
- Wiederherstellung intakter Dateien trotz Schäden an ungewählten Dateien; Ablauf und Bereinigung privater Browsing-Sitzungen.
- Gleich hohe Felder, große englische Schrift ohne horizontalen Seitenüberlauf, hoher Kontrast mit gemessener Textkontrastprüfung sowie Tastenkürzel und Reiternavigation.
- Der Überspringlink fokussiert den Hauptinhalt, ohne die Fensteradresse zu verändern; Einstellungen und andere App-Anfragen funktionieren anschließend weiterhin.

Die Versionsüberwachung wird weiterhin über mehrere App-Neustarts geprüft: dieselbe übersprungene Version bleibt verborgen, erst eine höhere Version meldet sich wieder, und die Auswahl kann ausdrücklich zurückgesetzt werden. Die Release-Antworten dieser Tests sind Fixtures, keine erfundenen offiziellen Veröffentlichungen.

## Paketprüfung

Für Version 3 wurden tatsächlich **AppImage, DEB, RPM, TAR.GZ und ein Arch-/CachyOS-Pacman-Paket für Linux x64** gebaut. Die entpackte Anwendung und das AppImage über seinen eigenen Extract-and-run-Start wurden erfolgreich gestartet; Version 3.0.0, `isPackaged`, leere Quellenliste, Preload und die neuen Leistungseinstellungen wurden geprüft. TAR.GZ und Pacman-Archiv wurden vollständig gelesen, DEB-Inhalt/-Metadaten und RPM-Metadaten erfolgreich ausgewertet. Die Metadaten nennen Version 3.0.0 und die passende x64-Architektur. Ein Paketbau ersetzt keinen interaktiven Installations-/Deinstallationstest auf jedem Zielsystem.

Diese lokalen Paket- und Fedora-Ergebnisse stammen vom Stand vor der abschließenden Korrektur des Überspringlinks. Der anschließende lokale Gesamtlauf mit 22 GUI-Tests und ESLint prüft auch diese Korrektur; die Release-Pipeline baut Pakete aus ihrem jeweils geprüften Commit neu.

## Grenzen und historische Ergebnisse

Die Fedora-Prüfung verwendet distributionsspezifische Git-/LFS- und Desktop-Bibliotheken und echte Electron-Fenster auf Xvfb. Playwright beziehungsweise der isolierte Container-Harness verwendet testbezogen `--no-sandbox`. Der reguläre Produktstart behält seine Sandbox-Einstellungen. Die Testumgebung ist kein Nachweis einer Installation oder Autostartprüfung auf physischer Hardware.

Frühere zusätzliche Version-2-Läufe: Fedora 45 mit 72 Kern-/12 GUI-Tests, Arch mit 74 Kern- und 13 GUI-Tests (ein später korrigierter Test zunächst instabil), CachyOS mit 74 Kern-/13 GUI-Tests. Diese älteren Ergebnisse werden nicht als ausgeführte Version-3-Tests ausgegeben. Der lokale Mint-Containerstart wurde wegen des begrenzten Speichers und des hohen Layer-Bedarfs des Docker-vfs-Treibers nicht abgeschlossen.

Die CI definiert Windows x64/ARM64, macOS Intel/ARM64, Linux, Node 22 sowie Fedora/Mint/Arch/CachyOS. Native Mac-/Windows-Installation, Autostart und ARM64-Hardwaretests sowie ein vollständiger Flatpak-Build wurden in dieser Linux-Umgebung nicht ausgeführt. WLAN-Namen können unter macOS durch Datenschutzregeln verborgen sein; Linux benötigt NetworkManager, und im Flatpak kann die Ermittlung fehlen. Dann wartet eine ausdrücklich aktivierte WLAN-Regel auf einen ermittelbaren erlaubten Namen.

Am 4. November 2026 wurde die neu freigegebene GitHub-Installation für das Projekt erfolgreich geprüft: Die Projektlizenz konnte als Commit angelegt und von GitHub zurückgelesen werden. Der frühere HTTP-403-Fehler ist damit behoben. Die vollständigen Quelltexte und Workflows werden über diese Anbindung übertragen; erst tatsächlich abgeschlossene Actions-Läufe gelten als bestandene CI-/Release-Prüfungen. Lokale Ergebnisse und Git-Bundles bleiben unabhängig davon verfügbar. Siehe [GITHUB-ZUGRIFF.md](GITHUB-ZUGRIFF.md).

Homebrew-, winget-, AUR- und Flathub-Manifeste werden ausschließlich aus echten Release-Dateien und Prüfsummen erzeugt. Generator-Tests sind erfolgreich; öffentliche Einreichung und Annahme sind nicht erfolgt. Siehe [PAKETVERZEICHNISSE.md](PAKETVERZEICHNISSE.md).

Verifizierte Signierung, Notarisierung und automatische Update-Installation bleiben auf ausdrücklichen Wunsch ausgeschlossen.
