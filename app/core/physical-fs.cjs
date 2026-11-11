// Downloaded program bundles are physical files, including their opaque .asar archives.
// Electron's patched fs treats those archives as directories and cannot write/copy them safely.
// Keep the application's own ASAR loader enabled; only installer file operations use original-fs.
module.exports = process.versions.electron ? require('original-fs') : require('node:fs');
