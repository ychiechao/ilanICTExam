const fs=require('fs'),vm=require('vm');
const Blockly=require('blockly');require('blockly/blocks');
const {javascriptGenerator:g}=require('blockly/javascript');
const {compile}=require('./blockly-compiler.cjs');const S=require('./solutions.cjs');
Blockly.defineBlocksWithJsonArray([
 {type:'event_whenflagclicked',message0:'開始 %1',args0:[{type:'input_statement',name:'DO'}],colour:40},
 {type:'io_print',message0:'輸出 %1',args0:[{type:'input_value',name:'TEXT'}],previousStatement:null,nextStatement:null},
 {type:'io_input',message0:'讀取文字',output:null},
 {type:'io_input_number',message0:'讀取數字',output:'Number'}
]);
g.forBlock.event_whenflagclicked=(b,g)=>g.statementToCode(b,'DO');
g.forBlock.io_print=(b,g)=>'window.alert('+g.valueToCode(b,'TEXT',0)+');\n';
g.forBlock.io_input=()=>["window.prompt('')",0];g.forBlock.io_input_number=()=>["Number(window.prompt(''))",0];
const probs=JSON.parse(fs.readFileSync(__dirname+'/problems.json','utf8'));
const normalize=s=>String(s).trim().split(/\s+/).join(' ');
fs.mkdirSync(__dirname+'/dist/xml',{recursive:true});
const only=process.argv[2]?process.argv.slice(2).map(Number):null;
const report=[];
for(const p of probs){
 if(only&&!only.includes(p.id)){const keep=fs.existsSync(__dirname+'/validation.json')&&JSON.parse(fs.readFileSync(__dirname+'/validation.json','utf8')).find(r=>r.id===p.id);if(keep){report.push(keep);continue;}}
 if(!S[p.id]){report.push({id:p.id,imported:false,error:'No solution yet'});continue;}
 try{
 const xml=compile(S[p.id],`${p.id} ${p.title}`);
 const ws=new Blockly.Workspace();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(xml),ws);
 if(ws.getTopBlocks(false).length!==1)throw Error('Detached blocks detected');
 const expectedBlockCount=(xml.match(/<block /g)||[]).length;
 if(ws.getAllBlocks(false).length!==expectedBlockCount)throw Error('Dropped blocks detected');
 const code=g.workspaceToCode(ws);ws.dispose();
 fs.writeFileSync(__dirname+`/dist/xml/problem-${String(p.id).padStart(3,'0')}.xml`,xml);
 const tests=p.test_cases.length?p.test_cases.map(t=>({input:t.input_text,output:t.expected})):p.examples;
 const cases=tests.map(t=>{
  const queue=t.input.trim().split(/[\s,]+/).filter(Boolean),out=[];
  try{vm.runInNewContext(code,{window:{prompt:()=>queue.shift()??'',alert:x=>out.push(String(x))}},{timeout:3000});return {passed:normalize(out.join(' '))===normalize(t.output),expected:t.output,actual:out.join(' '),input:t.input};}catch(e){return {passed:false,error:e.message,input:t.input};}
 });
 report.push({id:p.id,imported:true,blocks:(xml.match(/<block /g)||[]).length,cases,code});
 }catch(e){report.push({id:p.id,imported:false,error:e.message});}
}
report.sort((a,b)=>a.id-b.id);
fs.writeFileSync(__dirname+'/validation.json',JSON.stringify(report,null,2));
const bad=report.filter(r=>(r.imported&&r.cases.some(t=>!t.passed))||(!r.imported&&r.error!=="No solution yet"));const todo=report.filter(r=>r.error==="No solution yet").map(r=>r.id);
console.log(JSON.stringify({imported:report.filter(r=>r.imported).length,total:report.length,tests:report.reduce((s,r)=>s+(r.cases?.length||0),0),passed:report.reduce((s,r)=>s+(r.cases?.filter(t=>t.passed).length||0),0),failing:bad.map(r=>r.id),todo:todo.length?`${todo[0]}..${todo[todo.length-1]} (${todo.length})`:"none"},null,2));
for(const r of bad.slice(0,8)){console.log('--- '+r.id, r.error||'');for(const c of (r.cases||[]).filter(t=>!t.passed).slice(0,2)){console.log('  in:',JSON.stringify(c.input),'exp:',JSON.stringify(c.expected),'got:',JSON.stringify(c.actual||c.error));}}
