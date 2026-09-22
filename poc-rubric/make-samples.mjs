// 產生 PoC 用的範例 .aia / .sb3（node poc-rubric/make-samples.mjs）
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'samples');

// ---------- 最小 zip 寫入器（store，不壓縮） ----------
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

// ---------- App Inventor ----------
function aia(project, components, blocksXml) {
  const scm = `#|\n$JSON\n${JSON.stringify({
    authURL: ['ai2.appinventor.mit.edu'], YaVersion: '232', Source: 'Form',
    Properties: { $Name: 'Screen1', $Type: 'Form', $Version: '31', AppName: project, Title: project, Uuid: '0', $Components: components },
  })}\n|#`;
  const bky = `<xml xmlns="https://developers.google.com/blockly/xml">\n${blocksXml}\n<yacodeblocks ya-version="232" language-version="37"></yacodeblocks>\n</xml>`;
  const props = `main=appinventor.ai_demo.${project}.Screen1\nname=${project}\nassets=../assets\nsource=../src\nbuild=../build\nversioncode=1\nversionname=1.0\nuseslocation=False\naname=${project}\nsizing=Responsive\nshowlistsasjson=True\ntheme=AppTheme.Light.DarkActionBar\n`;
  const base = `src/appinventor/ai_demo/${project}/`;
  return zip([
    { name: 'youngandroidproject/project.properties', data: props },
    { name: base + 'Screen1.scm', data: scm },
    { name: base + 'Screen1.bky', data: bky },
  ]);
}
const num = (n, id) => `<block type="math_number" id="${id}"><field name="NUM">${n}</field></block>`;
const getVar = (v, id) => `<block type="lexical_variable_get" id="${id}"><field name="VAR">${v}</field></block>`;
const getProp = (type, inst, prop, id) => `<block type="component_set_get" id="${id}"><mutation component_type="${type}" set_or_get="get" property_name="${prop}" is_generic="false" instance_name="${inst}"></mutation><field name="COMPONENT_SELECTOR">${inst}</field><field name="PROP">${prop}</field></block>`;
const setProp = (type, inst, prop, valueXml, id, nextXml = '') => `<block type="component_set_get" id="${id}"><mutation component_type="${type}" set_or_get="set" property_name="${prop}" is_generic="false" instance_name="${inst}"></mutation><field name="COMPONENT_SELECTOR">${inst}</field><field name="PROP">${prop}</field><value name="VALUE">${valueXml}</value>${nextXml ? `<next>${nextXml}</next>` : ''}</block>`;
const setVar = (v, valueXml, id, nextXml = '') => `<block type="lexical_variable_set" id="${id}"><field name="VAR">${v}</field><value name="VALUE">${valueXml}</value>${nextXml ? `<next>${nextXml}</next>` : ''}</block>`;
const add = (a, b, id) => `<block type="math_add" id="${id}"><mutation items="2"></mutation><value name="NUM0">${a}</value><value name="NUM1">${b}</value></block>`;
const globalDecl = (v, valueXml, id, y) => `<block type="global_declaration" id="${id}" x="20" y="${y}"><field name="NAME">${v}</field><value name="VALUE">${valueXml}</value></block>`;
const clickEvent = (inst, bodyXml, id) => `<block type="component_event" id="${id}" x="20" y="120"><mutation component_type="Button" is_generic="false" instance_name="${inst}" event_name="Click"></mutation><field name="COMPONENT_SELECTOR">${inst}</field><statement name="DO">${bodyXml}</statement></block>`;

