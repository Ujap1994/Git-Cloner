# Homebrew, winget, AUR und Flathub

Der Release-Workflow erzeugt zu den gebauten Paketen ein zusätzliches Archiv `Git-Cloner-Katalogvorlagen.zip`. Es enthält vollständige Homebrew-Cask-, winget-, AUR- und Flathub-Vorlagen mit den tatsächlich berechneten SHA256-Prüfsummen des Releases und dem zugehörigen Quellcode-Commit. Falsche Platzhalter-Prüfsummen werden nicht verwendet: Fehlt ein erforderliches Release-Artefakt, schlägt die Erzeugung fehl.

Die App selbst benötigt weder Paketverzeichnis-Konten noch Signierzertifikate. Sie zeigt ausschließlich neue offizielle GitHub-Releases an; übersprungene Versionen werden dauerhaft unterdrückt, bis eine höhere Version erscheint.

## Vorlagen lokal erzeugen

Alle benötigten Release-Dateien in einen Ordner legen: macOS ARM64/x64 als DMG, Windows ARM64/x64 als Setup und Linux ARM64/x64 als TAR.GZ. Danach im Projekt:

```sh
npm run catalogs -- --assets ./release-assets --output ./catalogs --commit VOLLSTAENDIGER_COMMIT_SHA
```

Für `VOLLSTAENDIGER_COMMIT_SHA` die tatsächliche 40-stellige Commit-ID des gebauten Releases verwenden. Versionsnummer und Dateinamen werden aus dem Projekt abgeleitet. Die Vorlagen beziehen sich ausschließlich auf Releases dieses Repositorys.

## Homebrew

`homebrew/git-cloner.rb` ist ein Cask mit getrennten Intel-/Apple-Silicon-Downloads. Nach Prüfung kann es in einem eigenen Tap verwendet oder als Pull Request an `Homebrew/homebrew-cask` eingereicht werden. Einreichung und Annahme sind getrennte Schritte. Die Vorlage aktiviert keine automatische Update-Installation.

## winget

`winget/manifests/u/Ujap1994/GitCloner/VERSION` enthält Version-, Locale- und Installer-Manifeste für x64 und ARM64. Vor einer Einreichung auf einem Windows-Rechner mit `winget validate` prüfen und die Installation beider Architekturpakete testen. Anschließend an `microsoft/winget-pkgs` übermitteln.

## AUR

`aur/PKGBUILD` und `.SRCINFO` beschreiben `git-cloner-bin` für x86_64 und aarch64. Mit `makepkg --printsrcinfo` und einem sauberen Build prüfen. Zur Veröffentlichung sind ein AUR-Konto und dessen SSH-Zugang nötig. Eine bloß erzeugte PKGBUILD ist noch keine AUR-Veröffentlichung. CachyOS kann das normale x86_64-Paket verwenden.

## Flathub

`flathub/io.github.Ujap1994.GitCloner.yml` bindet das konkrete Release mit Prüfsumme ein, enthält Git und Git LFS und installiert Desktop-Datei, Icon und AppStream-Daten aus dem festgelegten Commit. Der Build verwendet Zypak für Electron. Zunächst lokal mit `flatpak-builder` testen, danach eine neue App bei `flathub/flathub` einreichen. Die Aufnahme unterliegt den Regeln und der Prüfung von Flathub.

## Was noch externe Freigaben benötigt

Die Vorlagen und ihre automatische Erzeugung sind implementiert. Öffentliche Einträge in Homebrew, winget, AUR und Flathub erfordern jedoch jeweils Veröffentlichung beziehungsweise Annahme. Sie können ohne entsprechende Konten und Schreibrechte nicht automatisch entstehen. Ebenso lassen sich echte Hardwaretests auf Mac und Windows nur auf verfügbaren Rechnern oder den konfigurierten GitHub-Runnern ausführen. Die Projekt-CI enthält dafür Intel-/ARM64-Matrixjobs und zusätzliche Linux-Distributionsprüfungen; deren tatsächliche Ergebnisse sind im Actions-Verlauf zu prüfen.
