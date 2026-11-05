# Architektur und Entwicklung

## Laufzeit und Oberfläche

`app/main.cjs` verwaltet Electron, Fenster, Tray, Benachrichtigungen, Dateidialoge und eine begrenzte IPC-API. `app/runtime.cjs` verbindet Konfiguration, GitHub-Clients, Zugangsdaten, Backup, Zeitplan und Laufwerkserkennung. Derselbe Runtime-Kern wird von **`--scheduled-worker`** ohne Fenster ausgeführt. Dadurch verwenden App und native OS-Aufgabe identische Sicherungsregeln.

Der Renderer lädt ausschließlich lokale Dateien. Node-Integration ist aus; Context Isolation, Renderer-Sandbox und Web Security sind an. Die CSP verbietet Netzwerkzugriffe aus der Oberfläche. Externe Links sind im Hauptprozess begrenzt, IPC-Aufrufe an das genaue lokale Hauptfenster gebunden, dynamische Texte werden HTML-maskiert. Geheimnisse werden nicht mit dem Zustand an den Renderer zurückgegeben.

Die Oberfläche gliedert sich in Übersicht, Quellen, Zeitplan, Wiederherstellung, Einstellungen und Hilfe. Einstellungen haben eigene Reiter. Erweiterte Quelloptionen bleiben einklappbar. Deutsch und Englisch liegen unmittelbar an den UI-Texten; Theme und Schriftgröße werden persistent über CSS-Variablen angewendet.

## Kernmodule

| Modul in `app/core/` | Aufgabe |
| --- | --- |
| `config.cjs`, `filters.cjs` | Leere Standardkonfiguration, Migration durch Defaults, strenge Validierung und Repository-Namensfilter. |
| `github.cjs` | REST-Pagination, begrenzter ETag-Cache, accountbezogene Clients, kontrollierte Asset-Downloads. |
| `git.cjs` | Git per `execFile`, flache Klone, Mirror-Refs, inkrementeller Fetch, LFS und sichere Submodule. |
| `backup.cjs` | Quellen/Ziele auflösen, atomarer Austausch, Absturzerholung, Integritäts- und Metadatenplanung. |
| `destinations.cjs` | Laufwerkskennungen, sichere Unterpfade, freier Platz und Reserve. |
| `integrity.cjs`, `restore.cjs` | Streaming-SHA256, Git-fsck, Wiederherstellung ohne Überschreiben vorhandener Ordner. |
| `metadata.cjs` | JSON-Exporte, Release-Dateien, Wiki-Mirror und Änderungsdigest. |
| `archives.cjs` | Streaming-TAR/Gzip, AES-256-GCM, scrypt und authentifizierte Extraktion. |
| `vault.cjs`, `device-flow.cjs` | OS-verschlüsselte Zugangsdaten und GitHub Device Flow. |
| `schedule.cjs`, `native-schedule.cjs` | Lokale Termine und launchd-/Windows-/systemd-Benutzeraufgaben. |
| `lease.cjs`, `drive-monitor.cjs` | Prozessübergreifende Sperre und auf Zielpfade begrenzte Wiederanschlusserkennung. |
| `updates.cjs` | Offizielle Release-Prüfung mit dauerhaftem Überspringen, ohne Download oder Installation. |
| `transfer.cjs`, `store.cjs` | Geheimnisfreie Konfigurationsübertragung, anonymisierte Diagnose und atomare JSON-Dateien. |

Das alte `secrets.cjs` bleibt für die Kompatibilität des bisherigen Einzel-Token-Formats erhalten; die Runtime migriert diesen Zugang in den neuen Vault.

## Daten und Performance

Im von Electron ermittelten `userData`-Verzeichnis liegen:

- `settings.json`: Quellen, Pfade, Kontonamen und Optionen; keine Tokens/Passwörter.
- `state.json`: aktueller Repository-Status und letzter Scheduler-Termin.
- `history.json`: separat gespeicherte letzte 100 Läufe mit maximal 500 Details je Lauf; Fehler werden zuerst behalten, Gesamtsummen separat erfasst.
- `updates.json`: übersprungene und zuletzt gemeldete Release-Version.
- `secrets.enc`: mit OS-`safeStorage` verschlüsselter Vault für Tokens und gegebenenfalls Archivpasswort.
- `backup.lock/`: temporäre Sperre mit Heartbeat, kein dauerhaftes Benutzer-Backup.
- `worker.log`: begrenztes, von Namen/Pfaden bereinigtes Ergebnis des GUI-freien Workers.

