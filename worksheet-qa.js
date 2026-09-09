const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');
// HTML path: 1st CLI arg, else index.html next to this script, else older names.
const HTML_PATH=process.argv[2]
  || [path.join(__dirname,'index.html'),
      path.join(__dirname,'server-build-worksheet.html'),
      '/mnt/user-data/outputs/server-build-worksheet.html']
     .find(p=>fs.existsSync(p))
  || path.join(__dirname,'index.html');
const html=fs.readFileSync(HTML_PATH,'utf8');
console.log('testing '+HTML_PATH+'\n');

const errors=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
  virtualConsole:new (require('jsdom').VirtualConsole)().on('jsdomError',e=>errors.push('JSDOM: '+e.message))
});
const w=dom.window,d=w.document;

function fail(m){console.log('FAIL  '+m);process.exitCode=1;}
function pass(m){console.log('ok    '+m);}
function fire(el,type){el.dispatchEvent(new w.Event(type,{bubbles:true}));}

setTimeout(()=>{
  if(errors.length){errors.forEach(e=>fail(e));}
  else pass('page loaded with no script errors');

  // 1. datalists populated
  ['dimms','ctrls','psus','caps','expanders','rearopts'].forEach(id=>{
    const n=d.getElementById(id).children.length;
    n>0?pass(`datalist #${id} populated (${n})`):fail(`datalist #${id} EMPTY`);
  });

  // 2. model combo opens and lists models
  const mi=d.getElementById('model-input');
  mi.value='DL380';fire(mi,'input');
  const items=d.querySelectorAll('#model-panel .combo-item');
  items.length>0?pass(`model search "DL380" -> ${items.length} results`):fail('model search returned nothing');

  // 3. pick DL380 G10 and confirm CPU list filters to sp1+sp2 only
  const target=[...items].find(el=>el.textContent.includes('DL380 G10')&&!el.textContent.includes('G10+'));
  if(!target)return fail('DL380 G10 not in results');
  target.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  d.getElementById('model').value==='DL380 G10'?pass('selected DL380 G10'):fail('model hidden value not set');

  const ci=d.getElementById('cpu-input');
  ci.disabled===false?pass('cpu box enabled after model pick'):fail('cpu box still disabled');
  ci.value='';fire(ci,'input');
  const cpuItems=[...d.querySelectorAll('#cpu-panel .combo-item')];
  const groups=[...d.querySelectorAll('#cpu-panel .combo-group')].map(g=>g.textContent);
  cpuItems.length>0?pass(`cpu list populated (${cpuItems.length} parts, groups: ${groups.length})`):fail('cpu list EMPTY');
  groups.some(g=>g.includes('Skylake'))&&groups.some(g=>g.includes('Cascade'))
    ?pass('cpu groups separated by generation: '+groups.join(' | ')):fail('cpu groups wrong: '+groups.join('|'));
  cpuItems.some(el=>el.textContent.includes('6140'))?pass('Gold 6140 offered on G10'):fail('6140 missing on G10');

  // 4. G9 must NOT offer 6140
  mi.value='DL380 G9';fire(mi,'input');
  const g9=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.includes('DL380 G9'));
  g9.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  ci.value='';fire(ci,'input');
  const g9cpus=[...d.querySelectorAll('#cpu-panel .combo-item')].map(e=>e.textContent);
  g9cpus.some(t=>t.includes('6140'))?fail('6140 wrongly offered on G9'):pass('Gold 6140 correctly absent on G9');

  // 5. cpu select auto-sets qty to 1
  d.getElementById('cpuq').value='';
  const pick=[...d.querySelectorAll('#cpu-panel .combo-item')].find(e=>e.textContent.includes('E5-2697v4'));
  pick.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  d.getElementById('cpuq').value==='1'?pass('cpu qty auto-set to 1'):fail('cpu qty not auto-set (got "'+d.getElementById('cpuq').value+'")');

  // 6. socket cap
  d.getElementById('cpuq').max==='2'?pass('cpu qty capped at 2 sockets for DL380'):fail('socket cap wrong: '+d.getElementById('cpuq').max);

  // 7. rear-drive 160W rule should block with E5-2697v4 (145W ok) -> use 2699v4? 145W. Use rear + >160W none exist on g9.
  // instead test 2SFF rear on 8SFF chassis
  d.getElementById('bays').value='8SFF';fire(d.getElementById('bays'),'input');
  d.getElementById('rear').value='2SFF rear';fire(d.getElementById('rear'),'input');
  let checks=d.getElementById('checks').textContent;
  checks.includes('2SFF rear cage is only supported')?pass('2SFF-on-8SFF blocked correctly'):fail('2SFF rule did not fire');

  // 8. bay overflow
  d.getElementById('rear').value='';fire(d.getElementById('rear'),'input');
  const dq=d.querySelector('#drives [data-k=q]'),dc=d.querySelector('#drives [data-k=cap]');
  dq.value='12';dc.value='1.2TB';fire(dc,'input');
  checks=d.getElementById('checks').textContent;
  checks.includes('TOO MANY DRIVES')||checks.includes('12 drives specified')?pass('drive overflow blocked (12 in 8SFF)'):fail('drive overflow not caught');

  // 9. memory ceiling
  d.getElementById('dimmq').value='24';d.getElementById('dimm').value='64GB 2400';
  fire(d.getElementById('dimm'),'input');
  checks=d.getElementById('checks').textContent;
  (checks.includes('OVER MEMORY LIMIT')||checks.includes('DIMM'))?pass('memory limit check fires'):fail('memory check silent');

  // 10. paste parser: lowercase "dl380 g10"
  d.getElementById('paste-text').value='dl380 g10 with 2x 12C cpu, 64gb memory, p408, 2x 800w';
  d.getElementById('paste-fill').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const pr=d.getElementById('paste-result').textContent;
  d.getElementById('model').value==='DL380 G10'?pass('paste "dl380 g10" resolved to DL380 G10'):fail('paste model failed -> "'+d.getElementById('model').value+'"');
  pr.includes('800w')?pass('paste picked up PSU'):fail('paste missed PSU');
  d.getElementById('ctrl').value.startsWith('P408')?pass('paste picked up P408 controller'):fail('paste missed controller');

  // 11. capacity planner
  d.getElementById('bays').value='24SFF';fire(d.getElementById('bays'),'input');
  d.getElementById('plan-cap').value='20';
  d.getElementById('plan-raid').value='5';
  d.getElementById('plan-go').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const rows=d.querySelectorAll('#plan-out .plan-row');
  rows.length>0?pass(`planner returned ${rows.length} suggestions (top: ${rows[0].textContent.trim().replace(/\s+/g,' ')})`):fail('planner returned nothing');

  // 12. spec slip has content
  const slip=d.getElementById('slip').textContent;
  slip.includes('DL380 G10')?pass('spec slip renders'):fail('spec slip empty/wrong');

  // 13. override not hard-locked
  const stdFan=d.getElementById('fn1');
  stdFan.checked=true;fire(stdFan,'change');
  stdFan.checked?pass('manual fan override sticks (not force-reverted)'):fail('fan override was overwritten');
},400);

