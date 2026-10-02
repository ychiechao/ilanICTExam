// 把平台題庫 JSON（115 年三個題庫）轉成電子書內部格式，章節編號 1..70。
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const sources=['ilan_115_problems.json','national_115_elementary_problems.json','national_115_junior_problems.json'];
const out=[];
for(const file of sources){
 const raw=JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
 for(const p of raw.problems){
  out.push({
   id:out.length+1,
   platformId:p.id,
   year:p.year,
   title:p.title,
   categories:p.categories&&p.categories.length?p.categories:[p.category],
   category:p.category,
   difficulty:p.difficulty,
   problem_description:p.description,
   problem_statement:`輸入格式\n${p.inputFormat}\n\n輸出格式\n${p.outputFormat}`,
   examples:(p.examples||[]).map(x=>({input:x.input,output:x.output,explanation:x.description||''})),
   test_cases:(p.cases||[]).map(c=>({input_text:c.input,expected:c.output,visibility:c.visibility,title:c.caseTitle})),
   local_images:[],
  });
 }
}
fs.mkdirSync(path.join(__dirname,'dist/xml'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'problems.json'),JSON.stringify(out,null,2));
console.log('Prepared '+out.length+' problems');
