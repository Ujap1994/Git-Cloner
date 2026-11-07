# Stand der ursprünglichen Roadmap

Version 3 erweitert das Grundgerüst. Performance, einfache Bedienung und eine zusammenhängende, sauber ausgerichtete Oberfläche haben Vorrang. Optionen sind nach Aufgabe gegliedert. Zusatzdaten und Ressourcenregeln sind opt-in; kleine Aufgaben laufen standardmäßig zu zweit. Quellen starten weiterhin leer.

| Ursprünglicher Punkt | Umsetzung |
| --- | --- |
| **1. Signierte automatische Updates** | **Auf ausdrücklichen Wunsch ausgenommen.** Keine Einrichtung von Herausgeberzertifikaten, keine Notarisierungsintegration und kein automatischer Download/Installer. Die Versionsüberwachung meldet neuere offizielle Releases und erlaubt dauerhaftes Überspringen bis zum nächsten höheren Release. |
| **2. Vollständiger Git-Umfang** | Optionaler vollständiger Mirror aller Branches/Tags, inkrementelle Aktualisierung, Git-LFS-Inhalte und rekursive HTTPS-Submodule im Snapshot. |
| **3. Repository-Filter** | Forks, archivierte Repositories, Ein-/Ausschlusslisten mit Namensmustern; separate Regeln und Konten. |
| **4. Wiederherstellungsprüfung** | SHA256-Manifeste, Git-fsck, wöchentliche/ständige/manuelle Prüfung, sichtbare Fehler und geprüfter Wiederherstellungsassistent. |
| **5. Unabhängiger Zeitplan** | GUI-freier Worker und installierbare Benutzeraufgaben für launchd, Windows-Aufgabenplanung und systemd. Gemeinsame Prozesssperre. Kein Wecken ausgeschalteter/schlafender Rechner. |
| **6. Laufwerkssteuerung** | Wiederanschluss erkennen, freier Platz samt Reserve vorab prüfen, bis zu zehn unabhängige Ziele je Quelle. |
| **7. GitHub-Metadaten** | Issues/Kommentare, PRs/Reviews/Kommentare/Dateiliste, Releases/Dateien und Wiki-Mirror optional exportieren. |
| **8. Komfort** | Suche, Statusfilter, Seitenaufteilung, anonymisierte Diagnoseprotokolle und Einstellungsimport/-export ohne Geheimnisse. |
| **9. Zugangsdaten** | Mehrere Konten, getrennte Tokens je Quelle, echte Device-Flow-Anmeldung. Device Flow benötigt eine eigene öffentliche OAuth-Client-ID; alternativ PAT oder öffentliche Quellen ohne Anmeldung. |
| **10. Verteilung und Hardwaretests** | Native x64-/ARM64-CI, vier Distro-Testjobs sowie Release-Erzeugung echter Homebrew-, winget-, AUR- und Flathub-Manifeste mit Prüfsummen. Öffentliche Aufnahme in diese Verzeichnisse und ausgeführte native Mac-/Windows-Installationstests hängen von externen Schreibrechten und Runnern/Hardware ab; siehe unten. |
| **11. Verschlüsselte Sicherungen** | AES-256-GCM mit scrypt, authentifizierte Extraktion, optionales Merken im sicheren OS-Schlüsselspeicher und Wiederherstellung einzelner Archive. |
| **12. Sprachen und Darstellung** | Deutsch/Englisch, System/Hell/Dunkel, drei Schriftgrößen, einheitliche Feldhöhen und responsive Anordnung. |

## Die zehn anschließend beauftragten Erweiterungen

