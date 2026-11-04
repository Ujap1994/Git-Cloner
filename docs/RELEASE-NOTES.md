Git Cloner **3.0.0** vereinfacht Einrichtung, große Sicherungsläufe und gezielte Wiederherstellung. Die Anwendung startet weiterhin ohne Standardkonten oder Repositories und behält genau einen erfolgreichen Stand je Repository und Ziel.

- Dreistufiger Einrichtungsassistent für eigene Quellen, Laufwerk und Prüfzeiten.
- Reiner Probelauf mit Filterausschlüssen, geplanten Speicherorten und Platzschätzung, ohne Backup-Schreibzugriffe.
- Nach aktiven Repositories pausieren, Warteschlange über Neustarts behalten und nur ausstehende Ziele fortsetzen.
- Einzelne Dateien oder Ordner aus Snapshot, GCB und Mirror-HEAD wiederherstellen, einschließlich vorhandener LFS-Inhalte.
- Eigene Sicherungsoptionen je Quelle oder globale Vererbung.
- Kleine Aufgaben begrenzt parallel, maximal zwei je erkanntem Datenträger; große und aufwendige Sicherungen exklusiv.
- Begrenzte Wiederholungen vorübergehender Netzwerkfehler mit Backoff; verschachtelte Wiederholungen vervielfachen das Budget nicht.
- Gemeinsames Download-Limit für Git/LFS und Release-Dateien; optionale Netzstrom- und WLAN-Regeln vor der ersten Quellenabfrage.
- Dashboard mit Laufzeit, Restzeitschätzung, Download-Mengen, Backup-Umfang, freiem Platz und überfälligen Prüfungen.
- Hoher Kontrast, Tastenkürzel, Statusansagen, Überspringlink und Tastaturnavigation in Einstellungsreitern.
- Zusätzliche Schutzprüfungen für Downloads, temporäre Pfade, Manifeständerungen und Windows-Dateinamen.
- Erweiterte npm-/Git-/Electron-Tests, Node-22-Kompatibilitätsprüfung und zusätzliche Fedora-Prüfung. Konkrete Ergebnisse stehen in `docs/VALIDIERUNG.md`.

Die bisherigen Funktionen bleiben erhalten: vollständige Mirrors, LFS/Submodule, Metadaten, verschlüsselte Archive, Integrität, mehrere Konten/Ziele, Zeitplanung, Autostart, Deutsch/Englisch und Hell/Dunkel.

**Versionshinweise:** Ausschließlich mit dem letzten offiziellen stabilen GitHub-Release vergleichen und informieren. „Diese Version überspringen“ bleibt nach Neustarts erhalten; erst eine höhere Version meldet sich erneut. Keine automatischen Downloads oder Installer, keine erforderlichen Signierzertifikate.

**Voraussetzungen:** Git im PATH, für LFS zusätzlich Git LFS; beides ist im Flatpak enthalten. Fertige Pakete brauchen kein separates Node.js. Device Flow benötigt eine eigene öffentliche OAuth-Client-ID; öffentliche Quellen und PAT funktionieren unabhängig davon.

**Betrieb:** Temporär Platz für bisherigen und neuen Stand erforderlich. Der Rechner muss wach sein und der Benutzerkontext verfügbar. Die App weckt ihn nicht. WLAN-Ermittlung hängt von OS-Freigaben und verfügbaren Werkzeugen ab; unbekannte erforderliche Zustände pausieren. Ein Probelauf ist eine separate manuelle Leseoperation. Die gemeinsame Download-Messung schließt API-JSON und andere Programme aus.

**Wiederherstellung:** Vorhandene Ausgabeordner werden abgelehnt. Neue Manifeste erlauben die Prüfung ausgewählter Dateien; ältere Sicherungen verwenden zunächst die vollständige Prüfung. Verschlüsselte Archive werden zur Auswahl vollständig authentifiziert und privat temporär entpackt. Reguläres Schließen räumt auf; ein harter Abbruch kann OS-Temp-Dateien hinterlassen. Passwörter unabhängig aufbewahren; noch nicht erneuerte Archive benötigen nach einem Wechsel das bisherige Passwort.

**Veröffentlichung:** Pakete haben keine verifizierte Herausgebersignatur. macOS verwendet Ad-hoc-Signierung und ist nicht notarisiert. Vorbereitete CI-/Release-/Store-Vorlagen bedeuten noch keine ausgeführte öffentliche Veröffentlichung. Prüfsummen stehen in `SHA256SUMS.txt`.
