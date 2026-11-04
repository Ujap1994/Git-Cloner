const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { Git } = require('../../app/core/git.cjs');
const { defaults } = require('../../app/core/config.cjs');
const { prepareDestination } = require('../../app/core/destinations.cjs');
const { syncRepository } = require('../../app/core/backup.cjs');
const { RestoreBrowser, relative } = require('../../app/core/selective-restore.cjs');
const { Runtime } = require('../../app/runtime.cjs');
async function fixture(t,{mode='snapshot',encryption=false,lfs=false}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gc-selective-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  const remote=path.join(root,'remote'),destination=path.join(root,'backups'),parent=path.join(root,'restored');await Promise.all([fs.mkdir(remote),fs.mkdir(destination),fs.mkdir(parent)]);
  const command=(...args)=>execute('git',args,{cwd:remote,windowsHide:true});
  await command('init','-b','main');await command('config','user.name','Tests');await command('config','user.email','tests@example.invalid');
  await fs.mkdir(path.join(remote,'src'));await fs.writeFile(path.join(remote,'src','one.txt'),'one');await fs.writeFile(path.join(remote,'src','two.txt'),'two');await fs.writeFile(path.join(remote,'README.md'),'read me');await fs.writeFile(path.join(remote,'run.sh'),'#!/bin/sh\necho hello\n',{mode:0o755});
  if(lfs){await command('lfs','install','--local','--skip-smudge','--skip-repo');await command('lfs','track','*.bin');await fs.writeFile(path.join(remote,'large.bin'),Buffer.alloc(32768,0x42));}
  await command('add','.');await command('commit','-m','initial');
  const url=pathToFileURL(remote).href;
  class LocalGit extends Git { run(args,options){return super.run(args.map(value=>/^https:\/\/github.com\/demo\/[^/]+\.git$/.test(value)?url:value),options);} }
  const git=new LocalGit(),source=await prepareDestination({id:'source',kind:'repository',value:'demo/project',destination,enabled:true,accountId:'default',additionalDestinations:[]});
  const options={...defaults().backup,mode,encryption,lfs},passphrase='a long archive passphrase';
  const record=await syncRepository({source,repository:{full_name:'demo/project',size:1,has_wiki:false},git,options,passphrase});
  const browser=new RestoreBrowser({git});t.after(()=>browser.closeAll());
  return{root,remote,destination,parent,git,source,record,browser,passphrase,command,LocalGit};
}
test('Windows file selection rejects device names and alternate data streams',()=>{
  for(const name of ['src/CON.txt','src/file.txt:stream','folder./file','src/LPT1','src/file?'])assert.throws(()=>relative(name,false,'win32'));
  assert.equal(relative('src/safe-file.txt',false,'win32'),'src/safe-file.txt');
});
test('snapshot browsing hides Git internals and restores a verified selected directory only',async t=>{
  const f=await fixture(t),session=await f.browser.open({record:f.record});
  const root=f.browser.list({sessionId:session.id});assert.ok(root.entries.some(e=>e.path==='src'&&e.type==='directory'));assert.ok(!root.entries.some(e=>e.name==='.git'));
  assert.deepEqual(f.browser.list({sessionId:session.id,folder:'src'}).entries.map(e=>e.name),['one.txt','two.txt']);
  const restored=await f.browser.restore({sessionId:session.id,paths:['src','src/one.txt'],parent:f.parent,name:'selected'});
  assert.equal(restored.files,2);assert.equal(await fs.readFile(path.join(restored.destination,'src','one.txt'),'utf8'),'one');assert.deepEqual(await fs.readdir(restored.destination),['src']);
});
test('encrypted file browsing authenticates first and removes private plaintext when closed',async t=>{
  const f=await fixture(t,{encryption:true});await assert.rejects(f.browser.open({record:f.record,passphrase:'incorrect long passphrase'}),/Passwort/);assert.equal(f.browser.sessions.size,0);
  const session=await f.browser.open({record:f.record,passphrase:f.passphrase}),temporary=f.browser.sessions.get(session.id).temporary;
  const restored=await f.browser.restore({sessionId:session.id,paths:['README.md'],parent:f.parent,name:'readme'});assert.equal(await fs.readFile(path.join(restored.destination,'README.md'),'utf8'),'read me');
  await f.browser.close(session.id);await assert.rejects(fs.stat(temporary),{code:'ENOENT'});
});
test('mirror file browsing exports HEAD files and preserves executable bits',async t=>{
  const f=await fixture(t,{mode:'mirror'}),session=await f.browser.open({record:f.record});
  const root=f.browser.list({sessionId:session.id});assert.ok(root.entries.some(e=>e.name==='README.md'));assert.ok(!root.entries.some(e=>e.name==='objects'));
  const restored=await f.browser.restore({sessionId:session.id,paths:['run.sh','src/one.txt'],parent:f.parent,name:'mirror-files'});
  assert.equal(await fs.readFile(path.join(restored.destination,'src','one.txt'),'utf8'),'one');if(process.platform!=='win32')assert.ok((await fs.stat(path.join(restored.destination,'run.sh'))).mode&0o100);
});
test('selective restore rejects traversal, Git internals, unknown files and foreign destinations',async t=>{
  const f=await fixture(t),session=await f.browser.open({record:f.record}),occupied=path.join(f.parent,'occupied');await fs.mkdir(occupied);await fs.writeFile(path.join(occupied,'personal'),'keep');
  for(const selection of [['../outside'],['.git/config'],['not-present']])await assert.rejects(f.browser.restore({sessionId:session.id,paths:selection,parent:f.parent,name:'unsafe'}));
  await assert.rejects(f.browser.restore({sessionId:session.id,paths:['README.md'],parent:f.parent,name:'occupied'}),/existiert/);assert.equal(await fs.readFile(path.join(occupied,'personal'),'utf8'),'keep');
});
test('changed backup contents cannot be copied after a file browser was opened',async t=>{
  const f=await fixture(t),session=await f.browser.open({record:f.record});await fs.writeFile(path.join(f.record.destination,'README.md'),'tampered');
  await assert.rejects(f.browser.restore({sessionId:session.id,paths:['README.md'],parent:f.parent,name:'changed'}),/Integritätsprüfung/);await assert.rejects(fs.stat(path.join(f.parent,'changed')),{code:'ENOENT'});
});
test('selective recovery can rescue intact files without hashing unrelated damaged files',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.record.destination,'src','two.txt'),'unrelated damage');
  const session=await f.browser.open({record:f.record});const result=await f.browser.restore({sessionId:session.id,paths:['README.md'],parent:f.parent,name:'rescued'});assert.equal(await fs.readFile(path.join(result.destination,'README.md'),'utf8'),'read me');
});
test('a changed manifest is rejected before the file picker opens',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.record.destination,'.git','git-cloner-manifest.json'),'{}');await assert.rejects(f.browser.open({record:f.record}),/Dateimanifest/);
});
test('browsing expires and only paginates direct children',async t=>{
  const f=await fixture(t);let now=1000;f.browser.now=()=>now;f.browser.ttl=100;
  const session=await f.browser.open({record:f.record});assert.equal(f.browser.list({sessionId:session.id,folder:'src',offset:100}).entries.length,0);now=1200;assert.throws(()=>f.browser.list({sessionId:session.id}),/abgelaufen/);
});
test('mirror selective restore resolves actual LFS object contents',async t=>{
  try{await execute('git',['lfs','version']);}catch(_error){t.skip('Git LFS unavailable');return;}
  const f=await fixture(t,{mode:'mirror',lfs:true}),session=await f.browser.open({record:f.record});const result=await f.browser.restore({sessionId:session.id,paths:['large.bin'],parent:f.parent,name:'lfs-file'});
  assert.deepEqual(await fs.readFile(path.join(result.destination,'large.bin')),Buffer.alloc(32768,0x42));
});
test('runtime checkpoints survive an actual profile restart and reuse completed backups',async t=>{
  const f=await fixture(t),directory=path.join(f.root,'profile');await fs.mkdir(directory);const config=defaults();config.execution.concurrency=1;
  config.sources=Array.from({length:3},(_,i)=>({...f.source,id:`source-${i}`,value:`demo/repo-${i}`}));
  await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify(config));
  const options={directory,version:'3.0.0',safeStorage:{isEncryptionAvailable:()=>false},gitFactory:args=>new f.LocalGit(args),fetchImpl:async url=>({ok:true,status:200,json:async()=>({full_name:new URL(url).pathname.slice(7),size:1,has_wiki:false})})};
  let runtime=await new Runtime(options).init();t.after(()=>runtime.stop());
  runtime.backup.on('data',()=>{if(runtime.backup.state.queue.completed.length===1)runtime.pause();});
  const paused=await runtime.run();assert.equal(paused.paused,true);const completed=Object.values(runtime.backup.state.repositories)[0],stamp=(await fs.stat(completed.destination)).mtimeMs;await runtime.stop();
  runtime=await new Runtime(options).init();assert.equal(runtime.snapshot().queue.completed,1);const result=await runtime.resume();assert.equal(result.resultCount,3);assert.equal((await fs.stat(completed.destination)).mtimeMs,stamp);assert.equal(runtime.snapshot().queue,null);
  const before=runtime.snapshot();runtime.backup.progress={status:'checking'};const after=runtime.snapshot();assert.strictEqual(before.repositories,after.repositories);assert.strictEqual(before.metrics,after.metrics);
});
test('runtime automatically resumes an AC-blocked queue once the power rule permits it',async t=>{
  const f=await fixture(t),directory=path.join(f.root,'policy-profile');await fs.mkdir(directory);const config=defaults();config.execution.onlyOnAC=true;config.sources=[{...f.source,value:'demo/policy'}];await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify(config));
  let onBattery=true,requests=0;
  const runtime=await new Runtime({directory,version:'3.0.0',safeStorage:{isEncryptionAvailable:()=>false},environmentState:async()=>({onBattery}),gitFactory:args=>new f.LocalGit(args),fetchImpl:async()=>{requests++;return{ok:true,status:200,json:async()=>({full_name:'demo/policy',size:1,has_wiki:false})};}}).init();t.after(()=>runtime.stop());
  await runtime.run();assert.equal(requests,0);assert.equal(runtime.snapshot().queue.pauseReason,'power');onBattery=false;runtime.lastEnvironmentAt=0;await runtime.policyTick();assert.equal(runtime.snapshot().queue,null);assert.equal(runtime.snapshot().history[0].errorCount,0);assert.equal(requests,1);
});
