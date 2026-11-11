# Proposed repository detail view

This is a design proposal, not a description of an implemented screen. The current overview already shows backup and program status, release locations, install/rollback actions and contextual errors.

A future detail view could combine the source identity, effective inherited settings, destination health, last verified commit, release asset selection, installation stage, retained program version and recent events. Each action should explain its scope and show a preview before changing source settings or owned data.

Use tabs only when they reduce scanning: **Backup**, **Release files**, **Installation**, and **History**. Lazy-load large file lists and diffs. Preserve keyboard focus during live progress updates. Display precise transfer counts rather than estimated time savings. Do not expose tokens, local secrets or unnecessary internal identifiers.

See the [feature proposal list](ROADMAP.md), particularly package-selection previews and installation health reports.
