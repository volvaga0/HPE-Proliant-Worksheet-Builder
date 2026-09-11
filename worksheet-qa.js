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

  // 0. build version marker present (so a stale cached page is obvious)
  /^v\d{4}\.\d{2}\.\d{2}/.test(d.getElementById('build-ver').textContent)
    ?pass('build version marker rendered ('+d.getElementById('build-ver').textContent+')')
    :fail('build version marker missing/malformed: "'+d.getElementById('build-ver').textContent+'"');

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

  // 2b. combo items respond to a plain click, not just mousedown (touch devices
  //     fire pointer/click, not mousedown — the picker was dead on phones)
  mi.value='DL160 G9';fire(mi,'input');
  const clickTarget=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.includes('DL160 G9'));
  clickTarget && clickTarget.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
  d.getElementById('model').value==='DL160 G9'
    ?pass('combo item selects on click (mobile-safe), panel '+(d.getElementById('model-panel').hidden?'closed':'still open'))
    :fail('combo item click did not select — mobile picker broken');
  // 2c. re-focusing shows the WHOLE list again, not just what matches the filled text
  const allModels=[...d.querySelectorAll('#model-panel .combo-item')].length;  // (panel still open from the pick, value "DL160 G9")
  mi.dispatchEvent(new w.FocusEvent('focus'));
  const onRefocus=[...d.querySelectorAll('#model-panel .combo-item')].length;
  (onRefocus>10 && onRefocus>allModels)
    ?pass('re-focusing the picker shows all models again ('+onRefocus+'), not just the 1 matching "DL160 G9"')
    :fail('re-focus did not un-filter: '+allModels+' -> '+onRefocus);
  mi.value='DL380';fire(mi,'input');

  // 3. pick DL380 G10 and confirm CPU list filters to sp1+sp2 only
  const target=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.includes('DL380 G10')&&!el.textContent.includes('G10+'));
  if(!target)return fail('DL380 G10 not in results');
  target.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  d.getElementById('model').value==='DL380 G10'?pass('selected DL380 G10 (mousedown/desktop path)'):fail('model hidden value not set');

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

  const pickModel1=(label)=>{mi.value=label;fire(mi,'input');
    const o=[...d.querySelectorAll('#model-panel .combo-item')].find(e=>e.textContent.replace(/\s+/g,' ').includes(label)&&(label.includes('G10+')||!e.textContent.includes('G10+')));
    if(o)o.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
  const pickCpu1=(code)=>{ci.value='';fire(ci,'input');
    const o=[...d.querySelectorAll('#cpu-panel .combo-item')].find(e=>e.querySelector('.ci-main').textContent===code);
    if(o)o.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));};

  // 5. cpu select auto-sets the count to 1
  d.getElementById('cpuq').value='';
  pickCpu1('E5-2697v4');
  d.getElementById('cpuq').value==='1'?pass('cpu qty auto-set to 1 when a CPU is picked'):fail('cpu qty not auto-set (got "'+d.getElementById('cpuq').value+'")');

  // 6. processor count is a button group scoped to the chassis' socket count
  const cpuqBtns=()=>[...d.querySelectorAll('#cpuq-btns button')].map(b=>b.getAttribute('data-n'));
  JSON.stringify(cpuqBtns())===JSON.stringify(['1','2'])?pass('DL380 G9: processor-count buttons are [1,2]'):fail('DL380 G9 cpuq buttons: '+cpuqBtns());
  pickModel1('DL560 G10');
  JSON.stringify(cpuqBtns())===JSON.stringify(['1','2','4'])?pass('DL560 G10: buttons are [1,2,4] — 3 not offered (validCounts)'):fail('DL560 G10 cpuq buttons: '+cpuqBtns());
  pickModel1('DL20 G10');
  (cpuqBtns().length===1&&d.getElementById('cpuq').value==='1')?pass('DL20 G10 (1 socket): single button, auto-selected'):fail('DL20 G10 cpuq: '+cpuqBtns()+' / '+d.getElementById('cpuq').value);
  pickModel1('DL380 G10'); pickCpu1('S4110');

  // 7. rear-drive 160W rule should block with E5-2697v4 (145W ok) -> use 2699v4? 145W. Use rear + >160W none exist on g9.
  // instead test 2SFF rear on 8SFF chassis
  d.getElementById('bays').value='8SFF';fire(d.getElementById('bays'),'input');
  d.getElementById('rear').value='2SFF rear';fire(d.getElementById('rear'),'input');
  let checks=d.getElementById('checks').textContent;
  checks.includes('2SFF rear cage is only supported')?pass('2SFF-on-8SFF blocked correctly'):fail('2SFF rule did not fire');

  // 7b. number steppers: −/+ buttons on the count fields
  const dq=d.querySelector('#drives [data-k=q]'),dc=d.querySelector('#drives [data-k=cap]');
  (dq.parentElement.classList.contains('stepper')
   && dq.parentElement.querySelector('.st-btn'))?pass('drive line qty is wrapped in a −/+ stepper'):fail('drive qty not steppered');
  dq.value='';
  dq.parentElement.querySelector('.st-btn:last-child').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); // "+"
  dq.parentElement.querySelector('.st-btn:last-child').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  dq.value==='2'?pass('tapping "+" twice from empty -> 2 (min then +1)'):fail('stepper + gave "'+dq.value+'"');
  dq.parentElement.querySelector('.st-btn:first-child').dispatchEvent(new w.MouseEvent('click',{bubbles:true})); // "−"
  dq.parentElement.querySelector('.st-btn:first-child').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  dq.value==='1'?pass('"−" clamps at the min (1)'):fail('stepper − gave "'+dq.value+'" (should clamp to 1)');
  { const dqm=d.getElementById('dimmq').parentElement;
    dqm.classList.contains('stepper')?pass('memory qty is steppered'):fail('dimmq not steppered'); }

  // 7c. steppers respect the live cap (drive bays / fan cage), not just typing
  d.getElementById('rear').value='';fire(d.getElementById('rear'),'input');
  d.getElementById('bays').value='8SFF';fire(d.getElementById('bays'),'input');
  dc.value='1.2TB';fire(dc,'input');dq.value='';
  { const up=dq.parentElement.querySelector('.st-btn:last-child');
    for(let i=0;i<15;i++)up.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); }
  dq.value==='8'?pass('drive qty stepper stops at the chassis bay count (8 on 8SFF)'):fail('drive stepper overshot to "'+dq.value+'"');
  { const fmax=Number(d.getElementById('fanq').getAttribute('max'));
    (fmax>0&&fmax<=8)?pass('fan qty stepper is capped by the fan cage (max='+fmax+')'):fail('fanq has no sane max cap: '+d.getElementById('fanq').getAttribute('max')); }
  dq.value='';

  // 8. bay overflow (typed values still caught even if the stepper won't go there)
  d.getElementById('rear').value='';fire(d.getElementById('rear'),'input');
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
  let pr=d.getElementById('paste-result').textContent;
  d.getElementById('model').value==='DL380 G10'?pass('paste "dl380 g10" resolved to DL380 G10'):fail('paste model failed -> "'+d.getElementById('model').value+'"');
  (/800\s*w/i.test(pr)&&d.getElementById('psuq').value==='2')?pass('paste picked up PSU (2x 800W)'):fail('paste missed PSU -> psu="'+d.getElementById('psu').value+'" q="'+d.getElementById('psuq').value+'"');
  d.getElementById('ctrl').value.startsWith('P408')?pass('paste picked up P408 controller'):fail('paste missed controller');

  // 10b. shorthand paste variants
  const pasteCase=(s)=>{d.getElementById('paste-text').value=s;d.getElementById('paste-fill').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
  pasteCase('DL360 Gen10, dual 6248, 4x32gb, 2x800 psu');
  (d.getElementById('psuq').value==='2' && d.getElementById('psu').value==='800W')
    ?pass('"2x800 psu" -> 2 x 800W (plain wattage)'):fail('"2x800 psu" missed -> "'+d.getElementById('psu').value+'" q'+d.getElementById('psuq').value);
  d.getElementById('cpuq').value==='2'?pass('"dual 6248" -> 2 processors'):fail('"dual" cpu qty missed -> '+d.getElementById('cpuq').value);
  (d.getElementById('dimmq').value==='4'&&d.getElementById('dimm').value==='32GB')?pass('"4x32gb" -> 4x 32GB'):fail('mem shorthand missed -> '+d.getElementById('dimmq').value+' / '+d.getElementById('dimm').value);
  d.getElementById('model').value==='DL360 G10'?pass('"DL360 Gen10" resolved'):fail('gen-word model parse failed -> '+d.getElementById('model').value);
  pasteCase('dl380g10 800w x2');
  (d.getElementById('model').value==='DL380 G10'&&d.getElementById('psuq').value==='2'&&/800/.test(d.getElementById('psu').value))
    ?pass('"dl380g10" (no spaces) + "800w x2" parsed'):fail('no-space model / reversed psu missed -> m="'+d.getElementById('model').value+'" q'+d.getElementById('psuq').value);
  pasteCase('DL385 Gen10 v2, 2P 7443, 8x 32gb, 550w atx');
  d.getElementById('model').value==='DL385 G10+ v2'?pass('"DL385 Gen10 v2" -> G10+ v2 (v2 boards are Gen10 Plus)'):fail('v2 model -> '+d.getElementById('model').value);
  d.getElementById('cpu').value==='EPYC 7443'?pass('bare "7443" -> EPYC 7443'):fail('bare AMD code missed -> '+d.getElementById('cpu').value);
  (/550/.test(d.getElementById('psu').value)&&/quantity not stated/i.test(d.getElementById('paste-result').textContent))
    ?pass('"550w atx" -> 550W + qty-not-stated CHECK'):fail('atx psu missed -> "'+d.getElementById('psu').value+'"');
  pasteCase('dl380 g10');  // restore state for the tests below

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
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
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
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Std Heatsinks'?pass2('7452 (155W, below 170W) -> standard heatsink auto-selected'):fail2('7452 heatsink: '+((d.querySelector('input[name="hs"]:checked')||{}).value||'none'));

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
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Std Heatsinks'?pass2('DL385 G11: 200W EPYC -> standard heatsink auto-selected (below 240W tier)'):fail2('DL385 G11 200W heatsink: '+((d.querySelector('input[name="hs"]:checked')||{}).value||'none'));
  pickCpu('EPYC 9354'); // 280W - should be performance (240-300 tier)
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Perf Heatsinks'?pass2('DL385 G11: 280W EPYC -> performance heatsink'):fail2('DL385 G11 280W got '+(d.querySelector('input[name="hs"]:checked')||{}).value);

  // ML350 G10 -> 85W threshold
  setModel('ML350 G10');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  pickCpu('S4110'); // exactly 85W - "above 85W" should NOT trigger perf
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Std Heatsinks'?pass2('ML350 G10: 85W (not above) -> standard heatsink, not performance'):fail2('ML350 G10 85W heatsink: '+((d.querySelector('input[name="hs"]:checked')||{}).value||'none'));
  pickCpu('G6140'); // 140W - clearly above 85W, should trigger
  (d.querySelector('input[name="hs"]:checked')||{}).value==='Perf Heatsinks'?pass2('ML350 G10: 140W part -> performance heatsink'):fail2('ML350 G10 140W got '+(d.querySelector('input[name="hs"]:checked')||{}).value);

  // --- Gen9 heatsinks ---
  const hsv=()=>(d.querySelector('input[name="hs"]:checked')||{}).value||'none';
  setModel('DL380 G9'); d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  pickCpu('E5-2697v4');  // 145W
  hsv()==='Perf Heatsinks'?pass2('DL380 G9: 145W processor -> performance heatsink'):fail2('DL380 G9 145W got '+hsv());
  pickCpu('E5-2690v4');  // 135W but the listed exception
  (hsv()==='Std Heatsinks'&&/E5-2690v4 is a listed exception/.test(d.getElementById('checks').textContent))
    ?pass2('DL380 G9: E5-2690v4 (135W) keeps the standard heatsink — the QuickSpecs exception'):fail2('DL380 G9 E5-2690v4 got '+hsv());
  pickCpu('E5-2650v4');  // 105W
  hsv()==='Std Heatsinks'?pass2('DL380 G9: 105W processor -> standard heatsink auto-selected'):fail2('DL380 G9 105W heatsink: '+hsv());
  // GPU forces the performance heatsink regardless of TDP
  d.getElementById('add-card').click();
  { const cn=d.querySelector('#cards [data-k=name]'); cn.value='NVIDIA T4'; fire(cn,'input'); }
  (hsv()==='Perf Heatsinks' && /Graphics Enablement Kit \(719082-B21\)/.test(d.getElementById('checks').textContent))
    ?pass2('DL380 G9: a double-wide GPU forces the performance heatsink (or the Graphics Enablement Kit)'):fail2('DL380 G9 GPU heatsink rule: '+hsv());
  d.getElementById('cards').innerHTML='';
  // 4-socket Gen9: no standard/performance choice
  setModel('DL560 G9'); d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  pickCpu('E5-4667v4');  // 135W
  (hsv()==='Std Heatsinks' && /no standard-vs-performance heatsink choice/.test(d.getElementById('checks').textContent))
    ?pass2('DL560 G9: heatsink ships in the CPU kit — no choice, no perf-heatsink flag'):fail2('DL560 G9 heatsink handling: '+hsv()+' / '+d.getElementById('checks').textContent.slice(0,160));
  setModel('DL580 G9'); d.getElementById('cpuq').value='4';fire(d.getElementById('cpuq'),'input');
  pickCpu('E7-8890v4');  // 165W
  /no standard-vs-performance heatsink choice/.test(d.getElementById('checks').textContent)
    ?pass2('DL580 G9: 165W E7, still no heatsink choice'):fail2('DL580 G9 heatsink: '+d.getElementById('checks').textContent.slice(0,160));

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
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
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

  // --- the chassis' default riser is pre-filled at qty 1 ---
  const risersEl=d.getElementById('risers');
  risersEl.innerHTML='';
  setModel3('DL380 G10');
  { const rows=[...risersEl.querySelectorAll('.line')].map(r=>({q:r.querySelector('[data-k=q]').value,name:r.querySelector('[data-k=name]').value}));
    (rows.length===1 && rows[0].q==='1' && /Default Primary riser/.test(rows[0].name))
      ?pass3('DL380 G10: the default primary riser is pre-filled at 1x'):fail3('default riser not pre-filled: '+JSON.stringify(rows)); }
  setModel3('DL360 G10');
  { const rows=[...risersEl.querySelectorAll('.line [data-k=name]')].map(x=>x.value);
    (rows.length===1 && /ships standard/.test(rows[0]))
      ?pass3('switching model swaps the pre-filled default riser (DL360 primary)'):fail3('riser default not swapped: '+JSON.stringify(rows)); }

  // --- Riser lines: DL380 has 3 positions -> a 4th line blocks ---
  setModel3('DL380 G10');
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
  !/\bTPM\b/.test(txt)?pass3('TPM "None" default kept off the slip'):fail3('TPM default clutters the slip: '+txt.slice(0,160));
  d.getElementById('tp2').checked=true;fire(d.getElementById('tp2'),'change');
  d.getElementById('slip').textContent.includes('TPM 2.0')?pass3('TPM 2.0 selection reaches the slip'):fail3('TPM 2.0 not on slip');
  d.getElementById('tp0').checked=true;fire(d.getElementById('tp0'),'change');
  txt.includes('Standard motherboard')?pass3('Standard motherboard shown by default'):fail3('motherboard default missing');
  txt.includes('No bezel')?pass3('No bezel shown by default'):fail3('bezel default missing');
  txt.includes('No media bay')?pass3('No media bay shown by default'):fail3('media bay default missing');
  // rails = "No" must clear the "rails" gap, not keep nagging
  d.getElementById('rl0').checked=true;fire(d.getElementById('rl0'),'change');
  { const s=d.getElementById('slip').textContent, need=(s.split('Still needed')[1]||'');
    (!/\brails?\b/i.test(need) && /No rail kit/.test(s))
      ?pass3('Rails "No" -> "No rail kit" on the slip, no rails gap'):fail3('rails=No still gapping: '+need.slice(0,80)); }

  // --- "No drives" checkbox: hides the drive list, clears the drives gap ---
  d.getElementById('drives').innerHTML='';fire(d.getElementById('add-drive'),'click');
  { const need=(d.getElementById('slip').textContent.split('Still needed')[1]||'');
    /\bdrives\b/.test(need)?pass3('empty drive list -> "drives" is a gap'):fail3('drives not gapping when empty: '+need.slice(0,60)); }
  d.getElementById('nodrives').checked=true;fire(d.getElementById('nodrives'),'change');
  { const s=d.getElementById('slip').textContent, need=(s.split('Still needed')[1]||'');
    (d.getElementById('drives-wrap').hidden && /No drives/.test(s) && !/\bdrives\b/.test(need))
      ?pass3('"No drives" hides the drive list and clears the drives gap'):fail3('no-drives: hidden='+d.getElementById('drives-wrap').hidden+' need='+need.slice(0,60)); }
  d.getElementById('nodrives').checked=false;fire(d.getElementById('nodrives'),'change');
  { const s=d.getElementById('slip').textContent, need=(s.split('Still needed')[1]||'');
    (!d.getElementById('drives-wrap').hidden && !/No drives/.test(s) && /\bdrives\b/.test(need))
      ?pass3('unchecking "No drives" brings the drive list and its gap back'):fail3('no-drives untoggle: need='+need.slice(0,60)); }

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

  // --- mobile: iOS focus-zoom guard + safe-area + touch targets ---
  const mq=(html.match(/@media \(max-width:640px\)\{[\s\S]*?\n\}/)||[''])[0];
  (/font-size:\s*16px/.test(mq) && /\.pills label\{[^}]*min-height:\s*4\dpx/.test(mq))
    ?pass3('mobile CSS: 16px form controls (no iOS zoom) + 42px+ pill targets'):fail3('mobile control sizing missing: '+mq.slice(0,200));
  (/env\(safe-area-inset-bottom\)/.test(html) && /viewport-fit=cover/.test(html))
    ?pass3('mobile CSS: safe-area insets + viewport-fit=cover'):fail3('safe-area handling missing');
  /overflow-x:\s*hidden/.test(html)?pass3('mobile: body overflow-x hidden (no sideways scroll)'):fail3('body overflow-x not guarded');

  // --- DL560 / DL580 PSU bay counts (verified against QuickSpecs) ---
  const psuFor=(label)=>{ setModel3(label); return d.getElementById('psuq').max; };
  psuFor('DL560 G10')==='4'?pass3('DL560 G10: 4 PSU bays'):fail3('DL560 G10 psuMax wrong: '+psuFor('DL560 G10'));
  psuFor('DL580 G10')==='4'?pass3('DL580 G10: 4 PSU bays'):fail3('DL580 G10 psuMax wrong');
  psuFor('DL560 G9')==='2'?pass3('DL560 G9: 2 PSU bays'):fail3('DL560 G9 psuMax wrong');
  psuFor('DL580 G9')==='4'?pass3('DL580 G9: 4 PSU bays'):fail3('DL580 G9 psuMax wrong');
  psuFor('DL560 G11')==='4'?pass3('DL560 G11: 4 PSU bays'):fail3('DL560 G11 psuMax wrong');

  // --- DL560 / DL580 Gen9: proc counts + fan counts verified vs QuickSpecs DA-15187 ---
  const btns=(l)=>{ setModel3(l); return [...d.querySelectorAll('#cpuq-btns button')].map(b=>b.getAttribute('data-n')); };
  JSON.stringify(btns('DL560 G9'))===JSON.stringify(['1','2','4'])?pass3('DL560 G9: 1/2/4 processors (not 3)'):fail3('DL560 G9 cpu counts: '+btns('DL560 G9'));
  JSON.stringify(btns('DL580 G9'))===JSON.stringify(['2','3','4'])?pass3('DL580 G9: 2/3/4 processors (min 2)'):fail3('DL580 G9 cpu counts: '+btns('DL580 G9'));
  { setModel3('DL580 G9');
    [...d.querySelectorAll('#cpuq-btns button')].find(b=>b.getAttribute('data-n')==='2').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    ci3.disabled=false;ci3.value='E7-8890v4';fire(ci3,'input');
    const o=[...d.querySelectorAll('#cpu-panel .combo-item')].find(x=>x.querySelector('.ci-main').textContent==='E7-8890v4');o&&o.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
    (d.getElementById('fanq').value==='4' && d.getElementById('fanq').getAttribute('max')==='4')
      ?pass3('DL580 G9: 4 hot-plug fans (auto-filled, cage cap 4)'):fail3('DL580 G9 fanq: '+d.getElementById('fanq').value+' max='+d.getElementById('fanq').getAttribute('max')); }
  { setModel3('DL560 G9');
    [...d.querySelectorAll('#cpuq-btns button')].find(b=>b.getAttribute('data-n')==='2').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    ci3.disabled=false;ci3.value='E5-4650v4';fire(ci3,'input');
    const o=[...d.querySelectorAll('#cpu-panel .combo-item')].find(x=>x.querySelector('.ci-main').textContent==='E5-4650v4');o&&o.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
    (d.getElementById('fanq').value==='6' && d.getElementById('fanq').getAttribute('max')==='6')
      ?pass3('DL560 G9: 6 hot-plug fans (auto-filled, cage cap 6)'):fail3('DL560 G9 fanq: '+d.getElementById('fanq').value+' max='+d.getElementById('fanq').getAttribute('max')); }

  // --- Gen9: v3 and v4 processors are separate picker groups ---
  const cpuGroups=(label)=>{ setModel3(label); ci3.disabled=false; ci3.value='';fire(ci3,'focus');fire(ci3,'input');
    return [...d.querySelectorAll('#cpu-panel .combo-group')].map(x=>x.textContent); };
  (()=>{ const g=cpuGroups('DL380 G9');
    (g.length===2 && /v3/.test(g[0]) && /v4/.test(g[1]))
      ?pass3('DL380 G9: E5-2600 v3 and v4 are separate CPU groups'):fail3('G9 v3/v4 not split: '+JSON.stringify(g)); })();
  // E5-2600 v3/v4 list: E5-2687W (HPE QuickSpecs) + the tagged OEM parts
  (()=>{ setModel3('DL380 G9'); ci3.disabled=false; ci3.value='';fire(ci3,'focus');fire(ci3,'input');
    const codes=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(x=>x.textContent);
    const subs=[...d.querySelectorAll('#cpu-panel .combo-item .ci-sub')].map(x=>x.textContent).join(' | ');
    (codes.includes('E5-2673v3') && codes.includes('E5-2687Wv3') && codes.includes('E5-2687Wv4') && /2673 v3 · 12C 2.4GHz — OEM/.test(subs))
      ?pass3('DL380 G9: E5-2687W v3/v4 + E5-2673 v3/v4 (tagged OEM) in the list'):fail3('G9 SKU check: '+codes.filter(c=>/2673|2687W/.test(c))); })();
  { setModel3('DL380 G9'); d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
    pickCpu3('E5-2687Wv3');
    (d.querySelector('input[name="hs"]:checked')||{}).value==='Perf Heatsinks'
      ?pass3('E5-2687W v3 (160W) -> performance heatsink'):fail3('E5-2687Wv3 heatsink: '+((d.querySelector('input[name="hs"]:checked')||{}).value||'none')); }
  (()=>{ const g=cpuGroups('DL560 G9');
    (g.length===2 && g.every(x=>/E5-4600/.test(x)))
      ?pass3('DL560 G9: CPU list is E5-4600 v3/v4 (4-socket parts)'):fail3('DL560 G9 cpu groups: '+JSON.stringify(g)); })();
  (()=>{ const g=cpuGroups('DL580 G9');
    (g.length===2 && g.every(x=>/E7-4800/.test(x)))
      ?pass3('DL580 G9: CPU list is E7 v3/v4'):fail3('DL580 G9 cpu groups: '+JSON.stringify(g)); })();
  // per-socket memory ceiling follows the *selected* CPU, not the model
  setModel3('DL380 G9'); d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('dimmq').value='24';fire(d.getElementById('dimmq'),'input');
  d.getElementById('dimm').value='128GB';fire(d.getElementById('dimm'),'input');
  pickCpu3('E5-2680v3'); const g9v3=d.getElementById('checks').textContent;
  pickCpu3('E5-2680v4'); const g9v4=d.getElementById('checks').textContent;
  (/OVER MEMORY LIMIT/.test(g9v3) && !/OVER MEMORY LIMIT/.test(g9v4))
    ?pass3('mem ceiling is per-CPU: 3TB blocked on E5-2600 v3 (768/sock), fine on v4 (1536/sock)')
    :fail3('per-CPU mem ceiling wrong — v3 blocked? '+/OVER MEMORY LIMIT/.test(g9v3)+' v4 blocked? '+/OVER MEMORY LIMIT/.test(g9v4));

  // --- DL560 / DL580 Gen9 risers (verified against QuickSpecs DA-15187) ---
  setModel3('DL560 G9');
  const dl560g9k=[...d.querySelectorAll('#riser-kits .riser-kit')].map(x=>x.getAttribute('data-name'));
  (dl560g9k.some(k=>/793474-B21/.test(k)) && dl560g9k.some(k=>/Slot 7/i.test(k)))
    ?pass3('DL560 G9: riser list has the 793474-B21 secondary + Slot 7'):fail3('DL560 G9 risers: '+dl560g9k.join(' | '));
  setModel3('DL580 G9');
  const dl580g9k=[...d.querySelectorAll('#riser-kits .riser-kit')].map(x=>x.getAttribute('data-name'));
  (dl580g9k.length===1 && /9 slots/i.test(dl580g9k[0]))
    ?pass3('DL580 G9: single 9-slot I/O riser'):fail3('DL580 G9 risers: '+dl580g9k.join(' | '));

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

  // --- ML towers: no riser cages ---
  setModel3('ML30 G10+');
  (d.getElementById('add-riser').hidden
    && /system board/.test(d.getElementById('riser-note').textContent))
    ?pass3('ML30 G10+: no riser section (PCIe slots on the system board)')
    :fail3('ML30 G10+ riser: addHidden='+d.getElementById('add-riser').hidden);
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

  // --- picking a PSU wattage sets the count to 1 ---
  setModel3('DL380 G10');
  d.getElementById('psuq').value='';d.getElementById('psu').value='';
  d.getElementById('psu').value='800W';fire(d.getElementById('psu'),'input');
  d.getElementById('psuq').value==='1'?pass3('picking a PSU wattage sets the qty to 1'):fail3('psuq after picking 800W: "'+d.getElementById('psuq').value+'"');
  d.getElementById('psuq').value='3';fire(d.getElementById('psuq'),'input');
  d.getElementById('psu').value='1000W';fire(d.getElementById('psu'),'input');
  d.getElementById('psuq').value==='3'?pass3('...but leaves an already-set qty alone'):fail3('psuq clobbered to '+d.getElementById('psuq').value);

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

  // --- PSU list is just wattages (no tier / part number clutter) ---
  const psuOpts=[...d.querySelectorAll('#psus option')].map(o=>o.value);
  (psuOpts.length && psuOpts.every(o=>/^\d{3,4}W$/.test(o)) && psuOpts.includes('800W'))
    ?pass3('PSU list is plain wattages (800W, 1600W …) — no tier or part number'):fail3('PSU list not plain: '+psuOpts.slice(0,4));
  setModel3('DL380 G10');pickCpu3('G6148');d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('psu').value='800W';fire(d.getElementById('psu'),'input');
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

  // --- 4-socket dense boxes: SFF only, no rear/mid-tray cage ---
  setModel3('DL560 G10');
  const dl560bays=[...d.querySelectorAll('#bayopts option')].map(o=>o.value);
  (dl560bays.length && !dl560bays.some(o=>/lff/i.test(o)))
    ?pass3('DL560 G10: bay list is SFF only, no LFF'):fail3('DL560 G10 bay list: '+dl560bays.join(', '));
  d.getElementById('rear').disabled
    ?pass3('DL560 G10: rear/mid-tray field disabled (no rear bays)'):fail3('DL560 G10 rear field still enabled');
  d.getElementById('rear').value='4LFF midtray';fire(d.getElementById('rear'),'input');
  d.getElementById('checks').textContent.includes('no rear or mid-tray drive bays')
    ?pass3('DL560 G10: a rear/mid-tray entry is blocked'):fail3('DL560 G10 rear entry not blocked: '+d.getElementById('checks').textContent.slice(0,160));
  d.getElementById('rear').value='';fire(d.getElementById('rear'),'input');

  // --- no 3.5in NVMe backplane ---
  setModel3('DL380 G10');
  d.getElementById('bays').value='24SFF';fire(d.getElementById('bays'),'input');
  d.getElementById('rear').value='4LFF midtray NVMe';fire(d.getElementById('rear'),'input');
  d.getElementById('checks').textContent.includes('no 3.5-inch (LFF) NVMe backplane')
    ?pass3('LFF NVMe rear cage blocked (no such backplane)'):fail3('LFF NVMe rear not blocked: '+d.getElementById('checks').textContent.slice(0,160));
  d.getElementById('rear').value='';fire(d.getElementById('rear'),'input');

  // --- low-profile bracket awareness (DL360 G10 primary = 1 FH + 1 LP) ---
  setModel3('DL360 G10');pickCpu3('S4110');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  d.getElementById('risers').innerHTML='';d.getElementById('cards').innerHTML='';
  addRiser('Primary riser (ships standard)');
  d.getElementById('add-card').click();
  {const c=d.querySelector('#cards [data-k=name]');c.value='NVIDIA T4';fire(c,'input');}
  {const rn=d.getElementById('riser-slot-note').textContent, ck=d.getElementById('checks').textContent;
   (/low-profile/.test(rn) && /BRACKETS/.test(ck))
     ?pass3('DL360 G10 primary riser: FH/LP split reported + bracket check raised')
     :fail3('bracket awareness missing — note: '+rn+' | checks: '+ck.slice(0,160));}
  d.getElementById('risers').innerHTML='';d.getElementById('cards').innerHTML='';d.getElementById('add-card').click();
},1400);

