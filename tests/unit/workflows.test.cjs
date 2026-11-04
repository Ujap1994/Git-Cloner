const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { defaults, validateConfig, effectiveBackup } = require('../../app/core/config.cjs');
const { BackupService, resolveJobs } = require('../../app/core/backup.cjs');
const { retry } = require('../../app/core/retry.cjs');
const { restriction, networkName } = require('../../app/core/network-rules.cjs');
const { TransferBudget, createTransport } = require('../../app/core/transport.cjs');
const { previewConfig } = require('../../app/core/preview.cjs');
const { dashboard } = require('../../app/core/metrics.cjs');
const { GitHubClient } = require('../../app/core/github.cjs');
const { Git } = require('../../app/core/git.cjs');
function config(count = 5) { const c=defaults();c.sources=Array.from({length:count},(_,i)=>({id:`source-${i}`,kind:'repository',value:`demo/repo-${i}`,enabled:true,destination:path.join(os.tmpdir(),'gc-workflows-unit'),accountId:'default',additionalDestinations:[],backup:null}));return validateConfig(c); }
const github={repository:async value=>({full_name:value,size:1,has_wiki:false})};
const fakeTransport=async()=>({proxy:'',bytes:0,close:async()=>{}});
function service(options={}) { return new BackupService({github,git:{version:async()=>'git test'},saveState:async()=>{},transportFactory:fakeTransport,sync:async({repository,source})=>({fullName:repository.full_name,destination:path.join(source.destination,...repository.full_name.split('/')),status:'cloned',commit:'a'.repeat(40),bytes:10,checkedAt:new Date().toISOString()}),...options}); }
test('v2 settings migrate to empty, bounded v3 defaults and reject unsafe rule values',()=>{
  const c=defaults();delete c.execution;delete c.setupCompleted;delete c.appearance.highContrast;
  const restored=validateConfig(c);assert.deepEqual(restored.sources,[]);assert.equal(restored.execution.concurrency,2);assert.equal(restored.appearance.highContrast,false);
  for(const execution of [{concurrency:9},{retries:-1},{bandwidthKBps:NaN},{allowedNetworks:['bad\nname']},{onlyOnAC:'yes'}])assert.throws(()=>validateConfig({...c,execution}));
});
test('per-source backup options override the global mode without changing other sources',()=>{
  const c=config(2);c.sources[0].backup={...c.backup,mode:'mirror',lfs:true};const valid=validateConfig(c);
  assert.equal(effectiveBackup(valid,valid.sources[0]).mode,'mirror');assert.equal(effectiveBackup(valid,valid.sources[1]).mode,'snapshot');assert.equal(valid.backup.lfs,false);
  c.sources[0].backup.submodules=true;assert.throws(()=>validateConfig(c),/Submodule/);
});
test('retries back off, honor Retry-After and never retry a permission error',async()=>{
  let calls=0;const waits=[];
  assert.equal(await retry(async()=>{if(++calls<3)throw Object.assign(new Error('offline'),{code:'ECONNRESET'});return'good';},{sleep:async ms=>waits.push(ms),random:()=>0}), 'good');
  assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);calls=0;
  await assert.rejects(retry(async()=>{calls++;throw new Error('permission');},{sleep:async()=>{throw new Error('must not sleep');}}));assert.equal(calls,1);
  const retryAfter=[];calls=0;await retry(async()=>{if(!calls++)throw Object.assign(new Error('limited'),{retryable:true,retryAfterMs:9000});},{sleep:async ms=>retryAfter.push(ms),random:()=>0});assert.deepEqual(retryAfter,[9000]);
});
test('GitHub retries transient responses but leaves a normal HTTP 403 alone',async()=>{
  let calls=0;const client=new GitHubClient({retryOptions:{sleep:async()=>{},random:()=>0},fetchImpl:async()=>++calls<3?{status:503,ok:false}:{status:200,ok:true,json:async()=>({ok:true})}});
  assert.equal((await client.request('/repos/demo/test')).ok,true);assert.equal(calls,3);calls=0;
  client.fetchImpl=async()=>{calls++;return{status:403,ok:false};};await assert.rejects(client.request('/repos/demo/test'));assert.equal(calls,1);
});
test('release downloads retry a broken stream and never overwrite a foreign file',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gc-assets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let calls=0;
  const client=new GitHubClient({retryOptions:{sleep:async()=>{},random:()=>0},fetchImpl:async()=>({status:200,ok:true,body:++calls===1?new ReadableStream({start(controller){controller.error(Object.assign(new Error('stream failed'),{code:'ECONNRESET'}));}}):new ReadableStream({start(controller){controller.enqueue(Buffer.from('complete asset'));controller.close();}})})});
  const file=path.join(root,'asset');await client.downloadAsset('demo/project',1,file);assert.equal(calls,2);assert.equal(await fs.readFile(file,'utf8'),'complete asset');await assert.rejects(client.downloadAsset('demo/project',1,file),{code:'EEXIST'});assert.equal(await fs.readFile(file,'utf8'),'complete asset');
});
test('release redirects keep GitHub credentials off the external asset request',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gc-assets-auth-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const calls=[];
  const client=new GitHubClient({token:'a-secret',fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?{status:302,headers:{get:()=> 'https://release-assets.githubusercontent.com/demo/file'}}:{status:200,ok:true,body:new ReadableStream({start(c){c.enqueue(Buffer.from('asset'));c.close();}})};}});
  await client.downloadAsset('demo/project',1,path.join(root,'asset'));assert.equal(calls[0].options.headers.Authorization,'Bearer a-secret');assert.equal(calls[1].options.headers,undefined);
});
test('Git marks network errors retryable and keeps proxy/credentials scoped to the invocation',async()=>{
  let call;const git=new Git({token:'hidden-token',exec:async(...args)=>{call=args;return{stdout:'ok'};}}).withTransport('http://127.0.0.1:1234');
  await git.version();assert.ok(call[1].includes('http.proxy=http://127.0.0.1:1234'));assert.ok(!JSON.stringify(call[1]).includes('hidden-token'));assert.equal(call[2].env.NO_PROXY,'');
  const broken=new Git({exec:async()=>{throw Object.assign(new Error('private'),{stderr:'Connection reset by peer'});}});await assert.rejects(broken.version(),e=>e.retryable&&!e.message.includes('private'));
});
test('a shared transfer budget accounts for concurrent streams with one aggregate rate',async()=>{
  let now=0;const waits=[];const budget=new TransferBudget({bytesPerSecond:1024,now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;}});
  await Promise.all([budget.consume(1024),budget.consume(2048),budget.consume(1024)]);assert.equal(budget.bytes,4096);assert.deepEqual(waits,[1000,2000,1000]);budget.close();await assert.rejects(budget.consume(1));
});
test('the transfer proxy tunnels opaque bytes and applies a real download rate',async t=>{
  const echo=net.createServer(socket=>socket.pipe(socket));echo.listen(0,'127.0.0.1');await once(echo,'listening');
  const transport=await createTransport({bandwidthKBps:64,upstream:''});
  t.after(async()=>{await transport.close();await new Promise(resolve=>echo.close(resolve));});
  const proxy=new URL(transport.proxy),client=net.connect({host:proxy.hostname,port:Number(proxy.port)});await once(client,'connect');
  client.write(`CONNECT 127.0.0.1:${echo.address().port} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
  const [header]=await once(client,'data');assert.match(header.toString(),/200 Connection Established/);
  const bytes=Buffer.alloc(32768,0x4a),received=[];let length=0;const started=Date.now();
  const done=new Promise(resolve=>client.on('data',chunk=>{received.push(chunk);length+=chunk.length;if(length===bytes.length)resolve();}));client.write(bytes);await done;
  assert.deepEqual(Buffer.concat(received),bytes);assert.equal(transport.bytes,bytes.length);assert.ok(Date.now()-started>=350);client.destroy();
});
test('power and network rules fail closed when a required state is unknown',()=>{
  const e=defaults().execution;assert.equal(restriction(e,{}),null);assert.equal(restriction({...e,onlyOnAC:true},{onBattery:null}),'power');assert.equal(restriction({...e,onlyOnAC:true},{onBattery:false}),null);
  assert.equal(restriction({...e,allowedNetworks:['Office']},{network:null}),'network-unknown');assert.equal(restriction({...e,allowedNetworks:['Office']},{network:'Guest'}),'network');assert.equal(restriction({...e,allowedNetworks:['Office']},{network:'Office'}),null);
});
test('network names are read without shell commands on macOS, Windows and Linux',async()=>{
  const run=async(platform,outputs)=>{let i=0;return networkName({platform,exec:async(_file,args,options)=>{assert.ok(Array.isArray(args));assert.equal(options.timeout,5000);return{stdout:outputs[i++]};}});};
  assert.equal(await run('darwin',['Hardware Port: Wi-Fi\nDevice: en0\n','Current Wi-Fi Network: Office\n']),'Office');
  assert.equal(await run('win32',['    SSID : Office\n    BSSID : xx\n']),'Office');assert.equal(await run('linux',['no:Guest\nyes:Office\\:North\n']),'Office:North');
  assert.equal(await networkName({exec:async()=>{throw new Error('missing');}}),null);
});
test('preview reports exclusions and destinations without creating files or volume identities',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gc-readonly-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const c=config(1);c.sources[0]={...c.sources[0],kind:'owner',value:'demo',destination:root,filters:{includeForks:false,includeArchived:false,include:[],exclude:[]}};
  const result=await previewConfig(c,{repositories:async()=>[{full_name:'demo/yes',size:12},{full_name:'demo/no',fork:true,size:100}]});
  assert.equal(result.readOnly,true);assert.equal(result.repositoryCount,1);assert.equal(result.excludedCount,1);assert.equal(result.targets[0].destination,path.join(root,'demo','yes'));assert.deepEqual(await fs.readdir(root),[]);
});
test('pausing drains active jobs and a restarted service resumes only the remaining jobs',async()=>{
  const c=config(),releases=[],started=[];let twoStarted;
  const ready=new Promise(resolve=>{twoStarted=resolve;});
  const first=service({sync:async({repository,source})=>{started.push(repository.full_name);if(started.length===2)twoStarted();await new Promise(resolve=>releases.push(resolve));return{fullName:repository.full_name,destination:source.destination,status:'cloned',commit:'a'.repeat(40)};}});
  const running=first.run(c);await ready;first.pause();releases.forEach(resolve=>resolve());const paused=await running;
  assert.equal(paused.paused,true);assert.equal(first.busy,false);assert.equal(first.state.queue.completed.length,2);assert.equal(first.state.history.length,0);
  const second=service({state:structuredClone(first.state),sync:async({repository})=>{assert.ok(!started.includes(repository.full_name));return{fullName:repository.full_name,status:'cloned'};}});
  assert.deepEqual(await second.run(c),{paused:true});const result=await second.run(c,{resume:true});assert.equal(result.resultCount,5);assert.equal(second.state.queue,null);assert.equal(result.results.length,5);
});
test('parallel work is bounded and heavy backups run exclusively',async()=>{
  const c=config(7);c.execution.concurrency=4;c.sources[2].backup={...c.backup,mode:'mirror'};c.sources[5].destination=path.join(os.tmpdir(),'gc-another-volume');
  let active=0,peak=0,heavyOverlap=false;
  const backup=service({sync:async({repository,options})=>{active++;peak=Math.max(peak,active);if(options.mode==='mirror'&&active!==1)heavyOverlap=true;await delay(10);active--;return{fullName:repository.full_name,status:'cloned'};}});
  const result=await backup.run(c);assert.equal(result.errorCount,0);assert.ok(peak>1&&peak<=4);assert.equal(heavyOverlap,false);
});
test('parallel jobs cannot use another repository staging or rollback path',async()=>{
  const c=config(2);c.sources[0].value='demo/project';c.sources[1].value='demo/.project.git-cloner-stage';await assert.rejects(resolveJobs(c.sources,github),/Reservierte/);
  c.sources.reverse();await assert.rejects(resolveJobs(c.sources,github),/Reservierte/);
});
test('policy-blocked queues persist without dispatch and resume when allowed',async()=>{
  let blocked='power',calls=0;const backup=service({gate:async()=>blocked,sync:async({repository})=>{calls++;return{fullName:repository.full_name,status:'cloned'};}}),c=config(2);
  assert.equal((await backup.run(c)).reason,'power');assert.equal(calls,0);assert.equal(backup.state.queue.completed.length,0);blocked=null;await backup.run(c,{resume:true});assert.equal(calls,2);
});
test('resource restrictions prevent even the initial GitHub repository lookup',async()=>{
  let lookups=0;const backup=service({gate:async()=>'network',github:{repository:async()=>{lookups++;throw new Error('must not contact GitHub');}}});
  await backup.run(config(1));assert.equal(lookups,0);assert.equal(backup.state.queue.unresolved,true);
});
test('nested request retries do not multiply the configured attempt count',async()=>{
  let calls=0;await assert.rejects(retry(()=>retry(async()=>{calls++;throw Object.assign(new Error('network'),{retryable:true});},{sleep:async()=>{},retries:2}),{sleep:async()=>{},retries:2}));assert.equal(calls,3);
});
test('transient backup failures retry without duplicating final results',async()=>{
  let calls=0;const backup=service({retryOptions:{sleep:async()=>{},random:()=>0},sync:async({repository})=>{if(++calls<3)throw Object.assign(new Error('network'),{retryable:true});return{fullName:repository.full_name,status:'cloned'};}});
  const result=await backup.run(config(1));assert.equal(calls,3);assert.equal(result.resultCount,1);assert.equal(result.errorCount,0);
});
test('state-write failures release the process lease and do not keep the worker busy',async()=>{
  let released=0;const backup=service({saveState:async()=>{throw new Error('disk full');},acquireLock:async()=>async()=>{released++;}});
  await assert.rejects(backup.run(config(1)),/disk full/);assert.equal(released,1);assert.equal(backup.busy,false);
});
test('an unexpected policy error drains active repositories before releasing the lease',async()=>{
  let probes=0,active=0,released=false;
  const backup=service({gate:async()=>{if(++probes===3)throw new Error('probe failed');return null;},acquireLock:async()=>async()=>{assert.equal(active,0);released=true;},sync:async({repository})=>{active++;await delay(repository.full_name.endsWith('0')?5:20);active--;return{fullName:repository.full_name,status:'cloned'};}});
  const result=await backup.run(config(3));assert.equal(result.reason,'error');assert.equal(released,true);assert.equal(backup.state.queue.completed.length,2);
});
test('discard removes only a paused queue and leaves repository records intact',async()=>{
  const backup=service({gate:async()=>'user'});await backup.run(config(1));backup.state.repositories.existing={commit:'keep'};await backup.discard();assert.equal(backup.state.queue,null);assert.equal(backup.state.repositories.existing.commit,'keep');
});
test('dashboard combines bytes, overdue status and seven local-calendar days',()=>{
  const now=new Date(2026,10,4,12).getTime(),metrics=dashboard({a:{commit:'a',bytes:100,checkedAt:new Date(now-72*3600000).toISOString()},b:{status:'error'}},[{finishedAt:new Date(now).toISOString(),durationMs:5000,receivedBytes:42,errorCount:0,results:[]}],[],now);
  assert.equal(metrics.backupBytes,100);assert.equal(metrics.overdue,1);assert.equal(metrics.errors,1);assert.equal(metrics.days.length,7);assert.equal(metrics.days[6].receivedBytes,42);assert.equal(metrics.days[6].durationMs,5000);
});