Typische Basispfade sind `~/Library/Application Support/git-cloner`, `%APPDATA%\git-cloner` und `$XDG_CONFIG_HOME/git-cloner` beziehungsweise `~/.config/git-cloner`. Entscheidend ist immer Electrons tatsächlicher `userData`-Pfad; Produktname und Flatpak können ihn beeinflussen. Portable verwendet ebenfalls das Benutzerprofil. Eine beschädigte JSON-Datei wird nicht still durch Defaults ersetzt. Vor manuellen Änderungen die App beenden und eine Kopie anlegen.

Git-Remote-Prüfungen und ETags vermeiden unnötige Klone und JSON-Downloads. Mirrors verwenden Fetch und Copy-on-Write, soweit unterstützt. Große Dateien werden gestreamt. Der Standard für unveränderte Sicherungen ist eine wöchentliche Vollprüfung. Metadaten-Downloads sind opt-in.

IPC-Zustandsmeldungen werden auf ungefähr 120 ms gebündelt. Konfiguration, Repository-Status und Verlauf haben getrennte Änderungserkennung. Fortschrittsereignisse ersetzen weder Tabellen noch Suchfelder; bis zu 75 Zeilen werden gleichzeitig angezeigt. Während eines großen Laufs wird der persistente Status alle 20 Repositories oder zehn Sekunden und abschließend geschrieben. Die Backup-Marker bleiben unabhängig davon maßgeblich; nach einem Absturz kann die Übersicht deshalb kurz hinter den tatsächlichen Sicherungen liegen und wird beim nächsten Lauf abgeglichen.

## Sichere Ablage und Wiederherstellung

Im Ziel liegen `.git-cloner-volume.json` und `Konto/Repository`. Snapshot-Verwaltungsdateien liegen in `.git`, bei Bare-Mirrors direkt im Root. Verschlüsselte Ziele enthalten `backup.gcb` und `git-cloner.json`. Der Zielpfad bleibt beim Wechsel des Formats gleich.

Ein Austausch verwendet `.<Repository>.git-cloner-stage`, `.<Repository>.git-cloner-previous` und eine separate Staging-Kennung. Erst nach Git-Prüfung, Manifest und gegebenenfalls Verschlüsselung wird der bisherige Stand umbenannt und der neue eingesetzt. Nach einem Absturz werden nur eindeutig zugeordnete temporäre Ordner repariert. Fremde Ordner, fremde Staging-Kennungen und Symlinks an Verwaltungspositionen blockieren den Vorgang.

SHA256-Manifeste erfassen Dateiinhalte und symbolische Linkziele, ausgenommen die veränderliche Verwaltungskennung und das Manifest selbst. Die Wiederherstellung prüft vor und nach dem Kopieren und akzeptiert nur einen neuen Zielnamen. Die automatische Reparatur einer beschädigten Sicherung benötigt weiterhin ein erreichbares Original und erfolgreiche Verifikation des Ersatzes.

## Archive und Zugangsdaten

Das Archiv beginnt mit `GCLONER2`, einem vier Byte langen Big-Endian-Headermaß und JSON mit Formatversion, `aes-256-gcm`, `scrypt-32768-8-1`, Salt (32 Byte) und IV (12 Byte). Dieser Prefix wird als AAD authentifiziert. Danach folgen verschlüsseltes TAR/Gzip und ein 16-Byte-GCM-Tag. scrypt nutzt N=32768, r=8, p=1 und maximal 64 MiB. Passwörter benötigen 12–1024 Zeichen. Schlüsselbuffer werden nach Benutzung gelöscht.

Die vollständige GCM-Prüfung erfolgt vor der Extraktion in einen privaten Temp-Ordner. Pfade werden geprüft und Links erst nach allen regulären Schreibvorgängen angelegt. Kein Archiveintrag darf durch zuvor extrahierte Symlinks schreiben. Bestehende Ziele werden nicht überschrieben. Interne Klartext-Zwischenstände werden entfernt, aber nicht forensisch sicher gelöscht. Für ein vergessenes Passwort gibt es keine Wiederherstellung. Ältere, noch nicht erneuerte Archive benötigen nach einem Passwortwechsel weiterhin ihr altes Passwort.