// ---- round 4: rack/tower gating, iLO, FLR "no", mem-target suggester,
// controller->battery default, and the paste-parser fixes ----
setTimeout(()=>{
  function pass4(m){console.log('ok    '+m);}
  function fail4(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi4=d.getElementById('model-input'), ci4=d.getElementById('cpu-input');
  function setModel4(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi4.value='';fire(mi4,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail4('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function pickCpu4(code){
    ci4.value='';fire(ci4,'input');
    const opt=[...d.querySelectorAll('#cpu-panel .combo-item')].find(el=>el.textContent.includes(code));
    if(opt)opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  const pasteCase4=(s)=>{d.getElementById('paste-text').value=s;d.getElementById('paste-fill').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};

  // --- Rack/Tower gates the model list ---
  d.getElementById('ct-r').checked=true;fire(d.getElementById('ct-r'),'change');
  mi4.value='';fire(mi4,'input');
  { const rackList=[...d.querySelectorAll('#model-panel .combo-item')].map(e=>e.textContent);
    (rackList.some(t=>t.includes('DL380 G10')) && !rackList.some(t=>t.includes('ML350')))
      ?pass4('Rack chassis: model list has DL380 G10, no ML towers')
      :fail4('rack model list wrong: '+rackList.filter(t=>/ML/.test(t)).join('|'));
  }
  d.getElementById('ct-t').checked=true;fire(d.getElementById('ct-t'),'change');
  mi4.value='';fire(mi4,'input');
  { const towerList=[...d.querySelectorAll('#model-panel .combo-item')].map(e=>e.textContent);
    (towerList.some(t=>t.includes('ML350')) && !towerList.some(t=>t.includes('DL380')))
      ?pass4('Tower chassis: model list has ML towers, no DL rack models')
      :fail4('tower model list wrong: '+towerList.filter(t=>/DL/.test(t)).join('|'));
  }
  setModel4('ML350 G10');
  d.getElementById('ct-r').checked=true;fire(d.getElementById('ct-r'),'change');
  d.getElementById('model').value===''
    ?pass4('switching Rack/Tower clears a model that no longer matches')
    :fail4('model not cleared on chassis switch: '+d.getElementById('model').value);

  // --- "HP authenticated memory" radios removed ---
  (!d.getElementById('au1')&&!d.getElementById('au2'))
    ?pass4('"HP authenticated memory" radios removed')
    :fail4('HP authenticated memory radios still present');

  // --- iLO license: defaults to Standard, selectable, reaches the slip ---
  setModel4('DL380 G10');pickCpu4('G6148');d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('slip').textContent.includes('iLO Standard (included)')
    ?pass4('iLO defaults to Standard (included) on the slip')
    :fail4('iLO default missing from slip: '+d.getElementById('slip').textContent.slice(0,200));
  d.getElementById('il1').checked=true;fire(d.getElementById('il1'),'change');
  d.getElementById('slip').textContent.includes('iLO Advanced license')
    ?pass4('iLO Advanced selectable and reaches the slip')
    :fail4('iLO Advanced missing from slip');
  d.getElementById('il0').checked=true;fire(d.getElementById('il0'),'change');

  // --- FlexibleLOM/OCP: blank is a gap, explicit "No" is not ---
  d.getElementById('fl1').checked=false;d.getElementById('fl0').checked=false;
  d.getElementById('flr').disabled=false;d.getElementById('flr').value='';fire(d.getElementById('flr'),'input');
  d.getElementById('slip').textContent.includes('FlexibleLOM / OCP')
    ?pass4('FlexibleLOM/OCP left entirely blank is a gap')
    :fail4('blank FlexibleLOM/OCP not flagged as a gap');
  d.getElementById('fl0').checked=true;fire(d.getElementById('fl0'),'change');
  (d.getElementById('slip').textContent.includes('No FlexibleLOM / OCP fitted') && d.getElementById('flr').disabled)
    ?pass4('FlexibleLOM/OCP "No" gives an explicit slip line, not a gap, and locks the text field')
    :fail4('FlexibleLOM/OCP "No" not handled: '+d.getElementById('slip').textContent.slice(0,220));
  d.getElementById('fl1').checked=true;fire(d.getElementById('fl1'),'change');
  d.getElementById('flr').value='366FLR 4x1GbE';fire(d.getElementById('flr'),'input');
  d.getElementById('slip').textContent.includes('366FLR 4x1GbE')
    ?pass4('FlexibleLOM/OCP model reaches the slip once fitted')
    :fail4('FlexibleLOM/OCP model missing from slip');

  // --- picking a storage controller does NOT auto-fill the battery — some
  // traders build without one, so it stays a manual field (2026-09-11) ---
  d.getElementById('bat').value='';
  d.getElementById('ctrl').value='P408i-a';fire(d.getElementById('ctrl'),'input');
  d.getElementById('bat').value===''
    ?pass4('picking a controller leaves the battery field blank — set manually')
    :fail4('controller wrongly auto-filled the battery: "'+d.getElementById('bat').value+'"');
  d.getElementById('ctrl').value='';fire(d.getElementById('ctrl'),'input');

  // --- memory "reach a total" suggester ---
  setModel4('DL380 G10');pickCpu4('G6148');d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('dimmq').value='';d.getElementById('dimm').value='';
  d.getElementById('memtarget').value='384GB';fire(d.getElementById('memtarget'),'input');
  const msBtns=[...d.querySelectorAll('#mem-suggestions button')];
  (msBtns.length>0 && !d.getElementById('mem-suggestions').hidden)
    ?pass4('memory target "384GB" suggests '+msBtns.length+' even DIMM-per-socket config(s)')
    :fail4('no memory configs suggested for 384GB: '+d.getElementById('mem-suggestions').textContent);
  if(msBtns.length){
    msBtns[0].dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    const q=Number(d.getElementById('dimmq').value), sz=Number((d.getElementById('dimm').value||'').replace(/GB/i,''));
    (q*sz===384 && q%2===0)
      ?pass4('clicking a suggestion fills qty x size to exactly the target, split evenly per socket')
      :fail4('suggestion fill wrong: qty='+d.getElementById('dimmq').value+' size='+d.getElementById('dimm').value);
  }
  d.getElementById('memtarget').value='';fire(d.getElementById('memtarget'),'input');

  // --- paste: "P408i-a + bat" — controller found, battery guessed ---
  pasteCase4('P408i-a + bat');
  (d.getElementById('ctrl').value==='P408i-a' && d.getElementById('bat').value==='96w bat'
    && /Battery mentioned/.test(d.getElementById('paste-result').textContent))
    ?pass4('"P408i-a + bat" -> controller + assumed 96W battery, flagged to confirm')
    :fail4('"P408i-a + bat" mishandled: ctrl="'+d.getElementById('ctrl').value+'" bat="'+d.getElementById('bat').value+'"');

  // --- paste: SAS expander part follows the identified model's generation ---
  pasteCase4('DL380 Gen9, needs a SAS expander');
  /727250-B21/.test(d.getElementById('expander').value)
    ?pass4('SAS expander on a Gen9 model assumes the Gen9 part (727250-B21)')
    :fail4('Gen9 expander part wrong: '+d.getElementById('expander').value);
  pasteCase4('DL380 Gen10, needs a SAS expander');
  /870549-B21/.test(d.getElementById('expander').value)
    ?pass4('SAS expander on a Gen10 model assumes the Gen10 part (870549-B21)')
    :fail4('Gen10 expander part wrong: '+d.getElementById('expander').value);

  // --- paste: "2x 600GB 15K SAS" no longer misread as memory, drive lines populate ---
  d.getElementById('drives').innerHTML='';d.getElementById('add-drive').click();  // clear stray rows from earlier tests
  pasteCase4('DL380 Gen10, 2x 600GB 15K SAS, 4x 1.2TB 10K SAS, 6x 960Gb SSD');
  const dCaps=[...d.querySelectorAll('#drives [data-k=cap]')].map(x=>x.value.toLowerCase());
  (dCaps.includes('600gb')&&dCaps.includes('1.2tb')&&dCaps.includes('960gb'))
    ?pass4('"2x 600GB 15K SAS, 4x 1.2TB 10K SAS, 6x 960Gb SSD" -> 3 drive lines')
    :fail4('drive shorthand missed, caps: '+dCaps.join(', '));
  (d.getElementById('dimm').value===''||!/600/.test(d.getElementById('dimm').value))
    ?pass4('...and "600GB" was NOT misread as a memory size')
    :fail4('600GB drive capacity leaked into memory: '+d.getElementById('dimm').value);

  // --- paste: PCI card shorthand straight out of CARDLIST ---
  pasteCase4('DL380 Gen10, 2x 562SFP+ 2P 10Gb');
  const cNames=[...d.querySelectorAll('#cards [data-k=name]')].map(x=>x.value);
  cNames.some(n=>/562SFP\+/.test(n))
    ?pass4('"2x 562SFP+ 2P 10Gb" -> a card line added from the CARDLIST code')
    :fail4('562SFP+ card shorthand missed: '+cNames.join(', '));

  pasteCase4('dl380 g10');  // restore a clean baseline

  // --- picking from a dropdown defaults a blank qty to 1 ---
  setModel4('DL380 G10');
  d.getElementById('drives').innerHTML='';d.getElementById('add-drive').click();
  { const cap=d.querySelector('#drives [data-k=cap]'),q=d.querySelector('#drives [data-k=q]');
    q.value='';cap.value='1.92TB';fire(cap,'input');
    q.value==='1'?pass4('picking a drive capacity defaults the qty to 1'):fail4('drive qty not defaulted: "'+q.value+'"');
  }
  d.getElementById('cards').innerHTML='';d.getElementById('add-card').click();
  { const name=d.querySelector('#cards [data-k=name]'),q=d.querySelector('#cards [data-k=q]');
    q.value='';name.value='530SFP+ 2x10Gb';fire(name,'input');
    q.value==='1'?pass4('picking a card name defaults the qty to 1'):fail4('card qty not defaulted: "'+q.value+'"');
  }
},1900);
