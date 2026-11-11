const { transferAsset } = require('./release-transfer.cjs');
const { stableReleaseData, finishReleaseFolder, assetIdentity } = require('./release-reuse.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const semver=require('semver');
const {controlDirectory}=require('./integrity.cjs');
const {writeJson}=require('./store.cjs');
const {selectReleaseAssets}=require('./release-assets.cjs');
const {cloneURL}=require('./provider-spec.cjs');
const {createReleaseDirectory}=require('./release-layout.cjs');
const {narrowToProgram}=require('./program-select.cjs');
async function hostedMetadataPlan(repository,options,client,git,{releaseScope='all',platform=process.platform,releaseArchitecture='all',releaseFileTypes=[],releaseDmgVariant='compatible',arch=process.arch,releaseProgram=null}={}){
  const base=client.projectPath(repository.full_name),lab=client.provider==='gitlab',data={};
  if(options.issues)data.issues=await client.collection(`${base}/issues${lab?'?scope=all&state=all':'?state=all&type=issues'}`);
  if(options.pullRequests)data.pullRequests=await client.collection(`${base}/${lab?'merge_requests?scope=all&state=all':'pulls?state=all'}`);
  if(options.releases)data.releases=await client.collection(`${base}/releases`);
  const stable=(data.releases??[]).filter(release=>!release.draft&&!release.prerelease&&!release.upcoming_release&&!(semver.valid(release.tag_name?.replace(/^v/,''))&&semver.prerelease(release.tag_name.replace(/^v/,'')))&&(!release.released_at||Date.parse(release.released_at)<=Date.now())).sort((a,b)=>Date.parse(b.released_at||b.published_at||b.created_at||0)-Date.parse(a.released_at||a.published_at||a.created_at||0));
  const release=stable[0]??null;
  const assets=release?await client.collection(lab?`${base}/releases/${encodeURIComponent(release.tag_name)}/assets/links`:`${base}/releases/${release.id}/assets`):[],normalized=assets.map(asset=>{
    let url=lab?(asset.direct_asset_url||asset.url):asset.browser_download_url;
    if(lab&&url){const parsed=new URL(url,client.server+'/'),server=new URL(client.server),download=parsed.pathname.indexOf('/-/releases/'),uploads=parsed.pathname.indexOf('/uploads/');if(parsed.origin===server.origin&&download>=0&&parsed.pathname.includes('/downloads/',download)){url=`${client.apiBase}${base}/releases/${encodeURIComponent(release.tag_name)}/downloads/${parsed.pathname.split('/downloads/').slice(1).join('/downloads/')}`;}else if(parsed.origin===server.origin&&uploads>=0){url=`${client.apiBase}${base}/uploads/${parsed.pathname.slice(uploads+9)}`;}}
    return{...asset,browser_download_url:url};
  });
  const selection=narrowToProgram(selectReleaseAssets(normalized,releaseScope,platform,{releaseArchitecture,releaseFileTypes,releaseDmgVariant,arch}),options.releases?releaseProgram:null,platform,arch),estimatedBytes=selection.selected.reduce((sum,a)=>sum+(Number.isSafeInteger(a.size)&&a.size>=0?a.size:0),0);
  let wikiRevision=null,warning=null;
  if(options.wiki&&repository.has_wiki!==false)try{wikiRevision=await git.revision(cloneURL(client,repository.full_name,true),true);}catch(_error){warning='Wiki nicht vorhanden oder nicht zugänglich.';}
  const digest=createHash('sha256').update(JSON.stringify({provider:client.provider,server:client.server,data:stableReleaseData(data),wikiRevision,warning,...(options.releases?{releaseLayout:3,identities:selection.selected.map(assetIdentity),releaseArchitecture,releaseFileTypes,...(releaseDmgVariant!=='compatible'?{releaseDmgVariant}:{}),arch:releaseArchitecture==='system'?arch:null,release:release?.tag_name,ids:selection.selected.map(a=>a.id),scope:releaseScope,platform:releaseScope==='system'?platform:null,...(releaseProgram?{program:releaseProgram.pattern}:{})}:{})})).digest('hex');
  const releaseInfo=release?{architecture:selection.architecture,fileTypes:releaseFileTypes,tag:release.tag_name,scope:releaseScope,platform,fileCount:selection.selected.length,bytes:estimatedBytes,excludedCount:selection.excluded.length,unknownSizes:selection.selected.filter(a=>!Number.isSafeInteger(a.size)).length}:null;
  return{digest,warning,wikiRevision,estimatedBytes,releaseInfo,downloadCount:selection.selected.length,releaseWarning:assets.length&&!selection.selected.length?'Keine Release-Dateien passen zu den gewählten Filtern. Betriebssystem, Architektur und Dateitypen prüfen.':null,
    async apply(directory,mode,{downloads,onProgress,reuse,onDownload}={}){
      const target=path.join(controlDirectory(directory,mode),'git-cloner-metadata');await fs.rm(target,{recursive:true,force:true});if(!Object.values(options).some(Boolean))return;await fs.mkdir(target,{recursive:true});await writeJson(path.join(target,'repository.json'),repository);
      for(const [key,values]of Object.entries(data))await writeJson(path.join(target,key+'.json'),values);
      if(options.issues)for(const issue of data.issues){const id=lab?issue.iid:issue.number;if(Number.isSafeInteger(id)&&id>0)await writeJson(path.join(target,`issue-${id}-comments.json`),await client.collection(`${base}/issues/${id}/${lab?'notes':'comments'}`));}
      if(options.pullRequests)for(const pull of data.pullRequests){const id=lab?pull.iid:pull.number;if(!Number.isSafeInteger(id)||id<1)throw new Error('Ungültige Merge-/Pull-Request-Nummer.');await writeJson(path.join(target,`pull-${id}.json`),{...pull,comments:await client.collection(`${base}/${lab?'merge_requests':'issues'}/${id}/${lab?'notes':'comments'}`),...(lab?{diffs:await client.collection(`${base}/merge_requests/${id}/diffs`)}:{reviews:await client.collection(`${base}/pulls/${id}/reviews`),files:await client.collection(`${base}/pulls/${id}/files`)})});}
      if(options.releases)await writeJson(path.join(target,'release-selection.json'),{tag:release?.tag_name??null,scope:releaseScope,platform,platformName:selection.platformName,selected:selection.selected.map(a=>({id:a.id,name:a.name,size:a.size??null})),excluded:selection.excluded});
      const releaseFolder=selection.selected.length?await createReleaseDirectory(directory,repository,release,selection.selected):null;
      for(const asset of selection.selected){const name=releaseFolder.files.find(file=>file.id===asset.id).storedName;await transferAsset({asset,tag:release.tag_name,target:path.join(releaseFolder.target,name),downloads,reuse,onProgress,onDownload,download:measured=>client.downloadAsset(repository.full_name,asset.id,path.join(releaseFolder.target,name),{url:asset.browser_download_url,expectedName:asset.name,expectedSize:asset.size,expectedDigest:asset.digest,...measured})});}
      await finishReleaseFolder(releaseFolder,selection.selected);
      if(wikiRevision)await git.cloneMirror(cloneURL(client,repository.full_name,true),path.join(target,'wiki.git'));
      await writeJson(path.join(target,'export.json'),{exportedAt:new Date().toISOString(),provider:client.provider,server:client.server,options,warning,wikiRevision});
      return {releaseInfo:releaseInfo?{...releaseInfo,assetDirectory:releaseFolder?.name??null}:null};
    }
  };
}
module.exports={hostedMetadataPlan};
