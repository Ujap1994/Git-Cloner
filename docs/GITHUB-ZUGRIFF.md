# Schreibzugriff auf das Projekt einrichten

Die normale GitHub-Anbindung in ChatGPT unterstützt laut [OpenAI-Anleitung](https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt) Lesezugriffe. Für Codeänderungen und Pushes die **Codex-GitHub-Anbindung** verwenden. Eine Änderung der ChatGPT-Rückfrageeinstellungen erweitert keine GitHub-App-Berechtigungen.

1. GitHub in Safari/Chrome öffnen und mit dem Konto anmelden, dem das Repository gehört beziehungsweise das darauf schreiben darf.
2. Den offiziellen [ChatGPT Codex Connector von OpenAI](https://github.com/apps/chatgpt-codex-connector) öffnen und **Install** beziehungsweise **Configure** wählen.
3. Das passende GitHub-Konto auswählen. Unter **Only select repositories** gezielt `Git-Cloner` freigeben und speichern.
4. Die von der offiziellen App angeforderten Berechtigungen prüfen und bestätigen. Die App fordert unter anderem Schreibrechte für Contents, Workflows und Actions an. Diese Rechte werden vom App-Anbieter festgelegt; sie sind keine frei umschaltbare Checkliste.
5. Unter [Installed GitHub Apps](https://github.com/settings/installations) kontrollieren, dass der Codex Connector für das richtige Konto installiert ist und Zugriff auf dieses Repository hat. Ausstehende aktualisierte Berechtigungen gegebenenfalls bestätigen.
6. [Codex im Browser](https://chatgpt.com/codex) öffnen und diese Verbindung bei Projekt/Cloud-Umgebung beziehungsweise Repository-Auswahl verwenden. Konto und Projekt kontrollieren. Die Installation auf GitHub und die Auswahl in Codex sind getrennte Schritte.
7. Wenn die mobile Ansicht Einstellungen versteckt, im Browser **Desktop-Website anfordern** aktivieren. Links gegebenenfalls in die Browser-Adresszeile kopieren, damit sie nicht in der GitHub-App öffnen.

Eine separate Terminal-Anmeldung muss ebenfalls ein schreibberechtigtes Konto verwenden. Eine Anmeldung auf dem eigenen Mac ändert nicht automatisch die Git-Zugangsdaten einer Cloud-Umgebung. Weder Tokens noch Passwörter in einen Chat einfügen.

Eine neue Codex-Umgebung übernimmt vorhandene lokale Arbeit nicht automatisch. Das bereitgestellte Git-Bundle enthält die vollständige Commit-Historie. Nach dem Klonen des Bundles dessen `origin` auf `https://github.com/Ujap1994/Git-Cloner.git` setzen und erst dann mit der passenden Anmeldung pushen.

Nach einem erfolgreichen Push nach `main` startet die vorbereitete CI. Die Release-Pipeline folgt nach erfolgreicher CI für denselben Commit und eine noch unveröffentlichte Paketversion. Der Publish-Job deklariert seine `contents: write`-Berechtigung selbst. Verifizierte Signierzertifikate oder ein eigener automatischer Update-Dienst sind dafür nicht erforderlich.
