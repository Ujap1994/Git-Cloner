const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const semver=require('semver');
const execute=promisify(execFile);
async function digest(file){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
function transient(error){return /HTTP[ :]*(?:408|429|5\d\d)|ECONNRESET|ETIMEDOUT|timed out|TLS.*terminated|connection reset/i.test(`${error.message}\n${error.stderr??''}`);}
async function publishRelease({repository,version,commit,assets,notes,run=args=>execute('gh',args,{timeout:10*60000,maxBuffer:8*1048576}),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||!semver.valid(version)||semver.prerelease(version)||!/^[a-f\d]{40}$/.test(commit))throw new Error('Valid repository, stable version and commit are required.');
  const tag='v'+version,endpoint=`repos/${repository}/releases`,directory=path.resolve(assets),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'gc-publish-'));
  async function retry(fn){for(let attempt=0;;attempt++){try{return await fn();}catch(error){if(attempt>=3||!transient(error))throw error;await pause(2000*2**attempt);}}}
  async function api(method,url,body){const args=['api','--method',method,url,'-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'];if(body){const file=path.join(temporary,'request.json');await fs.writeFile(file,JSON.stringify(body));args.push('--input',file);}const {stdout}=await run(args);return stdout.trim()?JSON.parse(stdout):null;}
  let releaseId;
  async function read(){
    if(releaseId)return api('GET',`${endpoint}/${releaseId}`);
    try{const release=await api('GET',`${endpoint}/tags/${tag}`);releaseId=release.id;return release;}catch(error){if(!/HTTP[ :]*404/.test(`${error.message}\n${error.stderr??''}`))throw error;}
    // Drafts do not necessarily have a Git tag yet. Locate them in the authenticated list.
    for(let page=1;page<=100;page++){
      const releases=await api('GET',`${endpoint}?per_page=100&page=${page}`);if(!Array.isArray(releases))throw new Error('Invalid release list.');
      const release=releases.find(value=>value.tag_name===tag);if(release){releaseId=release.id;return release;}
      if(releases.length<100)return null;
    }
    throw new Error('Release list is too large.');
  }
  try{
    const files=(await fs.readdir(directory,{withFileTypes:true}));if(files.some(f=>!f.isFile()||f.isSymbolicLink()))throw new Error('Release assets must be regular files.');
    const manifest=await fs.readFile(path.join(directory,'SHA256SUMS.txt'),'utf8'),expected=new Map();
    for(const line of manifest.trim().split('\n')){const match=line.match(/^([a-f\d]{64}) {2}(.+)$/);if(!match||path.basename(match[2])!==match[2]||match[2].includes('\\')||expected.has(match[2]))throw new Error('Invalid checksum manifest.');expected.set(match[2],match[1]);}
    expected.set('SHA256SUMS.txt',await digest(path.join(directory,'SHA256SUMS.txt')));
    if(files.length!==expected.size||files.some(f=>!expected.has(f.name)))throw new Error('Checksum manifest does not cover every release asset.');
    const sizes=new Map(await Promise.all(files.map(async f=>[f.name,(await fs.stat(path.join(directory,f.name))).size])));
    const verify=release=>{
      if(release.target_commitish!==commit)throw new Error('Existing release targets a different commit.');
      if(release.assets.length!==expected.size||new Set(release.assets.map(a=>a.name)).size!==expected.size)throw new Error('Uploaded release asset list is incomplete or contains unexpected files.');
      for(const asset of release.assets)if(!expected.has(asset.name)||asset.size!==sizes.get(asset.name)||asset.digest!==`sha256:${expected.get(asset.name)}`)throw new Error(`Release asset checksum or size mismatch: ${asset.name}`);
    };
    let release=await retry(async()=>{const existing=await read();if(existing)return existing;return api('POST',endpoint,{tag_name:tag,target_commitish:commit,name:`Git Cloner ${version}`,body:await fs.readFile(notes,'utf8'),draft:true,prerelease:false});});
    releaseId=release.id;
    if(release.target_commitish!==commit)throw new Error('Existing release targets a different commit.');
    if(!release.draft){verify(release);return{url:release.html_url,alreadyPublished:true,assets:expected.size};}
    for(const file of files){const existing=release.assets.find(a=>a.name===file.name);if(existing?.digest===`sha256:${expected.get(file.name)}`&&existing.size===sizes.get(file.name))continue;await retry(()=>run(['release','upload',tag,path.join(directory,file.name),'--repo',repository,'--clobber']));}
    release=await retry(read);verify(release);
    const published=await retry(async()=>{const current=await read();verify(current);return current.draft?api('PATCH',`${endpoint}/${current.id}`,{draft:false,make_latest:'true'}):current;});
    if(published.draft)throw new Error('Release is still a draft.');return{url:published.html_url,alreadyPublished:false,assets:expected.size};
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
if(require.main===module)publishRelease({repository:process.env.GITHUB_REPOSITORY,version:process.env.RELEASE_VERSION,commit:process.env.RELEASE_COMMIT,assets:process.argv[2],notes:process.argv[3]}).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={publishRelease};
