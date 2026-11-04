const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { VOLUME_MARKER, destinationHint } = require('./destinations.cjs');
const { readJson, writeJson } = require('./store.cjs');
const { validateConfig } = require('./config.cjs');
const execute = promisify(execFile);
const {repositoryDestination}=require('./provider-spec.cjs');
function targets(config) { return config.sources.flatMap(source => [{ sourceId: source.id, targetId: `${source.id}:primary`, ...source },...source.additionalDestinations.map(target => ({...target,sourceId:source.id,targetId:`${source.id}:${target.id}`}))]); }
async function markerAt(destination) {
  try { const root = await fs.lstat(destination); if (!root.isDirectory() || root.isSymbolicLink()) return null; const file = path.join(destination,VOLUME_MARKER), info = await fs.lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) return null; const marker = await readJson(file,null); return marker?.schemaVersion === 1 && /^[a-f\d-]{36}$/.test(marker.id) ? marker.id : null; } catch (_error) { return null; }
}
async function childDirectories(root) { try { return (await fs.readdir(root,{withFileTypes:true})).filter(d => d.isDirectory() && !d.isSymbolicLink()).slice(0,64).map(d => path.join(root,d.name)); } catch (_error) { return []; } }
async function mountedRoots(platform = process.platform, exec = execute) {
  if (platform === 'darwin') return childDirectories('/Volumes');
  if (platform === 'win32') {
    try { const {stdout} = await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command','@(Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root) | ConvertTo-Json -Compress'],{windowsHide:true,timeout:5000,maxBuffer:32768}); const roots = JSON.parse(stdout); return (Array.isArray(roots) ? roots : [roots]).filter(root => typeof root === 'string' && path.isAbsolute(root)).slice(0,64); } catch (_error) { return []; }
  }
  try {
    const text = await fs.readFile('/proc/self/mountinfo','utf8');
    return [...new Set(text.split('\n').filter(Boolean).map(line => line.split(' ')[4]?.replace(/\\([0-7]{3})/g,(_m,n) => String.fromCharCode(parseInt(n,8)))).filter(root => root && root !== '/' && !/^\/(proc|sys|dev)(\/|$)/.test(root) && (!root.startsWith('/run/') || root.startsWith('/run/media/'))))].slice(0,128);
  } catch (_error) { return [...await childDirectories('/mnt'),...await childDirectories('/media'),...await childDirectories('/run/media')]; }
}
async function rememberHints(config) {
  let changed = false;
  for (const target of targets(config)) {
    if (!target.volumeId || target.volumeHint || await markerAt(target.destination) !== target.volumeId) continue;
    const source = config.sources.find(s => s.id === target.sourceId), value = target.targetId.endsWith(':primary') ? source : source.additionalDestinations.find(t => `${source.id}:${t.id}` === target.targetId);
    value.volumeHint = await destinationHint(value.destination); changed = true;
  }
  return changed;
}
async function findRelocations(config, { roots = mountedRoots, includeDisabled = false } = {}) {
  const bindings = targets(config), moves = [], issues = [], cache = new Map(); let connected;
  const marker = destination => { if (!cache.has(destination)) cache.set(destination,markerAt(destination)); return cache.get(destination); };
  for (const target of bindings) {
    if (!target.volumeId || !target.volumeHint || !includeDisabled && !config.sources.find(s => s.id === target.sourceId).enabled || await marker(target.destination) === target.volumeId) continue;
    connected ??= [...new Set(await roots())].slice(0,128);
    const matches = [];
    for (const root of connected) {
      const candidate = path.resolve(root,...target.volumeHint.relative.split('/').filter(Boolean));
      if (candidate === path.resolve(target.destination) || matches.includes(candidate)) continue;
      if (await marker(candidate) === target.volumeId) matches.push(candidate);
    }
    if (matches.length === 1) {
      const chosen = matches[0], newRoot = connected.find(root => path.resolve(root,...target.volumeHint.relative.split('/').filter(Boolean)) === chosen);
      const destination = await fs.realpath(chosen), canonicalRoot = await fs.realpath(newRoot), relative = path.relative(canonicalRoot,destination).split(path.sep).join('/');
      if (relative === '..' || relative.startsWith('../')) continue;
      moves.push({ sourceId: target.sourceId, targetId: target.targetId, from: path.resolve(target.destination), recordFrom: target.volumeHint.canonical ?? path.resolve(target.destination), to: destination, volumeId: target.volumeId, volumeHint: {root:canonicalRoot,relative,canonical:destination} });
    } else if (matches.length > 1) issues.push({sourceId:target.sourceId,targetId:target.targetId,kind:'ambiguous',candidates:matches});
  }
  return { moves, issues };
}
function rewriteLocations(config, state, moves) {
  const nextConfig = structuredClone(config), nextState = structuredClone(state), idChanges = new Map();
  function moveConfig(value) {
    for (const source of value?.sources ?? []) for (const target of [{id:'primary',value:source},...source.additionalDestinations.map(t => ({id:t.id,value:t}))]) {
      const move = moves.find(m => m.targetId === `${source.id}:${target.id}` && m.volumeId === target.value.volumeId && path.resolve(target.value.destination) === m.from);
      if (move) { target.value.destination = move.to; target.value.volumeHint = move.volumeHint; }
    }
  }
  function moveResult(record) {
    const matching = moves.filter(m => (!record.targetId || record.targetId === m.targetId) && (!record.sourceId || record.sourceId === m.sourceId) && record.destination === repositoryDestination({...record,destination:m.recordFrom??m.from},record.fullName));
    const move = matching.find(m => config.sources.find(s => s.id === m.sourceId)?.value.toLowerCase() === record.fullName.toLowerCase()) ?? matching[0];
    if (!move) return record;
    const destination = repositoryDestination({...record,destination:move.to},record.fullName), id = createHash('sha256').update(`${record.fullName.toLowerCase()}\0${path.resolve(destination)}`).digest('hex').slice(0,24);
    if (record.id) idChanges.set(record.id,id);
    return {...record,destination,id,sourceId:record.sourceId ?? move.sourceId,targetId:record.targetId ?? move.targetId};
  }
  moveConfig(nextConfig); moveConfig(nextState.queue?.config);
  const repositories = new Map();
  for (const [key,record] of Object.entries(nextState.repositories ?? {})) { const updated = moveResult(record), id = updated.id ?? key; if (repositories.has(id)) throw new Error('Die Laufwerkszuordnung würde zwei Sicherungen zusammenführen. Bitte den Speicherort manuell auswählen.'); repositories.set(id,updated); }
  nextState.repositories = Object.fromEntries(repositories);
  if (nextState.queue) {
    for (const job of nextState.queue.jobs) {
      const move = moves.find(m => m.targetId === job.targetId && m.volumeId === job.source.volumeId && path.resolve(job.source.destination) === m.from);
      if (move) { const before = createHash('sha256').update(`${job.repository.full_name.toLowerCase()}\0${repositoryDestination(job.source,job.repository.full_name)}`).digest('hex').slice(0,24); job.source.destination = move.to; job.source.volumeHint = move.volumeHint; const after = createHash('sha256').update(`${job.repository.full_name.toLowerCase()}\0${repositoryDestination(job.source,job.repository.full_name)}`).digest('hex').slice(0,24); idChanges.set(before,after); }
    }
    nextState.queue.results = nextState.queue.results.map(moveResult);
    nextState.queue.completed = nextState.queue.completed.map(id => idChanges.get(id) ?? id);
    if(nextState.queue.blockedSpaces)nextState.queue.blockedSpaces=Object.fromEntries(Object.entries(nextState.queue.blockedSpaces).map(([id,item])=>{const move=moves.find(m=>item.root===m.from||item.root===m.recordFrom);return[idChanges.get(id)??id,{...item,...(move?{root:move.to}:{})}];}));
  }
  return { config: nextConfig, state: nextState,idChanges:Object.fromEntries(idChanges) };
}
async function persistRelocations(directory, config, state, moves) {
  const file = path.join(directory,'pending-relocations.json');
  const result = rewriteLocations(config,state,moves);
  result.config = validateConfig(result.config);
  await writeJson(file,{schemaVersion:1,moves});
  await writeJson(path.join(directory,'settings.json'),result.config);
  const current = {...result.state}; delete current.history;
  await writeJson(path.join(directory,'state.json'),{...current,history:[]});
  await fs.rm(file,{force:true}); return result;
}
async function recoverRelocations(directory, config, state) {
  const pending = await readJson(path.join(directory,'pending-relocations.json'),null);
  if (!pending) return {config,state};
  if (pending.schemaVersion !== 1 || !Array.isArray(pending.moves) || pending.moves.length > 1000 || pending.moves.some(m => !m || !path.isAbsolute(m.from ?? '') || !path.isAbsolute(m.to ?? '') || !/^[a-f\d-]{36}$/.test(m.volumeId ?? '') || !config.sources.some(s => s.id === m.sourceId))) throw new Error('Die gespeicherte Laufwerkszuordnung ist ungültig.');
  return persistRelocations(directory,config,state,pending.moves);
}
module.exports = { targets, markerAt, mountedRoots, rememberHints, findRelocations, rewriteLocations, persistRelocations, recoverRelocations };