Tokens werden nur im Hauptprozess entschlüsselt. Git erhält einen auf GitHub begrenzten Authorization-Header über die Prozessumgebung; kein Token steht in argv oder Remote-URL. Git-Hooks sind aus; Operationen haben 15 Minuten Zeitlimit, die Git-Verfügbarkeit fünf Sekunden. Submodule erlauben HTTPS und schreiben GitHub-SSH-Adressen auf HTTPS um. Unsichere lokale/ext-Protokolle werden blockiert. LFS wird nur bei expliziter Option geladen.

Linux-`basic_text` wird als Vault-Backend abgelehnt. Ein Archivpasswort kann sitzungsweise genutzt werden, für einen unabhängigen verschlüsselten Worker ist sichere persistente Speicherung erforderlich. Device Flow benötigt eine öffentliche OAuth-Client-ID mit freigeschalteter Geräteanmeldung; dieses Repository stellt keine allgemeine OAuth-App bereit. PAT und öffentliche Quellen sind Alternativen.

## Tests

Benötigt: Node ab 22.12, empfohlen 24 LTS, npm, Git; für vollständige LFS-Prüfung Git LFS. GUI-Tests benötigen eine grafische Sitzung.

```sh
npm ci
npm run check
npm run test:coverage
npm run test:e2e
```

Unter Linux: `xvfb-run -a npm run test:e2e`. Tests erzeugen echte lokale Repositories, Dateien, Mirrors und Archive, ohne private GitHub-Zugänge. Simulierte Antworten prüfen Pagination, ETags, Device Flow und Release-Vergleiche. E2E-Tests starten echte Electron-Fenster und prüfen unter anderem mehrfache Neustarts nach übersprungenen Updates, Konten, Zielordner, Layout, englische große Schrift und verschlüsselte Wiederherstellung. Entwicklungs-Testprofile und Release-Fixtures sind in installierten Apps deaktiviert.

Playwright und isolierte Distro-Container benötigen in dieser Testumgebung einen testbezogenen `--no-sandbox`-Start. Das gilt ausschließlich für den Harness, nicht für den Produktstart. Container-Prüfungen sind kein Nachweis eines interaktiven Installations-/Autostarttests auf physischer Hardware.

`npm run screenshots` erzeugt echte anonymisierte Bilder in `docs/screenshots`. Der dokumentierte Update-Hinweis verwendet ausdrücklich eine lokale Release-Fixture und behauptet kein existierendes Release. Konkrete Ergebnisse und Einschränkungen stehen in [VALIDIERUNG.md](VALIDIERUNG.md).

## Paketbau und Veröffentlichung

```sh
npm run build:dir
npm run build:linux
npm run build:win
npm run build:mac
```

Native Plattformen verwenden; DMGs benötigen macOS. RPM benötigt entsprechende Paketwerkzeuge. `scripts/package-arch.sh x86_64` oder `aarch64` erzeugt Pacman-Pakete aus den passenden Linux-TAR.GZ-Dateien. Flatpak benötigt Flatpak/flatpak-builder, Freedesktop 25.08 und Electron2.BaseApp 25.08; es enthält SHA256-fixiertes Git 2.56.0 und Git LFS 3.8.1. Zypak startet Electron innerhalb der Sandbox.

[CI](../.github/workflows/ci.yml) prüft Linux, Windows x64/ARM64, macOS Intel/ARM64, Node 22 und Fedora-/Mint-/Arch-/CachyOS-Container. Nach grüner CI auf `main` baut [Release](../.github/workflows/release.yml) genau diesen Commit, überspringt bereits veröffentlichte Versionen und veröffentlicht erst nach allen erfolgreichen Paketjobs. Ausschließlich der Publish-Job erhält `contents: write`.

Der Publish-Job erzeugt Homebrew-, winget-, AUR- und Flathub-Vorlagen mit tatsächlichen Asset-Prüfsummen und Source-Commit. Details und externe Veröffentlichungsschritte stehen in [PAKETVERZEICHNISSE.md](PAKETVERZEICHNISSE.md). Weder Store-Aufnahme noch native Hardwaretests dürfen aus der Workflow-Konfiguration allein abgeleitet werden.

Für eine neue Version Paketversion und Lockfile, Release-Notizen und AppStream aktualisieren, prüfen, committen und nach `main` pushen. Ein bereits veröffentlichter Tag wird nicht überschrieben. Der manuelle Workflow prüft Kernlogik erneut, ersetzt aber nicht die vollständige reguläre GUI-Matrix.

