const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { defaults, parseSource, validateConfig } = require('../../app/core/config.cjs');

test('first launch has no preconfigured repositories or account', () => {
  assert.deepEqual(defaults().sources, []);
  assert.deepEqual(validateConfig(defaults()).sources, []);
  const config = defaults(); config.schedule.times[0] = '03:00';
  assert.equal(defaults().schedule.times[0], '02:00');
});
test('normalizes GitHub URLs and plain names', () => {
  assert.equal(parseSource('https://github.com/some-user/demo.git/', 'repository'), 'some-user/demo');
  assert.equal(parseSource('some-user', 'owner'), 'some-user');
  assert.equal(parseSource('owner/.github', 'repository'), 'owner/.github');
});
test('rejects non-GitHub hosts, credentials, query strings and path traversal', () => {
  for (const value of ['https://evil.test/a/b','http://github.com/a/b','https://github.com.evil.test/a/b','https://token@github.com/a/b','https://github.com/a/b?x=1','a/../b','a/..','-a/b','a/b/c']) assert.throws(()=>parseSource(value,'repository'));
});
test('requires absolute destinations, unique sources, and matching time count', () => {
  const config = defaults();
  config.sources = [{ id:'one', kind:'repository', value:'some/repo', destination:os.tmpdir(), enabled:true }];
  assert.equal(validateConfig(config).sources[0].value,'some/repo');
  config.sources[0].destination = 'relative'; assert.throws(()=>validateConfig(config));
  config.sources[0].destination = os.tmpdir();
  config.sources.push({...config.sources[0],id:'two',value:'SOME/Repo'}); assert.throws(()=>validateConfig(config));
  config.sources=[];
  for (const schedule of [ {enabled:true,checksPerDay:2,times:['02:00']}, {enabled:true,checksPerDay:2,times:['02:00','02:00']}, {enabled:true,checksPerDay:1,times:['24:00']}, {enabled:true,checksPerDay:25,times:[]} ]) {
    config.schedule=schedule; assert.throws(()=>validateConfig(config));
  }
});
test('sorts schedule and strips unknown settings including plaintext tokens', () => {
  const config = {...defaults(), token:'must-not-persist', schedule:{enabled:true,checksPerDay:2,times:['20:00','03:00']}};
  const result=validateConfig(config);
  assert.equal(result.token,undefined);
  assert.deepEqual(result.schedule.times,['03:00','20:00']);
});