| Punkt | Umsetzung in Version 3 |
| --- | --- |
| 1. Einrichtungsassistent | Drei Schritte: eigene Quellen, bestehender Zielordner, Zeitplan mit Probelauf. |
| 2. Vorschau | Repository-Auswahl, Filterausschlüsse, Zielpfade und Platzschätzung ohne Backup-Schreibzugriffe. |
| 3. Pause/Fortsetzen | Aktive Aufgaben beenden, ausstehende Aufgaben dauerhaft behalten und nach Neustart fortsetzen. |
| 4. Dateiwiederherstellung | Auswahl einzelner Dateien/Ordner aus Snapshot, GCB und Mirror-HEAD, einschließlich vorhandener LFS-Inhalte. |
| 5. Optionen je Quelle | Eigener Git-Modus, LFS/Submodule, Metadaten, Integrität und Verschlüsselung oder globale Vererbung. |
| 6. Parallelisierung | Begrenzt kleine Aufgaben parallel, höchstens zwei je erkanntem Datenträger; aufwendige Aufgaben exklusiv. |
| 7. Wiederholungen | Vorübergehende API-/Git-/Download-Fehler begrenzt mit Backoff wiederholen; keine multiplizierten verschachtelten Versuche. |
| 8. Ressourcen | Gemeinsames Download-Limit, optional Netzstrom und genaue WLAN-Liste. Unbekannte notwendige Zustände pausieren. |
| 9. Dashboard | Laufzeit, Restzeitschätzung, Download-Mengen, Datenumfang, Speicher und überfällige Prüfungen. |
| 10. Bedienung | Tastenkürzel, hoher Kontrast, Statusansagen, Überspringlink und Tastaturnavigation in Reitern. |

Alle zehn Funktionen sind implementiert und durch gezielte Tests sowie echte GUI-Abläufe geprüft. OS-spezifische Einschränkungen der WLAN-Ermittlung und noch ausstehende native Hardwaretests sind in Anleitung und Validierung ausgewiesen.

## Was ein lokaler Test nicht bestätigen kann

Die [CI](../.github/workflows/ci.yml) definiert echte Windows-x64-/ARM64- und Mac-Intel-/ARM64-Runner sowie Fedora-, Mint-, Arch- und CachyOS-Container. Die [Release-Pipeline](../.github/workflows/release.yml) baut die Paketmatrix und erzeugt aus den tatsächlichen Dateien Einreichungsvorlagen für Paketverzeichnisse. Die Vorlagen sind technisch angebunden; ein öffentlicher Store-Eintrag entsteht erst nach Veröffentlichung und Annahme durch die jeweiligen Verzeichnisse.

Die Entwicklungsumgebung kann Linux-Tests ausführen und verfügt seit der Freigabe vom 4. November 2026 über einen geprüften GitHub-Schreibzugang. Native Mac-/Windows-Hardware ist hier nicht vorhanden. Deshalb werden vorbereitete Workflows, erzeugte Pakete und tatsächlich ausgeführte Prüfungen ausdrücklich getrennt dokumentiert. Ein nicht gestarteter GitHub-Lauf oder ein nicht eingereichter Store-Eintrag wird nicht als erfolgreich ausgeführt bezeichnet. Die konkreten lokalen Ergebnisse stehen in [VALIDIERUNG.md](VALIDIERUNG.md).

## Zusätzliche Erweiterungen in Version 3.1

Die vier zuletzt vorgeschlagenen Funktionen sind umgesetzt. Dazu kommen Release-Dateien mit Betriebssystemfilter und eine getrennte Wiederherstellung. Quellen bleiben beim ersten Start leer.

| Funktion | Umsetzung |
| --- | --- |
| Eigene Zeitpläne je Quelle | Allgemeine Zeiten übernehmen oder 1–24 eigene tägliche Prüfzeiten verwenden. Separate Prüfstände, globale Pause und aktualisierte native Aufgaben. |
| Änderungen vor dem Sichern ansehen | Git-Dateiliste und bei Bedarf Text-Diffs zum aktuellen Standardbranch; Suche, Seitenaufteilung, verschlüsselte Sicherungen und Abbruch laufender Vorschauanfragen. |
| Laufwerke nach geändertem Pfad wiederfinden | Gespeicherte Ordnerkennung und relativen Speicherort prüfen, eindeutige Treffer übernehmen und pausierte Warteschlangen erhalten. Mehrdeutige Treffer bleiben unverändert. |
| Benachrichtigungsregeln | Alle Prüfungen, nur Fehler, Änderungen und Fehler oder keine Sicherungsmeldungen; separate Versionsmeldungen und lokale Ruhezeiten über Mitternacht. |
| Release-Dateien nach Betriebssystem | Dateien des neuesten offiziellen Releases sichern: alle Plattformen oder das automatisch erkannte Windows/macOS/Linux. Streaming-Prüfung von Größe und vorhandenen SHA256-Digests. |
| Release-Dateien wiederherstellen | Nur ausgewählte Download-Dateien wiederherstellen, einschließlich verschlüsselter Sicherungen und Mirrors. |

