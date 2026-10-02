const P=require('./problems.json');
const [a,b]=process.argv.slice(2).map(Number);
for(const p of P.filter(p=>p.id>=a&&p.id<=(b||a))){
 console.log('================ #'+p.id+' '+p.title+'  ['+p.difficulty+'] '+p.category);
 console.log(p.problem_description);
 console.log(p.problem_statement);
 p.examples.forEach((x,i)=>console.log(`範例${i+1} IN<${x.input}> OUT<${x.output}> ${x.explanation}`));
 p.test_cases.forEach(t=>console.log(`測資${t.title} IN<${t.input_text}> OUT<${t.expected}>`));
}
