# Diesen Chat am Mac öffnen und Git Cloner starten

## Den bestehenden Chat weiterverwenden

1. Auf dem Mac Safari oder Chrome öffnen. Für eine bestehende Codex-Aufgabe [Codex](https://chatgpt.com/codex) aufrufen; für einen Chat in ChatGPT [chatgpt.com](https://chatgpt.com) öffnen. Verwende dieselbe Produktoberfläche wie auf dem bisherigen Gerät.
2. Mit **demselben ChatGPT-Konto und derselben Anmeldemethode** wie auf dem bisherigen Gerät anmelden.
3. Falls mehrere Arbeitsbereiche vorhanden sind, denselben persönlichen oder geschäftlichen Arbeitsbereich auswählen.
4. In Codex dasselbe Projekt und die vorhandene Aufgabe öffnen; in ChatGPT den bestehenden Chat im Verlauf auswählen. Die Unterhaltung kann dort fortgesetzt werden.

Falls der Chat fehlt, zuerst Konto und Arbeitsbereich prüfen. Temporäre Chats erscheinen nicht im normalen Verlauf. Ein GitHub-Login ist eine separate Verbindung und bestimmt nicht, welche ChatGPT-Unterhaltungen angezeigt werden.

Alternativ kann auf unterstützten Macs die offizielle [ChatGPT-Desktop-App](https://chatgpt.com/download/) verwendet werden. Der Browser ist auch dann geeignet, wenn die Desktop-App den jeweiligen Mac nicht unterstützt. Für das Weiterführen dieses Chats wird keine separate Codex-CLI oder Editor-Erweiterung benötigt.

Der hier verwendete Projektordner liegt in einer Cloud-Umgebung. Das Öffnen des Chats auf dem Mac überträgt ihn nicht automatisch auf dessen Festplatte. Eine separate Codex-CLI beziehungsweise Editor-Sitzung übernimmt diesen Chatverlauf ebenfalls nicht automatisch.

## Git Cloner lokal auf dem Mac ausführen

1. Das bereitgestellte **Projektpaket** oder **Quellcode-ZIP für Version 3.0.0** auf dem Mac herunterladen und entpacken.
2. Node.js **24 LTS** mit npm installieren, falls es fehlt. Mindestens Node 22.12 wird unterstützt; 22.23.4 und 24.22.1 wurden hier tatsächlich geprüft. Offizielle Downloads: [nodejs.org](https://nodejs.org/en/download).
3. Git installieren beziehungsweise prüfen. Falls die Apple Command Line Tools fehlen, im Terminal `xcode-select --install` starten. Für die optionale LFS-Funktion zusätzlich Git LFS installieren.
4. Ein Terminal im entpackten Projektordner mit `package.json` öffnen. Eine einfache Möglichkeit: Im Terminal `cd ` eingeben, den Projektordner aus dem Finder hineinziehen und Enter drücken.
5. Dort ausführen:

```sh
npm ci
npm run check
npm run test:e2e
npm start
```

Die Oberfläche startet ohne Standardquellen. Über **Einrichtung starten** eigene Quellen, Laufwerk und Prüfzeiten eintragen. Für öffentliche Quellen wird kein Token benötigt. Vollständige Hinweise stehen in [ANLEITUNG.md](ANLEITUNG.md).

## Eigene Mac-Pakete bauen

Auf dem Mac im selben Projektordner:

```sh
npm run build:mac
```

Die DMG-/ZIP-Pakete für Universal, ARM64 und x64 erscheinen in `dist`. Die App verwendet eine technisch nötige Ad-hoc-Signatur; verifizierte Entwicklersignierung, Notarisierung und automatische Updates sind wie gewünscht nicht eingerichtet. Die normalen macOS-Sicherheitsfreigaben können deshalb erforderlich sein.

Die hier bereitgestellten fertigen Binärpakete sind Linux-x64-Builds. Fertige Mac-/Windows- und ARM64-Releases benötigen die vorbereiteten nativen Build-Läufe beziehungsweise passende Rechner. Die ausführbare gepackte App braucht anschließend kein separat installiertes Node.js.

## Git-Historie und GitHub

Das `.bundle` enthält die vollständige lokale Commit-Historie. Wer diese verwenden möchte, klont die Bundle-Datei in einen **neuen** Ordner und setzt anschließend `origin` auf `https://github.com/Ujap1994/Git-Cloner.git`. Das reine Quellcode-ZIP enthält kein Git-Verzeichnis.

Die Einrichtung des passenden Codex-GitHub-Schreibzugangs ist in [GITHUB-ZUGRIFF.md](GITHUB-ZUGRIFF.md) beschrieben. Zugangsdaten und Tokens nicht in den Chat einfügen.
