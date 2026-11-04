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

## Weitere mögliche Features

Diese Ideen sind noch nicht umgesetzt. Sie behalten jeweils einen erfolgreichen Stand pro Repository und Ziel bei und benötigen keine automatische Update-Installation.

| Priorität | Idee | Nutzen |
| --- | --- | --- |
| 1 | Verlauf durchsuchen | Nach Repository, Zeitraum oder Fehler filtern und einzelne Läufe anonym exportieren. |
| 2 | Konkrete Fehlerhilfe | Zu Netzwerk-, Berechtigungs-, Speicher- und Git-Problemen passende nächste Schritte anbieten. |
| 3 | Auf freien Speicher warten | Platzmangel als gezielt fortsetzbaren Zustand behandeln, ohne bestehende Backups zu löschen. |
| 4 | Passwortwechsel-Assistent | Noch mit dem alten Passwort geschützte Archive erkennen und eine kontrollierte Umstellung begleiten. |
| 5 | GitLab und Forgejo | Weitere Anbieter als optionale Backup-Quellen integrieren; das Projekt selbst bleibt auf GitHub. |
| 6 | Umfang automatisch vorschlagen | Vorhandene LFS-Dateien und Submodule erkennen und passende Optionen erklären, ohne sie ungefragt zu aktivieren. |

Eine historische Ordnerrotation bleibt außerhalb des aktuellen Verhaltens. Ein Mirror enthält seine Git-Historie innerhalb eines einzigen Stands.
