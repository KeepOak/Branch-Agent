import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.env.BRANCH_MEMORY_ACCEPTANCE_ENGINE_ROOT ?? path.dirname(fileURLToPath(import.meta.url));
const paths=JSON.parse(fs.readFileSync(`${root}/tsconfig.json`,'utf8')).compilerOptions.paths;
function resolveSource(id){for(const [pattern,targets] of Object.entries(paths)){const wildcard=pattern.indexOf('*');if(wildcard<0&&id===pattern)return path.resolve(root,targets[0]);if(wildcard>=0&&id.startsWith(pattern.slice(0,wildcard))&&id.endsWith(pattern.slice(wildcard+1))){const tail=id.slice(wildcard,id.length-(pattern.length-wildcard-1));return path.resolve(root,targets[0].replace('*',tail));}}}
export default {root,cacheDir:process.env.BRANCH_MEMORY_ACCEPTANCE_CACHE_DIR ?? path.join(root,'.cache/memory-acceptance-vitest'),plugins:[{name:'memory-real-source-aliases',enforce:'pre',resolveId:resolveSource}],test:{pool:'forks',maxWorkers:1,fileParallelism:false,isolate:true,testTimeout:60000,hookTimeout:120000,setupFiles:[`${root}/test/setup.ts`],include:['extensions/memory-core/src/standing-intents.test.ts','extensions/memory-core/src/rings-dreams-file.test.ts','extensions/memory-wiki/src/chatgpt-import-labels.test.ts','extensions/memory-wiki/src/import-insights.test.ts'],execArgv:['--max-old-space-size=384','--import',`file:///${root}/node_modules/tsx/dist/esm/index.mjs`]}};