Verifizierte Signierung, Apple-Notarisierung und automatische Updates sind auf Wunsch ausgeschlossen. macOS verwendet lediglich Ad-hoc-Signierung mit den nötigen Electron-Entitlements. `electron-updater` und ein automatischer Update-Installer sind nicht Teil der Anwendung.


## Version 3: Warteschlange und Ressourcen

`state.json` enthält zusätzlich die gespeicherte Warteschlange: unveränderlichen Sicherungsumfang, aufgelöste Jobs, abgeschlossene Job-IDs, bisherige Ergebnisse und Pausengrund. Keine Tokens oder Archivpasswörter. Vor Freigabe einer Ressourcenregel bleibt eine Warteschlange zunächst unaufgelöst; dadurch findet auch die erste GitHub-Abfrage erst nach Freigabe statt. Nach einem ungeplanten Neustart wird ein unvollständiger aktiver Lauf ausdrücklich fortgesetzt. Benutzerpausen werden nie automatisch aufgehoben.

Kleine Jobs laufen mit einem globalen Limit von 1–4 und maximal zwei je erkanntem `stat.dev`. Mirrors, unbekannte/große Repositories und optionale LFS-/Submodul-/Metadaten-/Verschlüsselungsschritte sind exklusiv. Zielpfade sowie Staging-/Rollback-Pfade werden vor dem Start auf Kollisionen geprüft. Ein Lauf ist auf 100000 geplante Ziele begrenzt. Vor einer Freigabe des Prozess-Lease werden auch bei unerwarteten Fehlern aktive Jobs abgewartet.

`retry.cjs` klassifiziert vorübergehende Fehler, begrenzt Versuche und Wartezeiten und verhindert, dass verschachtelte Wiederholungen die Versuchszahl multiplizieren. Teilweise geschriebene Release-Dateien werden nur entfernt, wenn der aktuelle Download sie selbst angelegt hat. Fremde Dateien bleiben erhalten.

`transport.cjs` stellt einen nur auf Loopback gebundenen CONNECT-Tunnel bereit. Git erhält dessen Adresse ausschließlich für den jeweiligen Aufruf. TLS wird nicht entschlüsselt; ein vorhandener HTTP-/HTTPS-Upstream-Proxy und NO_PROXY werden berücksichtigt. Ein gemeinsames Streaming-Budget begrenzt eingehende Tunnel- und Release-Daten. Der Zähler umfasst Transportdaten, jedoch weder API-JSON noch Uploads. Ressourcenregeln stehen in `network-rules.cjs`; nicht ermittelbare erforderliche Werte führen zu einer wartenden Queue.

`preview.cjs` verwendet dieselbe Quellen-/Filterauflösung, führt aber nur API-Lesezugriffe und Dateisystem-Statistik aus. `metrics.cjs` fasst Status und Verlauf für sieben lokale Kalendertage zusammen. Runtime-Snapshots verwenden getrennte Caches für Repository-Listen und Dashboard-Daten; Fortschrittsmeldungen erzeugen keine vollständigen Tabellen- oder Statistikneuberechnungen.

## Version 3: Dateiauswahl

`selective-restore.cjs` verwaltet maximal drei kurzlebige Browsing-Sitzungen. Neue Manifestdateien besitzen einen separat im Marker hinterlegten SHA256-Hash. Damit benötigt ein Snapshot-Picker keine Vollprüfung aller ungewählten Dateien; die ausgewählten Dateien werden beim Kopieren jeweils geprüft. Ältere Sicherungen verwenden die bisherige Vollprüfung. Mirror-Dateilisten kommen aus `git ls-tree HEAD`, der Blob-Export wird anhand der Git-Objekt-ID geprüft. Vorhandene LFS-Objekte werden aufgelöst, symbolische Links erst nach regulären Dateien erzeugt.

Verschlüsselte Picker-Sitzungen authentifizieren das komplette Archiv und halten die privaten extrahierten Daten bis zum Schließen oder Ablauf nach fünf Minuten vor. Aktive Wiederherstellungen halten ihre Sitzung gesperrt; ein Schließen wird erst nach Abschluss wirksam. Reguläres Beenden räumt Sitzungen auf. Ein harter Prozessabbruch kann temporäre OS-Dateien hinterlassen. Pfad-Traversal, Git-Verwaltungssegmente, Symlink-Eltern sowie Windows-Gerätenamen/ADS werden abgewehrt. Ein bestehender Ausgabeordner wird abgelehnt.

