import {build} from 'esbuild';
await build({entryPoints:['business/ui/xlsx-worker-source.js'],outfile:'assets/xlsx-worker.js',bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022',legalComments:'eof'});
console.log('Built dedicated XLSX worker (no server credentials or records).');
