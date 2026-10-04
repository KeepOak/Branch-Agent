// Only explicitly changed, literal lane test paths can extend the frozen batch.
export function selectChangedTests(files) {
  const selected = { engine: [], window: [] };
  for (const file of files) {
    if (!/\.test\.tsx?$/.test(file)) continue;
    const match = /^(engine|window)\/(.+)$/.exec(file);
    if (!match) continue;
    const [, lane, relative] = match;
    if (!/^[A-Za-z0-9_./-]+\.test\.tsx?$/.test(relative)
      || relative.split('/').some(part => !part || part === '.' || part === '..')
      || !/^(src|packages|extensions|scripts)\//.test(relative)) {
      throw new Error(`Invalid changed feature test path: ${file}`);
    }
    if (!selected[lane].includes(relative)) selected[lane].push(relative);
  }
  return selected;
}
