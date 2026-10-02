// Compile a deliberately small, auditable algorithm notation into real Blockly blocks.
const ts=require('typescript');
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function compile(code,title){
 const vars=new Set();
 const f=(n,v)=>`<field name="${n}">${esc(v)}</field>`;
 const v=(n,x)=>`<value name="${n}">${x}</value>`;
 const st=(n,x)=>`<statement name="${n}">${x}</statement>`;
 const b=(t,body='')=>`<block type="${t}">${body}</block>`;
 const num=n=>b('math_number',f('NUM',n));
 const str=s=>b('text',f('TEXT',s));
 const get=n=>{vars.add(n);return b('variables_get',f('VAR',n))};
 const set=(n,x)=>{vars.add(n);return b('variables_set',f('VAR',n)+v('VALUE',x))};
 const ar=(op,a,c)=>b('math_arithmetic',f('OP',op)+v('A',a)+v('B',c));
 const chain=a=>a.filter(Boolean).reduceRight((tail,x)=>tail?x.replace(/<\/block>((?:<\/next><\/block>)*)$/,(_,suffix)=>`<next>${tail}</next></block>${suffix}`):x,'');
 const list=a=>b('lists_create_with',`<mutation items="${a.length}"></mutation>`+a.map((x,i)=>v('ADD'+i,x)).join(''));
 const join=a=>b('text_join',`<mutation items="${a.length}"></mutation>`+a.map((x,i)=>v('ADD'+i,x)).join(''));
 function e(n){
  if(ts.isParenthesizedExpression(n))return e(n.expression);
  if(ts.isNumericLiteral(n))return num(n.text);
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return str(n.text);
  if(n.kind===ts.SyntaxKind.TrueKeyword||n.kind===ts.SyntaxKind.FalseKeyword)return b('logic_boolean',f('BOOL',n.kind===ts.SyntaxKind.TrueKeyword?'TRUE':'FALSE'));
  if(ts.isIdentifier(n))return get(n.text);
  if(ts.isArrayLiteralExpression(n))return list(n.elements.map(e));
  if(ts.isElementAccessExpression(n))return b('lists_getIndex',`<mutation statement="false" at="true"></mutation>`+f('MODE','GET')+f('WHERE','FROM_START')+v('VALUE',e(n.expression))+v('AT',ar('ADD',e(n.argumentExpression),num(1))));
  if(ts.isPrefixUnaryExpression(n)){if(n.operator===ts.SyntaxKind.MinusToken)return ar('MINUS',num(0),e(n.operand));if(n.operator===ts.SyntaxKind.ExclamationToken)return b('logic_negate',v('BOOL',e(n.operand)));}
  if(ts.isConditionalExpression(n))return b('logic_ternary',v('IF',e(n.condition))+v('THEN',e(n.whenTrue))+v('ELSE',e(n.whenFalse)));
  if(ts.isBinaryExpression(n)){
   const op=n.operatorToken.getText(),a=e(n.left),c=e(n.right);
   if(['+','-','*','/','**'].includes(op))return ar(({'+':'ADD','-':'MINUS','*':'MULTIPLY','/':'DIVIDE','**':'POWER'})[op],a,c);
   if(op==='%')return b('math_modulo',v('DIVIDEND',a)+v('DIVISOR',c));
   if(['<','<=','>','>=','==','===','!=','!=='].includes(op))return b('logic_compare',f('OP',({'<':'LT','<=':'LTE','>':'GT','>=':'GTE','==':'EQ','===':'EQ','!=':'NEQ','!==':'NEQ'})[op])+v('A',a)+v('B',c));
   if(op==='&&'||op==='||')return b('logic_operation',f('OP',op==='&&'?'AND':'OR')+v('A',a)+v('B',c));
  }
  if(ts.isCallExpression(n)){
   const name=n.expression.getText(),a=n.arguments.map(e);
   if(name==='read')return b('io_input_number');if(name==='word')return b('io_input');
   if(['floor','ceil','round'].includes(name))return b('math_round',f('OP',({floor:'ROUNDDOWN',ceil:'ROUNDUP',round:'ROUND'})[name])+v('NUM',a[0]));
   if(name==='abs'||name==='sqrt')return b('math_single',f('OP',name==='abs'?'ABS':'ROOT')+v('NUM',a[0]));
   if(name==='min'||name==='max'||name==='sum')return b('math_on_list',f('OP',name.toUpperCase())+v('LIST',name==='sum'?a[0]:list(a)));
   if(name==='len')return b('lists_length',v('VALUE',a[0]));
   if(name==='strlen')return b('text_length',v('VALUE',a[0]));
   if(name==='char')return b('text_charAt',`<mutation at="true"></mutation>`+f('WHERE','FROM_START')+v('VALUE',a[0])+v('AT',ar('ADD',a[1],num(1))));
   if(name==='number')return ar('MINUS',b('lists_indexOf',f('END','FIRST')+v('VALUE',list(['0','1','2','3','4','5','6','7','8','9'].map(str)))+v('FIND',a[0])),num(1));
   if(name==='cat')return join(a);
   if(name==='join')return b('lists_split',f('MODE','JOIN')+v('INPUT',a[0])+v('DELIM',str(' ')));
   if(name==='index')return ar('MINUS',b('lists_indexOf',f('END','FIRST')+v('VALUE',a[0])+v('FIND',a[1])),num(1));
   if(name==='sort')return b('lists_sort',f('TYPE','NUMERIC')+f('DIRECTION',n.arguments[1]?.getText()==='-1'?-1:1)+v('LIST',a[0]));
   if(name==='zeros')return b('lists_repeat',v('ITEM',num(0))+v('NUM',a[0]));
  }
  throw Error('Unsupported expression: '+n.getText());
 }
 function assign(target,value){
  if(ts.isIdentifier(target))return set(target.text,value);
  if(ts.isElementAccessExpression(target))return b('lists_setIndex',`<mutation at="true"></mutation>`+f('MODE','SET')+f('WHERE','FROM_START')+v('LIST',e(target.expression))+v('AT',ar('ADD',e(target.argumentExpression),num(1)))+v('TO',value));
  throw Error('Bad assignment');
 }
 function statement(n){
  if(ts.isBlock(n))return chain(n.statements.map(statement));
  if(ts.isVariableStatement(n))return chain(n.declarationList.declarations.map(d=>set(d.name.text,d.initializer?e(d.initializer):num(0))));
  if(ts.isIfStatement(n))return b('controls_if',(n.elseStatement?'<mutation else="1"></mutation>':'')+v('IF0',e(n.expression))+st('DO0',statement(n.thenStatement))+(n.elseStatement?st('ELSE',statement(n.elseStatement)):''));
  if(ts.isWhileStatement(n))return b('controls_whileUntil',f('MODE','WHILE')+v('BOOL',e(n.expression))+st('DO',statement(n.statement)));
  if(ts.isForStatement(n)){
   const d=n.initializer.declarations[0];const name=d.name.text;vars.add(name);
   const op=n.condition.operatorToken.getText();const step=n.incrementor.operator===ts.SyntaxKind.MinusMinusToken?-1:1;
   const end=(op==='<'?ar('MINUS',e(n.condition.right),num(1)):op==='>'?ar('ADD',e(n.condition.right),num(1)):e(n.condition.right));
   // while preserves empty ranges, unlike Blockly's auto-direction controls_for.
   const cmp=b('logic_compare',f('OP',({'<':'LT','<=':'LTE','>':'GT','>=':'GTE'})[op])+v('A',get(name))+v('B',e(n.condition.right)));
   return chain([set(name,e(d.initializer)),b('controls_whileUntil',f('MODE','WHILE')+v('BOOL',cmp)+st('DO',chain([statement(n.statement),set(name,ar('ADD',get(name),num(step)))])))]);
  }
  if(ts.isBreakStatement(n))return b('controls_flow_statements',f('FLOW','BREAK'));
  if(ts.isExpressionStatement(n)){
   const x=n.expression;
   if(ts.isBinaryExpression(x)&&['=','+=','-='].includes(x.operatorToken.getText()))return assign(x.left,x.operatorToken.getText()==='='?e(x.right):ar(x.operatorToken.getText()==='+='?'ADD':'MINUS',e(x.left),e(x.right)));
   if(ts.isPostfixUnaryExpression(x))return assign(x.operand,ar('ADD',e(x.operand),num(x.operator===ts.SyntaxKind.PlusPlusToken?1:-1)));
   if(ts.isCallExpression(x)){
    const name=x.expression.getText(),a=x.arguments.map(e);
    if(name==='print')return b('io_print',v('TEXT',a[0]));
    if(name==='push')return b('lists_setIndex',`<mutation at="false"></mutation>`+f('MODE','INSERT')+f('WHERE','LAST')+v('LIST',a[0])+v('TO',a[1]));
   }
  }
  throw Error('Unsupported statement: '+n.getText());
 }
 const ast=ts.createSourceFile('algorithm.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const blocks=chain(ast.statements.map(statement));
 return `<xml xmlns="https://developers.google.com/blockly/xml"><variables>${[...vars].map(n=>`<variable>${esc(n)}</variable>`).join('')}</variables><block type="event_whenflagclicked" x="30" y="30"><comment pinned="false">${esc(title)}。參考解答；輸入依平台逐筆讀取。</comment>${st('DO',blocks)}</block></xml>`;
}
module.exports={compile};
