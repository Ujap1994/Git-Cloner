const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {repository}=require('../helpers/repository.cjs');
const {ChangesPreview}=require('../../app/core/changes.cjs');
const {RestoreBrowser}=require('../../app/core/selective-restore.cjs');
const {findRelocations}=require('../../app/core/relocation.cjs');
const {writeJson,readJson}=require('../../app/core/store.cjs');
const {syncRepository}=require('../../app/core/backup.cjs');

test('release backup downloads the latest stable release only and replaces old assets after an OS change',async t=>{
  const f=await repository(t),assets=[f.asset(1,'project-windows-x64.exe','windows'),f.asset(2,'project-mac-universal.dmg','mac'),f.asset(3,'project-linux.AppImage','linux'),f.asset(4,'SHA256SUMS.txt','checksums'),f.asset(5,'unclassified.zip','unknown')],old=f.asset(6,'old.exe','obsolete');
  f.releases=[{id:100,tag_name:'v2',assets},{id:90,tag_name:'v1',assets:[old]}];f.options.metadata.releases=true;
  const first=await f.sync();assert.equal(first.status,'cloned');assert.deepEqual(f.downloads,[1,2,3,4,5]);
  f.downloads=[];f.options.releaseScope='system';await f.sync();
  const selected=process.platform==='win32'?1:process.platform==='darwin'?2:3;assert.deepEqual(f.downloads,[selected,4]);
  const folder=path.join(first.destination,'.git','git-cloner-metadata');const filenames=await fs.readdir(path.join(folder,'release-assets'));assert.equal(filenames.length,2);assert.ok(!filenames.includes('6-old.exe'));
  const selection=await readJson(path.join(folder,'release-selection.json'));assert.equal(selection.tag,'v2');assert.equal(selection.platform,process.platform);assert.ok(selection.excluded.some(a=>a.id===5));
  f.downloads=[];assert.equal((await f.sync()).status,'unchanged');assert.deepEqual(f.downloads,[]);
});
test('a failed release integrity check cannot replace the last successful snapshot',async t=>{
  const f=await repository(t);const first=await f.sync(),stamp=(await fs.stat(first.destination)).mtimeMs;
  const asset=f.asset(1,'release.zip','bad transfer');asset.digest='sha256:'+'0'.repeat(64);f.releases=[{tag_name:'v2',assets:[asset]}];f.options.metadata.releases=true;
  await assert.rejects(f.sync(),/Prüfsumme/);assert.equal(await f.git.head(first.destination),first.commit);assert.equal((await fs.stat(first.destination)).mtimeMs,stamp);assert.equal(await fs.readFile(path.join(first.destination,'README.md'),'utf8'),'  old text  \n');
});
test('text change preview is lazy, preserves whitespace and leaves the stored backup untouched',async t=>{
  const f=await repository(t),record=await f.sync(),stamp=(await fs.stat(record.destination)).mtimeMs;
  await fs.writeFile(path.join(f.remote,'README.md'),'  new text  \n<script>not executable</script>\n');await fs.rm(path.join(f.remote,'removed.txt'));await fs.writeFile(path.join(f.remote,'new.txt'),'created\n');await f.command('add','.');await f.command('commit','-m','changed');
  const preview=new ChangesPreview();t.after(()=>preview.close());const opened=await preview.open({record,git:f.git,github:f.github});
  assert.equal(opened.added,1);assert.equal(opened.deleted,1);assert.equal(opened.modified,1);assert.ok(!f.requests.some(url=>url.includes('/git/blobs/')));
  const listing=preview.list({sessionId:opened.sessionId});assert.equal(listing.total,3);
  const patch=await preview.file({sessionId:opened.sessionId,path:'README.md'});assert.equal(patch.kind,'text');assert.ok(patch.patch.includes('-  old text  '));assert.ok(patch.patch.includes('+  new text  '));
  const blobCalls=f.requests.filter(url=>url.includes('/git/blobs/')).length;await preview.file({sessionId:opened.sessionId,path:'README.md'});assert.equal(f.requests.filter(url=>url.includes('/git/blobs/')).length,blobCalls);
  await assert.rejects(preview.file({sessionId:opened.sessionId,path:'../../foreign'}),/gehört nicht/);assert.equal(await f.git.head(record.destination),record.commit);assert.equal((await fs.stat(record.destination)).mtimeMs,stamp);
});
test('change preview lists large files without fetching their contents and handles binary files safely',async t=>{
  const f=await repository(t),record=await f.sync();await fs.writeFile(path.join(f.remote,'large.dat'),Buffer.alloc(300000,1));await fs.writeFile(path.join(f.remote,'binary.dat'),Buffer.from([0,1,2]));await f.command('add','.');await f.command('commit','-m','binary files');
  const preview=new ChangesPreview();t.after(()=>preview.close());const opened=await preview.open({record,git:f.git,github:f.github});const requests=f.requests.length;
  assert.equal((await preview.file({sessionId:opened.sessionId,path:'large.dat'})).kind,'unavailable');assert.equal(f.requests.length,requests);
  assert.equal((await preview.file({sessionId:opened.sessionId,path:'binary.dat'})).kind,'binary');
});
test('encrypted change previews authenticate and remove private plaintext on close',async t=>{
  const f=await repository(t),password='long test archive password',record=await f.sync({options:{...f.options,encryption:true},passphrase:password});
  await fs.writeFile(path.join(f.remote,'README.md'),'updated\n');await f.command('add','.');await f.command('commit','-m','updated');
  const browser=new RestoreBrowser({git:f.git}),preview=new ChangesPreview({browser});t.after(async()=>{await preview.close();await browser.closeAll();});
  await assert.rejects(preview.open({record,git:f.git,github:f.github,passphrase:'incorrect password'}));assert.equal(browser.sessions.size,0);
  const opened=await preview.open({record,git:f.git,github:f.github,passphrase:password});const temporary=browser.sessions.get(preview.current.browserId).temporary;
  assert.equal((await preview.file({sessionId:opened.sessionId,path:'README.md'})).kind,'text');await preview.close();await assert.rejects(fs.stat(temporary),{code:'ENOENT'});assert.equal(browser.sessions.size,0);
});
test('runtime holds the backup lease while the read-only change dialog is open',async t=>{
  const f=await repository(t),record=await f.sync(),runtime=await f.runtime({state:{repositories:{[record.id]:record}}});
  await runtime.openChanges({id:record.id});assert.deepEqual(await runtime.run(),{busy:true});await runtime.closeChanges();assert.equal(runtime.operation,null);assert.equal((await runtime.run()).errorCount,0);
});
test('closing a change preview cancels a pending network lookup and cleans its session',async t=>{
  const f=await repository(t),record=await f.sync(),preview=new ChangesPreview();let entered;const started=new Promise(r=>{entered=r;});
  const git=Object.create(f.git);git.remoteHead=(_url,{signal})=>new Promise((_resolve,reject)=>{entered();signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});
  const opening=preview.open({record,git,github:f.github});opening.catch(()=>{});await started;await preview.close();await assert.rejects(opening,/cancelled/);assert.equal(preview.current,undefined);assert.equal(preview.opening,null);
});
test('a failed change comparison releases the runtime lease and allows another backup',async t=>{
  const f=await repository(t),record=await f.sync(),runtime=await f.runtime({state:{repositories:{[record.id]:record}}});
  runtime.gitFor().remoteHead=async()=>{throw new Error('offline');};await assert.rejects(runtime.openChanges({id:record.id}),/offline/);assert.equal(runtime.operation,null);assert.equal(runtime.changesLease,null);
  runtime.gitClients.clear();runtime.git=runtime.gitFor();runtime.backup.git=runtime.git;assert.equal((await runtime.run()).errorCount,0);
});
test('release-only recovery supports encrypted mirrors without exposing Git internals',async t=>{
  const f=await repository(t),asset=f.asset(7,'package.zip','restore only this asset');f.releases=[{tag_name:'v1',assets:[asset]}];
  const record=await f.sync({options:{...f.options,mode:'mirror',metadata:{...f.options.metadata,releases:true},encryption:true},passphrase:'long release test password'}),browser=new RestoreBrowser({git:f.git});t.after(()=>browser.closeAll());
  const opened=await browser.open({record,passphrase:'long release test password',content:'releases'}),list=browser.list({sessionId:opened.id});assert.deepEqual(list.entries.map(e=>e.path),['7-package.zip']);
  const restored=await browser.restore({sessionId:opened.id,paths:['7-package.zip'],parent:f.root,name:'release-recovery'});assert.deepEqual(await fs.readdir(restored.destination),['7-package.zip']);assert.equal(await fs.readFile(path.join(restored.destination,'7-package.zip'),'utf8'),'restore only this asset');
});
test('a paused additional destination can be reloaded with its own volume hint',async t=>{
  const f=await repository(t),extra=path.join(f.root,'other-drive');await fs.mkdir(extra);const {prepareDestination}=require('../../app/core/destinations.cjs');const target=await prepareDestination({id:'extra',destination:extra});
  const config=f.config();config.sources[0].additionalDestinations=[target];config.execution.concurrency=1;const runtime=await f.runtime({config});let calls=0;
  runtime.backup.sync=async options=>{const result=await syncRepository(options);if(++calls===1)await runtime.pause();return result;};await runtime.run();const queue=structuredClone(runtime.backup.state.queue);await runtime.stop();
  const second=await f.runtime({config:runtime.config,state:runtime.backup.state});assert.equal(second.backup.state.queue.jobs.length,queue.jobs.length);assert.equal((await second.resume()).errorCount,0);
});
test('a moved drive is rebound by its marker and its existing snapshot is reused',async t=>{
  const f=await repository(t),record=await f.sync(),stamp=(await fs.stat(record.destination)).mtimeMs,newMount=path.join(f.root,'drive-renamed'),newBackup=path.join(newMount,'backups');
  const runtime=await f.runtime({state:{repositories:{[record.id]:record}},mountedRoots:async()=>[newMount]});await fs.rename(f.mount,newMount);
  const result=await runtime.locateDrives();assert.equal(result.moves.length,1);assert.equal(runtime.config.sources[0].destination,newBackup);
  const updated=Object.values(runtime.backup.state.repositories)[0];assert.equal(updated.destination,path.join(newBackup,'demo','project'));assert.notEqual(updated.id,record.id);
  assert.equal((await runtime.run()).results[0].status,'unchanged');assert.equal((await fs.stat(updated.destination)).mtimeMs,stamp);await assert.rejects(fs.stat(f.mount),{code:'ENOENT'});
});
test('duplicate drive markers remain ambiguous and no candidate or old path is modified',async t=>{
  const f=await repository(t),config=f.config(),first=path.join(f.root,'first'),second=path.join(f.root,'second');await fs.mkdir(path.join(first,'backups'),{recursive:true});await fs.mkdir(path.join(second,'backups'),{recursive:true});
  for(const folder of [first,second])await fs.copyFile(path.join(f.backup,'.git-cloner-volume.json'),path.join(folder,'backups','.git-cloner-volume.json'));
  await fs.rm(f.mount,{recursive:true});const result=await findRelocations(config,{roots:async()=>[first,second]});assert.equal(result.moves.length,0);assert.equal(result.issues[0].kind,'ambiguous');await assert.rejects(fs.stat(f.mount),{code:'ENOENT'});
  assert.deepEqual(await fs.readdir(path.join(first,'backups')),['.git-cloner-volume.json']);
});
test('an interrupted relocation finishes idempotently after settings were written before state',async t=>{
  const f=await repository(t),record=await f.sync(),newMount=path.join(f.root,'renamed'),newBackup=path.join(newMount,'backups');await fs.rename(f.mount,newMount);
  const config=f.config(),move={sourceId:f.source.id,targetId:`${f.source.id}:primary`,from:f.backup,recordFrom:f.backup,to:newBackup,volumeId:f.source.volumeId,volumeHint:{root:newMount,relative:'backups',canonical:newBackup}};
  config.sources[0].destination=newBackup;config.sources[0].volumeHint=move.volumeHint;
  await writeJson(path.join(f.directory,'pending-relocations.json'),{schemaVersion:1,moves:[move]});
  const runtime=await f.runtime({config,state:{repositories:{[record.id]:record}}});assert.equal(Object.values(runtime.backup.state.repositories)[0].destination,path.join(newBackup,'demo','project'));await assert.rejects(fs.stat(path.join(f.directory,'pending-relocations.json')),{code:'ENOENT'});assert.equal((await runtime.run()).errorCount,0);
});
test('paused queues preserve completed jobs when their drive mount path changes',async t=>{
  const f=await repository(t);f.names=['demo/one','demo/two'];const config=f.config();config.sources[0].kind='owner';config.sources[0].value='demo';config.execution.concurrency=1;
  const newMount=path.join(f.root,'new-letter'),runtime=await f.runtime({config,mountedRoots:async()=>[newMount]});let calls=0;
  runtime.backup.sync=async options=>{const result=await syncRepository(options);if(++calls===1)await runtime.pause();return result;};
  assert.equal((await runtime.run()).paused,true);const completed=runtime.backup.state.queue.completed[0];await fs.rename(f.mount,newMount);await runtime.locateDrives();assert.notEqual(runtime.backup.state.queue.completed[0],completed);
  runtime.backup.sync=async options=>{calls++;return syncRepository(options);};const result=await runtime.resume();assert.equal(result.resultCount,2);assert.equal(result.errorCount,0);assert.equal(calls,2);
});
test('scheduled queues process only due sources and persist each source checkpoint independently',async t=>{
  const f=await repository(t);f.names=['demo/project','demo/other'];const config=f.config();config.sources.push({...config.sources[0],id:'other',value:'demo/other',schedule:{enabled:true,checksPerDay:1,times:['18:00']}});
  const runtime=await f.runtime({config});const due=new Date(2026,10,4,2).toISOString();const result=await runtime.run({scheduledAt:due,scheduledSources:{source:due}});
  assert.equal(result.resultCount,1);assert.equal(runtime.backup.state.lastScheduledBySource.source,due);assert.equal(runtime.backup.state.lastScheduledBySource.other,undefined);assert.ok(!f.requests.some(endpoint=>endpoint==='/repos/demo/other'));
});
test('backup notification rules apply to automatic runs and pause/resume without duplicate completion notices',async t=>{
  const f=await repository(t),config=f.config();config.notificationRules.backup='changes';let notices=0;
  const runtime=await f.runtime({config,notifyBackup:()=>{notices++;}});const due=new Date().toISOString();await runtime.run({scheduledAt:due,scheduledSources:{source:due}});assert.equal(notices,1);await runtime.run();assert.equal(notices,1);
  const next=structuredClone(runtime.config);next.notificationRules.backup='errors';await runtime.saveConfig(next);await runtime.run();assert.equal(notices,1);
});