## Version 3: Oberfläche und Tests

`renderer/features.js` enthält Einrichtung, Probelauf, Ressourcenformular, Dashboard, Picker und Tastaturbedienung; der bestehende Renderer verbindet diese Komponenten mit den Hauptansichten. Aktionsbuttons haben ausdrücklich `type="button"`, damit Browse-/Preview-Aktionen keine umgebenden Formulare versehentlich absenden. Einstellungsreiter verwenden Roving-Tabindex und Pfeiltasten. Hoher Kontrast bleibt eine zusätzliche Darstellungsoption.

Die GUI-Suite erzeugt 16 anonymisierte Bilder aus echten Fenstern und neutralen Testprofilen. Fixtures für Repository-Antworten und lokale Git-Remotes sind ausschließlich in ungepackten E2E-Profilen aktiv. Die veröffentlichte App ignoriert diese Testvariablen. Testumfang und tatsächlich ausgeführte Plattformen stehen in [VALIDIERUNG.md](VALIDIERUNG.md).


## Erweiterungen in 3.1

- `schedule.cjs` berechnet fällige Quellen mit `lastScheduledBySource`. Nur passende Quellen werden aufgelöst; einzelne Repository-Overrides behalten auch zwischen unterschiedlichen Quellenterminen Vorrang. `native-schedule.cjs` registriert die Vereinigung aktiver Zeiten und teilt Windows-Aufgaben oberhalb der 48-Trigger-Grenze auf. `native-tasks.json` hält die eigene Aufgabenzahl für die Bereinigung fest.
- `release-assets.cjs` ordnet veröffentlichte Dateinamen den Plattformen zu. `metadata.cjs` verwendet den neuesten offiziellen Release und paginiert seine Asset-Liste. Auswahlmanifest, Dateigrößen und Release-Kennung gehen in den gesicherten Stand ein. `github.cjs` prüft Größe und SHA256 beim Streaming und begrenzt den gemeinsamen ETag-Cache auf 16 MiB.
- `changes.cjs` liest lokale Git-Bäume und vergleicht sie mit dem aktuellen GitHub-Baum. Inhalte werden erst für ausgewählte Dateien geladen, objektbezogene Git-Hashes geprüft und Text-Diffs zeitlich begrenzt erzeugt. Die Runtime hält die Prozesssperre bis zum Schließen der Vorschau; Netzwerkzugriffe sind abbrechbar. Entschlüsselter Klartext nutzt den privaten, anschließend bereinigten Browser-Cache.
- `relocation.cjs` sucht auf begrenzten Listen verbundener Mounts nach gespeicherten Ordnerkennungen. Eindeutige Zuordnungen ändern Konfiguration, aktuelle Record-IDs und die IDs erledigter Warteschlangenaufgaben zusammen. `pending-relocations.json` ermöglicht die Wiederaufnahme nach einer Unterbrechung zwischen den atomaren JSON-Schreibschritten. Mehrdeutige oder zusammenfallende Zuordnungen werden abgelehnt.
- `notifications.cjs` enthält die Regeln für Ergebnisse und lokale Ruhezeiten. `UpdateMonitor` verbraucht während stummer Phasen keine Versionsmeldung; persistente Schreibvorgänge werden geordnet. Die GUI prüft ausstehende Meldungen ohne zusätzliche API-Abfrage erneut.
- `enhancements.js` ergänzt die Oberfläche um getrennte Benachrichtigungsoptionen, Quellenzeiten, OS-Auswahl und die maskierte Diff-Ansicht. Ausgerichtete Feldraster verwenden dieselben Kontrollhöhen und Subgrid-Zeilen wie die bestehenden Einstellungen.
- `scripts/publish-release.cjs` veröffentlicht zunächst einen Entwurf, wiederholt begrenzt vorübergehende GitHub-Fehler und prüft alle Uploads gegen Größen und SHA256-Digests. Erst danach wird der Release offiziell. Erneute Aufrufe verändern einen bereits vollständig geprüften offiziellen Release nicht.
## Vorhandene Release-Pakete finalisieren

