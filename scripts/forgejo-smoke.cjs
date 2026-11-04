// Optional real-service check. FORGEJO_BIN must point to a checksum-verified Forgejo binary.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomBytes}=require('node:crypto');
const assert=require('node:assert/strict'),execute=promisify(execFile);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const {HostedClient}=require('../app/core/hosted-client.cjs');
const {Git}=require('../app/core/git.cjs');
const {prepareDestination}=require('../app/core/destinations.cjs');
const {syncRepository}=require('../app/core/backup.cjs');
const {defaults}=require('../app/core/config.cjs');
const {inspectRecommendations}=require('../app/core/recommendations.cjs');
async function freePort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function parent(){
  if(!process.env.FORGEJO_BIN)throw new Error('Set FORGEJO_BIN to a checksum-verified Forgejo binary.');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gc-forgejo-service-'));
  try{
    const cert=path.join(root,'cert.pem'),key=path.join(root,'key.pem'),trust=path.join(root,'trusted.pem');
    await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true});await fs.chmod(key,0o600);
    const inherited=process.env.NODE_EXTRA_CA_CERTS?await fs.readFile(process.env.NODE_EXTRA_CA_CERTS,'utf8'):'';await fs.writeFile(trust,inherited+'\n'+await fs.readFile(cert,'utf8'));
    const bypass=[process.env.NO_PROXY||process.env.no_proxy||'','localhost','127.0.0.1'].filter(Boolean).join(',');
    const child=spawn(process.execPath,[__filename,'--service',root],{stdio:'inherit',env:{...process.env,NODE_EXTRA_CA_CERTS:trust,GIT_SSL_CAINFO:trust,GIT_CONFIG_GLOBAL:path.join(root,'gitconfig'),NO_PROXY:bypass,no_proxy:bypass}});
    const code=await new Promise(resolve=>child.once('exit',resolve));if(code!==0)throw new Error('The real Forgejo check failed.');
  }finally{await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
async function service(root){
  const port=await freePort(),server=`https://localhost:${port}`,config=path.join(root,'app.ini'),binary=process.env.FORGEJO_BIN,user='backup-reader',password='Ephemeral fixture password 123!';let token='';
  await fs.writeFile(config,`APP_NAME=Backup integration fixture\n[server]\nAPP_DATA_PATH=${root}/data\nPROTOCOL=https\nHTTP_ADDR=127.0.0.1\nHTTP_PORT=${port}\nROOT_URL=${server}/\nDOMAIN=localhost\nCERT_FILE=${root}/cert.pem\nKEY_FILE=${root}/key.pem\nDISABLE_SSH=true\nOFFLINE_MODE=true\n[database]\nDB_TYPE=sqlite3\nPATH=${root}/forgejo.db\n[repository]\nROOT=${root}/repositories\nDEFAULT_BRANCH=main\n[security]\nINSTALL_LOCK=true\nSECRET_KEY=${randomBytes(32).toString('hex')}\nINTERNAL_TOKEN=${randomBytes(32).toString('hex')}\n[service]\nDISABLE_REGISTRATION=true\n[picture]\nDISABLE_GRAVATAR=true\nENABLE_FEDERATED_AVATAR=false\n[log]\nMODE=file\nLEVEL=error\nROOT_PATH=${root}/log\n`,{mode:0o600});
  const args=['-w',root,'-c',config];await execute(binary,[...args,'migrate'],{timeout:60000,maxBuffer:1048576});await execute(binary,[...args,'admin','user','create','--username',user,'--password',password,'--email','backup-reader@example.invalid','--admin','--must-change-password=false'],{timeout:30000,maxBuffer:1048576});
  const child=spawn(binary,[...args,'web'],{stdio:'ignore'});
  const api=async(method,endpoint,body,basic=false)=>{
    const response=await fetch(server+'/api/v1'+endpoint,{method,headers:{Authorization:basic?'Basic '+Buffer.from(user+':'+password).toString('base64'):'token '+token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Fixture API ${method} ${endpoint} returned HTTP ${response.status}.`);return response.status===204?null:response.json();
  };
  try{
    let ready=false;for(let n=0;n<60;n++){if(child.exitCode!==null)throw new Error('Forgejo stopped before becoming ready.');try{const response=await fetch(server+'/api/v1/version',{signal:AbortSignal.timeout(2000)});if(response.ok){ready=true;break;}}catch(_error){/* Wait for migrations and HTTPS startup. */}await delay(500);}if(!ready)throw new Error('Forgejo HTTPS startup timed out.');
    token=(await api('POST','/users/'+user+'/tokens',{name:'backup-integration',scopes:['all']},true)).sha1;assert.equal(typeof token,'string');
    const repo=await api('POST','/user/repos',{name:'project',private:true,auto_init:true,default_branch:'main'}),base=`/repos/${user}/project`;assert(repo.private);
    await api('POST',base+'/issues',{title:'Example issue',body:'Example body'});await api('POST',base+'/issues/1/comments',{body:'Example comment'});
    await api('POST',base+'/contents/.gitattributes',{branch:'main',message:'LFS configuration',content:Buffer.from('*.bin filter=lfs diff=lfs merge=lfs -text\n').toString('base64')});
    await api('POST',base+'/branches',{new_branch_name:'feature',old_ref_name:'main'});await api('POST',base+'/contents/example.txt',{branch:'feature',message:'Example change',content:Buffer.from('Example change\n').toString('base64')});await api('POST',base+'/pulls',{base:'main',head:'feature',title:'Example pull request'});
    await api('POST',base+'/wiki/new',{title:'Home',content_base64:Buffer.from('Example wiki\n').toString('base64'),message:'Example page'});
    const release=await api('POST',base+'/releases',{tag_name:'v1.0.0',target_commitish:'main',name:'Example release',draft:false,prerelease:false}),form=new FormData();form.set('attachment',new Blob(['real release payload']),'program-linux.AppImage');await api('POST',base+`/releases/${release.id}/assets?name=program-linux.AppImage`,form);
    const spec={provider:'forgejo',server},client=new HostedClient({...spec,token,username:user}),git=new Git({...spec,token,username:user}),destination=path.join(root,'backups');await fs.mkdir(destination);const source=await prepareDestination({id:'fixture',kind:'repository',value:user+'/project',enabled:true,destination,...spec}),repository=await client.repository(source.value),options={...defaults().backup,reserveMB:64,metadata:{issues:true,pullRequests:true,releases:true,wiki:true}};
    assert((await client.repositories(user)).some(item=>item.full_name===source.value),'Private repository must appear in owner discovery.');
    const browserContext=await client.repositoryContext(user),browserPage=await client.repositoryPage(browserContext,{query:'project'});assert(browserPage.repositories.some(item=>item.full_name===source.value&&item.private),'Private repository must appear in the paginated picker search.');
    let record=await syncRepository({source,repository,github:client,git,options});assert.equal(record.status,'cloned');assert.equal(record.releaseInfo.fileCount,1);const metadata=path.join(record.destination,'.git','git-cloner-metadata');assert.equal(await fs.readFile(path.join(record.destination,record.releaseInfo.assetDirectory,(await fs.readdir(path.join(record.destination,record.releaseInfo.assetDirectory))).find(name=>!name.startsWith('.'))),'utf8'),'real release payload');assert.equal(JSON.parse(await fs.readFile(path.join(metadata,'issue-1-comments.json'),'utf8'))[0].body,'Example comment');assert((await fs.readdir(metadata)).some(name=>/^pull-\d+\.json$/.test(name)));await git.fsck(path.join(metadata,'wiki.git'));
    const recommendation=await inspectRecommendations({source,repository:source.value,client,git});assert(recommendation.hasLfs);options.mode='mirror';record=await syncRepository({source,repository,github:client,git,options});assert.equal(await git.run(['-C',record.destination,'rev-parse','--is-bare-repository']),'true');await git.run(['-C',record.destination,'rev-parse','refs/heads/feature']);
    console.log('Real Forgejo HTTPS service: private Git snapshot/mirror, branches, issues/comments, pull requests, wiki, release asset authentication and LFS recommendations passed.');
  }catch(error){const message=String(error.message).replaceAll(password,'[fixture password]').replaceAll(token||'unused-token','[fixture token]');throw new Error(message);}
  finally{child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(5000)]);if(child.exitCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
}
if(require.main===module)(process.argv[2]==='--service'?service(process.argv[3]):parent()).catch(error=>{console.error(error.message);process.exitCode=1;});
