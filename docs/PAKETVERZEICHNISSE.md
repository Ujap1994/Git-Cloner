# Package catalog templates

The release workflow generates Homebrew, winget, AUR and Flathub templates from the actual release artifacts and their SHA-256 values. They are packaged as `Git-Cloner-Catalog-Templates.zip` alongside the application downloads.

Templates identify the release version and source commit. They do not automatically submit the application to a public catalog. Store admission, naming, signatures, permissions and review requirements remain external to this repository.

Run `npm run catalogs -- --assets PATH --output OUTPUT --version VERSION --commit COMMIT` against a complete set of built release files. The generator refuses missing required inputs rather than inventing download hashes. Keep the resulting manifests associated with that exact release.

Flatpak includes Git and Git LFS. Architecture-specific source selectors ensure the bundled Git LFS executable matches x86_64 or aarch64. Snap packages also stage Git and Git LFS, use strict confinement and retain Chromium's sandbox helper. Local Snap installation requires `--dangerous` for an unsigned standalone `.snap`; store publication is not performed here.