Wenn alle Paketbauten erfolgreich waren und nur die Veröffentlichung scheitert, können die vorhandenen Artefakte weiterverwendet werden. Der normale Publisher findet Entwürfe auch ohne bereits veröffentlichten Git-Tag und prüft sie anschließend über ihre Release-ID. Vorübergehende HTTP-Fehler werden begrenzt wiederholt. Katalog-ZIPs erhalten feste Zeitstempel aus ihrem Quellcommit, damit eine Wiederholung identische Prüfsummen erzeugt.

Für eine Korrektur am Publisher die Datei [`.github/release-recovery.json`](../.github/release-recovery.json) mit Run-ID, ursprünglichem Quellcommit und Paketversion bewusst aktualisieren und auf `main` committen. Alternativ den Workflow **Finalize verified release** manuell ausführen. Der Workflow prüft eine erfolgreiche CI für diesen Quellcommit und alle acht erfolgreichen Paketjobs des angegebenen Release-Laufs. Er prüft außerdem Repository, Hauptbranch und Paketversion. Erst danach lädt er die Originalartefakte, erzeugt Kataloge und Hinweise aus dem ursprünglichen Quellstand und führt den getesteten aktuellen Publisher aus. Die Anwendung wird dabei nicht neu gebaut; der Release bleibt seinem ursprünglichen geprüften App-Commit zugeordnet.

Bereits offizielle Releases werden nicht überschrieben. Ein Entwurf für einen anderen Quellcommit wird abgelehnt. Ein reiner Wiederanlauf nach einem vorübergehenden Fehler kann weiterhin direkt über den fehlgeschlagenen Veröffentlichungsjob in Actions erfolgen. Zugangsdaten gehören weder in die Anfrage-Datei noch ins Repository.


## Version 3.2: Anbieter, Verlauf und Archivschlüssel

`provider-spec.cjs` normalisiert HTTPS-Server, Quellen und kollisionsfreie Zielpfade. GitHub-Pfade und bestehende IDs bleiben unverändert. `hosted-client.cjs` kapselt GitLab API v4 und Forgejo API v1, servergebundene Authentifizierung, paginierte Listen/Git-Bäume, begrenzte ETag-Caches und geprüfte Download-Streams. `hosted-metadata.cjs` erzeugt die jeweiligen Metadatenexporte. Der Programm-Updater verwendet weiterhin einen eigenen festen GitHub-Client.

`history.cjs` liefert gefilterte Run-Vorschauen, paginierte Details und vollständige anonymisierte Exporte der aufbewahrten Ergebnisse. `error-help.cjs` ordnet Fehler statischen, lokalisierten Hilfeschritten zu. `space-wait.cjs` prüft gespeicherte Byte-Anforderungen ohne Repository-Abfragen; die Warteschlange behält fehlgeschlagene Platz-Aufgaben offen und überspringt fertige Ziele.

`key-rotation.cjs` authentifiziert Archive vor dem Passwortwechsel, erstellt und prüft neue verschlüsselte Stände und nutzt gespeicherte Austauschzustände für die Wiederaufnahme. Die Vault verwahrt Passwortwerte nur im RAM oder ausdrücklich per OS-Schlüsselspeicher; `archive-keys.json` enthält ausschließlich Kennungen/Zuordnungen. Ein gewöhnliches Entsperren authentifiziert den aktuellen Archivschlüssel über einen verworfenen Klartext-Stream ohne zusätzliche Extraktion. `recommendations.cjs` lädt begrenzte Dateibäume/Attributdateien und aktiviert keine Optionen selbst.

Zusatzprüfung: `FORGEJO_BIN=/pfad/zur/geprüften/forgejo npm run test:forgejo`. Das optionale Entwicklerskript erzeugt eine private lokale HTTPS-Instanz samt temporärem Zertifikat, Dummy-Konto und Dummy-Repository, prüft die echten APIs/Git-/Asset-Zugriffe und entfernt den Testbestand anschließend. Es bewahrt die geerbte CA-Vertrauenskette und ergänzt ausschließlich den Testprozess. Die CI pinnt Forgejo 17.0.1 und dessen SHA256. Produktpakete enthalten diesen Testserver nicht.
## Quellenarbeitsbereich und Downloads in Version 3.3