// 範例：按鈕計算 1..N 總和（for 迴圈）
function sumWithFor(names, sumVar) {
  const { txt, btn, lbl } = names;
  const body = setVar(`global ${sumVar}`, num(0, 's2'), 's1',
    `<block type="controls_forRange" id="f1"><field name="VAR">i</field>` +
    `<value name="START">${num(1, 'f2')}</value>` +
    `<value name="END">${getProp('TextBox', txt, 'Text', 'f3')}</value>` +
    `<value name="STEP">${num(1, 'f4')}</value>` +
    `<statement name="DO">${setVar(`global ${sumVar}`, add(getVar(`global ${sumVar}`, 'f7'), getVar('i', 'f8'), 'f6'), 'f5')}</statement>` +
    `<next>${setProp('Label', lbl, 'Text', getVar(`global ${sumVar}`, 'o2'), 'o1')}</next></block>`);
  return globalDecl(sumVar, num(0, 'g2'), 'g1', 20) + '\n' + clickEvent(btn, body, 'e1');
}
// 學生 B：邏輯相同但用 while 迴圈
function sumWithWhile(names) {
  const { txt, btn, lbl } = names;
  const body = setVar('global sum', num(0, 's2'), 's1',
    setVar('global i', num(1, 's4'), 's3',
      `<block type="controls_while" id="w1">` +
      `<value name="TEST"><block type="math_compare" id="w2"><field name="OP">LTE</field><value name="A">${getVar('global i', 'w3')}</value><value name="B">${getProp('TextBox', txt, 'Text', 'w4')}</value></block></value>` +
      `<statement name="DO">${setVar('global sum', add(getVar('global sum', 'w7'), getVar('global i', 'w8'), 'w6'), 'w5', setVar('global i', add(getVar('global i', 'w11'), num(1, 'w12'), 'w10'), 'w9'))}</statement>` +
      `<next>${setProp('Label', lbl, 'Text', getVar('global sum', 'o2'), 'o1')}</next></block>`));
  return globalDecl('sum', num(0, 'g2'), 'g1', 20) + '\n' + globalDecl('i', num(0, 'g4'), 'g3', 70) + '\n' + clickEvent(btn, body, 'e1');
}

const refComponents = [
  { $Name: 'TextBox1', $Type: 'TextBox', $Version: '6', Hint: '輸入 N', NumbersOnly: 'True', Width: '-2', Uuid: '1' },
  { $Name: 'Button1', $Type: 'Button', $Version: '7', Text: '計算', Width: '-2', Uuid: '2' },
  { $Name: 'Label1', $Type: 'Label', $Version: '5', Text: '結果', FontSize: '20', Uuid: '3' },
];
// 學生 A：名稱、尺寸、顏色、排列都不同，邏輯相同
const okComponents = [
  { $Name: 'VerticalArrangement1', $Type: 'VerticalArrangement', $Version: '4', Width: '-2', Height: '-2', AlignHorizontal: '3', Uuid: '10', $Components: [
    { $Name: 'txtN', $Type: 'TextBox', $Version: '6', Hint: 'N', Width: '200', Height: '60', BackgroundColor: '&HFFFFFF00', Uuid: '11' },
    { $Name: 'btnGo', $Type: 'Button', $Version: '7', Text: 'GO', Width: '120', Height: '80', Shape: '1', Uuid: '12' },
    { $Name: 'lblOut', $Type: 'Label', $Version: '5', Text: '?', FontSize: '40', TextColor: '&HFFFF0000', Uuid: '13' },
  ] },
];
const badComponents = [
  { $Name: 'Button1', $Type: 'Button', $Version: '7', Text: '按我', Uuid: '2' },
  { $Name: 'Label1', $Type: 'Label', $Version: '5', Text: '', Uuid: '3' },
];

writeFileSync(join(out, 'ai2-ref.aia'), aia('SumDemo', refComponents, sumWithFor({ txt: 'TextBox1', btn: 'Button1', lbl: 'Label1' }, 'sum')));
writeFileSync(join(out, 'ai2-student-A.aia'), aia('SumDemo', okComponents, sumWithFor({ txt: 'txtN', btn: 'btnGo', lbl: 'lblOut' }, 'total')));
writeFileSync(join(out, 'ai2-student-B.aia'), aia('SumDemo', refComponents, sumWithWhile({ txt: 'TextBox1', btn: 'Button1', lbl: 'Label1' })));
writeFileSync(join(out, 'ai2-student-C.aia'), aia('SumDemo', badComponents,
  clickEvent('Button1', setProp('Label', 'Label1', 'Text', `<block type="text" id="t1"><field name="TEXT">Hello</field></block>`, 'o1'), 'e1')));

// ---------- Scratch 3 ----------
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#4c97ff"/></svg>';
const svgMd5 = createHash('md5').update(svg).digest('hex');
const costume = (name) => ({ name, bitmapResolution: 1, dataFormat: 'svg', assetId: svgMd5, md5ext: svgMd5 + '.svg', rotationCenterX: 20, rotationCenterY: 20 });

