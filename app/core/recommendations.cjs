const {createHash}=require('node:crypto');
const {cloneURL,parseHostedSource}=require('./provider-spec.cjs');
async function inspectRecommendations({source,repository,client,git,signal}){
  const fullName=parseHostedSource(repository,'repository',source);
  if(source.kind==='repository'&&fullName.toLowerCase()!==source.value.toLowerCase()||source.kind==='owner'&&!fullName.toLowerCase().startsWith(source.value.toLowerCase()+'/'))throw new Error('Das Repository gehört nicht zu dieser Quelle.');
  await client.repository(fullName,{signal});const head=await git.remoteHead(cloneURL(source,fullName),{signal,timeout:30000});
  if(!head)return{sourceId:source.id,fullName,head:null,hasLfs:false,hasSubmodules:false,complete:true,empty:true,evidence:[]};
  let tree;if(client.tree)tree=await client.tree(fullName,head,{signal});else{const commit=await client.request(`/repos/${fullName}/git/commits/${head}`,{signal});tree=await client.request(`/repos/${fullName}/git/trees/${commit.tree.sha}?recursive=1`,{signal});}
  if(!Array.isArray(tree.tree))throw new Error('Der Git-Server liefert keine gültige Dateiliste.');
  const attributes=tree.tree.filter(e=>e.type==='blob'&&e.path.split('/').at(-1)==='.gitattributes'),links=tree.tree.filter(e=>e.type==='commit'||e.mode==='160000'),evidence=[];
  let complete=!tree.truncated&&attributes.length<=32,hasLfs=false;
  for(const entry of attributes.slice(0,32)){
    let info=entry;if(info.size==null&&client.blobInfo)info={...info,...await client.blobInfo(fullName,entry.path,head,{signal})};
    if(info.size==null||info.size>131072){complete=false;continue;}
    const blob=client.blob?await client.blob(fullName,entry.sha,{signal}):await client.request(`/repos/${fullName}/git/blobs/${entry.sha}`,{signal});
    if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.content.length>262144)throw new Error('Die Attributdatei ist zu groß.');
    const content=Buffer.from(blob.content,'base64'),sha=createHash(entry.sha.length===64?'sha256':'sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
    if(sha!==entry.sha||content.length!==info.size)throw new Error('Die Git-Prüfsumme der Attributdatei stimmt nicht.');
    if(content.toString('utf8').split(/\r?\n/).some(line=>line.trim()&&!line.trim().startsWith('#')&&/\bfilter\s*=\s*lfs\b/.test(line))){hasLfs=true;evidence.push({path:entry.path,kind:'lfs'});}
  }
  for(const entry of links.slice(0,100))evidence.push({path:entry.path,kind:'submodule'});
  let lfsAvailable=null;if(hasLfs)try{await git.run(['lfs','version'],{timeout:5000});lfsAvailable=true;}catch(_error){lfsAvailable=false;}
  return{sourceId:source.id,fullName,head,hasLfs,hasSubmodules:links.length>0,submoduleCount:links.length,lfsAvailable,complete,evidence,checkedAt:new Date().toISOString()};
}
module.exports={inspectRecommendations};