`source-workspace.cjs` enthält Gruppen/Favoriten, die reine Bulk-Vorschau und die begrenzte Repository-Browser-Sitzung. Anbieter-Kontexte werden einmal aufgelöst; Seiten enthalten maximal 50 Einträge, die Sitzung hält maximal 30 Seiten und 10.000 kompakte Repository-Beschreibungen. Auswahl und Erzeugung neuer Quellen werden serverseitig validiert. Bulk-Übernahmen beziehen sich auf eine fünf Minuten gültige, an die aktuelle Konfiguration gebundene Vorschau. Organisatorische Änderungen schreiben keine Sicherungsdaten oder OS-Aufgaben.

`workspace.js` ergänzt den bestehenden Quellenbereich. Quellenlisten sind auf 25 Zeilen begrenzt. Fortschrittsereignisse ersetzen keine Sucheingaben oder Tabellen. Gruppen-, Auswahl-, Browser- und Bulk-Formulare verwenden die vorhandenen Abstände, Steuerelementhöhen und Darstellungsvariablen.

`release-downloads.cjs` speichert bis zu 4 MiB große Teile in einer durch Laufwerkskennung, Besitzdateien und Prozesssperre geschützten temporären Ablage. Jeder Teil besitzt eine SHA256-Prüfung; das Journal erlaubt das Übernehmen vollständig geschriebener beziehungsweise Zurückrollen noch nicht angelegter Teile. Verschlüsselte Backups verwenden scrypt und AES-256-GCM pro Teil mit zufälligem Nonce und an Identität/Reihenfolge gebundenen Zusatzdaten. Schlüssel werden nach einer Operation aus den Schlüsselbuffern entfernt. Im Download-Cache werden Passwörter und Download-URLs nicht als Klartext-Metadaten gespeichert.

Fortsetzen erfordert passende Content-Range-Angaben sowie eine starke ETag-Kennung, als stark verwendbare HTTP-Änderungsdaten oder eine bekannte SHA256-Prüfsumme. Änderungsdaten gelten nur in kanonischem HTTP-Format und bei mindestens 60 Sekunden Abstand zum Date-Header der ursprünglichen Antwort als ausreichend stark. If-Range wird auch an erlaubte CDN-Weiterleitungen übertragen; Anmeldedaten bleiben am ursprünglichen Server gebunden. Vollständige zwischengespeicherte Dateien werden vor Übernahme erneut geprüft. Bei wiederverwendeten Git-Verzeichnissen wird der ohnehin neu erzeugte Metadatenordner nicht unnötig mitkopiert.

Die macOS-Paketjobs verwenden Intel-Runner für x64, ARM64 und Universal, um zusätzliche Abhängigkeit vom zeitweise knappen ARM64-Paketrunner-Pool zu vermeiden. Die native macOS-ARM64-CI mit echten Electron-Tests bleibt erhalten; reine Paketmontage und native Ausführung werden getrennt geprüft. Herausgebersignierung, Notarisierung und automatische Update-Installation werden weiterhin nicht eingerichtet.


`renderer/source-input.js` wird von Renderer und Kern gemeinsam genutzt: URLs und Organisationshauptseiten werden vor der bestehenden Namensvalidierung normalisiert. Dynamische Owner-Quellen verwenden die vorhandene paginierte Auflösung je Prüfung; wiederholte Importe ändern keine vorhandenen Regeln. Deaktivierte einzelne Repository-Regeln behalten ihren Vorrang.

`release-layout.cjs` legt fertige Dateien sichtbar in `Git-Cloner-Releases` oder einer freien nummerierten Alternative ab und erhält ursprüngliche portable Namen. Das Manifest deckt auch diesen Ordner ab. Die Plan-Anwendung liefert Ablageinformationen je Ziel zurück; Ergebnisse verschiedener Ziele teilen kein veränderliches Release-Objekt. Alte interne Assets werden beim Neuaufbau entfernt; Wiederherstellung akzeptiert alte und neue Ablagen. Verschlüsselte Archive umfassen den sichtbaren Ordner innerhalb des verschlüsselten Payloads.


## Release-Verwaltung und Programme in 3.4

`release-reuse.cjs` prüft alte Manifeste/Zuordnungen und kopierte Inhalte, mit Reflink-Fallback und temporär authentifiziert entschlüsselten Altarchiven. `release-assets.cjs` kombiniert OS, CPU und Format mit klaren Ausschlussgründen. `download-storage.cjs` liest auf Anforderung begrenzt Metadaten, bindet Bereinigungsvorschauen an Dateistände und prüft Eigentum/Leases vor jeder Entfernung. Die UI lädt diese Übersicht nicht im Hintergrund.

