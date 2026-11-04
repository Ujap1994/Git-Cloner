const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const semver = require('semver');
const REPOSITORY = 'Ujap1994/Git-Cloner';
async function checksum(file) { const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex'); }

async function generateCatalogs({ assets, output, version, commit }) {
  if (!semver.valid(version) || semver.prerelease(version) || !/^[a-f\d]{40}$/.test(commit)) throw new Error('A stable version and full commit SHA are required.');
  const base=`https://github.com/${REPOSITORY}/releases/download/v${version}`;
  const names={macArm:`Git-Cloner-${version}-mac-arm64.dmg`,macIntel:`Git-Cloner-${version}-mac-x64.dmg`,win64:`Git-Cloner-${version}-windows-x64-setup.exe`,winArm:`Git-Cloner-${version}-windows-arm64-setup.exe`,linux64:`Git-Cloner-${version}-linux-x64.tar.gz`,linuxArm:`Git-Cloner-${version}-linux-arm64.tar.gz`};
  const hashes={};for(const[key,name]of Object.entries(names))hashes[key]=await checksum(path.join(assets,name));
  const desktopFile='io.github.Ujap1994.GitCloner.desktop';
  const iconHash=await checksum(path.join(__dirname,'../build/icon.png'));
  const desktopHash=await checksum(path.join(__dirname,'../build',desktopFile));
  const write=async(name,content)=>{const file=path.join(output,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);};
  await write('homebrew/git-cloner.rb',`cask "git-cloner" do\n  version "${version}"\n  on_arm do\n    sha256 "${hashes.macArm}"\n    url "${base}/${names.macArm}"\n  end\n  on_intel do\n    sha256 "${hashes.macIntel}"\n    url "${base}/${names.macIntel}"\n  end\n  name "Git Cloner"\n  desc "Scheduled GitHub backups on your own drive"\n  homepage "https://github.com/${REPOSITORY}"\n  app "Git Cloner.app"\n  uninstall quit: "io.github.Ujap1994.GitCloner"\nend\n`);
  const identity=`PackageIdentifier: Ujap1994.GitCloner\nPackageVersion: ${version}\n`;
  const winget=`winget/manifests/u/Ujap1994/GitCloner/${version}`;
  await write(`${winget}/Ujap1994.GitCloner.yaml`,`${identity}DefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.9.0\n`);
  await write(`${winget}/Ujap1994.GitCloner.locale.en-US.yaml`,`${identity}PackageLocale: en-US\nPublisher: Ujap1994\nPublisherUrl: https://github.com/Ujap1994\nPackageName: Git Cloner\nPackageUrl: https://github.com/${REPOSITORY}\nLicense: MIT\nLicenseUrl: https://github.com/${REPOSITORY}/blob/${commit}/LICENSE\nShortDescription: Scheduled GitHub backups on your own drive\nDescription: Back up repositories to multiple drives, verify integrity, restore encrypted archives, and receive optional release notifications.\nManifestType: defaultLocale\nManifestVersion: 1.9.0\n`);
  await write(`${winget}/Ujap1994.GitCloner.installer.yaml`,`${identity}InstallerType: nullsoft\nScope: user\nUpgradeBehavior: install\nInstallerSwitches:\n  Silent: /S\n  SilentWithProgress: /S\nInstallers:\n  - Architecture: x64\n    InstallerUrl: ${base}/${names.win64}\n    InstallerSha256: ${hashes.win64.toUpperCase()}\n  - Architecture: arm64\n    InstallerUrl: ${base}/${names.winArm}\n    InstallerSha256: ${hashes.winArm.toUpperCase()}\nManifestType: installer\nManifestVersion: 1.9.0\n`);
  await write('aur/PKGBUILD',`pkgname=git-cloner-bin\npkgver=${version}\npkgrel=1\npkgdesc='Scheduled GitHub backups on your own drive'\narch=('x86_64' 'aarch64')\nurl='https://github.com/${REPOSITORY}'\nlicense=('MIT')\ndepends=('git' 'gtk3' 'nss' 'alsa-lib' 'libxss' 'libnotify' 'libxtst' 'xdg-utils' 'at-spi2-core' 'libdrm' 'mesa')\noptdepends=('git-lfs: Git LFS backup support')\nprovides=('git-cloner')\nconflicts=('git-cloner')\nsource=('https://raw.githubusercontent.com/${REPOSITORY}/${commit}/build/icon.png' 'https://raw.githubusercontent.com/${REPOSITORY}/${commit}/build/${desktopFile}')\nsha256sums=('${iconHash}' '${desktopHash}')\nsource_x86_64=('${base}/${names.linux64}')\nsource_aarch64=('${base}/${names.linuxArm}')\nsha256sums_x86_64=('${hashes.linux64}')\nsha256sums_aarch64=('${hashes.linuxArm}')\npackage() {\n  install -dm755 "$pkgdir/opt/git-cloner" "$pkgdir/usr/bin"\n  cp -a "$srcdir/Git-Cloner-$pkgver-linux-"*/. "$pkgdir/opt/git-cloner/"\n  ln -s /opt/git-cloner/git-cloner "$pkgdir/usr/bin/git-cloner"\n  install -Dm644 "$pkgdir/opt/git-cloner/resources/licenses/LICENSE.git-cloner.txt" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"\n  install -Dm644 "$srcdir/icon.png" "$pkgdir/usr/share/icons/hicolor/512x512/apps/io.github.Ujap1994.GitCloner.png"\n  install -Dm644 "$srcdir/${desktopFile}" "$pkgdir/usr/share/applications/${desktopFile}"\n}\n`);
  await write('aur/.SRCINFO',`pkgbase = git-cloner-bin\n\tpkgdesc = Scheduled GitHub backups on your own drive\n\tpkgver = ${version}\n\tpkgrel = 1\n\turl = https://github.com/${REPOSITORY}\n\tarch = x86_64\n\tarch = aarch64\n\tlicense = MIT\n${['git','gtk3','nss','alsa-lib','libxss','libnotify','libxtst','xdg-utils','at-spi2-core','libdrm','mesa'].map(d=>`\tdepends = ${d}\n`).join('')}\toptdepends = git-lfs: Git LFS backup support\n\tprovides = git-cloner\n\tconflicts = git-cloner\n\tsource = https://raw.githubusercontent.com/${REPOSITORY}/${commit}/build/icon.png\n\tsha256sums = ${iconHash}\n\tsource = https://raw.githubusercontent.com/${REPOSITORY}/${commit}/build/${desktopFile}\n\tsha256sums = ${desktopHash}\n\tsource_x86_64 = ${base}/${names.linux64}\n\tsha256sums_x86_64 = ${hashes.linux64}\n\tsource_aarch64 = ${base}/${names.linuxArm}\n\tsha256sums_aarch64 = ${hashes.linuxArm}\npkgname = git-cloner-bin\n`);
  const yaml=require('js-yaml');
  const build=yaml.load(await fs.readFile(path.join(__dirname,'../electron-builder.yml'),'utf8'));
  const manifest={
    'app-id':'io.github.Ujap1994.GitCloner',runtime:build.flatpak.runtime,'runtime-version':build.flatpak.runtimeVersion,sdk:build.flatpak.sdk,base:build.flatpak.base,'base-version':build.flatpak.baseVersion,command:'git-cloner',
    'finish-args':build.flatpak.finishArgs,
    modules:[...build.flatpak.modules,{
      name:'git-cloner',buildsystem:'simple','build-commands':[
        'mkdir -p /app/lib/git-cloner', 'cp -a payload/. /app/lib/git-cloner/',
        'install -Dm755 git-cloner /app/bin/git-cloner',
        'install -Dm644 io.github.Ujap1994.GitCloner.desktop /app/share/applications/io.github.Ujap1994.GitCloner.desktop',
        'install -Dm644 icon.png /app/share/icons/hicolor/512x512/apps/io.github.Ujap1994.GitCloner.png',
        'install -Dm644 io.github.Ujap1994.GitCloner.metainfo.xml /app/share/metainfo/io.github.Ujap1994.GitCloner.metainfo.xml'
      ],sources:[
        {type:'archive',url:`${base}/${names.linux64}`,sha256:hashes.linux64,'dest':'payload'},
        {type:'script','dest-filename':'git-cloner',commands:['exec zypak-wrapper /app/lib/git-cloner/git-cloner "$@"']},
        ...['io.github.Ujap1994.GitCloner.desktop','icon.png','io.github.Ujap1994.GitCloner.metainfo.xml'].map(file=>({type:'file',url:`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/build/${file}`,sha256:null}))
      ]
    }]
  };
  // Local, committed files are checksummed; no unverified network source is emitted.
  for(const source of manifest.modules.at(-1).sources.filter(s=>s.type==='file'))source.sha256=await checksum(path.join(__dirname,'../build',path.basename(new URL(source.url).pathname)));
  await write('flathub/io.github.Ujap1994.GitCloner.yml',yaml.dump(manifest,{lineWidth:140,noRefs:true}));
  await write('README.md',`# Package catalog submissions\n\nGenerated for Git Cloner ${version}, commit ${commit}. All binary and source checksums are calculated from the release artifacts.\n\n- Homebrew: submit homebrew/git-cloner.rb to Homebrew/homebrew-cask or use it in a private tap.\n- winget: submit the winget/manifests directory to microsoft/winget-pkgs after running winget validate.\n- AUR: review aur/PKGBUILD and .SRCINFO, then push to the git-cloner-bin AUR repository using your own AUR account.\n- Flathub: review and test the flathub manifest, then submit to flathub/flathub using its new-pr workflow.\n\nThese files do not create listings automatically. Catalog acceptance and maintainer credentials are external requirements. No signing certificates are required by Git Cloner's version notification feature.\n`);
  return {version,commit,output};
}
if(require.main===module){const args=process.argv.slice(2);const arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};generateCatalogs({assets:arg('--assets'),output:arg('--output'),version:arg('--version')||require('../package.json').version,commit:arg('--commit')}).then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});}
module.exports={generateCatalogs};
