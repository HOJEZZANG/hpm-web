import {build} from 'esbuild';
await build({entryPoints:['business/ui/ahu-pnd-worker-source.js'],outfile:'assets/ahu-pnd-worker.js',bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022',supported:{'template-literal':false},legalComments:'eof'});
console.log('Built browser-only AHU PND worker. Existing production worker unchanged.');