`program-options.cjs` begrenzt optierte Installationen auf einzelne Quellen und separate Ziele. `program-installation.cjs` verwendet verifizierte Backups, eigene Staging-/Vorher-Kennungen und atomare Austausche; Fremddaten bleiben erhalten. macOS nutzt hdiutil, codesign, PlistBuddy und lipo mit festen Argumentlisten; Windows/ELF werden als portable Dateien kopiert, nicht ausgeführt. `program-archives.cjs` extrahiert ZIPs mit yauzl und prüft Pfade, Typen, Grenzen und CRC32; Links werden begrenzt und auf Windows abgelehnt. Es gibt keine Shell-Interpolation fremder Dateinamen, kein Ausführen heruntergeladener Programme und keine automatische Rechteerhöhung.

`npm run test:wordcraft` ist ein ausdrücklich macOS-spezifischer Live-Check: öffentliches Wordcraft-DMG v0.15.1 und SHA256 sind gepinnt; echte Quelle/Dateien werden gesichert und die App in einen isolierten Programmordner installiert, geprüft und beim Wiederholen übersprungen. Der Check startet die fremde App nicht und wird nur im nativen macOS-ARM64-CI-Job ausgeführt. Die normalen Kernprüfungen bleiben unabhängig von diesem externen Live-Download.

## Version 3.5: Programme und Transfermessung

`program-content.cjs` öffnet DMG/ZIP isoliert, begrenzt die Kandidatensuche und prüft gewählte Apps vor jeder Kopie. Gespeicherte IDs sind relative Archivpfade. Windows-Ordner mit gemeinsamen Begleitdateien werden nur einmal kopiert; Mac-Bundles bleiben einzeln signaturprüfbar. `program-installation.cjs` führt den gemeinsamen Austausch samt kompatibler Version-1-Kennung aus. Installationen am selben Programmziel werden innerhalb eines Runtime-Laufs nacheinander ausgeführt, während Downloads unabhängig weiterlaufen können.

`program-shortcuts.cjs` verwaltet genau eigene unveränderte Dateien in einem ausdrücklich gewählten Ziel. Mac-Symlinks, Desktop-Entry-Escaping in zwei Ebenen und native Windows-LNK-Erstellung über Electrons `shell.writeShortcutLink`. Der Hauptprozess reicht diese Funktion auch an die fensterlose Worker-Runtime weiter. Es werden keine PowerShell-Skripte zur LNK-Erstellung verwendet. Eine Zuordnung mit vorbereitetem Hash/Ziel erlaubt Erholung vor/nach Umbenennung. Veränderte Links werden nicht übernommen. Der Metadatenordner wird unter Windows mit dem nativen Dateiattribut verborgen.

`release-transfer.cjs` verbindet lokale Übernahme und Downloadmessung für GitHub und andere Anbieter. Empfangen wird bei tatsächlich gelesenen Antwort-Chunks gezählt. Für Fortsetzung wird die Menge vor dem Abruf vorhandener Chunk-IDs mit den am Ende authentifizierten verwendeten IDs geschnitten. Dadurch erzeugt dieselbe Wiederholung keine vermeintliche alte Ersparnis. `ReleaseDownloads.removeEntry/clear` melden vor dem erfolgreichen Entfernen summierte reguläre Dateigrößen. Es werden keine gemeinsam belegten physischen Blöcke oder hypothetischen Zeitgewinne geschätzt.

`download-history.cjs` speichert höchstens 2.000 normalisierte Ereignisse, bündelt Schreibvorgänge bis zum nächsten Zeit-/Zustandscheckpoint und paginiert mit 50 Treffern. Alle gefilterten Treffer tragen zu Kennzahlen bei. Verschlüsselte Asset-Namen werden bereits vor der Persistenz entfernt. Die neue Renderer-Erweiterung `program-library.js` lädt diese Daten und Archivkandidaten ausschließlich bei Bedarf; laufende Fortschrittsmeldungen ersetzen keine Filtereingaben. Veraltete Antworten werden verworfen. GUI-Fixtures für die Programmliste werden nur im expliziten E2E-Modus akzeptiert; die native Integrationssuite prüft reale Archive und Programme.
