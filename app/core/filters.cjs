function wildcard(pattern, value) {
  const expression = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${expression}$`, 'i').test(value);
}
function includesRepository(repository, filters = {}) {
  if (filters.includeForks === false && repository.fork) return false;
  if (filters.includeArchived === false && repository.archived) return false;
  const match = pattern => wildcard(pattern, pattern.includes('/') ? repository.full_name : repository.full_name.split('/').at(-1));
  return (!(filters.include?.length) || filters.include.some(match)) && !(filters.exclude ?? []).some(match);
}
module.exports = { wildcard, includesRepository };
