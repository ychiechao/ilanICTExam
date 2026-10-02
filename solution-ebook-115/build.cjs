const fs=require('fs'),ts=require('typescript');
const problems=require('./problems.json');const S=require('./solutions.cjs');const reports=require('./validation.json');
const notes=new Map(fs.readFileSync(__dirname+'/notes.txt','utf8').trim().split(/\r?\n/).map(l=>{const [id,...parts]=l.split('|');return [+id,parts]}));
// 題意與測資有出入、或解法採用教學假設時，在這裡登記校勘說明。
const warnings={};
const format=code=>ts.createPrinter().printFile(ts.createSourceFile('solution.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS));
const data=problems.map(p=>{
 const n=notes.get(p.id);const r=reports.find(r=>r.id===p.id);
 if(!n||n.length<6||!r?.imported)throw Error('Incomplete chapter '+p.id);
 const xml=fs.readFileSync(__dirname+`/dist/xml/problem-${String(p.id).padStart(3,'0')}.xml`,'utf8');
 return {...p,notes:n,topic:n[4],concepts:n[5],warning:warnings[p.id]||'',code:format(S[p.id]),xml,
  checks:{total:r.cases.length,passed:r.cases.filter(c=>c.passed).length},kind:'程式參考解'};
});
fs.writeFileSync(__dirname+'/dist/data.js','window.BOOK='+JSON.stringify(data).replace(/</g,'\u003c')+';');
fs.writeFileSync(__dirname+'/dist/validation-summary.json',JSON.stringify(data.map(p=>({id:p.id,platformId:p.platformId,title:p.title,kind:p.kind,checks:p.checks,warning:p.warning})),null,2));
console.log('Built '+data.length+' complete chapters');