Siehe die [anonymisierte Anleitung](ANLEITUNG.md#17-eigene-prüfzeiten-je-quelle), [Release-Hinweise](RELEASE-NOTES.md) und [ausgeführten Prüfungen](VALIDIERUNG.md).

## Erledigte Erweiterungen in Version 3.2

Alle sechs zuletzt vorgeschlagenen Erweiterungen sind umgesetzt. Sie behalten jeweils einen erfolgreichen Stand pro Repository und Ziel bei und benötigen keine automatische Update-Installation. Die anonymisierte Anleitung beschreibt die Bedienung ab Abschnitt 22; die Validierung führt tatsächliche Tests und ihre Grenzen auf.

| Punkt | Funktion | Umsetzung |
| --- | --- | --- |
| 1 | Verlauf durchsuchen | Repository-Suche, lokaler Zeitraum, Fehler-/Änderungsfilter, paginierte Details und Auswahl ganzer Läufe für anonymisierte Exporte. |
| 2 | Konkrete Fehlerhilfe | Kontextbezogene Schritte direkt aus Übersicht, Verlaufsdetails und Fehlermeldungen; keine automatischen Änderungen an Systemeinstellungen. |
| 3 | Auf freien Speicher warten | Persistente Wartezustände, Fortsetzen bei ausreichendem Platz, kein Löschen vorhandener Backups und kein erneutes Bearbeiten fertiger Ziele. Unabhängige noch ausführbare Aufgaben werden zunächst fertiggestellt. |
| 4 | Passwortwechsel-Assistent | Erreichbare Archive auswählen, authentifizieren, prüfen und einzeln neu verschlüsseln. Wiederanlauf nach unterbrochenem Austausch, Stoppen zwischen Archiven und optionales Merken älterer benötigter Schlüssel. |
| 5 | GitLab und Forgejo | GitLab API v4 mit Untergruppen, Forgejo API v1, getrennte Server-/Token-Zuordnung, getrennte Ablage identischer Namen, Metadaten und private Release-Dateien. Das Entwicklungsprojekt bleibt auf GitHub. |
| 6 | Umfang vorschlagen | Git-Dateibäume und kleine Attributdateien auswerten; LFS/Submodule und Grenzen anzeigen. Aktivierung nur nach bewusster Auswahl für diese Quelle. |

Eine historische Ordnerrotation bleibt außerhalb des aktuellen Verhaltens. Ein Mirror enthält seine Git-Historie innerhalb eines einzigen Stands.

## Umgesetzt in Version 3.3: erste vier Prioritäten

Zusätzlich: URL-Bereinigung, dynamische Owner-Hauptseiten ohne doppelte Importe und sichtbare, geprüfte Release-Dateien mit direkter Ordneraktion.

| Priorität | Funktion | Umsetzung |
| --- | --- | --- |
| 1 | Repository-Browser mit Checkboxen | Anbieter-Suche, Seiten mit höchstens 50 Einträgen, Auswahl über Seiten/Suchen, gemeinsames Ziel und explizites Hinzufügen einzelner Quellen. GitHub, GitLab und Forgejo mit getrennten Zugangsdaten. |
| 2 | Gruppen und Favoriten | Bis zu 30 selbst benannte Gruppen, Favoriten, kombinierte Filter und Quellenseiten mit 25 Einträgen. Organisation funktioniert unabhängig von der Erreichbarkeit des Laufwerks und verändert keine aktive Sicherung. |
| 3 | Release-Downloads fortsetzen | Persistente geprüfte Dateiteile, sichere HTTP-Range-Fortsetzung und kontrollierter Neustart. Verschlüsselte Backups verwenden auch für den Cache authentifizierte Verschlüsselung. |
| 4 | Mehrere Quellen gemeinsam bearbeiten | Gezielte Änderungen mit erhaltener Vererbung und individuellen Unterschieden; paginierte Bisher-/Danach-Vorschau und Schutz vor veralteten Vorschauen. |

Die zusätzlich besprochenen Prioritäten 5–18 sind weitere Ideen. Sie wurden durch diese Beauftragung nicht umgesetzt. Der [Entwurf für weitere Detailansichten](DETAILANSICHTEN.md) beschreibt die geplante Darstellung ausdrücklich als Konzept.


## Umgesetzt in Version 3.4

1. Unveränderte Release-Dateien nach Inhaltsprüfung lokal übernehmen, einschließlich verschlüsselter Altarchive; Downloadzähler aus dem Änderungsvergleich ausnehmen.
2. Architektur- und mehrere Dateitypfilter global und je Quelle.
3. Download-Speicherübersicht und geprüfte Bereinigung ausschließlich eigener temporärer Teile.
4. Optionale Installation von Programmen aus einzelnen Repository-Quellen mit getrenntem Ziel und Austausch einer verwalteten Programmkopie. Unterstützte portable/App-Bundle-Formate sind in der Anleitung aufgeführt. Git Cloner selbst behält ausschließlich Versionshinweise.

Weitere Detailansichten bleiben das separat dokumentierte Konzept. Die drei zuletzt beauftragten Erweiterungen folgen in Version 3.5. Eine Übernahme fremder bereits vorhandener Installationen ist weiterhin nicht enthalten.

## Umgesetzt in Version 3.5

1. Optionale eigene Programmverknüpfungen mit aktualisierten Zielen, geschützter Benutzerbearbeitung und Wiederanlauf vorbereiteter Änderungen.
2. Auswahl von ein bis 64 kompatiblen Programmen in einer bereits gesicherten Release-Datei, gemeinsamer Austausch und Erhalt der alten Installation bei fehlenden oder ungültigen Mitgliedern.
3. Begrenzter Download-Verlauf mit tatsächlichen Nutzdaten, geprüfter Abrufersparnis und entfernten Cache-Dateibytes. Physische Blockersparnis und vermeintlich gemessene Zeitgewinne werden nicht behauptet.

## Wartung in Version 3.5.1

API-Limits pausieren die Warteschlange bis zur Freigabe, statt die übrigen Repositories als Fehler abzuschließen. Mirrors funktionieren mit Git ab 2.56 (`safe.bareRepository=explicit`). Leerlauf-Aktualisierungen, versteckte Fenster und die automatische Laufwerkssuche verursachen weniger Arbeit.

## Version 3.6.0

API-Limits beim Release-Download und GitHub-Sekundärlimits ohne Kopfzeilen pausieren ebenfalls die Warteschlange. Der OS-Worker wartet kurze Freigabezeiten selbst ab und übergibt an ein geöffnetes App-Fenster. Die DMG-Installation liest echte Mountpunkte, öffnet Abbilder mit Lizenzdialog ohne Rückfrage, lässt Finder-Mounts geöffnet und erlaubt Intel-Programme über Rosetta 2 als Rückfall. Mit automatischer Installation bleibt nur die installierte Datei des neuesten Releases gespeichert.

## Wartung in Version 3.6.1

DMG-Programme mit Finder-Layoutdaten werden wieder installiert und aktualisiert; dieselbe Datei unter zwei Namen zählt als ein Programm; `.DS_Store` blockiert keine Updates mehr. Release-Dateilisten kommen aus der Release-Antwort (drei statt vier API-Anfragen je Repository). Die Versionsprüfung wartet auf das API-Limit, unterbrochene Läufe setzen zum nächsten Zeitplan fort, und der API-Cache speichert kompakten Text statt Objekten.
