// Resource budgets, not fixed business row/column counts. Excel's physical grid remains the ceiling.
export const productionLimits=Object.freeze({file:10*1024*1024,expanded:32*1024*1024,text:16*1024*1024,cells:250000,metadata:512*1024,row:128*1024,chunk:256*1024,staged:32*1024*1024,chunkRows:20,excelRows:1048576,excelColumns:16384});
export const byteLength=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