// ---- round 2: newly verified models ----
setTimeout(()=>{
  function pass2(m){console.log('ok    '+m);}
  function fail2(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi2=d.getElementById('model-input'), ci2=d.getElementById('cpu-input');
  function setModel(label){
    mi2.value='';fire(mi2,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail2('model not found in list: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
    return d.getElementById('model').value===label;
  }
  function pickCpu(code){
    ci2.value='';fire(ci2,'input');
    const opt=[...d.querySelectorAll('#cpu-panel .combo-item')].find(el=>el.textContent.includes(code));
    if(!opt)return false;
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
    return d.getElementById('cpu').value===code;
  }

  // DL325 G10 -> 170W threshold, 7532 exception
  setModel('DL325 G10')?pass2('selected DL325 G10'):fail2('could not select DL325 G10');
  pickCpu('EPYC 7452')?pass2('picked EPYC 7452 (155W) on DL325 G10'):fail2('could not pick EPYC 7452');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  let txt=d.getElementById('checks').textContent;
  !(d.querySelector('input[name="hs"]:checked'))?pass2('7452 (155W, below 170W) -> no heatsink forced, none needed'):fail2('7452 wrongly forced a heatsink: '+(d.querySelector('input[name="hs"]:checked')||{}).value);

  pickCpu('EPYC 7532');
  txt=d.getElementById('checks').textContent;
  txt.includes('listed exception')?pass2('EPYC 7532 exception note fires'):fail2('7532 exception note missing');

  // DL560 G10 -> validCounts [1,2,4], reject 3
  setModel('DL560 G10');
  pickCpu('S4110');
  d.getElementById('cpuq').value='3';fire(d.getElementById('cpuq'),'input');
  txt=d.getElementById('checks').textContent;
  txt.includes('INVALID CPU COUNT')||txt.includes('only supports 1, 2, 4')?pass2('DL560 G10 rejects 3 processors'):fail2('DL560 G10 did not reject 3 CPUs: '+txt.slice(0,200));

  // DL325 G11 -> liquid cooling mandatory at 320W+
  setModel('DL325 G11');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  pickCpu('EPYC 9554'); // 360W, single-socket chassis
  txt=d.getElementById('checks').textContent;
  txt.includes('LIQUID COOLING REQUIRED')?pass2('DL325 G11 flags mandatory liquid cooling at 360W'):fail2('DL325 G11 liquid cooling rule silent: '+txt.slice(0,300));

  // DL385 G11 -> 240W tier
  setModel('DL385 G11');
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  pickCpu('EPYC 9224'); // 200W, below the 240W tier - no rule should fire
  !(d.querySelector('input[name="hs"]:checked'))?pass2('DL385 G11: 200W EPYC -> no heatsink forced (below 240W tier)'):fail2('DL385 G11 200W wrongly forced: '+(d.querySelector('input[name="hs"]:checked')||{}).value);
  pickCpu('EPYC 9354'); // 280W - should be performance (240-300 tier)
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Perf Heatsinks'?pass2('DL385 G11: 280W EPYC -> performance heatsink'):fail2('DL385 G11 280W got '+(d.querySelector('input[name="hs"]:checked')||{}).value);

  // ML350 G10 -> 85W threshold
  setModel('ML350 G10');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  pickCpu('S4110'); // exactly 85W - "above 85W" should NOT trigger
  !(d.querySelector('input[name="hs"]:checked'))?pass2('ML350 G10: 85W (not above) -> no heatsink forced'):fail2('ML350 G10 85W wrongly forced: '+(d.querySelector('input[name="hs"]:checked')||{}).value);
  pickCpu('G6140'); // 140W - clearly above 85W, should trigger
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Perf Heatsinks'?pass2('ML350 G10: 140W part -> performance heatsink'):fail2('ML350 G10 140W got '+(d.querySelector('input[name="hs"]:checked')||{}).value);

  // memory: genoa per-socket now 3072 not 6144
  setModel('DL325 G11');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  pickCpu('EPYC 9124'); // 200W, under liquid threshold
  d.getElementById('dimmq').value='12';d.getElementById('dimm').value='256GB';fire(d.getElementById('dimm'),'input');
  txt=d.getElementById('checks').textContent;
  // 12x256=3072GB = exactly at 3072 cap, should NOT be over; bump to 16x256=4096 to force over
  d.getElementById('dimmq').value='16';fire(d.getElementById('dimmq'),'input');
  txt=d.getElementById('checks').textContent;
  txt.includes('OVER MEMORY LIMIT')?pass2('genoa per-socket memory cap (3TB) now enforced correctly'):fail2('genoa memory cap not enforced: '+txt.slice(0,300));

},900);

setTimeout(()=>{
  function pass3(m){console.log('ok    '+m);}
  function fail3(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi3=d.getElementById('model-input'), ci3=d.getElementById('cpu-input');
  function setModel3(label){
    mi3.value='';fire(mi3,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail3('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function pickCpu3(code){
    ci3.value='';fire(ci3,'input');
    const opt=[...d.querySelectorAll('#cpu-panel .combo-item')].find(el=>el.textContent.includes(code));
    if(opt)opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }

  // --- Fresh DL380 G10, 1 socket populated ---
  setModel3('DL380 G10');
  pickCpu3('S4110');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  const dimmEl=d.getElementById('dimmq');
  dimmEl.max==='12'?pass3('DL380 G10, 1 CPU: dimmq hard-capped to 12'):fail3('dimmq max wrong: '+dimmEl.max);

  dimmEl.value='16';fire(dimmEl,'input');
  dimmEl.classList.contains('field-over')?pass3('dimmq visually flagged when over cap (16 > 12)'):fail3('dimmq not flagged when over cap');

  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  dimmEl.max==='24'?pass3('DL380 G10, 2 CPUs: dimmq cap raised to 24'):fail3('dimmq max wrong for 2 CPUs: '+dimmEl.max);
  dimmEl.value='30';fire(dimmEl,'input');
  let txt=d.getElementById('checks').textContent;
  txt.includes('TOO MANY DIMMS')&&dimmEl.classList.contains('field-over')?pass3('30 DIMMs on 24-slot board blocked + flagged'):fail3('30-DIMM overflow not caught: '+txt.slice(0,200));

  // --- Riser lines: DL380 has 3 positions -> a 4th line blocks ---
  const risersEl=d.getElementById('risers');
  const addRiser=(name)=>{ d.getElementById('add-riser').click();
    const rows=risersEl.querySelectorAll('[data-k=name]'); const el=rows[rows.length-1];
    el.value=name; fire(el,'input'); };
  risersEl.innerHTML='';
  for(let i=0;i<4;i++) addRiser('custom riser '+i);
  txt=d.getElementById('checks').textContent;
  txt.includes('TOO MANY RISERS')?pass3('4 riser lines on DL380 (3 positions) blocked'):fail3('riser overflow not caught: '+txt.slice(0,200));
  risersEl.innerHTML='';fire(d.getElementById('cpuq'),'input');

  setModel3('DL360 G10');
  pickCpu3('S4110');

  // --- PSU bay cap: DL360/DL380 = 2 ---
  const psuEl=d.getElementById('psuq');
  psuEl.max==='2'?pass3('DL360 G10: psuq capped at 2 bays'):fail3('psuq cap wrong: '+psuEl.max);
  psuEl.value='4';fire(psuEl,'input');
  txt=d.getElementById('checks').textContent;
  txt.includes('TOO MANY PSUS')&&psuEl.classList.contains('field-over')
    ?pass3('4 PSUs on a 2-bay chassis blocked + flagged'):fail3('PSU overflow not caught: '+txt.slice(0,160));
  psuEl.value='2';fire(psuEl,'input');

  // --- fan qty auto-set by socket count (DL380 G10: 1 CPU -> 4, 2 CPU -> 6) ---
  setModel3('DL380 G10');
  pickCpu3('S4110');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  d.getElementById('fanq').value==='4'?pass3('DL380 G10 1 CPU: fan qty auto-set to 4'):fail3('fan qty 1P wrong: '+d.getElementById('fanq').value);
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('fanq').value==='6'?pass3('DL380 G10 2 CPU: fan qty auto-raised to 6'):fail3('fan qty 2P wrong: '+d.getElementById('fanq').value);

  // --- Standard fans when performance is REQUIRED -> hard stop ---
  d.getElementById('bp2').checked=true;fire(d.getElementById('bp2'),'change'); // NVMe backplane
  d.getElementById('fn1').checked=true;fire(d.getElementById('fn1'),'change'); // force Standard
  txt=d.getElementById('checks').textContent;
  txt.includes('Perf Fans is required')&&d.getElementById('count').textContent.includes('Unsupported')
    ?pass3('Standard fans with NVMe backplane -> blocking error'):fail3('Std-fans-when-perf-required not blocked: '+txt.slice(0,200));
  d.getElementById('fn1').checked=false;d.getElementById('bp1').checked=true;fire(d.getElementById('bp1'),'change');

  // --- PCIe slots derive from the risers fitted ---
  setModel3('DL380 G10');pickCpu3('S4110');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  const cardsEl=d.getElementById('cards');cardsEl.innerHTML='';d.getElementById('risers').innerHTML='';
  addRiser('Default Primary riser');           // 3 slots
  for(let i=0;i<4;i++)d.getElementById('add-card').click();
  [...cardsEl.querySelectorAll('[data-k=name]')].forEach((el,i)=>{el.value='NIC'+i;fire(el,'input');});
  txt=d.getElementById('checks').textContent;
  (txt.includes('TOO MANY CARDS')&&/from the risers fitted/.test(d.getElementById('riser-slot-note').textContent))
    ?pass3('4 cards vs a 3-slot primary riser -> blocked, slot count is from the riser'):fail3('card/riser slot check wrong: '+d.getElementById('riser-slot-note').textContent);
  addRiser('Secondary Riser Kit (870548-B21)'); // +3 slots, needs CPU 2
  txt=d.getElementById('checks').textContent;
  /needs the 2nd processor/.test(txt)?pass3('secondary riser flagged with 1 CPU'):fail3('CPU2 riser gate silent');
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  txt=d.getElementById('checks').textContent;
  !txt.includes('TOO MANY CARDS')?pass3('...and the 4 cards fit once CPU 2 opens the secondary riser (6 slots)'):fail3('4 cards wrongly blocked with 2 CPUs + secondary riser');
  cardsEl.innerHTML='';d.getElementById('risers').innerHTML='';d.getElementById('add-card').click();

  // --- NVMe backplane on an LFF config -> blocked ---
  setModel3('DL380 G10');
  d.getElementById('bays').value='12LFF';fire(d.getElementById('bays'),'input');
  d.getElementById('bp2').checked=true;fire(d.getElementById('bp2'),'change');
  txt=d.getElementById('checks').textContent;
  txt.includes('BACKPLANE MISMATCH')?pass3('NVMe backplane on 12LFF blocked'):fail3('LFF+NVMe not caught: '+txt.slice(0,160));
  d.getElementById('bp1').checked=true;fire(d.getElementById('bp1'),'change');

  // --- riser kit reference list is per-model ---
  setModel3('DL380 G10');
  const rKits=[...d.querySelectorAll('#riser-kits .riser-kit')].map(b=>b.getAttribute('data-name'));
  (rKits.length===16 && rKits.some(n=>/870548-B21/.test(n)))
    ?pass3(`riser kit list has DL380 G10's 16 QuickSpecs kits`):fail3('riser kit list not model-specific: '+rKits.length);

  // --- "engineer to advise" removed ---
  (!d.getElementById('fn3')&&!d.getElementById('hs3'))?pass3('"engineer to advise" fan/heatsink options removed'):fail3('engineer-to-advise option still present');

  // --- Standard items shown instead of omitted ---
  txt=d.getElementById('slip').textContent;
  txt.includes('SAS/SATA')?pass3('SAS/SATA backplane shown by default'):fail3('SAS/SATA default missing from slip');
  txt.includes('No TPM')?pass3('No TPM shown by default'):fail3('No TPM default missing from slip');
  txt.includes('Standard motherboard')?pass3('Standard motherboard shown by default'):fail3('motherboard default missing');
  txt.includes('No bezel')?pass3('No bezel shown by default'):fail3('bezel default missing');
  txt.includes('No media bay')?pass3('No media bay shown by default'):fail3('media bay default missing');

  // --- model notes are filtered to the current selection ---
  setModel3('DL360 G10');pickCpu3('S4110');
  d.getElementById('bays').value='8SFF';fire(d.getElementById('bays'),'input');
  d.getElementById('bp1').checked=true;fire(d.getElementById('bp1'),'change');
  let mnotes=()=>[...d.querySelectorAll('#checks .chk.info')].filter(c=>c.querySelector('.tag').textContent==='MODEL').map(c=>c.querySelector('span:last-child').textContent).join(' || ');
  !/not tied to CPU wattage/.test(mnotes())
    ?pass3('NVMe/GPU/rear model note hidden when none of those are selected'):fail3('irrelevant model note still shown: '+mnotes().slice(0,160));
  d.getElementById('bp2').checked=true;fire(d.getElementById('bp2'),'change'); // NVMe backplane
  /not tied to CPU wattage/.test(mnotes())
    ?pass3('...and it appears once NVMe is selected'):fail3('NVMe model note did not appear: '+mnotes().slice(0,160));
  d.getElementById('bp1').checked=true;fire(d.getElementById('bp1'),'change');

  // --- config checks box is no longer height-capped / scrollable ---
  const checksRule=(html.match(/\.checks\s*\{[^}]*\}/)||[''])[0];
  (!/overflow\s*:\s*(auto|scroll)/.test(checksRule) && !/max-height/.test(checksRule))
    ?pass3('config checks box grows to fit — no inner scrollbar'):fail3('config checks box still scroll-capped: '+checksRule);

  // --- DL560 / DL580 PSU bay counts (verified against QuickSpecs) ---
  const psuFor=(label)=>{ setModel3(label); return d.getElementById('psuq').max; };
  psuFor('DL560 G10')==='4'?pass3('DL560 G10: 4 PSU bays'):fail3('DL560 G10 psuMax wrong: '+psuFor('DL560 G10'));
  psuFor('DL580 G10')==='4'?pass3('DL580 G10: 4 PSU bays'):fail3('DL580 G10 psuMax wrong');
  psuFor('DL560 G9')==='2'?pass3('DL560 G9: 2 PSU bays'):fail3('DL560 G9 psuMax wrong');
  psuFor('DL580 G9')==='4'?pass3('DL580 G9: 4 PSU bays'):fail3('DL580 G9 psuMax wrong');
  psuFor('DL560 G11')==='4'?pass3('DL560 G11: 4 PSU bays'):fail3('DL560 G11 psuMax wrong');

  // --- models HPE never made are absent ---
  d.getElementById('model-input').value='';fire(d.getElementById('model-input'),'input');
  const all=[...d.querySelectorAll('#model-panel .combo-item')].map(e=>e.textContent.replace(/\s+/g,' '));
  !all.some(t=>t.includes('DL580 G11'))?pass3('DL580 Gen11 absent (line went Gen10 -> Gen12)'):fail3('phantom DL580 G11 still listed');
  !all.some(t=>t.includes('DL560 G10+')||t.includes('DL580 G10+'))?pass3('DL560/DL580 Gen10 Plus absent (no Ice Lake 4-socket)'):fail3('phantom Gen10+ 4-socket still listed');

  // --- Genoa DIMM-slot corrections (1 DPC) ---
  setModel3('DL325 G11');
  d.getElementById('sys-note').textContent.includes('12 DIMM')?pass3('DL325 G11 corrected to 12 DIMM slots'):fail3('DL325 G11 DIMM count: '+d.getElementById('sys-note').textContent);
  setModel3('DL345 G11');
  d.getElementById('sys-note').textContent.includes('12 DIMM')?pass3('DL345 G11 corrected to 12 DIMM slots'):fail3('DL345 G11 DIMM count: '+d.getElementById('sys-note').textContent);

  // --- DL325 Gen10 Plus heatsink threshold is now 150W (was wrongly 180W) ---
  setModel3('DL325 G10+');
  pickCpu3('EPYC 7352'); // 155W Rome -> should force performance heatsink at the 150W step
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Perf Heatsinks'
    ?pass3('DL325 G10+ 155W -> performance heatsink (150W step, corrected from 180W)')
    :fail3('DL325 G10+ 155W heatsink: '+((d.querySelector('input[name="hs"]:checked')||{}).value||'none'));

  // --- DL365 Gen10 Plus fan qty by socket (5 / 7) ---
  setModel3('DL365 G10+');pickCpu3('EPYC 7302');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  d.getElementById('fanq').value==='5'?pass3('DL365 G10+ 1 CPU -> 5 fans'):fail3('DL365 G10+ 1P fan qty: '+d.getElementById('fanq').value);
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('fanq').value==='7'?pass3('DL365 G10+ 2 CPU -> 7 fans'):fail3('DL365 G10+ 2P fan qty: '+d.getElementById('fanq').value);

  // --- DL110 Gen10 Plus DIMM count corrected 16 -> 8 ---
  setModel3('DL110 G10+');
  d.getElementById('sys-note').textContent.includes('8 DIMM')?pass3('DL110 G10+ corrected to 8 DIMM slots'):fail3('DL110 G10+ DIMM count: '+d.getElementById('sys-note').textContent);

  // --- DL345 Gen10 Plus: 180W heatsink step ---
  setModel3('DL345 G10+');pickCpu3('EPYC 7413'); // 180W
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Perf Heatsinks'
    ?pass3('DL345 G10+ 180W -> performance heatsink'):fail3('DL345 G10+ 180W heatsink: '+((d.querySelector('input[name="hs"]:checked')||{}).value||'none'));

  // --- fan qty clears when switching to a model with no fan data ---
  setModel3('DL380 G10');pickCpu3('S4110');d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  setModel3('DL20 G10+');
  d.getElementById('fanq').value===''?pass3('stale fan qty cleared on a model with no fan-count data'):fail3('stale fan qty left behind: '+d.getElementById('fanq').value);

  // --- ML tower entries verified this pass ---
  const mlChk=(label,dimmFrag,psu,badge)=>{
    setModel3(label);
    const okD=d.getElementById('sys-note').textContent.includes(dimmFrag);
    const okP=d.getElementById('psuq').max===psu;
    const okB=badge==='v'?d.getElementById('badge-v').classList.contains('on'):d.getElementById('badge-u').classList.contains('on');
    (okD&&okP&&okB)?pass3(label+': '+dimmFrag+', '+psu+' PSU bays, badge '+badge)
      :fail3(label+' ML check: dimm="'+d.getElementById('sys-note').textContent+'" psuMax='+d.getElementById('psuq').max+' badgeV='+d.getElementById('badge-v').classList.contains('on'));
  };
  mlChk('ML30 G10','4 DIMM','2','v');
  mlChk('ML110 G10','6 DIMM','2','v');
  mlChk('ML30 G10+','4 DIMM','2','v');
  mlChk('ML350 G9','24 DIMM','4','u');

  // --- ML towers: no riser cages, model-specific PSU list ---
  setModel3('ML30 G10+');
  const mlPsus=[...d.querySelectorAll('#psus option')].map(o=>o.value);
  (d.getElementById('add-riser').hidden
    && /system board/.test(d.getElementById('riser-note').textContent)
    && mlPsus.some(o=>/P45209-B21/.test(o)) && mlPsus.some(o=>/865438-B21/.test(o)))
    ?pass3('ML30 G10+: no riser section, PSU list is model-specific (RPS kit P45209-B21, 800W Titanium 865438-B21)')
    :fail3('ML30 G10+ riser/PSU: addHidden='+d.getElementById('add-riser').hidden+' psus='+mlPsus.slice(0,2));
  // a riser line on a no-riser chassis blocks
  d.getElementById('risers').innerHTML='';
  const rl=d.createElement('div');rl.className='line card';
  rl.innerHTML='<input data-k="q"><input data-k="name" value="x16 riser"><button class="kill"></button>';
  d.getElementById('risers').appendChild(rl);fire(rl.querySelector('[data-k=name]'),'input');
  /no riser cages/.test(d.getElementById('checks').textContent)
    ?pass3('...and a riser line on it is blocked'):fail3('no-riser chassis let a riser line through');
  d.getElementById('risers').innerHTML='';

  // ML350 G10 PCIe slots split by processor (4 with one CPU, 8 with two)
  setModel3('ML350 G10');pickCpu3('S4110');
  const mlCardsEl=d.getElementById('cards');mlCardsEl.innerHTML='';
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  for(let i=0;i<6;i++)d.getElementById('add-card').click();
  [...mlCardsEl.querySelectorAll('[data-k=name]')].forEach((el,i)=>{el.value='NIC'+i;fire(el,'input');});
  txt=d.getElementById('checks').textContent;
  txt.includes('TOO MANY CARDS')?pass3('ML350 G10: 6 cards on one CPU (4 board slots) blocked'):fail3('ML350 G10 1-CPU slot cap not enforced');
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  !d.getElementById('checks').textContent.includes('TOO MANY CARDS')?pass3('...and the 6 fit once the 2nd CPU opens slots 5-8'):fail3('ML350 G10 2-CPU slots not opened');
  mlCardsEl.innerHTML='';d.getElementById('add-card').click();

  // --- riser-kit picker adds a riser LINE (repeatable, wrapping rows) ---
  setModel3('DL380 G10');
  d.getElementById('risers').innerHTML='';
  const rkBox=d.getElementById('riser-kits'), rkTog=d.getElementById('riser-toggle');
  (!rkTog.hidden && rkBox.children.length===16)
    ?pass3('DL380 G10: 16 riser kits offered as expandable rows'):fail3('riser picker wrong: hidden='+rkTog.hidden+' n='+rkBox.children.length);
  if(rkTog.textContent.startsWith('Show')) rkTog.click();
  rkBox.querySelector('.riser-kit').click();
  rkBox.querySelectorAll('.riser-kit')[6].click();  // a second, different kit
  const rlines=[...d.querySelectorAll('#risers [data-k=name]')].map(x=>x.value);
  (rlines.length===2 && rlines[0]!==rlines[1] && !d.querySelector('datalist#riseropts'))
    ?pass3('clicking two kits adds two riser lines (multiple risers supported)'):fail3('riser lines: '+JSON.stringify(rlines));

  // --- power budget check ---
  setModel3('DL380 G10');pickCpu3('G6148');
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('dimmq').value='24';d.getElementById('dimm').value='32GB';fire(d.getElementById('dimm'),'input');
  const pdq=d.querySelector('#drives [data-k=q]'),pdc=d.querySelector('#drives [data-k=cap]'),pdi=d.querySelector('#drives [data-k=int]');
  pdq.value='8';pdc.value='1.2TB';pdi.value='SAS';fire(pdc,'input');
  d.getElementById('psuq').value='1';d.getElementById('psu').value='500w';fire(d.getElementById('psu'),'input');
  let ptxt=d.getElementById('checks').textContent;
  (ptxt.includes('will not power on')&&d.getElementById('psu-note').textContent.match(/Rough peak draw ~\d+W/))
    ?pass3('1x 500W under a ~2S/24-DIMM/8-drive load -> POWER stop'):fail3('power check silent: '+ptxt.slice(0,180));
  d.getElementById('psu').value='1600w';fire(d.getElementById('psu'),'input');
  d.getElementById('psuq').value='2';fire(d.getElementById('psuq'),'input');
  ptxt=d.getElementById('checks').textContent;
  (!ptxt.includes('will not power on')&&!ptxt.includes('redundant (1+1)'))
    ?pass3('...2x 1600W clears the power check'):fail3('power check still firing on 2x 1600W: '+ptxt.slice(0,180));

  // --- PSU list carries efficiency tier + part number; wattage still parses ---
  const psuList=[...d.querySelectorAll('#psus option')].map(o=>o.value);
  (psuList.some(o=>/Titanium.*P03178-B21/.test(o)) && psuList.some(o=>/Platinum.*865414-B21/.test(o)))
    ?pass3('PSU list has tier + part number (Platinum 865414-B21 / Titanium P03178-B21)'):fail3('PSU list missing tiers: '+psuList.slice(0,4));
  d.getElementById('psu').value='800W Flex Slot Platinum (865414-B21)';fire(d.getElementById('psu'),'input');
  d.getElementById('psuq').value='2';fire(d.getElementById('psuq'),'input');
  /~\d+W .* 800W/.test(d.getElementById('psu-note').textContent)
    ?pass3('a tier+PN PSU string still parses to 800W for the budget check'):fail3('psu note: '+d.getElementById('psu-note').textContent);

  // --- rear / mid-tray options validated against the chassis ---
  const rearTest=(model,rear)=>{
    setModel3(model);
    d.getElementById('rear').value=rear;fire(d.getElementById('rear'),'input');
    return d.getElementById('checks').textContent;
  };
  rearTest('DL360 G10','4LFF midtray').includes('not a rear or mid-tray option on DL360 G10')
    ?pass3('DL360 G10: "4LFF midtray" blocked (1U, no mid-tray)'):fail3('DL360 midtray not blocked: '+rearTest('DL360 G10','4LFF midtray').slice(0,160));
  !rearTest('DL360 G10','1SFF rear').includes('REAR NOT SUPPORTED')
    ?pass3('DL360 G10: "1SFF rear" accepted'):fail3('DL360 1SFF rear wrongly blocked');
  !rearTest('DL380 G10','4LFF midtray').includes('REAR NOT SUPPORTED')
    ?pass3('DL380 G10: "4LFF midtray" accepted (2U LFF chassis)'):fail3('DL380 midtray wrongly blocked');
  rearTest('DL380 G10','8SFF midtray').includes('not a rear or mid-tray option on DL380 G10')
    ?pass3('DL380 G10: "8SFF midtray" blocked (Gen10 mid cage is 4LFF)'):fail3('DL380 G10 8SFF midtray not blocked');
  setModel3('DL360 G11');
  const rOpts=[...d.querySelectorAll('#rearopts option')].map(o=>o.value);
  (rOpts.length===3 && !rOpts.some(o=>/mid/i.test(o)))
    ?pass3('rear datalist is per-model (DL360 G11: 3 options, no midtray)'):fail3('rear datalist not filtered: '+rOpts.join(', '));
},1400);
