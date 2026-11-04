const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GitHubClient } = require('../../app/core/github.cjs');
const { checkForUpdates } = require('../../app/core/updates.cjs');
const response = (data,status=200) => ({ok:status>=200&&status<300,status,json:async()=>data});
test('paginates account repositories and excludes foreign-owned repos', async () => {
  const calls=[];
  const api=new GitHubClient({fetchImpl:async url=>{
    calls.push(url);
    if(url.endsWith('/users/demo'))return response({type:'User'});
    return response(new URL(url).searchParams.get('page')==='1' ? Array.from({length:100},(_,i)=>({full_name:`demo/r${i}`,owner:{login:'demo'}})) : [{full_name:'demo/last',owner:{login:'demo'}},{full_name:'other/repo',owner:{login:'other'}}]);
  }});
  assert.equal((await api.repositories('demo')).length,101);
  assert.equal(calls.length,3);
});
test('uses org endpoint with authentication for organizations', async () => {
  const calls=[];
  const api=new GitHubClient({token:'test-token',fetchImpl:async(url,options)=>{
    calls.push(url); assert.equal(options.headers.Authorization,'Bearer test-token');
    return response(url.endsWith('/users/team') ? {type:'Organization'} : []);
  }});
  await api.repositories('team'); assert.ok(calls[1].includes('/orgs/team/repos?type=all'));
});
test('authenticated owner listing includes private repositories', async () => {
  const calls=[];
  const api=new GitHubClient({token:'test-token',fetchImpl:async url=>{
    calls.push(url);
    if(url.endsWith('/users/me'))return response({type:'User'});
    if(url.endsWith('/user'))return response({login:'Me'});
    return response([{full_name:'me/private',owner:{login:'me'},private:true}]);
  }});
  assert.equal((await api.repositories('me')).length,1);
  assert.ok(calls[2].includes('/user/repos?affiliation=owner&visibility=all'));
});
test('GitHub errors are actionable without exposing response data', async () => {
  for(const status of [401,403,404,429,500]) {
    const api=new GitHubClient({fetchImpl:async()=>response({message:'secret'},status)});
    await assert.rejects(api.repository('a/b'),error=>!error.message.includes('secret'));
  }
});
test('release comparison uses semantic version order', async () => {
  const github={request:async()=>({tag_name:'v10.0.0'})};
  assert.equal((await checkForUpdates('2.0.0',github)).status,'available');
  github.request=async()=>({tag_name:'v1.0.0'});
  assert.equal((await checkForUpdates('1.0.0',github)).status,'current');
  assert.equal((await checkForUpdates('1.1.0',github)).status,'current');
  github.request=async()=>null; assert.equal((await checkForUpdates('1.0.0',github)).status,'unpublished');
  github.request=async()=>({tag_name:'invalid'}); await assert.rejects(checkForUpdates('1.0.0',github));
});