function sb3(stage, sprites) {
  const project = {
    targets: [
      { isStage: true, name: 'Stage', variables: stage.variables || {}, lists: stage.lists || {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0, costumes: [costume('backdrop1')], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null },
      ...sprites.map((s, i) => ({ isStage: false, name: s.name, variables: s.variables || {}, lists: {}, broadcasts: {}, blocks: s.blocks, comments: {},
        currentCostume: 0, costumes: [costume('costume1')], sounds: [], volume: 100, layerOrder: i + 1, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' })),
    ],
    monitors: [], extensions: [], meta: { semver: '3.0.0', vm: '0.2.0', agent: 'poc' },
  };
  return zip([{ name: 'project.json', data: JSON.stringify(project) }, { name: svgMd5 + '.svg', data: svg }]);
}
const B = (opcode, { next = null, parent = null, inputs = {}, fields = {}, topLevel = false } = {}) =>
  ({ opcode, next, parent, inputs, fields, shadow: false, topLevel, ...(topLevel ? { x: 0, y: 0 } : {}) });

// 範例：加總清單「輸入」到變數「答案」，用計數變數 counter 走訪
function sumList(counter, sayOpcode = 'looks_say') {
  const V = (name) => [12, name, 'v_' + name];
  return {
    a: B('event_whenflagclicked', { topLevel: true, next: 'b' }),
    b: B('data_setvariableto', { parent: 'a', next: 'c', inputs: { VALUE: [1, [10, '0']] }, fields: { VARIABLE: ['答案', 'v_答案'] } }),
    c: B('data_setvariableto', { parent: 'b', next: 'd', inputs: { VALUE: [1, [10, '1']] }, fields: { VARIABLE: [counter, 'v_' + counter] } }),
    d: B('control_repeat', { parent: 'c', next: 'h', inputs: { TIMES: [3, 'e', [6, '10']], SUBSTACK: [2, 'f'] } }),
    e: B('data_lengthoflist', { parent: 'd', fields: { LIST: ['輸入', 'l_輸入'] } }),
    f: B('data_changevariableby', { parent: 'd', next: 'g3', inputs: { VALUE: [3, 'g', [4, '1']] }, fields: { VARIABLE: ['答案', 'v_答案'] } }),
    g: B('data_itemoflist', { parent: 'f', inputs: { INDEX: [3, V(counter), [7, '1']] }, fields: { LIST: ['輸入', 'l_輸入'] } }),
    g3: B('data_changevariableby', { parent: 'f', inputs: { VALUE: [1, [4, '1']] }, fields: { VARIABLE: [counter, 'v_' + counter] } }),
    h: B(sayOpcode, { parent: 'd', inputs: { MESSAGE: [3, V('答案'), [10, 'Hello!']], ...(sayOpcode === 'looks_sayforsecs' ? { SECS: [1, [4, '2']] } : {}) } }),
  };
}
const stageVars = (counter) => ({ variables: { 'v_答案': ['答案', 0], ['v_' + counter]: [counter, 0] }, lists: { 'l_輸入': ['輸入', [1, 2, 3, 4, 5]] } });

writeFileSync(join(out, 'sb3-ref.sb3'), sb3(stageVars('i'), [{ name: 'Sprite1', blocks: sumList('i') }]));
// 學生 A：同名變數、同邏輯，角色名稱不同、多一個角色
writeFileSync(join(out, 'sb3-student-A.sb3'), sb3(stageVars('i'), [{ name: '貓咪', blocks: sumList('i') }, { name: '裝飾', blocks: {} }]));
// 學生 B：計數變數改名為「索引」，說改成「說 2 秒」
writeFileSync(join(out, 'sb3-student-B.sb3'), sb3(stageVars('索引'), [{ name: 'Sprite1', blocks: sumList('索引', 'looks_sayforsecs') }]));
// 學生 C：只會說 Hello
writeFileSync(join(out, 'sb3-student-C.sb3'), sb3({ variables: { 'v_答案': ['答案', 0] }, lists: { 'l_輸入': ['輸入', [1, 2, 3]] } }, [{ name: 'Sprite1', blocks: {
  a: B('event_whenflagclicked', { topLevel: true, next: 'b' }),
  b: B('looks_say', { parent: 'a', inputs: { MESSAGE: [1, [10, 'Hello']] } }),
} }]));

console.log('samples written to', out);
