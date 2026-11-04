# Anonymisierte Anleitung für Git Cloner 3

Alle Konto-, Repository- und Laufwerksnamen in dieser Anleitung sind Platzhalter. Die App trägt **keine Standardquellen** ein. Die Bilder zeigen echte App-Fenster mit einem isolierten Testprofil. Zugangsdaten sind weder erforderlich noch abgebildet.

## 1. Installation

Verwende ausschließlich die [offiziellen GitHub-Releases](https://github.com/Ujap1994/Git-Cloner/releases) und kontrolliere die Download-Prüfsumme aus `SHA256SUMS.txt`. Eine vorbereitete Paketart bedeutet noch nicht, dass bereits ein entsprechendes Release veröffentlicht wurde.

Die fertige App benötigt kein separates Node.js. **Git muss erreichbar sein**, für die optionale LFS-Sicherung zusätzlich **Git LFS**. Flatpak enthält beides. Nach einer Git-Installation die App neu starten.

| System | Passendes Paket und Installation |
| --- | --- |
| macOS | Universal für Intel und Apple Silicon, alternativ x64 oder ARM64. DMG öffnen und App nach „Programme“ ziehen. Git bei Bedarf über `xcode-select --install` installieren. |
| Windows | Git for Windows installieren und die PATH-Integration für andere Programme wählen. Danach x64-/ARM64-Installer oder Portable starten. |
| Ubuntu / Mint | Git installieren; dann `sudo apt install ./DATEINAME.deb`. |
| Fedora | `sudo dnf install git ./DATEINAME.rpm`. |
| Arch / CachyOS | `sudo pacman -U ./DATEINAME.pkg.tar.zst`. Die Abhängigkeiten werden vom Paketmanager aufgelöst. |
| AppImage | Git installieren, Datei ausführbar machen (`chmod +x ./DATEINAME.AppImage`) und starten. Je nach Distribution ist FUSE erforderlich; alternativ `--appimage-extract` verwenden. |
| Linux TAR.GZ | An einem festen Ort entpacken und die enthaltene Anwendung starten; Git und die Desktop-Laufzeitbibliotheken müssen installiert sein. |

`DATEINAME` steht jeweils für den tatsächlichen Dateinamen aus dem Release. Für ARM64 ein entsprechendes Paket wählen. CachyOS verwendet hauptsächlich x86_64; Linux-aarch64-Pakete richten sich an kompatible ARM-Systeme.

Die Pakete besitzen keine verifizierte Herausgebersignatur. macOS verwendet eine technisch erforderliche Ad-hoc-Signatur und ist nicht notarisiert. Nach Kontrolle von Quelle und Prüfsumme kann eine Freigabe unter **Systemeinstellungen → Datenschutz & Sicherheit** nötig sein; Windows kann SmartScreen anzeigen. Einrichten von Signierzertifikaten oder automatischen Update-Installern gehört ausdrücklich nicht zum Funktionsumfang.

Lege Portable- und AppImage-Dateien vor dem Einrichten von Autostart oder OS-Zeitplan an ihrem endgültigen Ort ab. Nach einem Verschieben diese Optionen aus- und wieder einschalten. Portable speichert die Einstellungen weiterhin im normalen Benutzerprofil.

### Flatpak

Das Release kann ein x64-Bundle enthalten. Ein Bundle ist noch kein öffentlicher Flathub-Eintrag:

```sh
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./DATEINAME.flatpak
flatpak run io.github.Ujap1994.GitCloner
```

Home und übliche Mount-Pfade `/media`, `/run/media` und `/mnt` sind freigegeben. Für einen anderen Pfad gezielt Zugriff erlauben, beispielsweise:

```sh
flatpak override --user --filesystem=/backups io.github.Ujap1994.GitCloner
```

Flatpak nutzt App-Zeitplan und Autostart, keinen unabhängigen systemd-Worker. Für gespeicherte Zugangsdaten wird ein funktionierender Secret-Service benötigt. Die reguläre Anwendung schaltet ihre Chromium-Sandbox nicht ab; bei Problemen mit AppImage vorzugsweise ein natives Paket oder Flatpak verwenden.

## 2. Laufwerk und Quellen einrichten

Verbinde die externe Festplatte und lege einen Sicherungsordner an. Beispiele:

| System | Neutraler Zielpfad |
| --- | --- |
| macOS | `/Volumes/BackupDisk/GitHub` |
| Windows | `E:\GitHub-Backups` |
| Linux | `/media/backup-disk/GitHub` |

Der Ordner muss vorhanden und beschreibbar sein. Unter macOS kann die Erlaubnis für Wechselmedien notwendig sein. Die App speichert dort eine zufällige Laufwerkskennung in `.git-cloner-volume.json`. Diese Datei erhalten: Ein fehlendes oder ausgetauschtes Laufwerk darf nicht versehentlich durch einen neuen lokalen Ordner ersetzt werden.

Öffne **Quellen → Quelle hinzufügen** und trage eigene Konten oder Repositories ein, eine Quelle pro Zeile:

```text
beispiel-konto
anderes-konto/werkzeug
```

`beispiel-konto` sichert die für deine Zugangsdaten sichtbaren eigenen Repositories dieses Kontos oder dieser Organisation. `anderes-konto/werkzeug` sichert nur dieses Repository. Vollständige GitHub-HTTPS-Adressen funktionieren ebenfalls. Die Beispiele werden nicht automatisch übernommen.

![Quelle mit neutralen Eingabefeldern hinzufügen](screenshots/add-source.png)

Wähle den Zielordner. Mehrere gemeinsam eingegebene Quellen teilen ihn zunächst; anschließend kannst du jede Quelle einzeln bearbeiten. Die Ablage ist `Ziel/Konto/Repository`. Eine aktive Einzelregel hat Vorrang vor einer gleichzeitig vorhandenen Kontoregel für dasselbe Repository.

Unter **Weitere Ziele, Konto und Filter** stehen zusätzliche Optionen bereit:

- Bis zu neun weitere Speicherorte, insgesamt zehn je Quelle. Jedes Ziel erhält eine unabhängige Sicherung und Laufwerkskennung.
- Ein GitHub-Zugang aus deinen gespeicherten Konten. „Standard“ funktioniert bei öffentlichen Quellen auch ohne Token.
- Forks und archivierte Repositories einschließen oder ausschließen.
- Namensmuster zum Ein- und Ausschließen: `web-*`, `*-alt` oder `beispiel-konto/projekt?`. `*` steht für beliebig viele Zeichen, `?` für genau eines. Ausschlüsse haben Vorrang.

![Erweiterte Quelleneinstellungen mit neutralen Beispielen](screenshots/source-advanced.png)

Quellen lassen sich pausieren oder entfernen. Vorhandene Sicherungen bleiben erhalten. Auch auf GitHub gelöschte oder umbenannte Repositories werden lokal nicht automatisch entfernt.

## 3. Erste Prüfung und Status

Wähle **Jetzt prüfen**. Neue Stände werden zunächst separat aufgebaut und geprüft. Erst danach ersetzen sie den bisherigen Stand. Ein Fehler lässt den vorherigen Stand bestehen; andere Quellen werden weiter bearbeitet. Nach Abschluss gibt es je Ziel genau einen erfolgreichen Stand, keine historische Ordnerrotation.

![Leere Startübersicht ohne Standard-Repositories](screenshots/overview.png)

| Status | Bedeutung |
| --- | --- |
| Gesichert | Erste Sicherung angelegt. |
| Aktualisiert | Veränderte Git-Daten oder Metadaten übernommen. |
| Aktuell | Der geprüfte Remote-Stand entspricht der Sicherung. |
| Repariert | Beschädigte verwaltete Sicherung erfolgreich neu aufgebaut. |
| Leer | Das Git-Repository enthält noch keinen Commit. |
| Fehler | Der Vorgang war nicht erfolgreich; Meldung im Verlauf prüfen. |

Suche und Statusfilter helfen bei vielen Repositories. Die Liste zeigt bis zu 75 Zeilen pro Seite. Einträge bieten Integritätsprüfung und Wiederherstellung. Ein Integritätsfehler bleibt sichtbar und erzwingt beim nächsten Sicherungslauf eine erneute Prüfung beziehungsweise Reparatur.

Die App verarbeitet standardmäßig bis zu zwei kleine Repositories parallel. Aufwendige Sicherungen laufen einzeln; die Grenzen lassen sich unter „Leistung & Regeln“ einstellen. Während einer Sicherung bleiben Navigation, Suche und Statusanzeige nutzbar; Änderungen an Quellen und Sicherungseinstellungen warten auf das Ende des Vorgangs. Temporär muss Platz für den bisherigen und den neuen Stand vorhanden sein.

## 4. Sicherungsumfang wählen

Unter **Einstellungen → Sicherung** sind Zusatzfunktionen standardmäßig ausgeschaltet:

| Option | Wirkung |
| --- | --- |
| Aktueller Stand | Schnelle flache Arbeitskopie des aktuellen Standardbranches. Keine vollständige Git-Historie. |
| Vollständiger Mirror | Bare-Repository mit vollständiger Git-Historie, allen Branches und Tags. Kein ausgecheckter Arbeitsordner. Änderungen werden inkrementell geholt. |
| Git LFS | Echte LFS-Inhalte herunterladen; zusätzlich installiertes Git LFS erforderlich. |
| Submodule | Im Snapshot rekursiv auschecken. Nur sichere HTTPS-Remotes; GitHub-SSH-Adressen werden auf HTTPS umgesetzt. Nicht mit Mirror kombinierbar. |
| Issues | Issues und Kommentare als JSON. |
| Pull Requests | PRs, Reviews, Kommentare und Änderungsinformationen als JSON. |
| Releases | Release-Daten und zugehörige Dateien. Große Dateien benötigen entsprechend Platz und Zeit. |
| Wiki | Separater Git-Mirror des Wikis. Ein nicht zugängliches Wiki wird ausdrücklich gemeldet. |

Die Metadaten liegen im Verwaltungsordner `git-cloner-metadata` innerhalb von `.git` beziehungsweise im Bare-Mirror. Sie sind Exporte, kein automatischer Rückimport in GitHub. Der Wiki-Zugriff kann bei nicht angelegten Wikis scheitern. Hat eine vorhandene Sicherung bereits ein Wiki, verhindert ein späterer Abruffehler den Austausch dieses Stands.

![Sicherungsoptionen mit gleich hohen Auswahlfeldern](screenshots/backup-settings.png)

Die Speicherreserve ist zusätzlich zum geschätzten Repository-Bedarf vorgesehen. Die GitHub-Größenangabe ist eine Schätzung; sehr große LFS- und Release-Dateien können darüber liegen. Bei Platzmangel wird kein vorhandenes Backup vorsorglich gelöscht.

## 5. Integrität und Verschlüsselung

Neue Sicherungen werden mit Git-Prüfung und SHA256-Dateimanifest versehen. Bereits unveränderte Sicherungen werden standardmäßig wöchentlich vollständig geprüft. Alternativ **bei jeder Prüfung** oder **nur manuell** wählen. Eine manuelle Prüfung ist in Übersicht und Wiederherstellung möglich.

Für verschlüsselte Sicherungen:

1. Unter **Einstellungen → Sicherung** ein eigenes Archivpasswort mit mindestens zwölf Zeichen setzen.
2. Optional das Passwort im sicheren Betriebssystem-Schlüsselspeicher merken.
3. Verschlüsselung aktivieren, Einstellungen speichern und **Jetzt prüfen** starten.
4. Anschließend eine Wiederherstellung an einem anderen Ort testen.

Im Ziel liegen dann `backup.gcb` und eine Verwaltungsdatei. Git-Inhalte, Dateinamen und Metadaten innerhalb des Archivs werden mit AES-256-GCM und scrypt verschlüsselt. Der umgebende Pfad verrät weiterhin Konto- und Repository-Namen; die Verwaltungsdatei enthält Statusdaten. Für vollständigen Schutz des Datenträgers dessen Laufwerksverschlüsselung verwenden.

**Ein vergessenes Passwort ist nicht wiederherstellbar.** Bewahre es unabhängig von der App auf. Nach einem Passwortwechsel benötigen noch nicht erfolgreich ausgetauschte Archive das alte Passwort. Ohne „merken“ gilt das Passwort nur für die aktuelle Sitzung; nach einem Neustart erneut eingeben. Der unabhängige Worker benötigt ein sicher gespeichertes Passwort und einen entsperrbaren OS-Schlüsselspeicher.

Während der Verarbeitung liegen entschlüsselte Daten in einem privaten lokalen Temp-Ordner, der anschließend entfernt wird. Das ist kein forensisch sicheres Löschen. Die regelmäßige Prüfung verschlüsselter Archive kontrolliert ihren SHA256-Wert; die manuelle Prüfung entschlüsselt zusätzlich und prüft Git sowie alle Dateien. Ein falsches Passwort oder veränderte Archivdaten verhindern die Extraktion.

## 6. Zeitplan, Autostart und Laufwerke

Unter **Zeitplan** automatische Prüfungen aktivieren und **1 bis 24 Prüfungen pro Tag** einstellen. Pro Prüfung erscheint ein eigenes Uhrzeitfeld. Beispielsweise sind 02:00, 10:00 und 18:00 möglich. Doppelte oder ungültige Zeiten werden abgelehnt. Alle Zeiten beziehen sich auf die lokale Systemzeitzone.

![Zeitplan mit mehreren ausgerichteten Uhrzeitfeldern](screenshots/schedule.png)

**Beim Schließen im Hintergrund weiterlaufen** lässt den App-Zeitplan im Tray beziehungsweise in der Menüleiste aktiv. Fehlt ein verfügbarer Tray, bleibt das Fenster offen. **Bei der Anmeldung starten** richtet den Autostart der installierten App ein. In einer Entwicklungsfassung ist dies deaktiviert.

Optional **Unabhängige OS-Zeitplanung** einschalten: Native installierte Pakete richten einen macOS-LaunchAgent, eine Windows-Aufgabe oder einen systemd-Benutzertimer unter Linux ein. Damit prüft ein GUI-freier Worker auch bei beendeter Oberfläche. Eine laufende Oberfläche und ein Worker überschreiben sich durch eine gemeinsame Sperre nicht gegenseitig. Deaktivieren entfernt den von der App angelegten Eintrag. Entwicklungsfassungen und Flatpak unterstützen diese Option nicht.

**Der Rechner muss eingeschaltet und wach sein, der Benutzer angemeldet.** Die App weckt ihn nicht auf. Beim Aufwachen beziehungsweise Start holt der App-Zeitplan die letzte verpasste Prüfung des aktuellen Tages einmal nach; ältere Tage werden nicht einzeln abgearbeitet. Native Dienste können zusätzlich verpasste Termine gemäß ihren OS-Regeln nachholen.

**Beim Verbinden eines Laufwerks prüfen** erkennt zuvor konfigurierte Zielpfade innerhalb von ungefähr 30 Sekunden, während die App läuft. Nur wieder angeschlossene Ziele werden angefragt. Ein fehlendes Laufwerk erzeugt einen Fehler, keinen Ausweichordner. Diese Erkennung startet eine vollständig beendete App nicht selbst.

## 7. Mehrere GitHub-Konten und Anmeldung

Öffentliche Quellen funktionieren ohne Anmeldung. GitHub erlaubt anonym typischerweise 60 API-Anfragen pro Stunde. Private Repositories oder größere Mengen benötigen passende Leserechte.

Unter **Einstellungen → Konten** lassen sich mehrere benannte Zugänge anlegen. Jede Quelle wählt ihren Zugang in den erweiterten Einstellungen.

### Personal Access Token

Über den angebotenen GitHub-Link ein Token mit minimal erforderlichen Leserechten erstellen. Bei Fine-grained Tokens benötigt Quelltext `Contents: Read`; für optionale Metadaten zusätzlich die jeweiligen Lese-Berechtigungen für Issues und Pull Requests. Organisationen können Freigabe oder SSO verlangen. Das Token ausschließlich in das Passwortfeld der App einfügen und speichern. Es wird nicht wieder angezeigt.

### Device Flow

Die App unterstützt GitHubs Device Flow. Dafür ist die öffentliche **Client-ID einer GitHub-OAuth-App mit aktiviertem Device Flow** nötig. Es wird kein Client-Secret benötigt. Eine allgemeine OAuth-App wird von diesem Projekt nicht bereitgestellt. Ohne eine solche Client-ID stattdessen öffentliche Quellen oder ein Personal Access Token nutzen.

Nach Eingabe der Client-ID beim gewünschten Konto die Geräteanmeldung starten, den angezeigten Code auf GitHub bestätigen und zur App zurückkehren. Anmeldungen lassen sich abbrechen; abgelaufene Codes neu erzeugen.

Tokens und optional das Archivpasswort speichert Electron `safeStorage` verschlüsselt. Ein unsicherer Linux-Klartext-Fallback wird abgelehnt. Ein fehlender oder gesperrter Keyring kann das Speichern verhindern. Tokens stehen nicht in Repo-URLs, Prozessargumenten oder exportierten Einstellungen. „Zugang entfernen“ löscht den gespeicherten Zugang; vorhandene Sicherungen bleiben erhalten.

## 8. Wiederherstellung

Öffne **Wiederherstellen**, wähle einen gesicherten Eintrag oder eine vorhandene `.gcb`-Archivdatei und einen vorhandenen übergeordneten Zielordner. Vergib einen **neuen Ordnernamen**. Ein bestehender Ordner wird nicht überschrieben.

![Wiederherstellungsassistent](screenshots/restore.png)

Der Assistent prüft die Quelle, kopiert oder entschlüsselt sie und verifiziert das Ergebnis vor dem endgültigen Umbenennen. Ein Archiv benötigt sein damaliges Passwort. Eine GitHub-Anmeldung ist zur lokalen Wiederherstellung nicht erforderlich. Ein Mirror bleibt bei der Wiederherstellung ein Bare-Repository; daraus lässt sich anschließend eine Arbeitskopie klonen:

```sh
git clone /PFAD/ZUM/WIEDERHERGESTELLTEN-MIRROR /NEUER/ARBEITSORDNER
```

Entwickle ausschließlich in einem separaten Arbeitsordner. Änderungen innerhalb einer verwalteten Sicherung können beim nächsten Austausch verloren gehen. Ein flacher Snapshot enthält nur den gesicherten Standardbranch; zusätzliche Historie kann nur nachgeladen werden, solange ein erreichbares Original sie noch bereitstellt.

## 9. Neue Versionen melden und überspringen

Die Seitenleiste zeigt die ausgeführte Version. Beim Start und danach alle sechs Stunden vergleicht die automatische Versionsprüfung diese mit dem letzten offiziellen stabilen Release von `Ujap1994/Git-Cloner`. Unter **Einstellungen → Allgemein** kannst du manuell prüfen oder die automatische Prüfung deaktivieren.

Eine neuere Version erscheint als Hinweis mit einem Link zur offiziellen Release-Seite. Wenn Benachrichtigungen aktiv sind, gibt es einmalig eine Systemmeldung. **Diese Version überspringen** speichert die Auswahl dauerhaft. Dieselbe oder eine niedrigere Version erzeugt auch nach einem Neustart keine erneute Update-Info. Erst eine höhere Version löst wieder einen Hinweis aus. **Übersprungene Version zurücksetzen** hebt die Auswahl auf.

![Update-Hinweis aus einer lokalen Testantwort; 3.1.0 ist ausschließlich ein Demonstrationswert](screenshots/update-notice.png)

Das Bild verwendet eine simulierte Release-Antwort, keine Behauptung eines veröffentlichten Releases. Die App lädt oder installiert keine Updates automatisch. Zur Aktualisierung das passende offizielle Paket herunterladen, laufende Sicherungen beenden und die neue Version selbst installieren. Gibt es noch kein offizielles Release, zeigt die App dies als eigenen Zustand an.

## 10. Darstellung, Einstellungen und Diagnose

Unter **Einstellungen → Darstellung** gibt es Deutsch/Englisch, Hell/Dunkel/System und drei Schriftgrößen. Auswahlfelder sind gleich hoch; größere Schrift verändert die gesamte Oberfläche. Die Auswahl bleibt nach Neustarts erhalten.

![Englische Oberfläche im Dunkelmodus](screenshots/dark-english.png)

**Einstellungen → Import / Export** exportiert oder importiert Quellen, Optionen und gegebenenfalls erlaubte WLAN-Namen. Tokens und Passwörter werden ausgeschlossen. **Namen und Pfade sind in Einstellungsdateien weiterhin enthalten**; solche Dateien nicht ungeprüft teilen. Ein Import zeigt eine Vorschau und bindet Zielordner neu; OS-Autostart und unabhängige Zeitplanung werden nicht fremd übernommen.

Der Diagnoseexport entfernt Konto-/Repository-Namen, Pfade, Commit-IDs und rohe Fehlermeldungen. Der Verlauf behält bis zu 100 Durchläufe und maximal 500 Einzelergebnisse je Lauf, Fehler zuerst. Gesamtsummen bleiben erhalten. `settings.json`, `state.json`, `history.json` und die verschlüsselte `secrets.enc` niemals als vermeintlich anonymen Support-Export versenden.

| Problem | Nächster Schritt |
| --- | --- |
| Git fehlt | Git installieren, PATH prüfen, App neu starten. Unter macOS kann die Finder-Umgebung von der Terminal-Umgebung abweichen. |
| Laufwerkskennung fehlt | Richtigen Datenträger verbinden. Bei einem bewusst neuen Ziel die Quelle neu einrichten. Keine fremde Kennung kopieren. |
| Fremder Ordner blockiert Ziel | Neuen Zielordner wählen oder vorhandene Daten selbst sicher verschieben. |
| Platzmangel | Platz für den alten und neuen Stand sowie Reserve freigeben; Metadaten/LFS können größer als die Schätzung sein. |
| GitHub 401 / 403 | Gültigkeit, Repository-Freigabe, Org-SSO und API-Limit prüfen. |
| LFS fehlt | Git LFS installieren oder die Option abschalten; vorhandener erfolgreicher Stand bleibt erhalten. |
| Passwort fehlt/falsch | Das Passwort dieses Archivs eingeben. Nach einem Wechsel kann für ältere Archive noch das alte gelten. |
| Kein automatischer Lauf | Quelle und Zeitplan aktiviert/gespeichert? Rechner wach? App im Hintergrund oder OS-Worker aktiv? |
| Token nicht speicherbar | Sicheren OS-Schlüsselspeicher/Keyring einrichten oder öffentliche Quellen verwenden. |

[Architektur und Datenablage](ENTWICKLUNG.md) · [Paketverzeichnisse](PAKETVERZEICHNISSE.md) · [Roadmap-Status](ROADMAP.md)


## 11. Einrichtungsassistent und Probelauf

Auf der leeren Übersicht **Einrichtung starten** wählen. Der Assistent enthält keine Standardquelle. Trage eigene Quellen ein, wähle einen bestehenden Sicherungsordner und lege anschließend Häufigkeit und Uhrzeiten fest. Vor dem Speichern zeigt er eine Vorschau der geplanten Ablage. Erst **Einrichtung speichern** bindet das Laufwerk und speichert die Quellen.

![Dritter Schritt des Assistenten mit neutralen Testdaten](screenshots/setup-wizard.png)

**Probelauf** in Übersicht oder Quellen fragt ausschließlich Repository-Daten ab und liest vorhandene Zielordner. Es werden weder Klone noch Laufwerkskennungen angelegt. Die Vorschau nennt gefundene Repositories, durch Filter oder Vorrangregeln ausgeschlossene Einträge, Zielpfade und die GitHub-Größenschätzung. Bei mehreren Zielen auf demselben erkannten Datenträger wird der gemeinsame freie Platz berücksichtigt. LFS, Submodule und Release-Dateien können größer als diese Schätzung sein. Auch ein Probelauf verbraucht GitHub-API-Anfragen.

![Probelauf ohne Schreibzugriffe](screenshots/dry-run.png)

Die neuen Bilder verwenden isolierte Testprofile. Sichtbare `/tmp/gc-…`-Pfade sind zufällige temporäre Testverzeichnisse; Konto- und Repository-Namen sind neutrale Beispiele.

## 12. Pausieren und nach Neustart fortsetzen

Während eines Durchlaufs **Nach laufenden Repos pausieren** wählen. Bereits gestartete Repositories werden abgeschlossen; neue Aufgaben starten nicht mehr. Bei paralleler Ausführung können deshalb noch zwei oder mehr aktive kleine Repositories fertig werden. Danach erscheint **Fortsetzen**. Die ausstehenden Aufgaben und die Laufkonfiguration werden gespeichert und bleiben nach einem App-Neustart verfügbar.

![Gespeicherte pausierte Warteschlange](screenshots/paused-queue.png)

**Fortsetzen** überspringt die in diesem Lauf bereits abgeschlossenen Ziele. **Warteschlange verwerfen** entfernt ausschließlich den ausstehenden Lauf; vorhandene Backups bleiben erhalten. Während eine Warteschlange wartet, bleiben Quellen und Sicherungsumfang fest. Leistungsregeln, Darstellung und zukünftige Prüfzeiten lassen sich ändern. Für einen anderen Sicherungsumfang zunächst den Lauf abschließen oder verwerfen.

Eine Regelpause durch Strom/WLAN wird im laufenden Hintergrundbetrieb etwa alle 30 Sekunden neu geprüft und bei erlaubten Bedingungen automatisch fortgesetzt. Nach einer bewusst gewählten Pause, einem Neustart während eines aktiven Laufs oder einem allgemeinen Laufabbruch bleibt das Fortsetzen ausdrücklich bei dir. Ein unabhängiger Worker prüft Regelpausen bei seinen nächsten Starts. Er startet keine dauerhaft laufende Überwachung einer beendeten GUI.

Zustand und Warteschlange werden gebündelt sowie beim Pausieren geschrieben. Nach einem harten Prozessabbruch können noch nicht protokollierte Prüfungen erneut stattfinden; erfolgreich ausgetauschte Backups bleiben maßgeblich. Es entsteht keine historische Ordnerrotation.

## 13. Leistung, Download-Limit und Ressourcenregeln

Unter **Einstellungen → Leistung & Regeln**:

| Einstellung | Bedeutung |
| --- | --- |
| Parallele kleine Repositories | 1–4, Standard 2. Höchstens zwei kleine Aufgaben je erkanntem Datenträger. |
| Als klein behandeln bis | GitHub-Größenschätzung in MiB, Standard 50. Unbekannte oder größere Repositories laufen exklusiv. |
| Aufwendige Sicherungen | Mirrors, LFS, Submodule, Metadaten und Verschlüsselung laufen unabhängig von der Größenschätzung einzeln. |
| Wiederholungen | 0–5 zusätzliche Versuche je vorübergehend fehlgeschlagener Netzwerkoperation; Standard 2. Zunehmende Wartezeit und begrenzte Berücksichtigung von Retry-After. Verschachtelte Wiederholungen vervielfachen die Versuchszahl nicht. |
| Download-Limit | KiB/s, 0 = unbegrenzt. Gemeinsames Limit über Git-, LFS- und Release-Downloads, einschließlich Transportdaten. API-JSON, Uploads und andere Anwendungen sind ausgenommen. |
| Nur am Netzteil sichern | Bei Akkubetrieb oder unbekanntem erforderlichem Stromstatus wartet die Warteschlange. Laufende Aufgaben werden fertiggestellt. |
| Erlaubte WLAN-Namen | Exakter Name pro Zeile. Leer erlaubt alle Netzwerke. Bei nicht erlaubtem oder unbekanntem WLAN-Namen wartet die App. |

![Leistung und Regeln](screenshots/performance-settings.png)

Die Regeln greifen schon vor der ersten Repository-Abfrage eines Sicherungslaufs. Ein manuell angeforderter Probelauf ist eine separate Leseoperation. Unter macOS kann die SSID aus Datenschutzgründen verborgen sein; dann Standort-/Systemberechtigungen prüfen oder die optionale WLAN-Liste leer lassen. Unter Linux wird `nmcli` aus NetworkManager verwendet. Im Flatpak kann diese Host-Abfrage fehlen. Es gibt keine automatische Erkennung aller Mobilfunktarife; eine konkrete WLAN-Liste kann beispielsweise das eigene Hotspot-Netz ausschließen.

Download-Messung und Begrenzung verwenden einen lokalen HTTPS-Tunnel ohne Entschlüsselung des TLS-Verkehrs. Ein konfigurierter HTTP-/HTTPS-Unternehmensproxy wird berücksichtigt. Nicht unterstützte Proxy-Protokolle erzeugen einen Fehler, statt die Begrenzung still zu umgehen. Die App benötigt dafür keine Zertifikate und schaltet die TLS-Prüfung nicht aus.

## 14. Sicherungsumfang je Quelle

Im Quelleneditor **Sicherungsumfang dieser Quelle** öffnen und **Eigene Sicherungsoptionen verwenden** aktivieren. Modus, LFS, Submodule, Metadaten, Integrität und Verschlüsselung gelten dann nur für diese Quelle. Die Speicherreserve wird beim Aktivieren aus den allgemeinen Optionen übernommen. Alle Ziele dieser Quelle verwenden denselben gewählten Umfang.

Ohne eigene Optionen gelten die allgemeinen Sicherungseinstellungen. Für unterschiedliche Regeln innerhalb eines ganzen Kontos einzelne Repository-Regeln anlegen; diese haben weiterhin Vorrang vor der Kontoregel. Eine Verschlüsselungsoption benötigt ein gesetztes Archivpasswort. Mirror und ausgecheckte Submodule bleiben nicht kombinierbar.

## 15. Dateien oder Ordner gezielt wiederherstellen

Unter **Wiederherstellen** eine Sicherung oder GCB-Datei wählen. Ein Archivpasswort gegebenenfalls direkt im ersten Bereich eingeben. Unter **Wiederherstellungsumfang** auf **Einzelne Dateien oder Ordner** wechseln und **Dateien auswählen** öffnen. Ordner lassen sich öffnen oder vollständig markieren. Mehrere Auswahlpfade sind möglich; überlappende Auswahlen kopieren eine Datei nur einmal.

![Dateiauswahl aus einem entschlüsselten Testarchiv](screenshots/selective-restore.png)

Danach einen vorhandenen übergeordneten Ordner und einen neuen Ausgabeordnernamen wählen. Die relative Ordnerstruktur bleibt erhalten. Git-Verwaltungsdateien sind in der Arbeitskopie-Auswahl verborgen. Ein Mirror zeigt Dateien seines HEAD-Stands; exportierte Git-Dateien werden anhand ihrer Objekt-IDs geprüft und vorhandene LFS-Objekte auf echte Inhalte aufgelöst. Vollständige Mirror-Wiederherstellung bleibt zusätzlich möglich.

Neue Sicherungen schützen das Dateimanifest mit einem separaten Hash im Verwaltungsmarker. Die Auswahl prüft dieses Manifest und die tatsächlich ausgewählten Dateien. Dadurch können intakte Dateien auch dann gerettet werden, wenn eine andere Datei beschädigt ist. Ältere Sicherungen ohne Manifest-Hash benötigen zunächst die vollständige bisherige Prüfung. Die manuelle Gesamtintegritätsprüfung bleibt unabhängig davon verfügbar.

Verschlüsselte Archive müssen zur Auswahl vollständig authentifiziert und in einen privaten lokalen Temp-Ordner entpackt werden. Die Dateiauswahl bleibt fünf Minuten nach der letzten Nutzung verfügbar; Schließen, Verlassen der Wiederherstellungsseite oder reguläres Beenden entfernt die temporären Daten. Während einer laufenden Wiederherstellung werden sie nicht vorzeitig gelöscht. Nach einem harten Prozessabbruch können OS-Temp-Dateien zurückbleiben; es gibt kein forensisch sicheres Löschen.

## 16. Dashboard, hoher Kontrast und Tastatur

Die Übersicht zeigt während eines Laufs Laufzeit, abgeschlossene Aufgaben, eine ungefähre Restzeit und empfangene Daten. Restzeiten sind Schätzungen aus dem bisherigen Ablauf; vor der ersten abgeschlossenen Aufgabe gibt es noch keine belastbare Schätzung. Das Dashboard zeigt erfassten Backup-Umfang, freien Speicher, Netzwerkempfang der letzten sieben lokalen Kalendertage und Fehler beziehungsweise seit über 48 Stunden ungeprüfte Sicherungen. Alte Statusdaten können noch keine Bytewerte enthalten. Andere Programme und API-JSON werden nicht als Backup-Download mitgezählt.

![Dashboard aus einem tatsächlichen lokalen Testlauf](screenshots/dashboard.png)

Unter **Darstellung** lässt sich **Hoher Kontrast** aktivieren. Tastaturbedienung umfasst sichtbare Fokusrahmen, einen Überspringlink zum Inhalt, Statusansagen und Pfeiltasten/Pos1/Ende in Einstellungsreitern. Die Kontrastprüfung der Tests ersetzt keine vollständige externe Barrierefreiheitszertifizierung.

![Darstellung mit hohem Kontrast](screenshots/high-contrast.png)

| Tastenkürzel | Funktion |
| --- | --- |
| Cmd/Ctrl + K | Übersicht und vorhandenes Suchfeld öffnen. |
| Cmd/Ctrl + N | Quelle hinzufügen, wenn kein Lauf aktiv oder pausiert ist. |
| Cmd/Ctrl + B | Prüfung starten, wenn Quellen vorhanden sind. |
| Cmd/Ctrl + Umschalt + P | Pause anfordern beziehungsweise fortsetzen. |
| Cmd/Ctrl + Komma | Einstellungen öffnen. |
| F1 | Tastenkürzel anzeigen. |
| Esc | Dialog schließen. |
