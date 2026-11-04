const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHash}=require('node:crypto');
const {defaults,validateConfig}=require('../../app/core/config.cjs');
const {dueSources,nextConfigRun,registrationTimes}=require('../../app/core/schedule.cjs');
const {scheduleFiles}=require('../../app/core/native-schedule.cjs');
const {selectReleaseAssets}=require('../../app/core/release-assets.cjs');
const {notificationAllowed,quietNow}=require('../../app/core/notifications.cjs');
const {UpdateMonitor}=require('../../app/core/updates.cjs');
const {GitHubClient}=require('../../app/core/github.cjs');
const {resolveJobs}=require('../../app/core/backup.cjs');
const local=(h,m=0)=>new Date(2026,10,4,h,m);
function sources(){const c=defaults();c.schedule={enabled:true,checksPerDay:2,times:['02:00','18:00']};c.sources=[{id:'first',kind:'repository',value:'demo/one',destination:os.tmpdir(),enabled:true},{id:'second',kind:'repository',value:'demo/two',destination:os.tmpdir(),enabled:true,schedule:{enabled:true,checksPerDay:2,times:['09:00','15:00']}}];return validateConfig(c);}
test('source schedules inherit defaults, catch up independently and obey the global pause',()=>{
  const config=sources(),state={lastScheduledAt:local(1).toISOString(),lastScheduledBySource:{first:local(2).toISOString()}};
  assert.deepEqual(dueSources(config,state,local(12)).sources,{second:local(9).toISOString()});
  assert.equal(nextConfigRun(config,local(12)),local(15).toISOString());
  assert.deepEqual(registrationTimes(config),['02:00','09:00','15:00','18:00']);
  config.schedule.enabled=false;assert.deepEqual(dueSources(config,state,local(12)).sources,{});assert.equal(nextConfigRun(config,local(12)),null);
});
test('source-specific disabled scheduling still leaves the source available for manual checks',()=>{
  const config=sources();config.sources[1].schedule.enabled=false;
  assert.equal(config.sources[1].enabled,true);assert.deepEqual(registrationTimes(config),['02:00','18:00']);
  assert.throws(()=>validateConfig({...config,sources:[{...config.sources[1],schedule:{enabled:true,checksPerDay:2,times:['10:00','10:00']}}]}),/Uhrzeit/);
});
test('native Windows registration splits more than 48 triggers without polling every minute',()=>{
  const times=Array.from({length:100},(_,i)=>`${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}`);
  const spec=scheduleFiles({platform:'win32',executable:path.resolve('Git Cloner.exe'),times,profile:os.tmpdir(),configDirectory:os.tmpdir(),home:os.tmpdir(),username:'Example user'});
  assert.equal(spec.files.length,3);assert.equal(spec.enable.length,3);
  assert.deepEqual(spec.files.map(f=>(f.content.match(/<CalendarTrigger>/g)||[]).length),[48,48,4]);
  assert.ok(spec.files.every(f=>!f.content.includes('<Repetition>')));
});
test('a repository override retains precedence even when its own schedule is not due',async()=>{
  const config=sources();config.sources=[{...config.sources[0],kind:'owner',value:'demo'},{...config.sources[1],value:'demo/one'}];
  const result=await resolveJobs(config.sources,{repositories:async()=>[{full_name:'demo/one'},{full_name:'demo/other'}]},{onlySources:['first']});
  assert.deepEqual(result.jobs.map(j=>j.repository.full_name),['demo/other']);assert.equal(result.excluded[0].reason,'override');
});
test('OS filtering recognizes desktop packages, preserves shared checksums and excludes uncertain archives',()=>{
  const names=['tool-windows-arm64.exe','tool-win-x64.zip','tool-macos-universal.dmg','tool-aarch64-apple-darwin.tar.gz','tool-linux-x86_64.AppImage','tool-amd64.deb','tool.pkg.tar.zst','tool.rpm','SHA256SUMS.txt','LICENSE.txt','tool-arm64.zip','tool-darwin.zip.sha256','tool-android.apk'];
  const assets=names.map((name,i)=>({name,id:i+1}));
  const selected=platform=>selectReleaseAssets(assets,'system',platform).selected.map(a=>a.name);
  assert.deepEqual(selected('win32'),[names[0],names[1],names[8],names[9]]);
  assert.deepEqual(selected('darwin'),[names[2],names[3],names[8],names[9],names[11]]);
  assert.deepEqual(selected('linux'),[names[4],names[5],names[6],names[7],names[8],names[9]]);
  assert.equal(selectReleaseAssets(assets,'all','darwin').selected.length,names.length);
  assert.equal(selectReleaseAssets(assets,'system','darwin').excluded.find(a=>a.name===names[10]).reason,'unknown-platform');
});
test('quiet hours include the start, exclude the end and span midnight',()=>{
  const hours={enabled:true,start:'22:00',end:'07:00'};
  assert.equal(quietNow(hours,local(21,59)),false);assert.equal(quietNow(hours,local(22)),true);assert.equal(quietNow(hours,local(6,59)),true);assert.equal(quietNow(hours,local(7)),false);
  assert.equal(quietNow({enabled:true,start:'12:00',end:'13:00'},local(12,30)),true);
  const config=defaults();config.notificationRules.backup='errors';assert.equal(notificationAllowed(config,'backup',{resultCount:2,errorCount:0},local(12)),false);assert.equal(notificationAllowed(config,'backup',{resultCount:2,errorCount:1},local(12)),true);
  config.notificationRules.backup='changes';assert.equal(notificationAllowed(config,'backup',{resultCount:2,errorCount:0,changedCount:1},local(12)),true);
  config.notificationRules.quietHours=hours;assert.equal(notificationAllowed(config,'backup',{resultCount:2,errorCount:1},local(23)),false);assert.equal(notificationAllowed(config,'update',{},local(23)),false);
  config.notificationRules.updates=false;assert.equal(notificationAllowed(config,'update',{},local(12)),false);
  assert.throws(()=>validateConfig({...config,notificationRules:{...config.notificationRules,quietHours:{enabled:true,start:'07:00',end:'07:00'}}}),/verschieden/);
});
test('a muted update remains visible and notifies once after quiet hours without another API request',async()=>{
  let allowed=false,requests=0,notices=0;const saved=[];
  const monitor=new UpdateMonitor({currentVersion:'3.0.0',github:{request:async()=>{requests++;return{tag_name:'v3.1.0'};}},canNotify:()=>allowed,notify:()=>{notices++;},save:async state=>saved.push(state)});
  assert.equal((await monitor.check()).status,'available');assert.equal(notices,0);assert.equal(monitor.state.lastNotifiedVersion,undefined);
  allowed=true;await Promise.all([monitor.notifyAvailable(),monitor.notifyAvailable()]);assert.equal(notices,1);assert.equal(requests,1);assert.equal(saved.at(-1).lastNotifiedVersion,'3.1.0');
  await monitor.ignore();await monitor.notifyAvailable();assert.equal(notices,1);
});
test('quiet hours beginning during persistence do not permanently consume the update notice',async()=>{
  let allowed=true,notices=0,release,started;const waiting=new Promise(r=>{started=r;});let writes=0;
  const monitor=new UpdateMonitor({currentVersion:'3.0.0',github:{request:async()=>({tag_name:'v3.1.0'})},canNotify:()=>allowed,notify:()=>{notices++;},save:async()=>{if(++writes===1){started();await new Promise(r=>{release=r;});}}});
  const checking=monitor.check();await waiting;allowed=false;release();await checking;
  assert.equal(notices,0);assert.equal(monitor.state.lastNotifiedVersion,undefined);allowed=true;await monitor.notifyAvailable();assert.equal(notices,1);
});
test('asset downloads check declared length and SHA256 while preserving foreign files',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gc-release-check-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const content=Buffer.from('verified release asset'),digest='sha256:'+createHash('sha256').update(content).digest('hex');
  const client=new GitHubClient({fetchImpl:async()=>new Response(content)}),file=path.join(root,'asset.bin');
  await client.downloadAsset('demo/project',1,file,{expectedSize:content.length,expectedDigest:digest});assert.deepEqual(await fs.readFile(file),content);
  await assert.rejects(client.downloadAsset('demo/project',1,file,{expectedSize:content.length}),/EEXIST/);assert.deepEqual(await fs.readFile(file),content);
  const bad=path.join(root,'bad.bin');await assert.rejects(client.downloadAsset('demo/project',1,bad,{expectedSize:content.length,expectedDigest:'sha256:'+'0'.repeat(64)}),/Prüfsumme/);await assert.rejects(fs.stat(bad),{code:'ENOENT'});
  await assert.rejects(client.downloadAsset('demo/project',1,bad,{expectedSize:content.length+1}),/unvollständig/);await assert.rejects(fs.stat(bad),{code:'ENOENT'});
});
test('GitHub cache stays bounded and transport-scoped clients share the same budget',async()=>{
  const client=new GitHubClient({cacheLimit:180,fetchImpl:async()=>({ok:true,status:200,headers:{get:key=>key==='etag'?'tag':null},json:async()=>({value:'x'.repeat(100)})})});
  await client.request('/first');await client.withTransfer(null).request('/second');assert.ok(client.cacheStats.bytes<=180);assert.equal(client.cache.size,1);assert.equal(client.cache.has('/first'),false);
});
