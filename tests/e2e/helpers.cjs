const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { defaults } = require('../../app/core/config.cjs');

async function launch(options = {}) {
  const { config = defaults(), state, release } = options;
  const directory=options.directory || await fs.mkdtemp(path.join(os.tmpdir(),'git-cloner-e2e-'));
  if (!options.directory || options.config) await fs.writeFile(path.join(directory,'settings.json'),JSON.stringify(config));
  if(state)await fs.writeFile(path.join(directory,'state.json'),JSON.stringify(state));
  const application=await electron.launch({
    args:[...(process.env.CI === 'true' && process.env.GIT_CLONER_CONTAINER_TEST === '1' ? ['--no-sandbox'] : []),path.resolve(__dirname,'../..')],
    env:{...process.env,GIT_CLONER_E2E:'1',GIT_CLONER_TEST_DATA:directory,...(options.programCandidates?{GIT_CLONER_TEST_PROGRAMS:JSON.stringify(options.programCandidates)}:{}),...(release?{GIT_CLONER_TEST_RELEASE:release}:{}),...(options.repositories?{GIT_CLONER_TEST_REPOSITORIES:JSON.stringify(options.repositories)}:{}),...(options.remotes?{GIT_CLONER_TEST_REMOTES:JSON.stringify(options.remotes)}:{}),...(options.api?{GIT_CLONER_TEST_API:JSON.stringify(options.api)}:{}),...(options.mounts?{GIT_CLONER_TEST_MOUNTS:JSON.stringify(options.mounts)}:{})}
  });
  const page=await application.firstWindow();
  await page.locator('h1').first().waitFor();
  return { application,page,directory,close:async({preserve=false}={})=>{await application.close();if(!preserve)await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});} };
}
module.exports={launch};
