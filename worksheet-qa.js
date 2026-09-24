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
// the MODELS literal references the shared constants + helper declared just above it (G11 card lists,
// NS204i-u builder, DL380 cage table); the data-table readers below eval that literal in isolation, so hand them the same code
const DATA_PRELUDE=html.slice(html.indexOf('var G11_NIC_CARDS='),html.indexOf('var MODELS=['));
console.log('testing '+HTML_PATH+'\n');

const errors=[];
// A real http(s) url (not the default about:blank) — jsdom disables
// localStorage for opaque/null origins, and the app now uses it for the
// recent-builds list as well as the draft, so tests need it to actually work.
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://worksheet.test/',
  virtualConsole:new (require('jsdom').VirtualConsole)().on('jsdomError',e=>errors.push('JSDOM: '+e.message))
});
const w=dom.window,d=w.document;

function fail(m){console.log('FAIL  '+m);process.exitCode=1;}
function pass(m){console.log('ok    '+m);}
function fire(el,type){el.dispatchEvent(new w.Event(type,{bubbles:true}));}
// rear/mid-tray is now a repeatable-lines list (like risers/cards), not one field —
// these mirror the old "set the #rear input" test shorthand.
function setRear(val){
  const box=d.getElementById('rear-lines');box.innerHTML='';
  d.getElementById('add-rear').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const inp=box.querySelector('[data-k=v]');inp.value=val;fire(inp,'input');
}
function clearRear(){d.getElementById('rear-lines').innerHTML='';}
function rearValues(){return [...d.querySelectorAll('#rear-lines [data-k=v]')].map(x=>x.value);}

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
  setRear('2SFF rear');
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
  clearRear();
  d.getElementById('bays').value='8SFF';fire(d.getElementById('bays'),'input');
  dc.value='1.2TB';fire(dc,'input');dq.value='';
  { const up=dq.parentElement.querySelector('.st-btn:last-child');
    for(let i=0;i<15;i++)up.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); }
  dq.value==='8'?pass('drive qty stepper stops at the chassis bay count (8 on 8SFF)'):fail('drive stepper overshot to "'+dq.value+'"');
  { const fmax=Number(d.getElementById('fanq').getAttribute('max'));
    (fmax>0&&fmax<=8)?pass('fan qty stepper is capped by the fan cage (max='+fmax+')'):fail('fanq has no sane max cap: '+d.getElementById('fanq').getAttribute('max')); }
  dq.value='';

  // 8. bay overflow (typed values still caught even if the stepper won't go there)
  clearRear();
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
  addRiser('x8/x16/x8 Secondary Riser Kit (870548-B21)'); // +3 slots, needs CPU 2
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
  d.getElementById('tp0').checked=true;fire(d.getElementById('tp0'),'change');
  /No TPM module/.test(d.getElementById('slip').textContent)?pass3('TPM default on a module board is stated on the slip as "No TPM module" (2026-09-23 — a bare None raised questions)'):fail3('TPM default not stated on the slip: '+txt.slice(0,160));
  d.getElementById('tp2').checked=true;fire(d.getElementById('tp2'),'change');
  d.getElementById('slip').textContent.includes('TPM 2.0')?pass3('TPM 2.0 selection reaches the slip'):fail3('TPM 2.0 not on slip');
  d.getElementById('tp0').checked=true;fire(d.getElementById('tp0'),'change');
  txt.includes('Standard motherboard')?pass3('Standard motherboard shown by default'):fail3('motherboard default missing');
  txt.includes('No bezel')?pass3('No bezel shown by default'):fail3('bezel default missing');
  /No optical drive|No media bay/.test(txt)?pass3('media bay default stated on the slip ("No optical drive")'):fail3('media bay default missing');
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
  /overflow-x:\s*(hidden|clip)/.test(html)?pass3('mobile: body overflow-x guarded (no sideways scroll)'):fail3('body overflow-x not guarded');

  // --- desktop: right column (Spec slip/Config checks/buttons) stays sticky while scrolling (2026-09-15) ---
  const slipWrapRule=(html.match(/\.slip-wrap\s*\{[^}]*\}/)||[''])[0];
  /position\s*:\s*sticky/.test(slipWrapRule)
    ?pass3('.slip-wrap is position:sticky on desktop'):fail3('.slip-wrap missing position:sticky: '+slipWrapRule);
  const sheetRule=(html.match(/\.sheet\{[^}]*\}/)||[''])[0];
  !/align-items\s*:\s*start/.test(sheetRule)
    ?pass3('.sheet grid has no align-items:start — .col-slip can stretch to give .slip-wrap room to stick (regression guard: align-items:start shrinks the grid cell to its own content height, leaving position:sticky nothing to float within)')
    :fail3('.sheet still has align-items:start, which breaks the sticky sidebar: '+sheetRule);
  const desktopResetMq=(html.match(/@media \(max-width:980px\)\{[\s\S]*?\n\}/)||[''])[0];
  /\.slip-wrap\{position:static\}/.test(desktopResetMq)
    ?pass3('sticky sidebar correctly reverts to position:static at/below the 980px tablet breakpoint'):fail3('980px reset missing: '+desktopResetMq);
  /overflow-x:\s*hidden/.test(html)
    ?fail3('body still uses overflow-x:hidden — this forces overflow-y:auto per the CSS overflow computed-value pairing rule, turning <body> into its own scroll container and silently breaking every position:sticky element on the page (this exact bug broke the sticky sidebar once already)')
    :pass3('body uses overflow-x:clip, not hidden — avoids the hidden/auto overflow-pairing quirk that breaks position:sticky');

  // --- desktop right column is clamped to the window (2026-09-21): the spec slip shows in FULL with no
  // scrollbar, the Config checks box scrolls inside itself, and the buttons stay above the bottom bar ---
  const slipRule=(html.match(/pre\.slip\{[^}]*\}/)||[''])[0];
  (!/max-height/.test(slipRule) && !/overflow\s*:\s*(auto|scroll)/.test(slipRule))
    ?pass3('spec slip has no max-height / scrollbar — the box grows so the whole slip is always visible')
    :fail3('spec slip still limits its height or scrolls: '+slipRule);
  const deskMq=(html.match(/@media \(min-width:981px\)\{[\s\S]*?\n\}/)||[''])[0];
  (/\.slip-checks\s+\.checks\{[^}]*overflow-y:\s*auto/.test(deskMq) && /class="slip-checks"/.test(html))
    ?pass3('desktop (>=981px): only the Config checks box scrolls, inside itself')
    :fail3('desktop checks-box scroll rule missing: '+deskMq.slice(0,300));
  (/function syncSlipWrap\(\)/.test(html) && /box\.style\.maxHeight=room\+'px'/.test(html) && /box\.style\.minHeight=room\+'px'/.test(html)
    && /syncSlipWrap\(\);\s*\n\s*save\(\);/.test(html) && /addEventListener\('resize',syncSlipWrap\)/.test(html))
    ?pass3('syncSlipWrap() gives the checks box an exact max-height (window - gaps - bar - slip - buttons) and pins the column to the bar — runs on every refresh and on resize')
    :fail3('syncSlipWrap wiring missing');
  const printMq=(html.match(/@media print\{[\s\S]*?\n\}/)||[''])[0];
  (/\.checks\{[^}]*max-height:\s*none\s*!important[^}]*overflow:\s*visible\s*!important/.test(printMq))
    ?pass3('print: the checks box is un-clamped (!important beats the inline max-height) so nothing is cut off on paper')
    :fail3('print un-clamp rules missing: '+printMq.slice(0,200));

  // --- scrolling a dropdown to its end doesn't chain into the page behind it ---
  const comboPanelRule=(html.match(/\.combo-panel\s*\{[^}]*\}/)||[''])[0];
  const acPanelRule=(html.match(/#ac-panel\s*\{[^}]*\}/)||[''])[0];
  (/overscroll-behavior:\s*contain/.test(comboPanelRule) && /overscroll-behavior:\s*contain/.test(acPanelRule))
    ?pass3('dropdown panels contain scroll — reaching the end doesn\u2019t scroll the page behind them')
    :fail3('overscroll-behavior:contain missing on a dropdown panel — combo:'+comboPanelRule+' ac:'+acPanelRule);

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
  mlChk('ML350 G9','24 DIMM','4','v'); // now verified 2026-09-17 against the real PDF (see round 15)

  // --- ML tower Gen9 stragglers verified 2026-09-15 ---
  mlChk('ML10 G9','4 DIMM','1','v');
  mlChk('ML30 G9','4 DIMM','2','v');
  mlChk('ML110 G9','8 DIMM','2','v');
  mlChk('ML150 G9','16 DIMM','2','v');
  setModel3('ML10 G9');
  d.getElementById('add-riser').hidden
    ?pass3('ML10 G9: no riser section (PCIe slots on the system board, Gen9 confirmed too)'):fail3('ML10 G9 riser section not hidden');

  // --- DL entry-level Gen9 stragglers verified 2026-09-15 ---
  setModel3('DL20 G9');
  d.getElementById('psuq').max==='2'
    ?pass3('DL20 G9: 2 PSU bays (fixed 290W + optional 900W redundant, SFF-only)'):fail3('DL20 G9 psuq.max: '+d.getElementById('psuq').max);
  setModel3('DL160 G9');
  { const btns=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
    (!btns.some(b=>/10sff/i.test(b)) && btns.some(b=>/8sff/i.test(b)))
      ?pass3('DL160 G9: no 10SFF bay option (unlike DL160 G10, which adds one) — confirmed data bug avoided')
      :fail3('DL160 G9 bay buttons: '+btns.join(', ')); }
  setModel3('DL80 G9');
  d.getElementById('add-riser').hidden===false && d.getElementById('psuq').max==='2'
    ?pass3('DL80 G9: 2 PSU bays, riser section shown (its riser is optional, not mandatory, but still selectable)'):fail3('DL80 G9: riser hidden='+d.getElementById('add-riser').hidden+' psuq.max='+d.getElementById('psuq').max);
  setModel3('DL180 G9');
  d.getElementById('psuq').max==='2'
    ?pass3('DL180 G9: 2 PSU bays confirmed (was already partially noted, now verified:true)'):fail3('DL180 G9 psuq.max: '+d.getElementById('psuq').max);

  // --- DL entry-level Gen11 verified 2026-09-15 (from already-cached QuickSpecs) ---
  setModel3('DL20 G11');
  d.getElementById('psuq').max==='2'
    ?pass3('DL20 G11: 2 PSU bays, redundant standard on every chassis type'):fail3('DL20 G11 psuq.max: '+d.getElementById('psuq').max);
  setModel3('DL110 G11');
  d.getElementById('add-riser').hidden===false
    ?pass3('DL110 G11: riser section shown (primary ships standard, optional secondary)'):fail3('DL110 G11 riser section hidden');
  setModel3('DL320 G11');
  { const btns=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
    btns.some(b=>/10sff/i.test(b))
      ?pass3('DL320 G11: 10SFF bay option present (8SFF base + 2SFF add-on kit)'):fail3('DL320 G11 bay buttons missing 10SFF: '+btns.join(', ')); }

  // --- ML30/ML110 Gen11 + ML350 Gen12 riser/fan/PSU/bay-counts verified 2026-09-15 ---
  mlChk('ML30 G11','4 DIMM','2','v');
  mlChk('ML110 G11','16 DIMM','2','v');
  setModel3('ML30 G11');
  d.getElementById('add-riser').hidden
    ?pass3('ML30 G11: no riser section (4 PCIe slots directly on the system board)'):fail3('ML30 G11 riser section not hidden');
  setModel3('ML110 G11');
  d.getElementById('add-riser').hidden===false
    ?pass3('ML110 G11: riser section shown (2 optional GPU riser kits unlock slots 2/3)'):fail3('ML110 G11 riser section hidden');
  setModel3('ML350 G12');
  d.getElementById('badge-v').classList.contains('on')
    ?pass3('ML350 G12: verified badge now on (riser/fan/PCIe corrected: riserMax 2->3, pcie two 8->10)'):fail3('ML350 G12 badge not verified');

  // --- missing `bays` array on a verified:true model silently fell back to
  // the generic list with zero validation (user-reported: DL360 G11 offered
  // 12LFF, which isn't real for that chassis) — fixed 2026-09-15 on DL360/
  // DL325/DL345 G11 and ML350 G11, all of which were verified:true with no
  // bays list at all ---
  const noGeneric12LFF=(model)=>{
    setModel3(model);
    const btns=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
    return !btns.some(b=>/^12LFF$/i.test(b));
  };
  noGeneric12LFF('DL360 G11')
    ?pass3('DL360 G11: bay buttons no longer include the generic-fallback 12LFF (real chassis is 4LFF/8SFF/20EDSFF)'):fail3('DL360 G11 still offers 12LFF');
  noGeneric12LFF('DL325 G11')
    ?pass3('DL325 G11: bay buttons no longer include a generic-fallback option not real for this chassis'):fail3('DL325 G11 still offers 12LFF');
  noGeneric12LFF('DL345 G11')
    ?pass3('DL345 G11: bay buttons no longer include a generic-fallback option not real for this chassis'):fail3('DL345 G11 still offers 12LFF');
  noGeneric12LFF('ML350 G11')
    ?pass3('ML350 G11: bay buttons no longer include a generic-fallback option not real for this chassis'):fail3('ML350 G11 still offers 12LFF');

  // --- user-reported 2026-09-15: DL110 G11 also had the bays-array gap,
  // but worse — it has NO front bay of any kind (M.2-only), so the fix
  // is a bays:[] + a new hard `stop`, not just a real options list.
  // Audited every model for the same "verified:true, no bays array"
  // pattern and fixed all of them (DL110 G10+/G11/G12, DL20 G10/G10+,
  // DL325 G10+/v2, DL345 G10+, DL385 G10+/v2, ML30 G10/G10+, ML110 G10,
  // ML350 G10/G12) ---
  const bayTest=(model,bayVal)=>{
    setModel3(model);
    d.getElementById('bays').value=bayVal;fire(d.getElementById('bays'),'input');
    return d.getElementById('checks').textContent;
  };
  bayTest('DL110 G11','8SFF').includes('has no front drive bay at all')
    ?pass3('DL110 G11: any front-bay value blocked — confirmed M.2-only, no front bay of any kind'):fail3('DL110 G11 front-bay stop missing: '+bayTest('DL110 G11','8SFF').slice(0,160));
  setModel3('DL110 G11');
  (d.querySelectorAll('#bays-btns button[data-b]').length===0)
    ?pass3('DL110 G11: zero preset bay buttons shown (only "Other") — matches its confirmed zero-bay chassis'):fail3('DL110 G11 still shows preset bay buttons: '+[...d.querySelectorAll('#bays-btns button[data-b]')].map(b=>b.textContent).join(', '));
  bayTest('DL110 G10+','4LFF').includes('has no front drive bay at all')
    ?pass3('DL110 G10+: same M.2-only fix applied'):fail3('DL110 G10+ front-bay stop missing');
  const noGeneric12LFF2=(model)=>{
    setModel3(model);
    const btns=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
    return !btns.some(b=>/^12LFF$/i.test(b));
  };
  noGeneric12LFF2('ML30 G10+')
    ?pass3('ML30 G10+: bay buttons no longer fall back to the generic list (real bays: 4LFF/8SFF)'):fail3('ML30 G10+ still offers 12LFF');
  setModel3('ML110 G10');
  { const btns=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
    (btns.includes('4LFF')&&btns.includes('16SFF')&&!btns.includes('12LFF'))
      ?pass3('ML110 G10: real bays (4LFF/8LFF/8SFF/16SFF), not the generic fallback')
      :fail3('ML110 G10 bay buttons: '+btns.join(', ')); }
  setModel3('ML350 G12');
  { const btns=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
    (btns.includes('8SFF')&&!btns.some(b=>/^2SFF$|^10SFF$/i.test(b)))
      ?pass3('ML350 G12: approximate real-bays list (no more generic 2SFF/10SFF options)')
      :fail3('ML350 G12 bay buttons: '+btns.join(', ')); }

  // --- backplane cross-reference (2026-09-16): ML110 G11 has zero real
  // Tri-Mode/U.3 backplane mentions in its own QuickSpecs (every NVMe
  // reference is the M.2 boot device or CPU-attached VROC) — added to
  // BACKPLANE_SAS_ONLY, same hard stop as the pre-existing sas-only models ---
  setModel3('ML110 G11');
  d.querySelector('input[name=bp][value="NVMe backplane"]').checked=true;
  fire(d.querySelector('input[name=bp][value="NVMe backplane"]'),'change');
  d.getElementById('checks').textContent.includes('BACKPLANE MISMATCH')
    ?pass3('ML110 G11: NVMe backplane pick is blocked — no real Tri-Mode/NVMe drive backplane exists on this chassis')
    :fail3('ML110 G11 sas-only backplane not enforced: '+d.getElementById('checks').textContent.slice(0,200));
  d.querySelector('input[name=bp][value="SAS/SATA backplane"]').checked=true;
  fire(d.querySelector('input[name=bp][value="SAS/SATA backplane"]'),'change');
  !d.getElementById('checks').textContent.includes('BACKPLANE MISMATCH')
    ?pass3('...but SAS/SATA (the real option) raises no note')
    :fail3('ML110 G11 SAS/SATA wrongly flagged: '+d.getElementById('checks').textContent.slice(0,200));

  // --- backplane cross-reference (2026-09-16), entry-level/tower Gen9 pass:
  // DL20/DL120/DL160/DL180 and ML30/ML110/ML150 G9 all have zero NVMe/
  // Tri-Mode/Premium mentions anywhere in their own QuickSpecs -- added to
  // BACKPLANE_SAS_ONLY, same mechanism as ML110 G11 above ---
  setModel3('DL120 G9');
  d.querySelector('input[name=bp][value="NVMe backplane"]').checked=true;
  fire(d.querySelector('input[name=bp][value="NVMe backplane"]'),'change');
  d.getElementById('checks').textContent.includes('BACKPLANE MISMATCH')
    ?pass3('DL120 G9: NVMe backplane pick is blocked — Gen9 entry-level predates NVMe hot-plug backplanes')
    :fail3('DL120 G9 sas-only backplane not enforced: '+d.getElementById('checks').textContent.slice(0,200));
  setModel3('ML110 G9');
  d.querySelector('input[name=bp][value="Premium backplane"]').checked=true;
  fire(d.querySelector('input[name=bp][value="Premium backplane"]'),'change');
  d.getElementById('checks').textContent.includes('BACKPLANE MISMATCH')
    ?pass3('ML110 G9: Premium backplane pick is blocked — no mixed SAS/SATA+NVMe cage exists on this Gen9 tower')
    :fail3('ML110 G9 sas-only backplane not enforced: '+d.getElementById('checks').textContent.slice(0,200));
  d.querySelector('input[name=bp][value="SAS/SATA backplane"]').checked=true;
  fire(d.querySelector('input[name=bp][value="SAS/SATA backplane"]'),'change');
  !d.getElementById('checks').textContent.includes('BACKPLANE MISMATCH')
    ?pass3('...but SAS/SATA (the real option) raises no note on ML110 G9 either')
    :fail3('ML110 G9 SAS/SATA wrongly flagged: '+d.getElementById('checks').textContent.slice(0,200));

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
    setRear(rear);
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
  setModel3('DL380 G11');
  const rOpts=[...d.querySelectorAll('#rearopts option')].map(o=>o.value);
  (rOpts.length===9 && rOpts.every(o=>/rear|midtray/.test(o)) && rOpts.some(o=>/primary riser \(P48810-B21\)/.test(o)))
    ?pass3('rear datalist is per-model (DL380 G11: the nine cage kits, one per riser position plus the mid-tray options, with part numbers)')
    :fail3('rear datalist not filtered: '+rOpts.join(', '));
  setModel3('DL360 G11');
  (d.getElementById('add-rear').disabled && /No rear or mid-tray drive bays/.test(d.getElementById('rear-note').textContent))
    ?pass3('DL360 G11: no rear or mid-tray bays (the 1U chassis has none) — the NS204i-u boot device is a card-list option, no longer a rear line')
    :fail3('DL360 G11 rear note wrong: '+d.getElementById('rear-note').textContent);

  // --- 4-socket dense boxes: SFF only, no rear/mid-tray cage ---
  setModel3('DL560 G10');
  const dl560bays=[...d.querySelectorAll('#bayopts option')].map(o=>o.value);
  (dl560bays.length && !dl560bays.some(o=>/lff/i.test(o)))
    ?pass3('DL560 G10: bay list is SFF only, no LFF'):fail3('DL560 G10 bay list: '+dl560bays.join(', '));
  d.getElementById('add-rear').disabled
    ?pass3('DL560 G10: "Add rear line" disabled (no rear bays)'):fail3('DL560 G10 add-rear button still enabled');
  rearValues().length===0
    ?pass3('DL560 G10: no rear/mid-tray lines exist (auto-cleared)'):fail3('DL560 G10 still has rear lines: '+rearValues());
  setModel3('DL380 G10');setRear('4LFF midtray');setModel3('DL560 G10');
  rearValues().length===0
    ?pass3('switching to a no-rear-bays model clears any entered rear/mid-tray line'):fail3('rear line survived the model switch: '+rearValues());

  // --- Rear/mid-tray G10-G12 transcription pass (2026-09-15) ---
  rearTest('DL180 G10','2SFF rear').includes('not a rear or mid-tray option')===false
    ?pass3('DL180 G10: "2SFF rear" accepted (sourced rear-only cage)'):fail3('DL180 G10 2SFF rear wrongly blocked: '+rearTest('DL180 G10','2SFF rear').slice(0,160));
  rearTest('DL160 G10','2SFF rear').includes('has no rear or mid-tray drive bays')
    ?pass3('DL160 G10: any rear pick blocked — confirmed no rear/mid-tray cage'):fail3('DL160 G10 rear not blocked: '+rearTest('DL160 G10','2SFF rear').slice(0,160));
  rearTest('DL360 G10+','1SFF rear').includes('has no rear or mid-tray drive bays')
    ?pass3('DL360 G10+: "1SFF rear" now blocked — corrected data bug (was copied from DL360 G10)'):fail3('DL360 G10+ rear bug not fixed: '+rearTest('DL360 G10+','1SFF rear').slice(0,160));
  rearTest('DL365 G10+','2x M.2 (dual uFF) rear').includes('has no rear or mid-tray drive bays')
    ?pass3('DL365 G10+: rear now blocked — its own QuickSpecs states "Rear Drive Cages: Not Available"'):fail3('DL365 G10+ rear bug not fixed');
  rearTest('DL365 G11','2SFF rear').includes('has no rear or mid-tray drive bays')
    ?pass3('DL365 G11: rear now blocked — confirmed data bug fixed, matches DL360 G11\'s earlier fix'):fail3('DL365 G11 rear bug not fixed');
  !rearTest('DL345 G11','4LFF rear').includes('REAR NOT SUPPORTED') && !rearTest('DL345 G11','4LFF midtray').includes('REAR NOT SUPPORTED')
    ?pass3('DL345 G11: both "4LFF rear" and "4LFF midtray" accepted individually (real combo chassis)'):fail3('DL345 G11 combo rear/midtray wrongly blocked');
  !rearTest('DL380 G12','4LFF midtray').includes('REAR NOT SUPPORTED')
    ?pass3('DL380 G12: "4LFF midtray" accepted (Gen11-pattern combo now sourced)'):fail3('DL380 G12 midtray wrongly blocked: '+rearTest('DL380 G12','4LFF midtray').slice(0,160));
  /has no rear or mid-tray drive bays|REAR NOT SUPPORTED/.test(rearTest('DL580 G12','2x M.2 (dual uFF) rear'))
    ?pass3('DL580 G12: the old "2x M.2 rear" line is no longer a rear option (V11: the NS204i-u boot device is a card-line with its own front/rear kit)'):fail3('DL580 G12 M.2 rear still accepted as a rear drive option');
  /has no rear or mid-tray drive bays|REAR NOT SUPPORTED/.test(rearTest('DL580 G12','4LFF rear'))
    ?pass3('DL580 G12: a real drive rear cage (not the M.2 boot device) is still blocked — all 4 boxes are front'):fail3('DL580 G12 4LFF rear wrongly accepted');

  // --- Backplane type: SAS-only / NVMe-only hard overrides (2026-09-15) ---
  const bpTest=(model,bpId)=>{
    setModel3(model);
    d.getElementById(bpId).checked=true;fire(d.getElementById(bpId),'change');
    const txt=d.getElementById('checks').textContent;
    d.getElementById('bp1').checked=true;fire(d.getElementById('bp1'),'change');
    return txt;
  };
  bpTest('DL160 G10','bp2').includes('has no NVMe or Premium backplane')
    ?pass3('DL160 G10: NVMe backplane blocked — SAS/SATA only on every bay config'):fail3('DL160 G10 NVMe not blocked: '+bpTest('DL160 G10','bp2').slice(0,160));
  bpTest('ML30 G11','bp3').includes('has no NVMe or Premium backplane')
    ?pass3('ML30 G11: Premium backplane blocked — same "no NVMe hot-plug bay" finding carried from G10+'):fail3('ML30 G11 Premium not blocked');
  bpTest('DL380a G12','bp1').includes('is NVMe-only')
    ?pass3('DL380a G12: SAS/SATA backplane blocked — zero SAS/SATA mentions in its own QuickSpecs'):fail3('DL380a G12 SAS/SATA not blocked: '+bpTest('DL380a G12','bp1').slice(0,160));
  !bpTest('DL380a G12','bp2').includes('is NVMe-only')
    ?pass3('DL380a G12: NVMe backplane accepted (its only real option)'):fail3('DL380a G12 NVMe wrongly blocked');
  !bpTest('DL20 G11','bp2').includes('has no NVMe or Premium backplane')
    ?pass3('DL20 G11: NVMe accepted — gained a real NVMe option at G11 (unlike DL20 G10/G10+, which stay SAS-only)'):fail3('DL20 G11 NVMe wrongly blocked');
  setModel3('DL160 G10');
  d.getElementById('bp-note').textContent.includes('SAS/SATA only')
    ?pass3('DL160 G10: #bp-note explains the SAS-only case'):fail3('DL160 G10 bp-note: '+d.getElementById('bp-note').textContent);
  setModel3('DL380a G12');
  d.getElementById('bp-note').textContent.includes('NVMe-only')
    ?pass3('DL380a G12: #bp-note explains the NVMe-only case'):fail3('DL380a G12 bp-note: '+d.getElementById('bp-note').textContent);

  // --- TPM: Gen11/12 embedded-only vs Gen10/10+ swappable module (2026-09-15) ---
  const tpmTest=(model,tpmId)=>{
    setModel3(model);
    d.getElementById(tpmId).checked=true;fire(d.getElementById(tpmId),'change');
    const txt=d.getElementById('checks').textContent;
    d.getElementById('tp0').checked=true;fire(d.getElementById('tp0'),'change');
    return txt;
  };
  tpmTest('DL380 G11','tp1').includes('embedded TPM 2.0 only')
    ?pass3('DL380 G11: TPM 1.2 flagged — embedded TPM 2.0 only, no 1.2 mode'):fail3('DL380 G11 TPM 1.2 not flagged: '+tpmTest('DL380 G11','tp1').slice(0,160));
  !tpmTest('DL560 G11','tp1').includes('embedded TPM 2.0 only')
    ?pass3('DL560 G11: TPM 1.2 NOT flagged (its own QuickSpecs lists both as standing options)'):fail3('DL560 G11 TPM 1.2 wrongly flagged');
  !tpmTest('DL380 G10','tp1').includes('embedded TPM 2.0 only')
    ?pass3('DL380 G10: TPM 1.2 NOT flagged (real FIO 1.2-mode switch on the discrete TPM 2.0 module)'):fail3('DL380 G10 TPM 1.2 wrongly flagged');
  tpmTest('DL20 G10+','tp1').includes('embedded TPM 2.0 only')
    ?pass3('DL20 G10+: TPM 1.2 flagged — embedded, non-swappable TPM 2.0, no 1.2 mode'):fail3('DL20 G10+ TPM 1.2 not flagged');
  (setModel3('DL380 G11'),d.getElementById('tp2').checked && d.getElementById('tp0').hidden && d.getElementById('tp1').hidden)
    ?pass3('DL380 G11: only "TPM 2.0 (built in)" is offered, pre-selected (no misleading None)'):fail3('DL380 G11 TPM pills wrong');
  tpmTest('DL380 G10','tp2').includes('Order the TPM 2.0 module 864279-B21')
    ?pass3('DL380 G10: TPM 2.0 module check names the Gen10 kit 864279-B21'):fail3('DL380 G10 TPM 2.0 info missing');
  setModel3('DL380 G11');
  d.getElementById('tpm-note').textContent.includes('no TPM 1.2 mode')
    ?pass3('DL380 G11: #tpm-note explains embedded-only, no 1.2 mode'):fail3('DL380 G11 tpm-note: '+d.getElementById('tpm-note').textContent);
  setModel3('DL560 G11');
  d.getElementById('tpm-note').textContent.includes('also lists a TPM 1.2 mode')
    ?pass3('DL560 G11: #tpm-note explains built-in TPM 2.0 plus a listed 1.2 mode'):fail3('DL560 G11 tpm-note: '+d.getElementById('tpm-note').textContent);
  setModel3('DL380 G10');
  d.getElementById('tpm-note').textContent.includes('872108-B21')
    ?pass3('DL380 G10: #tpm-note gives the module kit and the 1.2-mode FIO setting'):fail3('DL380 G10 tpm-note: '+d.getElementById('tpm-note').textContent);
  setModel3('DL20 G10+');
  d.getElementById('tpm-note').textContent.includes('nothing to order')
    ?pass3('DL20 G10+: #tpm-note explains the built-in TPM at G10+'):fail3('DL20 G10+ tpm-note: '+d.getElementById('tpm-note').textContent);

  // --- Motherboard Standard vs NC: always-nc / always-lom / choice (2026-09-15) ---
  const moboTest=(model,moboId)=>{
    setModel3(model);
    d.getElementById(moboId).checked=true;fire(d.getElementById(moboId),'change');
    const txt=d.getElementById('checks').textContent;
    d.getElementById('mb1').checked=true;fire(d.getElementById('mb1'),'change');
    return txt;
  };
  moboTest('DL20 G11','mb2').includes('has no NC motherboard variant')
    ?pass3('DL20 G11: "NC motherboard" blocked — always ships with embedded LOM, no NC variant'):fail3('DL20 G11 NC not blocked');
  moboTest('DL160 G10','mb2').includes('has no NC motherboard variant')
    ?pass3('DL160 G10: "NC motherboard" blocked — its own QuickSpecs states every config ships embedded NIC'):fail3('DL160 G10 NC not blocked');
  !moboTest('DL380 G11','mb2').includes('has no NC motherboard variant')
    ?pass3('DL380 G11: "NC motherboard" not blocked (always-nc chassis — picking either radio is valid, just misleading)'):fail3('DL380 G11 NC wrongly blocked');
  !moboTest('DL380 G10','mb2').includes('has no NC motherboard variant')
    ?pass3('DL380 G10: "NC motherboard" not blocked — a genuine NC choice exists on this chassis'):fail3('DL380 G10 NC wrongly blocked');
  setModel3('DL380 G11');
  d.getElementById('mobo-note').textContent.includes('networking comes entirely from')
    ?pass3('DL380 G11: #mobo-note explains the always-nc case'):fail3('DL380 G11 mobo-note: '+d.getElementById('mobo-note').textContent);
  setModel3('DL20 G11');
  d.getElementById('mobo-note').textContent.includes('no NC variant to pick')
    ?pass3('DL20 G11: #mobo-note explains the always-lom case'):fail3('DL20 G11 mobo-note: '+d.getElementById('mobo-note').textContent);

  // --- Media bay: chassis with no media bay slot at all (2026-09-15) ---
  const mediaTest=(model,mediaId)=>{
    setModel3(model);
    d.getElementById(mediaId).checked=true;fire(d.getElementById(mediaId),'change');
    const txt=d.getElementById('checks').textContent;
    d.getElementById('md0').checked=true;fire(d.getElementById('md0'),'change');
    return txt;
  };
  mediaTest('DL110 G11','md1').includes('has no media bay slot')
    ?pass3('DL110 G11: DVD-ROM blocked — confirmed no media bay slot on this chassis'):fail3('DL110 G11 media bay not blocked');
  mediaTest('DL380a G12','md3').includes('has no media bay slot')
    ?pass3('DL380a G12: Universal media bay blocked — fixed GPU-dense chassis, no media bay'):fail3('DL380a G12 media bay not blocked');
  !mediaTest('DL380 G11','md1').includes('has no media bay slot')
    ?pass3('DL380 G11: DVD-ROM not blocked (has a real media bay)'):fail3('DL380 G11 media bay wrongly blocked');
  setModel3('DL110 G11');
  d.getElementById('media-note').textContent.includes('No media bay slot')
    ?pass3('DL110 G11: #media-note shows "no media bay" text'):fail3('DL110 G11 media-note: '+d.getElementById('media-note').textContent);
  setModel3('DL380 G11');
  (/P50728-B21/.test(d.getElementById('media-note').textContent) && !/No media bay slot/.test(d.getElementById('media-note').textContent))
    ?pass3('DL380 G11: #media-note lists its real options (Universal Media Bay P50728-B21), not "no media bay"'):fail3('DL380 G11 media-note not empty: '+d.getElementById('media-note').textContent);

  // --- no 3.5in NVMe backplane ---
  setModel3('DL380 G10');
  d.getElementById('bays').value='24SFF';fire(d.getElementById('bays'),'input');
  setRear('4LFF midtray NVMe');
  d.getElementById('checks').textContent.includes('no 3.5-inch (LFF) NVMe backplane')
    ?pass3('LFF NVMe rear cage blocked (no such backplane)'):fail3('LFF NVMe rear not blocked: '+d.getElementById('checks').textContent.slice(0,160));
  clearRear();

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
  d.getElementById('slip').textContent.includes('iLO 5 Standard (included)')
    ?pass4('iLO defaults to Standard (included) on the slip')
    :fail4('iLO default missing from slip: '+d.getElementById('slip').textContent.slice(0,200));
  d.getElementById('il1').checked=true;fire(d.getElementById('il1'),'change');
  d.getElementById('slip').textContent.includes('iLO 5 Advanced license')
    ?pass4('iLO Advanced selectable and reaches the slip')
    :fail4('iLO Advanced missing from slip');
  d.getElementById('il0').checked=true;fire(d.getElementById('il0'),'change');

  // --- FlexibleLOM/OCP: blank is a gap, explicit "No" is not. DL380 G10
  // is a flrKind()==='flexlom' model, so the dynamic label is just
  // "FlexibleLOM" here, not the generic combined "FlexibleLOM / OCP" ---
  d.getElementById('fl1').checked=false;d.getElementById('fl0').checked=false;
  d.getElementById('flr').disabled=false;d.getElementById('flr').value='';fire(d.getElementById('flr'),'input');
  d.getElementById('slip').textContent.includes('FlexibleLOM')
    ?pass4('FlexibleLOM/OCP left entirely blank is a gap')
    :fail4('blank FlexibleLOM/OCP not flagged as a gap');
  d.getElementById('fl0').checked=true;fire(d.getElementById('fl0'),'change');
  (d.getElementById('slip').textContent.includes('No FlexibleLOM fitted') && d.getElementById('flr').disabled)
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

  // --- a bare number defaults to GB (no need to type the unit) ---
  d.getElementById('memtarget').value='384';fire(d.getElementById('memtarget'),'input');
  const msBtnsBare=[...d.querySelectorAll('#mem-suggestions button')];
  (msBtnsBare.length===msBtns.length && !d.getElementById('mem-suggestions').hidden)
    ?pass4('typing a bare "384" (no unit) suggests the same configs as "384GB"')
    :fail4('bare-number memory target did not default to GB: '+d.getElementById('mem-suggestions').textContent);
  d.getElementById('memtarget').value='1.5TB';fire(d.getElementById('memtarget'),'input');
  const msBtnsTB=[...d.querySelectorAll('#mem-suggestions button')];
  (msBtnsTB.length>0 && msBtnsTB[0].textContent.includes('per CPU'))
    ?pass4('"1.5TB" is still read as TB, not misread as a bare 1.5GB')
    :fail4('TB suffix stopped working: '+d.getElementById('mem-suggestions').textContent);
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

  // --- paste: a leading "5x" right before the model is a BUILD count, not
  // anything else the text might contain a number for ---
  pasteCase4('5x DL360g10');
  (d.getElementById('model').value==='DL360 G10' && d.getElementById('modelq').value==='5')
    ?pass4('"5x DL360g10" sets the model AND the build count to 5')
    :fail4('"5x DL360g10" build count wrong: model="'+d.getElementById('model').value+'" modelq="'+d.getElementById('modelq').value+'"');
  d.getElementById('modelq').value='';
  pasteCase4('2x 800w DL360 G10, needs a SAS expander');
  (d.getElementById('model').value==='DL360 G10' && d.getElementById('modelq').value==='1')
    ?pass4('an earlier, unrelated "2x 800w" doesn\'t get misread as the build count')
    :fail4('unrelated leading "2x" wrongly set the build count: modelq="'+d.getElementById('modelq').value+'"');

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

  // --- DL385 G11: riser/fan/bay/rear coverage + Turin platform (2026-09-11) ---
  setModel4('DL385 G11');
  { const bayopts=[...d.querySelectorAll('#bayopts option')].map(o=>o.value);
    (bayopts.includes('8SFF')&&bayopts.includes('24SFF')&&bayopts.includes('8LFF'))
      ?pass4('DL385 G11: bay list populated (8SFF/24SFF/8LFF/…)')
      :fail4('DL385 G11 bay list: '+bayopts.join(', '));
  }
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  (d.getElementById('fanq').getAttribute('max')==='6' && d.getElementById('fanq').value==='6')
    ?pass4('DL385 G11: fan count auto-fills to 6 (fixed cage regardless of CPU count)')
    :fail4('DL385 G11 fan auto-fill: max='+d.getElementById('fanq').getAttribute('max')+' val='+d.getElementById('fanq').value);
  { ci4.value='';fire(ci4,'input');
    const groups=[...d.querySelectorAll('#cpu-panel .combo-group')].map(g=>g.textContent);
    (groups.some(g=>/Genoa/.test(g)) && groups.some(g=>/Turin/.test(g)))
      ?pass4('DL385 G11: CPU picker groups Genoa and Turin separately')
      :fail4('DL385 G11 CPU groups: '+groups.join(' | '));
  }
  (d.getElementById('dimm-note').textContent.includes('4800') && d.getElementById('dimm-note').textContent.includes('6000'))
    ?pass4('DL385 G11 (no CPU picked yet): memory-speed note unions Genoa (4800) and Turin (6000) MT/s')
    :fail4('DL385 G11 dimm-note before CPU pick: '+d.getElementById('dimm-note').textContent);
  pickCpu4('EPYC 9555'); // Turin, 360W
  (d.getElementById('dimm-note').textContent.includes('6000') && !d.getElementById('dimm-note').textContent.includes('4800'))
    ?pass4('DL385 G11 (Turin CPU picked): memory-speed note narrows to just Turin\'s 6000 MT/s, not Genoa\'s 4800')
    :fail4('DL385 G11 dimm-note after CPU pick: '+d.getElementById('dimm-note').textContent);
  setRear('4LFF rear');
  !d.getElementById('checks').textContent.includes('REAR NOT SUPPORTED')
    ?pass4('DL385 G11: "4LFF rear" accepted as a rear option')
    :fail4('DL385 G11 "4LFF rear" wrongly blocked: '+d.getElementById('checks').textContent.slice(0,200));
  clearRear();
  { const kits=[...d.querySelectorAll('#riser-kits .riser-kit')].map(x=>x.getAttribute('data-name'));
    (kits.length===9 && kits.some(k=>k.includes('P57890-B21')) && kits.some(k=>k.includes('P57893-B21')))
      ?pass4('DL385 G11: real riser-kit part numbers offered (9 kits, not the generic fallback)')
      :fail4('DL385 G11 riser kits: '+kits.join(' | '));
    const defLine=[...d.querySelectorAll('#risers [data-k=name]')].map(x=>x.value);
    defLine[0]==='Default Primary riser (Slot 3 only)'
      ?pass4('DL385 G11: default primary riser pre-filled on model pick')
      :fail4('DL385 G11 default riser line: '+defLine.join(', '));
  }

  // --- DL560 G11: real riser-kit part numbers, ships with NONE by default ---
  setModel4('DL560 G11');
  { const kits=[...d.querySelectorAll('#riser-kits .riser-kit')].map(x=>x.getAttribute('data-name'));
    (kits.length===4 && kits.some(k=>k.includes('P54779-B21')&&k.includes('Primary'))
      && kits.some(k=>k.includes('P54780-B21')&&k.includes('Secondary')))
      ?pass4('DL560 G11: real riser-kit part numbers offered (P54779/P54780, both positions)')
      :fail4('DL560 G11 riser kits: '+kits.join(' | '));
    [...d.querySelectorAll('#risers [data-k=name]')].length===0
      ?pass4('DL560 G11: no riser pre-filled — the CTO base config ships with none')
      :fail4('DL560 G11 wrongly pre-filled a riser: '+[...d.querySelectorAll('#risers [data-k=name]')].map(x=>x.value).join(', '));
  }
  d.getElementById('checks').textContent.includes('Ships with NO riser')
    ?pass4('DL560 G11: "ships with no riser" reminder surfaces in config checks')
    :fail4('DL560 G11 riser reminder missing from checks');

  // --- DL325/DL345/DL365 G11: real riser-kit part numbers (2026-09-11) ---
  setModel4('DL325 G11');
  { const kits=[...d.querySelectorAll('#riser-kits .riser-kit')].map(x=>x.getAttribute('data-name'));
    const defLine=[...d.querySelectorAll('#risers [data-k=name]')].map(x=>x.value);
    (kits.length===3 && kits.some(k=>k.includes('P56915-B21')) && kits.some(k=>k.includes('P55029-B21'))
      && defLine[0]==='Default Primary riser (Slot 1)')
      ?pass4('DL325 G11: real riser kits (P56915/P55029-B21), default primary pre-filled')
      :fail4('DL325 G11 risers: kits='+kits.join(' | ')+' def='+defLine.join(', '));
  }
  setModel4('DL345 G11');
  { const kits=[...d.querySelectorAll('#riser-kits .riser-kit')].map(x=>x.getAttribute('data-name'));
    const defLine=[...d.querySelectorAll('#risers [data-k=name]')].map(x=>x.value);
    (kits.length===8 && kits.some(k=>k.includes('P57116-B21')) && kits.some(k=>k.includes('P57117-B21'))
      && defLine.includes('Default Primary riser (Slot 3)') && defLine.includes('Default Secondary riser (Slot 6)'))
      ?pass4('DL345 G11: real riser kits (8, incl. both enablement kits), both defaults pre-filled')
      :fail4('DL345 G11 risers: kits='+kits.join(' | ')+' def='+defLine.join(', '));
  }
  setModel4('DL365 G11');
  { const kits=[...d.querySelectorAll('#riser-kits .riser-kit')].map(x=>x.getAttribute('data-name'));
    const defLine=[...d.querySelectorAll('#risers [data-k=name]')].map(x=>x.value);
    (kits.length===3 && kits.some(k=>k.includes('P56915-B21')) && defLine[0]==='Primary riser (Slot 1)')
      ?pass4('DL365 G11: real riser kits (shares P56915/P55029-B21 with DL325), primary pre-filled')
      :fail4('DL365 G11 risers: kits='+kits.join(' | ')+' def='+defLine.join(', '));
  }
  d.getElementById('risers').innerHTML='';d.getElementById('add-riser').click();
  d.getElementById('add-riser').click();
  d.getElementById('add-riser').click();
  [...d.querySelectorAll('#risers [data-k=name]')].forEach((el,i)=>{el.value='Riser line '+i;fire(el,'input');});
  !d.getElementById('checks').textContent.includes('TOO MANY RISERS')
    ?pass4('DL365 G11: riserMax corrected 2->3 (GPU Riser 2 is a confirmed 3rd position) — 3 riser lines no longer blocked')
    :fail4('DL365 G11 riserMax still capped at 2: '+d.getElementById('checks').textContent.slice(0,200));
  d.getElementById('risers').innerHTML='';d.getElementById('add-riser').click();

  // --- picking a model defaults "Builds" to 1 (UI pick + paste), and the
  // generation quick-filter buttons scope the picker ---
  d.getElementById('modelq').value='';
  setModel4('DL380 G10');
  d.getElementById('modelq').value==='1'
    ?pass4('picking a model sets "Builds" to 1')
    :fail4('modelq after picking a model: "'+d.getElementById('modelq').value+'"');
  d.getElementById('modelq').value='4';fire(d.getElementById('modelq'),'input');
  setModel4('DL360 G10');
  d.getElementById('modelq').value==='4'
    ?pass4('...but leaves an already-set "Builds" count alone')
    :fail4('modelq clobbered to '+d.getElementById('modelq').value);
  d.getElementById('modelq').value='';
  pasteCase4('dl380 g10');
  d.getElementById('modelq').value==='1'
    ?pass4('paste resolving a model also sets "Builds" to 1')
    :fail4('paste modelq: "'+d.getElementById('modelq').value+'"');

  { const genBtns=()=>[...d.querySelectorAll('#model-gen-btns button')].map(b=>b.getAttribute('data-g'));
    (genBtns().includes('G9') && genBtns().includes('G12') && genBtns().includes('G10+ v2'))
      ?pass4('Rack: generation filter buttons offered (G9…G12, incl. G10+ v2)')
      :fail4('Rack gen buttons: '+genBtns().join(', '));
    d.querySelector('#model-gen-btns button[data-g="G9"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    mi4.value='';fire(mi4,'input');
    const shown=[...d.querySelectorAll('#model-panel .combo-group')].map(g=>g.textContent);
    (shown.length===1 && shown[0]==='G9')
      ?pass4('clicking "G9" scopes the model dropdown to just that generation')
      :fail4('gen filter did not scope the panel: groups='+shown.join(', '));
    d.querySelector('#model-gen-btns button[data-g="G9"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    mi4.value='';fire(mi4,'input');
    const shown2=[...d.querySelectorAll('#model-panel .combo-group')].map(g=>g.textContent);
    (shown2.length>1)
      ?pass4('clicking the active generation again clears the filter')
      :fail4('gen filter did not clear: groups='+shown2.join(', '));
    d.getElementById('ct-t').checked=true;fire(d.getElementById('ct-t'),'change');
    const towerBtns=genBtns();
    (!towerBtns.includes('G10+ v2') && towerBtns.includes('G9'))
      ?pass4('Tower: generation buttons drop G10+ v2 (no tower ever shipped it)')
      :fail4('Tower gen buttons: '+towerBtns.join(', '));
    d.getElementById('ct-r').checked=true;fire(d.getElementById('ct-r'),'change');
  }
},1900);

// ---- round 5: shareable link + recent builds ----
setTimeout(()=>{
  function pass5(m){console.log('ok    '+m);}
  function fail5(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi5=d.getElementById('model-input'), ci5=d.getElementById('cpu-input');
  function setModel5(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi5.value='';fire(mi5,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail5('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function pickCpu5(code){
    ci5.value='';fire(ci5,'input');
    const opt=[...d.querySelectorAll('#cpu-panel .combo-item')].find(el=>el.textContent.includes(code));
    if(opt)opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }

  // clean slate for the recent-builds checks below
  d.getElementById('recent-list').innerHTML='';
  try{w.localStorage.removeItem('sbw-recent-v1');}catch(e){}

  setModel5('DL380 G10');pickCpu5('G6148');
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');

  let capturedLinkText=null;
  try{ w.navigator.clipboard={writeText:(t)=>{capturedLinkText=t;return Promise.resolve();}}; }catch(e){}
  d.getElementById('copylink').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));

  // Everything "Copy link" touches (capturedLinkText, the recents write, the
  // DOM) happens synchronously inside the click handler — the mocked
  // clipboard.writeText sets capturedLinkText before returning, it doesn't
  // wait for its .then(). Deferring these checks via setTimeout(0) used to
  // just cost a tick; once enough rounds/tests piled up in this file, that
  // tick became large enough for round 6/7's OWN (fixed, absolute-delay)
  // timers to become due first and race ahead of it, mutating the shared
  // model/cpu out from under this block (surfaced as "model=DL560 G10" —
  // that's round 7's own model pick leaking in). Running synchronously
  // removes the gap those races needed.
  {
    // --- "Copy link" produces a decodable #s= payload matching the sheet ---
    let ok=false;
    try{
      const m=(capturedLinkText||'').match(/#s=([^&]+)/);
      const decoded=JSON.parse(Buffer.from(m[1],'base64').toString('utf8'));
      ok=decoded.f.model==='DL380 G10' && decoded.f.cpu==='G6148';
    }catch(e){}
    ok?pass5('"Copy link" produces a decodable #s= URL matching the current sheet')
      :fail5('copy-link payload wrong/missing: '+capturedLinkText);

    // --- ...and copying auto-snapshots a "recent build" entry ---
    const items=[...d.querySelectorAll('#recent-list .recent-pick')];
    (items.length===1 && items[0].textContent.includes('DL380 G10') && items[0].textContent.includes('G6148'))
      ?pass5('copying a link auto-snapshots a "recent build" entry')
      :fail5('recent-build snapshot missing/wrong: '+items.map(x=>x.textContent).join(' | '));
    d.getElementById('recent-section').hidden
      ?fail5('recent-builds section stayed hidden after a snapshot')
      :pass5('the recent-builds section un-hides once something is saved');

    // repeating the same build within the window updates in place, not a dupe
    d.getElementById('copylink').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    const items2=[...d.querySelectorAll('#recent-list .recent-pick')];
    (items2.length===1)
      ?pass5('re-saving the same build updates the existing recent entry instead of duplicating it')
      :fail5('recent list duplicated an identical build: '+items2.length+' entries');

    // --- switching model, then clicking the recent entry, restores it ---
    setModel5('DL360 G10');
    d.querySelector('#recent-list .recent-pick').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    (d.getElementById('model').value==='DL380 G10' && d.getElementById('cpu').value==='G6148')
      ?pass5('clicking a recent-build entry restores that exact model + CPU')
      :fail5('recent-build restore failed: model="'+d.getElementById('model').value+'"');

    // --- delete removes the entry and re-hides the (now empty) list ---
    d.querySelector('#recent-list .recent-del').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    (d.querySelectorAll('#recent-list .recent-pick').length===0 && d.getElementById('recent-section').hidden)
      ?pass5('deleting the last recent build empties and re-hides the list')
      :fail5('recent build not removed / list not re-hidden');
  }

  // --- opening the page with a #s= share-link hash restores state, then cleans the URL ---
  const state5={f:{model:'DL380 G10',cpu:'G6148',cpuq:'2'},r:{chassis:'Rack'},c:{},drives:[],cards:[],risers:[]};
  const payload5=Buffer.from(JSON.stringify(state5),'utf8').toString('base64');
  const dom5=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,
    url:'https://example.test/page.html#s='+payload5,
    virtualConsole:new (require('jsdom').VirtualConsole)()});
  setTimeout(()=>{
    const d5=dom5.window.document;
    (d5.getElementById('model').value==='DL380 G10' && d5.getElementById('cpu').value==='G6148')
      ?pass5('opening the page with a #s= share-link hash restores the model + CPU')
      :fail5('share-link restore failed: model="'+d5.getElementById('model').value+'" cpu="'+d5.getElementById('cpu').value+'"');
    dom5.window.location.hash===''
      ?pass5('...and the hash is cleaned off the address bar afterwards')
      :fail5('hash not cleared: '+dom5.window.location.hash);
    dom5.window.close();
  },600);
},2400);

// ---- round 6: phone-native <select> mirror for the free-type combo fields ----
// Chains into round 7 from inside its own nested 320ms callback (see below)
// instead of an independent fixed delay — round 7/8 mutate the same shared
// `ctrl` field this round's delayed assertion still needs to read; letting
// them run on schedule regardless of how long rounds 1-6 actually took
// (once the suite has enough tests, a fixed delay is no guarantee of "after")
// is exactly the bug that hit round 5's recent-builds check earlier.
function runRound6(){
  function pass6(m){console.log('ok    '+m);}
  function fail6(m){console.log('FAIL  '+m);process.exitCode=1;}

  // --- every attachList() field got wrapped with a mirrored native select ---
  const mirroredIds=['dimm','ctrl','bat','flr','expander','psu'];
  const missing=mirroredIds.filter(id=>{
    const inp=d.getElementById(id),wrap=inp.closest('.ac-wrap');
    return !(wrap && wrap.querySelector('select'));
  });
  missing.length===0
    ?pass6('all 6 top-level combo fields got a native <select> mirror')
    :fail6('missing native mirror on: '+missing.join(', '));
  // bays deliberately opted out (removed 2026-09-14) — the quick-pick buttons
  // above the field already do the tap-to-pick job, so it should NOT get the
  // combo-panel/native-mirror/chevron treatment attachList() applies.
  d.getElementById('bays').closest('.ac-wrap')
    ?fail6('bays field got an .ac-wrap mirror it should not have (dropdown was supposed to be removed)')
    :pass6('bays correctly has no .ac-wrap/native-select mirror — buttons only');
  d.getElementById('bays').classList.contains('ac-input')
    ?fail6('bays field carries .ac-input (chevron) — dropdown was supposed to be removed')
    :pass6('bays correctly has no .ac-input chevron class');
  d.getElementById('bays').hasAttribute('list')
    ?fail6('bays field still has list=bayopts — a native browser datalist dropdown is still active')
    :pass6('bays correctly has no list= attribute — no native datalist dropdown either');

  // --- row-based fields (drive capacity, card/riser/rear name) get it too ---
  d.getElementById('add-drive').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  d.getElementById('add-card').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  d.getElementById('add-riser').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  d.getElementById('add-rear').disabled=false; // whatever model round 4/5 left selected may have no rear bays
  d.getElementById('add-rear').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const rowFields=[['#drives [data-k=cap]','drive capacity'],['#cards [data-k=name]','card name'],['#risers [data-k=name]','riser kit name'],['#rear-lines [data-k=v]','rear/mid-tray line']];
  rowFields.forEach(([sel,label])=>{
    const inp=d.querySelector(sel),wrap=inp&&inp.closest('.ac-wrap');
    (wrap&&wrap.querySelector('select'))
      ?pass6('row field ('+label+') got a native <select> mirror')
      :fail6('row field ('+label+') missing native mirror');
  });

  // --- picking a real option in the mirror select updates the input and reaches run()/the slip ---
  const ctrlWrap=d.getElementById('ctrl').closest('.ac-wrap'),ctrlSel=ctrlWrap.querySelector('select');
  ctrlSel.value='P408i-a';fire(ctrlSel,'change');
  (d.getElementById('ctrl').value==='P408i-a' && d.getElementById('slip').textContent.includes('P408i-a'))
    ?pass6('picking a value in the native mirror updates the field and reaches the slip')
    :fail6('mirror pick did not propagate: ctrl.value="'+d.getElementById('ctrl').value+'"');

  // --- picking "Other" swaps to the free-type input instead ---
  const otherOpt=[...ctrlSel.options].find(o=>o.textContent.includes('Other'));
  ctrlSel.value=otherOpt.value;fire(ctrlSel,'change');
  (ctrlWrap.classList.contains('ac-editing') && d.getElementById('ctrl').value===''&&d.activeElement===d.getElementById('ctrl'))
    ?pass6('"Other" in the mirror swaps back to the free-type input, focused and cleared')
    :fail6('"Other" did not hand off to free typing (editing='+ctrlWrap.classList.contains('ac-editing')+')');

  // --- typing a custom value then blurring re-shows it as a selected mirror option ---
  d.getElementById('ctrl').value='Custom-Ctrl-XYZ';fire(d.getElementById('ctrl'),'input');
  d.getElementById('ctrl').dispatchEvent(new w.Event('blur',{bubbles:true}));
  setTimeout(()=>{
    (!ctrlWrap.classList.contains('ac-editing') && ctrlSel.value==='Custom-Ctrl-XYZ')
      ?pass6('a typed custom value re-appears as the selected mirror option after blur')
      :fail6('custom value not reflected back into the mirror select: sel.value="'+ctrlSel.value+'"');
    runRound7();   // chained — see the comment above runRound6()
  },320);

  // --- desktop keeps the searchable combo hidden-select CSS rule present (mobile-only swap) ---
  /\.ac-wrap:not\(\.ac-editing\)>select\{display:block/.test(html)
    ?pass6('mobile-breakpoint CSS swaps the mirror select in, leaving desktop on the searchable combo')
    :fail6('mobile <select>-swap CSS rule not found');

  // --- desktop flattens native <select> chrome (speed/class/interface, RAID planner) to match the
  // text-input combo fields, but only above the phone breakpoint — phones keep the OS glass picker ---
  const desktopSelectRule=(html.match(/@media \(min-width:641px\)\{[\s\S]*?\n\}/)||[''])[0];
  (/select\{appearance:none/.test(desktopSelectRule) && /min-width:641px/.test(desktopSelectRule))
    ?pass6('desktop-only rule flattens <select> chrome to match the other combo fields')
    :fail6('desktop select-flattening rule missing or not scoped to min-width:641px');
}
setTimeout(runRound6,3000);

// ---- round 7: rear/mid-tray as independent lines (more than one cage at once) ----
// Entirely synchronous (no nested timers of its own) — chained from round 6's
// nested callback above, and chains into round 8 at its own end below.
function runRound7(){
  function pass7(m){console.log('ok    '+m);}
  function fail7(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi7=d.getElementById('model-input');
  function setModel7(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi7.value='';fire(mi7,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail7('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function addRear(val){
    d.getElementById('add-rear').disabled=false;
    d.getElementById('add-rear').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    const rows=d.querySelectorAll('#rear-lines [data-k=v]'),inp=rows[rows.length-1];
    inp.value=val;fire(inp,'input');
    return inp;
  }
  const ci7=d.getElementById('cpu-input');
  function pickCpu7(code){
    ci7.value='';fire(ci7,'input');
    const opt=[...d.querySelectorAll('#cpu-panel .combo-item')].find(el=>el.textContent.includes(code));
    if(opt)opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }

  setModel7('DL385 G11');clearRear();
  addRear('4LFF midtray');addRear('4LFF rear');
  let txt=d.getElementById('checks').textContent;
  (!txt.includes('REAR NOT SUPPORTED') && !txt.includes('REAR CONFLICT'))
    ?pass7('DL385 G11: a mid-tray line + a separate rear line coexist (different bay locations)')
    :fail7('DL385 G11 mid+rear combo wrongly blocked: '+txt.slice(0,220));
  d.getElementById('slip').textContent.includes('4LFF midtray + 4LFF rear')
    ?pass7('both rear/mid-tray lines reach the slip, joined with "+"')
    :fail7('slip missing joined rear lines: '+d.getElementById('slip').textContent.slice(0,200));

  clearRear();
  addRear('2SFF rear');addRear('4LFF rear');
  txt=d.getElementById('checks').textContent;
  txt.includes('REAR CONFLICT')
    ?pass7('two different rear-cage picks at once is blocked (one rear-cage bay location)')
    :fail7('conflicting rear picks not caught: '+txt.slice(0,220));

  clearRear();
  addRear('4LFF midtray');
  d.querySelector('#rear-lines .kill').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  rearValues().length===0
    ?pass7('removing a rear line via its kill button clears it')
    :fail7('kill button left a stale rear line: '+rearValues());

  // bay-capacity math should sum across all rear/mid-tray lines, not just one
  clearRear();
  setModel7('DL380 G11');
  d.getElementById('bays').value='8LFF';fire(d.getElementById('bays'),'input');
  addRear('4LFF midtray');
  const capNoRear=Number((d.getElementById('bay-note').textContent.match(/(\d+) bays/)||[])[1]||0);
  addRear('2SFF rear');
  const capWithRear=Number((d.getElementById('bay-note').textContent.match(/(\d+) bays/)||[])[1]||0);
  (capWithRear===capNoRear+2)
    ?pass7('bay capacity sums across every rear/mid-tray line (8LFF+4LFF midtray+2SFF rear)')
    :fail7('bay capacity did not sum lines: '+capNoRear+' then '+capWithRear);
  clearRear();

  // the historical rearSigs() bug: a combo string's mid-flag must be per-clause, not global
  setModel7('DL560 G10');clearRear();
  addRear('2SFF rear');addRear('4LFF midtray');
  txt=d.getElementById('checks').textContent;
  (!txt.includes('REAR NOT SUPPORTED'))
    ?pass7('DL560 G10: "2SFF rear" + "4LFF midtray" both individually-allowed lines pass together')
    :fail7('per-clause rear/mid tagging regressed: '+txt.slice(0,220));
  clearRear();

  // --- controller list grouped by suffix (Type-a / PCI / OCP / Entry-tier /
  // other). Gen12 is used here on purpose: its controller compatibility
  // isn't sourced yet, so ctrlsFor() deliberately returns the full
  // unfiltered CTRLS for it (see CTRL_GENS in index.html) — the one
  // generation guaranteed to show every group for this structural check. ---
  setModel7('DL110 G12');   // a G12 model with no controller list of its own (no QuickSpecs found for it, so it will stay that way)
  const ctrl=d.getElementById('ctrl');
  ctrl.dispatchEvent(new w.Event('focus'));
  const groups=[...d.getElementById('ac-panel').querySelectorAll('.combo-group')].map(g=>g.textContent);
  (groups.length===5 && groups.some(g=>/type.a/i.test(g)) && groups.some(g=>/^pci/i.test(g)) &&
   groups.some(g=>/ocp/i.test(g)) && groups.some(g=>/entry/i.test(g)))
    ?pass7('controller combo panel groups into Type-a / PCI / OCP / Entry-tier / other')
    :fail7('controller groups wrong: '+groups.join(' | '));
  const ctrlSel=ctrl.closest('.ac-wrap').querySelector('select');
  const optgroups=[...ctrlSel.querySelectorAll('optgroup')].map(g=>g.label);
  (optgroups.length===5 && ctrlSel.querySelector('optgroup[label*="Type"] option[value="P408i-a"]') && ctrlSel.querySelector('optgroup[label*="OCP"] option[value="MR408i-o"]'))
    ?pass7('controller native-select mirror keeps the same 5 optgroups')
    :fail7('controller mirror optgroups wrong: '+optgroups.join(' | '));

  // --- the actual bug report: controllers are now filtered by generation,
  // not shown as one flat list for every model (2026-09-14, CTRL_GENS) ---
  // 2026-09-17: DL380 G10 got a real cpuAllow-style `ctrl:[...]` override
  // with sourced HPE part numbers, so its combo now shows rich strings
  // ("P408i-a (804331-B21)") instead of the bare generic names — updated
  // to check the substring, not an exact match.
  setModel7('DL380 G10');
  ctrl.dispatchEvent(new w.Event('focus'));
  let ctrlOpts=[...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);
  (!ctrlOpts.some(o=>/^MR416i-o|^MR216i-p|^MR416i-p|^SR932i-p/.test(o)) && ctrlOpts.some(o=>/^P408i-a \(804331-B21\)/.test(o)))
    ?pass7('DL380 G10: no OCP-mezz or MR-p/SR932i-p cards offered (Gen10 Plus+ only) — real P408i-a part number now shown')
    :fail7('DL380 G10 controller list wrong: '+ctrlOpts.join(', '));
  setModel7('DL380 G10+');
  ctrl.dispatchEvent(new w.Event('focus'));
  ctrlOpts=[...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);
  (ctrlOpts.some(o=>/^MR216i-p /.test(o)) && ctrlOpts.some(o=>/^SR932i-p /.test(o)) && ctrlOpts.some(o=>/^P408i-a \(/.test(o)) && !ctrlOpts.some(o=>/^MR416i-o/.test(o)))
    ?pass7('DL380 G10+: MR-p/SR932i-p cards now offered (real part numbers, 2026-09-18), still no OCP-mezz (Gen11 only)')
    :fail7('DL380 G10+ controller list wrong: '+ctrlOpts.join(', '));
  setModel7('DL380 G11');
  ctrl.dispatchEvent(new w.Event('focus'));
  ctrlOpts=[...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);
  (ctrlOpts.some(o=>/^MR416i-o /.test(o)) && ctrlOpts.some(o=>/^MR216i-p /.test(o)) && ctrlOpts.some(o=>/^E208e-p /.test(o)) && !ctrlOpts.some(o=>/^P408i-a/.test(o)) && !ctrlOpts.some(o=>/^P408i-p/.test(o)))
    ?pass7('DL380 G11: OCP-mezz + MR-p offered (now with part numbers), old Smart Array P-series dropped (E208e-p is the one survivor)')
    :fail7('DL380 G11 controller list wrong: '+ctrlOpts.join(', '));
  setModel7('DL380 G9');
  ctrl.dispatchEvent(new w.Event('focus'));
  ctrlOpts=[...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);
  (ctrlOpts.includes('P440') && ctrlOpts.includes('H240') && !ctrlOpts.includes('P408i-a') && !ctrlOpts.includes('MR216i-p'))
    ?pass7('DL380 G9: only the Gen8/9 P440/H240-era lineup offered')
    :fail7('DL380 G9 controller list wrong: '+ctrlOpts.join(', '));

  // --- a mismatched value that lands in the field some other way (typed,
  // pasted, a restored draft) is caught even though it can't be tapped
  // from the panel any more ---
  setModel7('DL380 G10');
  ctrl.value='MR416i-o';fire(ctrl,'input');
  d.getElementById('checks').textContent.includes('CONTROLLER GENERATION')
    ?pass7('a Gen11-only controller typed directly into a G10 build is flagged, not silently accepted')
    :fail7('mismatched typed controller value was not caught: '+d.getElementById('checks').textContent.slice(0,200));
  setModel7('DL380 G12');
  ctrl.value='P408i-a';fire(ctrl,'input'); // still unconfirmed for G12 — not one of the 6 sourced MR-series names
  (d.getElementById('checks').textContent.includes('CONTROLLER GENERATION') && !d.getElementById('checks').textContent.includes('does not work in'))
    ?pass7('Gen12 gets a verify note (not a hard stop) for a controller that still isn\'t sourced for it')
    :fail7('Gen12 controller check wrong: '+d.getElementById('checks').textContent.slice(0,200));
  ctrl.value='MR416i-o';fire(ctrl,'input'); // one of the 6 MR-series names confirmed for G12 — no note needed
  !d.getElementById('checks').textContent.includes('CONTROLLER GENERATION')
    ?pass7('...but a Gen12-confirmed MR-series controller (MR416i-o) gets no note at all')
    :fail7('confirmed G12 controller still nagging: '+d.getElementById('checks').textContent.slice(0,200));
  ctrl.value='';fire(ctrl,'input');

  // --- SAS expander: chassis-family + generation aware, not a flat list
  // (2026-09-14, EXPANDER_PARTS) — each real HPE expander-card part is
  // scoped to a specific chassis family (DL38X / ML350 / DL5x0), most
  // chassis never had one at all, and Gen11/Gen12 dropped the whole
  // product line. Also drops the fabricated "876907-B21" entry. ---
  const exp=d.getElementById('expander');
  function expOpts(){exp.dispatchEvent(new w.Event('focus'));return [...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);}
  setModel7('DL380 G9');
  let expOpts7=expOpts();
  (expOpts7.some(o=>/727250-B21/.test(o)) && !expOpts7.some(o=>/870549-B21/.test(o)) && !expOpts7.some(o=>/876907/.test(o)) &&
   expOpts7.some(o=>o==='2nd controller: H241') && !expOpts7.some(o=>/2nd controller: E208e-p|2nd controller: P408e-p/.test(o)))
    ?pass7('DL380 G9: Gen9 expander part (727250-B21) + H241 as a 2nd-controller option only — no fabricated 876907, no Gen10+/G11 controllers')
    :fail7('DL380 G9 expander list wrong: '+expOpts7.join(', '));
  setModel7('DL380 G10');
  expOpts7=expOpts();
  (expOpts7.some(o=>/870549-B21/.test(o)) && !expOpts7.some(o=>/727250-B21/.test(o)) && !expOpts7.some(o=>/876907/.test(o)) &&
   expOpts7.some(o=>/2nd controller: P408e-p/.test(o)) && !expOpts7.some(o=>o==='2nd controller: H241'))
    ?pass7('DL380 G10: Gen10 DL38X part (870549-B21), not the Gen9 one or the fabricated 876907; P408e-p offered as a 2nd controller, H241 (Gen9-only) is not')
    :fail7('DL380 G10 expander list wrong: '+expOpts7.join(', '));
  setModel7('ML350 G10');
  expOpts7=expOpts();
  expOpts7.some(o=>/874576-B21/.test(o))
    ?pass7('ML350 G10 gets its OWN expander part (874576-B21), not DL380\'s 870549-B21')
    :fail7('ML350 G10 expander list wrong: '+expOpts7.join(', '));
  setModel7('DL560 G10');
  expOpts7=expOpts();
  expOpts7.some(o=>/873444-B21/.test(o))
    ?pass7('DL560 G10 gets its OWN expander part (873444-B21)')
    :fail7('DL560 G10 expander list wrong: '+expOpts7.join(', '));
  setModel7('DL360 G10');
  expOpts7=expOpts();
  (!expOpts7.some(o=>/SAS Expander Card/.test(o)) && expOpts7.some(o=>/2nd controller: P408i-a/.test(o)) && expOpts7.includes('None needed'))
    ?pass7('DL360 G10 never had an expander-card SKU at all — no card offered, just its own real controllers as 2nd-controller options')
    :fail7('DL360 G10 should offer no expander card: '+expOpts7.join(', '));
  setModel7('DL380 G10+');
  expOpts7=expOpts();
  expOpts7.some(o=>/P23388-B21/.test(o))
    ?pass7('DL380 G10+ gets its own new part (P23388-B21), not the Gen10 870549-B21')
    :fail7('DL380 G10+ expander list wrong: '+expOpts7.join(', '));
  setModel7('DL380 G11');
  expOpts7=expOpts();
  (!expOpts7.some(o=>/SAS Expander Card/.test(o)) && expOpts7.some(o=>/2nd controller: E208e-p/.test(o)) && !expOpts7.some(o=>/2nd controller: H241|2nd controller: P408e-p/.test(o)) && expOpts7.some(o=>/2nd controller: MR416i-o/.test(o)))
    ?pass7('DL380 G11: no expander card exists for this generation at all (confirmed dropped) — its own real controller list (incl. E208e-p and the OCP MR-o parts) is offered as 2nd-controller options instead, H241/P408e-p (wrong generation) are not')
    :fail7('DL380 G11 expander list wrong: '+expOpts7.join(', '));

  // --- a mismatched expander value typed/pasted/restored is still caught,
  // same severity as CONTROLLER GENERATION ---
  setModel7('DL380 G11');
  exp.value='12G SAS Expander Card (870549-B21)';fire(exp,'input');
  d.getElementById('checks').textContent.includes('EXPANDER GENERATION')
    ?pass7('a Gen10 expander part typed directly into a G11 build is flagged (no expander card exists for G11 at all)')
    :fail7('mismatched typed expander value on G11 was not caught: '+d.getElementById('checks').textContent.slice(0,200));
  setModel7('DL380 G10');
  exp.value='12G SAS Expander Card (727250-B21)';fire(exp,'input'); // the Gen9 part, on a Gen10 build
  (d.getElementById('checks').textContent.includes('EXPANDER GENERATION') && d.getElementById('checks').textContent.includes('870549-B21'))
    ?pass7('the Gen9 expander part typed into a G10 build is flagged, naming the part this chassis actually takes')
    :fail7('wrong-generation expander part on same chassis family not caught: '+d.getElementById('checks').textContent.slice(0,300));
  exp.value='';fire(exp,'input');

  // --- memory speed/capacity is now DDR-generation + platform aware, not
  // one flat DDR4-only list topping out at 3200 for every model
  // (2026-09-14, MEM_DDR/MEM_SPEEDS/MEM_CAPS/dimmsFor()) ---
  const dimmq7=d.getElementById('dimmq'),dimm7=d.getElementById('dimm');
  function dimmOpts7(){dimm7.dispatchEvent(new w.Event('focus'));return [...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);}
  setModel7('DL380 G9');pickCpu7('E5-2680v4');
  let dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^32GB 2400 MT\/s$/.test(o)) && !dOpts7.some(o=>/4800|5600|6400|6000/.test(o)))
    ?pass7('DL380 G9 (E5-2680v4): DDR4 combos only, no DDR5 speed anywhere in the panel')
    :fail7('DL380 G9 dimm panel wrong: '+dOpts7.join(', '));
  // --- DL380 G11 now splits 4th Gen (sp4, DDR5-4800) from 5th Gen (sp5,
  // DDR5-5600-and-tier-capped) — same idea as genoa/turin for AMD
  // (2026-09-14, sp4/sp5 split + 36 missing CPUs added) ---
  setModel7('DL380 G11'); // no CPU picked yet — union of both Gen11 Intel tiers
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^64GB 4800 MT\/s$/.test(o)) && dOpts7.some(o=>/^64GB 5600 MT\/s$/.test(o)) &&
   !dOpts7.some(o=>/2133|2400|2666|2933|3200/.test(o)))
    ?pass7('DL380 G11 (no CPU yet): unions 4th Gen 4800 and 5th Gen 5600, zero DDR4 speeds offered')
    :fail7('DL380 G11 dimm panel (no CPU) wrong: '+dOpts7.join(', '));
  // per-CPU memory speed cap (2026-09-21, CPU_MEM_MAX from the DL360/DL380 Gen11 QuickSpecs feature
  // tables): a 4th Gen Gold 5416S tops out at 4400, so 4800 must not be offered for it
  pickCpu7('G5416S'); // 4th Gen Sapphire Rapids, sp4, 4400 MT/s max
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^64GB 4400 MT\/s$/.test(o)) && dOpts7.some(o=>/^64GB 4000 MT\/s$/.test(o)) && !dOpts7.some(o=>/4800|5200|5600/.test(o)))
    ?pass7('DL380 G11 (4th Gen G5416S, 4400 max): offers only 4000/4400 — never 4800 or a 5th-Gen speed')
    :fail7('DL380 G11 dimm panel (4th Gen CPU, 4400 max) wrong: '+dOpts7.join(', '));
  pickCpu7('G6448Y'); // 4th Gen, 4800 MT/s max
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^64GB 4800 MT\/s$/.test(o)) && !dOpts7.some(o=>/5200|5600/.test(o)))
    ?pass7('DL380 G11 (4th Gen G6448Y, 4800 max): offers up to 4800, no 5th-Gen speeds')
    :fail7('DL380 G11 dimm panel (4th Gen CPU, 4800 max) wrong: '+dOpts7.join(', '));
  pickCpu7('G6530'); // 5th Gen Emerald Rapids, sp5, but capped at 4800 by its own tier
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^64GB 4800 MT\/s$/.test(o)) && dOpts7.some(o=>/^64GB 4000 MT\/s$/.test(o)) && !dOpts7.some(o=>/5200|5600/.test(o)))
    ?pass7('DL380 G11 (5th Gen G6530, capped at 4800): sp5 grid narrowed to what this CPU runs — no 5200/5600')
    :fail7('DL380 G11 dimm panel (5th Gen CPU, 4800 max) wrong: '+dOpts7.join(', '));
  pickCpu7('P8592+'); // 5th Gen Platinum, 5600 MT/s
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^64GB 5600 MT\/s$/.test(o)) && dOpts7.some(o=>/^64GB 4000 MT\/s$/.test(o)))
    ?pass7('DL380 G11 (5th Gen P8592+): the full sp5 grid up to 5600')
    :fail7('DL380 G11 dimm panel (5th Gen P8592+) wrong: '+dOpts7.join(', '));
  // tapping a size then a speed button assembles one value, each preserving the other
  const szBtn7=d.querySelector('#dimm-size-btns button[data-sz="64"]'),spBtn7=d.querySelector('#dimm-speed-btns button[data-sp="5600"]');
  szBtn7.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  spBtn7.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  (dimm7.value==='64GB 5600 MT/s' && szBtn7.classList.contains('on') && spBtn7.classList.contains('on'))
    ?pass7('tapping size then speed assembles "64GB 5600 MT/s" and highlights both buttons')
    :fail7('dimm size/speed buttons did not assemble correctly: "'+dimm7.value+'"');

  // --- sp3 (3rd Gen Xeon Scalable, G10+) was wrongly a single 3200-only
  // speed — user-reported (2026-09-15): checked directly against DL110/
  // DL360/DL380 G10+ QuickSpecs, real speed is CPU-tier-dependent
  // (Platinum/most Gold = 3200, several Gold + all Silver = 2933 or 2667) ---
  setModel7('DL360 G10+');
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^64GB 3200 MT\/s$/.test(o)) && dOpts7.some(o=>/^64GB 2933 MT\/s$/.test(o)) && dOpts7.some(o=>/^64GB 2667 MT\/s$/.test(o)))
    ?pass7('DL360 G10+ (sp3): offers 2667/2933/3200, not just 3200 — real CPU-tier-dependent speeds')
    :fail7('DL360 G10+ dimm panel missing tier-capped sp3 speeds: '+dOpts7.join(', '));
  // AMD rome/milan G10+ genuinely IS a flat 3200 per their own QuickSpecs
  // (every individual EPYC SKU lists 3200; the only derate found is a
  // DIMMs-per-channel one this tool doesn't model) -- confirm that's
  // still correctly a single value, not a regression from the sp3 fix.
  setModel7('DL325 G10+');
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^16GB 3200 MT\/s$/.test(o)) && !dOpts7.some(o=>/2667|2933/.test(o)))
    ?pass7('DL325 G10+ (rome): still just 3200 — genuinely flat per-SKU speed, not a bug like sp3 was')
    :fail7('DL325 G10+ dimm panel wrong: '+dOpts7.join(', '));
  // restore state for the tests that follow, which assume DL380 G11/G6530
  // (5th Gen) is still selected from before this sp3/rome detour
  setModel7('DL380 G11');pickCpu7('G6530');

  // --- CPU picker groups 4th Gen and 5th Gen separately (same as
  // genoa/turin), and the 36 previously-missing SKUs are seeded ---
  ci7.value='';fire(ci7,'input');
  const g11CpuGroups=[...d.querySelectorAll('#cpu-panel .combo-group')].map(g=>g.textContent);
  (g11CpuGroups.some(g=>/4th Gen/.test(g)) && g11CpuGroups.some(g=>/5th Gen/.test(g)))
    ?pass7('DL380 G11 CPU picker groups 4th Gen (Sapphire Rapids) and 5th Gen (Emerald Rapids) separately')
    :fail7('DL380 G11 CPU groups wrong: '+g11CpuGroups.join(' | '));
  const g11CpuCodes=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(el=>el.textContent);
  (['B3408U','G6458Q','P9462','G5418N','G5411N','G6418H','P8470N'].every(c=>g11CpuCodes.includes(c)) &&
   ['S4509Y','P8593Q','P8581V','B3508U','G6530','P8558U'].every(c=>g11CpuCodes.includes(c)))
    ?pass7('DL380 G11: previously-missing 4th-Gen and 5th-Gen SKUs are now seeded and offered')
    :fail7('DL380 G11 CPU list still missing SKUs: '+g11CpuCodes.join(', '));
  // the 8581V single-socket exception (a "V" suffix, not the usual "U")
  pickCpu7('P8581V');
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  d.getElementById('checks').textContent.includes('single-socket-only')
    ?pass7('P8581V (5th Gen, "V" suffix) is still caught as single-socket-only via SINGLE_SOCKET_EXTRA')
    :fail7('P8581V single-socket exception not caught: '+d.getElementById('checks').textContent.slice(0,200));
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  dimm7.value='';fire(dimm7,'input');

  // --- 5th Gen rollout to the other Gen11 models it's actually confirmed
  // for (2026-09-14) — DL360/ML350/DL320/ML110 yes, DL110/DL560 no, and
  // DL340 G11 removed entirely (never a real HPE product) ---
  ['DL360 G11','ML350 G11','DL320 G11','ML110 G11'].forEach(function(model){
    setModel7(model);ci7.value='';fire(ci7,'input');
    const groups=[...d.querySelectorAll('#cpu-panel .combo-group')].map(g=>g.textContent);
    (groups.some(g=>/4th Gen/.test(g)) && groups.some(g=>/5th Gen/.test(g)))
      ?pass7(model+': 5th Gen (Emerald Rapids) is offered alongside 4th Gen, confirmed against its own QuickSpecs')
      :fail7(model+' CPU groups missing 5th Gen: '+groups.join(' | '));
  });
  ['DL110 G11','DL560 G11'].forEach(function(model){
    setModel7(model);ci7.value='';fire(ci7,'input');
    const groups=[...d.querySelectorAll('#cpu-panel .combo-group')].map(g=>g.textContent);
    (groups.some(g=>/4th Gen/.test(g)) && !groups.some(g=>/5th Gen/.test(g)))
      ?pass7(model+': stays 4th-Gen-only — its own QuickSpecs hasn\'t added 5th Gen')
      :fail7(model+' should not offer 5th Gen: '+groups.join(' | '));
  });
  // DL320/ML110 G11's new single-socket "U" SKUs (found during the sp5
  // rollout, not previously seeded at all) are caught by the existing
  // generic U-suffix rule, no new code needed
  setModel7('DL320 G11');pickCpu7('G5412U');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  ci7.value='';fire(ci7,'input');
  const g5412Item=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].find(el=>el.textContent==='G5412U');
  g5412Item
    ?pass7('DL320 G11: newly-seeded G5412U (4th Gen, single-socket) is offered')
    :fail7('G5412U not found in DL320 G11\'s CPU list');
  // DL340 G11 no longer exists as a pickable model
  mi7.value='DL340';fire(mi7,'input');
  const dl340Match=[...d.querySelectorAll('#model-panel .combo-item')].some(el=>/DL340\s*G11\b/.test(el.textContent.replace(/\s+/g,' ')));
  !dl340Match
    ?pass7('DL340 G11 no longer offered as a model — it was never a real HPE product')
    :fail7('DL340 G11 still appears in the model picker');
  mi7.value='';fire(mi7,'input');

  // --- FlexibleLOM vs OCP 3.0 are physically different connectors, not
  // interchangeable — the field used to offer nothing but FlexibleLOM
  // cards for every model, even Gen10 Plus/11/12 chassis that dropped
  // FlexibleLOM entirely in favor of OCP 3.0 (2026-09-14, flrKind()/
  // flrCardsFor()) ---
  const flr7=d.getElementById('flr');
  function flrOpts7(){flr7.dispatchEvent(new w.Event('focus'));return [...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);}
  setModel7('DL380 G9'); // pre-Gen10-Plus — FlexibleLOM only, no OCP existed yet
  let flrOpts=flrOpts7();
  (flrOpts.some(o=>/^366FLR/.test(o)) && !flrOpts.some(o=>/^I350-T4|^BCM5719/.test(o)))
    ?pass7('DL380 G9: FlexibleLOM cards only — OCP 3.0 didn\'t exist yet')
    :fail7('DL380 G9 FLR panel wrong: '+flrOpts.join(', '));
  setModel7('DL380 G11'); // OCP-only — FlexibleLOM was retired at Gen10 Plus
  flrOpts=flrOpts7();
  (flrOpts.some(o=>/^I350-T4/.test(o)) && !flrOpts.some(o=>/FLR/.test(o)))
    ?pass7('DL380 G11: OCP 3.0 cards only — no FlexibleLOM option anywhere (retired at Gen10 Plus)')
    :fail7('DL380 G11 FLR panel wrong: '+flrOpts.join(', '));
  d.getElementById('flr-note').textContent.includes('OCP 3.0 only')
    ?pass7('DL380 G11 flr-note explains it\'s OCP-only')
    :fail7('DL380 G11 flr-note wrong: '+d.getElementById('flr-note').textContent);
  setModel7('ML30 G10+'); // one of the 3 confirmed "neither slot" exceptions
  flrOpts=flrOpts7();
  (flrOpts.length===0 && d.getElementById('flr-note').textContent.includes('No FlexibleLOM/OCP mezzanine'))
    ?pass7('ML30 G10+: no FlexibleLOM or OCP option at all — this chassis has neither slot')
    :fail7('ML30 G10+ should offer nothing: '+flrOpts.join(', ')+' / note: '+d.getElementById('flr-note').textContent);
  setModel7('DL20 G11'); // NOT an exception — gained real OCP at G11 despite DL20 G10+ having neither
  flrOpts=flrOpts7();
  flrOpts.some(o=>/^I350-T4|^BCM5719/.test(o))
    ?pass7('DL20 G11 gained a real OCP slot (unlike DL20 G10+) — same model name, different generation, different answer')
    :fail7('DL20 G11 should offer OCP cards: '+flrOpts.join(', '));
  // a mismatched card typed/pasted/restored is still caught. FLRS entries
  // now carry real part numbers (2026-09-18), so the exact string must
  // match — bare '366FLR 4x1GbE' with no PN no longer exists in the array.
  setModel7('DL380 G11');
  flr7.value='366FLR 4x1GbE (665240-B21)';fire(flr7,'input');
  d.getElementById('checks').textContent.includes('FLEXLOM/OCP MISMATCH')
    ?pass7('a FlexibleLOM card typed directly into a G11 (OCP-only) build is flagged')
    :fail7('mismatched FLR/OCP card not caught: '+d.getElementById('checks').textContent.slice(0,200));
  flr7.value='';fire(flr7,'input');

  // --- a mismatched DDR4 speed typed/pasted/restored into a DDR5 build is
  // caught (hard stop) even though it can't be tapped from the panel any
  // more; capacity gets a softer verify, not a stop (lower confidence) ---
  setModel7('DL380 G11');pickCpu7('G6448Y');   // a 4800 MT/s Sapphire Rapids part
  dimmq7.value='4';fire(dimmq7,'input');
  dimm7.value='32GB 2933';fire(dimm7,'input');
  d.getElementById('checks').textContent.includes('MEMORY SPEED')
    ?pass7('a DDR4 speed (2933) typed into a DDR5 (Sapphire Rapids) build is flagged, not silently accepted')
    :fail7('mismatched DDR4 speed on a DDR5 build was not caught: '+d.getElementById('checks').textContent.slice(0,200));
  dimm7.value='32GB 4800';fire(dimm7,'input');
  !d.getElementById('checks').textContent.includes('MEMORY SPEED')
    ?pass7('...but the real DDR5 speed (4800) for this platform raises no note at all')
    :fail7('a real, valid speed still raised MEMORY SPEED: '+d.getElementById('checks').textContent.slice(0,200));
  dimm7.value='384GB 4800';fire(dimm7,'input');
  (d.getElementById('checks').textContent.includes('MEMORY CAPACITY') && !d.getElementById('checks').textContent.includes('MEMORY SPEED'))
    ?pass7('an unconfirmed capacity (384GB) gets a soft verify note, not a hard stop, and the valid speed stays clean')
    :fail7('unconfirmed capacity check wrong: '+d.getElementById('checks').textContent.slice(0,200));
  // per-CPU cap (2026-09-21): the 4400 MT/s Gold 5416S cannot run a 4800 module at 4800
  pickCpu7('G5416S');
  dimm7.value='32GB 4800';fire(dimm7,'input');
  (d.getElementById('checks').textContent.includes('MEMORY SPEED') && /4400 MT\/s/.test(d.getElementById('checks').textContent))
    ?pass7('G5416S (4400 max) with a 4800 module is a hard stop that names the 4400 ceiling')
    :fail7('4800 on a 4400-capped CPU not caught: '+d.getElementById('checks').textContent.slice(0,200));
  dimm7.value='32GB 4400';fire(dimm7,'input');
  !d.getElementById('checks').textContent.includes('MEMORY SPEED')
    ?pass7('...and 4400 on the same CPU is clean')
    :fail7('4400 on G5416S wrongly flagged: '+d.getElementById('checks').textContent.slice(0,200));
  dimmq7.value='';dimm7.value='';fire(dimm7,'input');

  // --- "U"-suffix (single-socket-only) Xeon SKUs blocked above 1 processor ---
  setModel7('DL360 G10+');pickCpu7('G6312U');
  d.getElementById('cpuq').value='1';fire(d.getElementById('cpuq'),'input');
  txt=d.getElementById('checks').textContent;
  !txt.includes('single-socket-only')
    ?pass7('G6312U (U-suffix) with 1 processor is not blocked')
    :fail7('U-suffix CPU wrongly blocked at qty 1: '+txt.slice(0,200));
  d.getElementById('cpuq').value='2';fire(d.getElementById('cpuq'),'input');
  txt=d.getElementById('checks').textContent;
  txt.includes('single-socket-only')
    ?pass7('G6312U (U-suffix) with 2 processors is blocked — single-socket-only SKU')
    :fail7('U-suffix 2-CPU conflict not caught: '+txt.slice(0,220));

  // --- DL560 G11's real CPU pool is a confirmed 9-SKU "H"-suffix subset of
  // sp4, not the general 2-socket-board list (2026-09-16, R.cpuAllow) ---
  setModel7('DL560 G11');ci7.value='';fire(ci7,'input');
  const dl560CpuCodes=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(el=>el.textContent);
  (dl560CpuCodes.length===9 &&
   ['P8490H','P8468H','P8460H','P8450H','P8444H','G6448H','G6434H','G6418H','G6416H'].every(c=>dl560CpuCodes.includes(c)) &&
   !dl560CpuCodes.includes('P8480+') && !dl560CpuCodes.includes('G6434') && !dl560CpuCodes.includes('P8468'))
    ?pass7('DL560 G11 CPU picker offers exactly its confirmed 9 "H"-suffix SKUs, not the general sp4 list')
    :fail7('DL560 G11 CPU list wrong: '+dl560CpuCodes.join(', '));
  d.getElementById('cpu-scope').textContent.includes('9 processors')
    ?pass7('DL560 G11 cpu-scope note reflects the narrowed 9-CPU pool')
    :fail7('DL560 G11 cpu-scope wrong: '+d.getElementById('cpu-scope').textContent);
  // a mismatched value that lands in the field some other way (typed, pasted,
  // a restored draft) is caught even though it can't be tapped from the panel
  d.getElementById('cpu').value='P8480+';fire(d.getElementById('cpu'),'input');
  d.getElementById('checks').textContent.includes('NOT SUPPORTED')
    ?pass7('DL560 G11: a non-allow-listed sp4 CPU (P8480+) typed directly in is flagged, not silently accepted')
    :fail7('DL560 G11 cpuAllow typed-value check not caught: '+d.getElementById('checks').textContent.slice(0,220));
  pickCpu7('G6416H');
  !d.getElementById('checks').textContent.includes('NOT SUPPORTED')
    ?pass7('...but a real allow-listed CPU (G6416H) raises no note at all')
    :fail7('DL560 G11 real allow-listed CPU wrongly flagged: '+d.getElementById('checks').textContent.slice(0,220));
  d.getElementById('cpu').value='';fire(d.getElementById('cpu'),'input');

  runRound8();   // chained — round 7 has no nested timers, so this is safe immediately
}

// ---- round 8: battery + SAS-expander suggestions (amber hints, not auto-fill/blocks) ----
// Chained from the end of round 7 — see the comment above runRound6().
function runRound8(){
  function pass8(m){console.log('ok    '+m);}
  function fail8(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi8=d.getElementById('model-input');
  function setModel8(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi8.value='';fire(mi8,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail8('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  const ctrl8=d.getElementById('ctrl'),bat8=d.getElementById('bat');
  // round 4's Gen9/Gen10 expander-guess tests (via the paste parser) never
  // clear #expander afterward — clean it so this round's own suggestion
  // checks (which only show while the field is blank) aren't starting
  // from that leftover value.
  d.getElementById('expander').value='';fire(d.getElementById('expander'),'input');

  // --- battery suggestion for a cached controller, left blank ---
  bat8.value='';fire(bat8,'input');
  ctrl8.value='P408i-a';fire(ctrl8,'input');
  /96W battery/.test(d.getElementById('bat-note').textContent)
    ?pass8('P408i-a (cached) with no battery entered -> suggests a 96W battery')
    :fail8('battery suggestion missing for P408i-a: "'+d.getElementById('bat-note').textContent+'"');

  // --- suggestion clears once a battery is actually entered ---
  bat8.value='96w bat';fire(bat8,'input');
  d.getElementById('bat-note').textContent===''
    ?pass8('battery suggestion clears once a battery value is entered')
    :fail8('battery suggestion still showing after a battery was entered: "'+d.getElementById('bat-note').textContent+'"');

  // --- battery is never auto-filled — only ever a suggestion ---
  bat8.value='';fire(bat8,'input');
  ctrl8.value='P408i-a';fire(ctrl8,'input');
  bat8.value===''
    ?pass8('battery field is never auto-filled from the controller (manual, by design)')
    :fail8('battery field got auto-filled: "'+bat8.value+'"');

  // --- no-cache controller with a battery entered anyway -> gently flagged ---
  ctrl8.value='H240';fire(ctrl8,'input');
  bat8.value='96w bat';fire(bat8,'input');
  /no cache/.test(d.getElementById('bat-note').textContent)
    ?pass8('H240 (no cache) + a battery entered anyway -> flagged to confirm')
    :fail8('no-cache battery flag missing: "'+d.getElementById('bat-note').textContent+'"');
  bat8.value='';fire(bat8,'input');

  // --- SAS expander: bay count vs the controller's actual port count ---
  setModel8('DL380 G10');
  d.getElementById('bays').value='16SFF';fire(d.getElementById('bays'),'input');
  ctrl8.value='P408i-a';fire(ctrl8,'input'); // 8 ports, 16 bays -> needs one
  var expTxt=d.getElementById('expander-note').textContent;
  (/727250-B21|870549-B21/.test(expTxt) && /8 ports/.test(expTxt))
    ?pass8('16 bays on an 8-port P408i-a -> suggests the gen-correct SAS expander part')
    :fail8('expander suggestion missing/wrong for P408i-a/16 bays: "'+expTxt+'"');

  // --- the Gen9 vs Gen10 part actually differs ---
  setModel8('DL380 G9');
  ctrl8.value='';fire(ctrl8,'input');ctrl8.value='P408i-a';fire(ctrl8,'input');
  const g9ExpTxt=d.getElementById('expander-note').textContent;
  /727250-B21/.test(g9ExpTxt)
    ?pass8('DL380 G9 gets the Gen9 SAS expander part number, not the Gen10 one')
    :fail8('Gen9 expander part wrong: "'+g9ExpTxt+'"');

  // --- suggestion disappears once an expander is actually entered ---
  d.getElementById('expander').value='12G SAS Expander Card (727250-B21, Gen9)';
  fire(d.getElementById('expander'),'input');
  d.getElementById('expander-note').textContent===''
    ?pass8('expander suggestion clears once an expander is entered')
    :fail8('expander suggestion still showing: "'+d.getElementById('expander-note').textContent+'"');
  d.getElementById('expander').value='';fire(d.getElementById('expander'),'input');

  // --- no port-count data for a Gen8/9 card (P440) -> the note stays generic: it still
  // points at the expander (the build does need one for 16 bays) but never invents a port count ---
  ctrl8.value='';fire(ctrl8,'input');ctrl8.value='P440';fire(ctrl8,'input');
  { const p440Txt=d.getElementById('expander-note').textContent;
    (/727250-B21/.test(p440Txt) && !/ports/.test(p440Txt) && d.getElementById('expander-note').classList.contains('suggest'))
      ?pass8('P440 (no fixed port count known): amber expander note stays generic — names the part, invents no port count')
      :fail8('P440 expander note wrong: "'+p440Txt+'"'); }
  runRound9();   // chained — round 8 has no nested timers, so this is safe immediately
}

// ---- round 9: model/CPU native <select> mirrors, select placeholder dimming, bay-config buttons ----
// Chained from the end of round 8 — see the comment above runRound6().
function runRound9(){
  function pass9(m){console.log('ok    '+m);}
  function fail9(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi9=d.getElementById('model-input'), ci9=d.getElementById('cpu-input');
  function setModel9(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi9.value='';fire(mi9,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail9('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }

  // --- model combo has a native <select> mirror again (re-added 2026-09-14,
  // after a same-day revert-of-the-revert): user's call — model's list is
  // short once a generation is picked via the G9/G10/… buttons, so a phone
  // browsing a wheel beats typing there, and there's nothing to type that
  // the gen filter wouldn't already have excluded. CPU keeps NO mirror —
  // its list still runs into the hundreds even with a model picked, where
  // typing still beats a flat wheel. ---
  const modelSel=mi9.closest('.combo').querySelector('select');
  modelSel?pass9('model combo has a native <select> mirror'):fail9('model combo is missing its native mirror');
  if(modelSel){
    fire(modelSel,'focus');
    const modelGroups=[...modelSel.querySelectorAll('optgroup')].map(g=>g.label);
    modelGroups.some(g=>g==='G9')
      ?pass9('model mirror groups options by generation (G9 group present)')
      :fail9('model mirror groups missing G9: '+modelGroups.join(', '));
    modelSel.value='DL380 G9';fire(modelSel,'change');
    (d.getElementById('model').value==='DL380 G9' && mi9.value==='DL380 G9')
      ?pass9('picking a model via the native mirror sets the field, same as the desktop panel')
      :fail9('model mirror pick did not propagate: model="'+d.getElementById('model').value+'"');
  }
  !ci9.closest('.combo').querySelector('select')
    ?pass9('CPU combo still has no native <select> mirror — its list is too big for a flat wheel')
    :fail9('CPU combo got a native mirror — its list is too big to browse without typing');
  !ci9.closest('.ac-wrap')
    ?pass9('CPU input is not wrapped in .ac-wrap — phones keep the searchable panel there')
    :fail9('CPU input is wrapped in .ac-wrap — phones would lose CPU search');

  // --- switching models via the desktop panel keeps the mirror in sync ---
  setModel9('DL360 G10');
  (d.getElementById('model').value==='DL360 G10' && modelSel.value==='DL360 G10')
    ?pass9('the model mirror select stays in sync when picking via the desktop panel too')
    :fail9('model mirror out of sync after a desktop-panel pick: sel.value="'+modelSel.value+'"');

  // --- desktop keeps typing/search on the model field regardless (the
  // mirror is phone-only via CSS; the text input + panel are still there
  // underneath for every viewport that doesn't hide them) ---
  mi9.value='DL560';fire(mi9,'input');
  const dl560Matches=[...d.querySelectorAll('#model-panel .combo-item')];
  (!d.getElementById('model-panel').hidden && dl560Matches.length>0 &&
   dl560Matches.every(el=>/dl560/i.test(el.textContent)))
    ?pass9('typing into the model field still filters the desktop panel down to matches')
    :fail9('typing into the model field did not filter the panel: '+dl560Matches.length+' items shown');
  // typing (without picking) blanks the hidden model value — same as real
  // usage, where a half-typed search shouldn't leave a stale model active.
  // Re-pick before testing the CPU field, which needs a model to be enabled.
  setModel9('DL380 G9');

  ci9.value='2680';fire(ci9,'input');
  (!d.getElementById('cpu-panel').hidden &&
   [...d.querySelectorAll('#cpu-panel .combo-item')].length>0 &&
   [...d.querySelectorAll('#cpu-panel .combo-item')].every(el=>/2680/i.test(el.textContent)))
    ?pass9('typing into the CPU field filters its panel too')
    :fail9('typing into the CPU field did not filter its panel');
  ci9.value='';fire(ci9,'input');ci9.dispatchEvent(new w.Event('blur',{bubbles:true}));

  // --- <select> "nothing chosen" option is dimmed (.ph class), same idea as input::placeholder ---
  const emptySelectRule=/select\.ph\{color:var\(--ink-soft\)\}/.test(html);
  emptySelectRule
    ?pass9('a placeholder-state <select> gets the dimmed .ph class/CSS rule')
    :fail9('select.ph dimming CSS rule not found');
  // every <select> left on the page is now a phone-only mirror (attachNativeMirror/
  // setupCombo's buildMirror) — no static <select> remains, so test one of those.
  const phSel9=d.getElementById('ctrl').closest('.ac-wrap').querySelector('select');
  phSel9.value='';fire(phSel9,'change');
  phSel9.classList.contains('ph')
    ?pass9('an empty <select> (native mirror) gets the .ph dimmed class')
    :fail9('.ph class not applied to an empty select');
  phSel9.value='P440';fire(phSel9,'change'); // P408i-a isn't offered on this G9 model post-CTRL_GENS filtering — P440 is
  !phSel9.classList.contains('ph')
    ?pass9('.ph clears once a real value is picked')
    :fail9('.ph class stuck after picking a real value');

  // --- drive speed/class/interface are now attachList combo fields, not <select> —
  // same dark #ac-panel as every other dropdown, and their own native mirror on phones ---
  d.getElementById('add-drive').click();
  const spdRows9=[...d.querySelectorAll('#drives [data-k=spd]')];
  const spdInp9=spdRows9[spdRows9.length-1];
  const spdWrap9=spdInp9.closest('.ac-wrap');
  (spdInp9.tagName==='INPUT' && spdWrap9 && spdWrap9.querySelector('select'))
    ?pass9('drive Speed is now a themed combo field (dark panel + phone-native mirror), not a plain <select>')
    :fail9('drive Speed did not convert to an attachList combo field');
  fire(spdInp9,'focus');
  const spdPanelItems=[...d.getElementById('ac-panel').querySelectorAll('.combo-item')].map(x=>x.textContent);
  spdPanelItems.includes('12G')
    ?pass9('drive Speed\'s dark combo panel offers the same list as before (6G/12G/24G/PCIe)')
    :fail9('drive Speed combo panel missing options: '+spdPanelItems.join(', '));

  // --- RAID level (capacity planner) converted the same way, for the same reason ---
  const raidInp9=d.getElementById('plan-raid');
  (raidInp9.tagName==='INPUT' && raidInp9.closest('.ac-wrap'))
    ?pass9('RAID level is now a themed combo field, not a plain <select>')
    :fail9('RAID level did not convert to an attachList combo field');
  raidInp9.value='';fire(raidInp9,'input');
  fire(raidInp9,'focus');
  const raidPanelItems=[...d.getElementById('ac-panel').querySelectorAll('.combo-item')].map(x=>x.textContent);
  raidPanelItems.includes('RAID 10')
    ?pass9('RAID level combo panel offers the same levels as before')
    :fail9('RAID level combo panel missing options: '+raidPanelItems.join(', '));
  // picking from the panel must still store the bare number the rest of the
  // tool expects (raidPlan(), the slip line) — not the display string "RAID 5"
  const raid5Item=[...d.getElementById('ac-panel').querySelectorAll('.combo-item')].find(x=>x.textContent==='RAID 5');
  raid5Item.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  setModel9('DL380 G10');
  d.getElementById('plan-cap').value='20';fire(d.getElementById('plan-cap'),'input');
  d.getElementById('bays').value='24SFF';fire(d.getElementById('bays'),'input');
  d.getElementById('plan-go').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  d.querySelectorAll('#plan-out .plan-row').length>0
    ?pass9('picking "RAID 5" from the panel still drives the drive-population planner correctly')
    :fail9('RAID level pick did not feed the planner: '+d.getElementById('plan-out').textContent.slice(0,160));
  raidInp9.value='';fire(raidInp9,'input');

  // --- themed combo text fields (attachList + model/CPU) get a chevron, like a real <select> ---
  // jsdom's CSS engine doesn't resolve real cascade/specificity, so this can
  // only check the rule exists, not that it actually wins — it does NOT catch
  // a regression back to the bare-class form, which real Chrome silently loses
  // to the shared "input[type=text]{background:var(--field)...}" rule (that's
  // a shorthand, so it resets background-image too, and an attribute+type
  // selector out-specifies a bare class regardless of source order). Checking
  // for the specificity-matched selector form specifically for that reason —
  // verify visually in a real browser (getComputedStyle) after touching this.
  const chevronRule=/input\[type=text\]\.ac-input,input\[type=text\]\.combo-input\{/.test(html);
  chevronRule
    ?pass9('attachList/combo text fields get a specificity-safe chevron CSS rule')
    :fail9('chevron rule for themed combo fields missing, or reverted to a bare class selector that a real browser would lose to the shorthand background: rule');
  d.getElementById('ctrl').classList.contains('ac-input')
    ?pass9('a live attachList field (controller) actually carries the .ac-input chevron class')
    :fail9('controller field missing .ac-input class');
  mi9.classList.contains('combo-input')
    ?pass9('the model field carries .combo-input (static class, same chevron rule)')
    :fail9('model field missing .combo-input class');

  // --- "back to top" button hidden on phones — they already have a native
  // scroll-to-top gesture, the floating button was just redundant clutter ---
  const bttMobileHideRule=/#back-to-top\{display:none !important\}/.test(html);
  const mobileBlock9=(html.match(/@media \(max-width:640px\)\{[\s\S]*?\n\}/)||[''])[0];
  (bttMobileHideRule && mobileBlock9.includes('#back-to-top{display:none !important}'))
    ?pass9('"back to top" is hidden inside the phone breakpoint, not just globally')
    :fail9('"back to top" mobile-hide rule missing or not scoped to the phone breakpoint');

  // --- bay-config quick-pick buttons, scoped to the current model's own bay list ---
  setModel9('DL380 G9');
  const bayBtnLabels=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
  (bayBtnLabels.length>0 && bayBtnLabels.includes('8SFF') && !bayBtnLabels.includes('10SFF'))
    ?pass9('bay-config buttons are scoped to this model\'s own bay list (DL380 G9: no 10SFF)')
    :fail9('bay-config buttons wrong for DL380 G9: '+bayBtnLabels.join(', '));
  const bayBtn9=[...d.querySelectorAll('#bays-btns button')].find(b=>b.textContent==='8SFF');
  bayBtn9.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  (d.getElementById('bays').value==='8SFF' && bayBtn9.classList.contains('on'))
    ?pass9('clicking a bay-config button fills the field and highlights itself')
    :fail9('bay-config button click did not fill/highlight: bays="'+d.getElementById('bays').value+'"');
  d.getElementById('bays').value='12LFF';fire(d.getElementById('bays'),'input');
  (!bayBtn9.classList.contains('on') && [...d.querySelectorAll('#bays-btns button')].find(b=>b.textContent==='12LFF').classList.contains('on'))
    ?pass9('typing a value that matches another button re-highlights that one instead')
    :fail9('bay-config highlight did not follow a typed value');
  d.getElementById('bays').value='';fire(d.getElementById('bays'),'input');

  // --- switching to a model with a different bay list rebuilds the buttons ---
  setModel9('DL560 G10');
  const dl560BayBtns=[...d.querySelectorAll('#bays-btns button')].map(b=>b.textContent);
  !dl560BayBtns.some(b=>/lff/i.test(b))
    ?pass9('bay-config buttons rebuild per model (DL560 G10: SFF only, no LFF)')
    :fail9('DL560 G10 bay buttons still show LFF: '+dl560BayBtns.join(', '));

  // --- the free-type box stays hidden until "Other" is tapped (added 2026-09-14
  // so the row doesn't show a redundant text box next to a button for every
  // real option — see the comment above renderBaysBtns() in index.html) ---
  const baysInp9=d.getElementById('bays'),otherBtn9=d.getElementById('bays-other-btn');
  (baysInp9.hidden && !otherBtn9.classList.contains('on'))
    ?pass9('bay free-type box starts hidden with nothing entered and "Other" not tapped')
    :fail9('bay free-type box should start hidden: hidden='+baysInp9.hidden);
  otherBtn9.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  (!baysInp9.hidden && otherBtn9.classList.contains('on') && baysInp9.value==='')
    ?pass9('tapping "Other" reveals the free-type box, empty, and highlights itself')
    :fail9('Other tap did not reveal the box: hidden='+baysInp9.hidden+' on='+otherBtn9.classList.contains('on')+' value="'+baysInp9.value+'"');
  baysInp9.value='6LFF+2SFF custom';fire(baysInp9,'input');
  (!baysInp9.hidden && otherBtn9.classList.contains('on') &&
   ![...d.querySelectorAll('#bays-btns button[data-b]')].some(b=>b.classList.contains('on')))
    ?pass9('typing an off-list value keeps the box open under "Other", no preset button lit')
    :fail9('off-list typed value did not keep the box open under "Other"');
  baysInp9.value='8SFF';fire(baysInp9,'input');
  const sffBtn9=[...d.querySelectorAll('#bays-btns button[data-b]')].find(b=>b.getAttribute('data-b')==='8SFF');
  (baysInp9.hidden && !otherBtn9.classList.contains('on') && sffBtn9.classList.contains('on'))
    ?pass9('typing a value that matches a listed preset collapses back out of "Other" mode')
    :fail9('matching-preset typed value did not collapse the Other box');
  baysInp9.value='36 EDSFF custom';fire(baysInp9,'input');
  !baysInp9.hidden
    ?pass9('an off-list value landed any other way (e.g. paste-fill) still reveals the box, without tapping "Other" first')
    :fail9('off-list value via direct fill did not reveal the box');
  baysInp9.value='';fire(baysInp9,'input');
  !baysInp9.hidden
    ?pass9('clearing the typed text while still focused keeps the box open (does not vanish mid-edit)')
    :fail9('box collapsed while the field was still being cleared/edited');
  baysInp9.dispatchEvent(new w.Event('blur',{bubbles:true}));
  setTimeout(()=>{
    (baysInp9.hidden && !otherBtn9.classList.contains('on'))
      ?pass9('blurring an abandoned empty "Other" box collapses it back to buttons-only')
      :fail9('empty Other box did not auto-collapse on blur');
    runRound10();   // chained — see the comment above runRound6()
  },260);
}

// ---- round 10: per-model data sanity — the model/CPU/riser tables themselves ----
// Chained from the end of round 9 — see the comment above runRound6().
// The rule data lives inside the page's IIFE, so these pull the array
// literals straight out of the source text and eval them. That's the only
// way to check the DATA (rather than one model's rendering) from here.
function runRound10(){
  function pass10(m){console.log('ok    '+m);}
  function fail10(m){console.log('FAIL  '+m);process.exitCode=1;}
  function grab(name){
    const start=html.indexOf('var '+name+'=');
    if(start<0)return null;
    let i=html.indexOf('=',start)+1;
    while(' \n\r\t'.includes(html[i]))i++;
    const open=html[i], close=open==='['?']':'}';
    let depth=0,q=null,esc=false,j=i;
    for(;j<html.length;j++){
      const c=html[j];
      if(esc){esc=false;continue;}
      if(q){ if(c==='\\')esc=true; else if(c===q)q=null; continue; }
      if(c==='\''||c==='"'){q=c;continue;}
      if(c==='/'&&html[j+1]==='*'){ j=html.indexOf('*/',j)+1; continue; }
      if(c==='/'&&html[j+1]==='/'){ j=html.indexOf('\n',j)-1; continue; }
      if(c===open)depth++;
      else if(c===close){depth--; if(!depth){j++;break;}}
    }
    try{ return eval(DATA_PRELUDE+'('+html.slice(i,j)+')'); }catch(e){ return null; }
  }
  const MODELS=grab('MODELS'), CPUS=grab('CPUS'), RISERS=grab('RISERS'),
        GEN_DEFAULTS=grab('GEN_DEFAULTS'), PLATFORM_LABELS=grab('PLATFORM_LABELS'),
        MEM_PER_SOCKET=grab('MEM_PER_SOCKET');
  if(!MODELS||!CPUS||!RISERS||!GEN_DEFAULTS){
    return fail10('could not read the data tables out of index.html — did the "var NAME=[...]" shape change?');
  }
  const rulesFor=m=>{
    const d0=GEN_DEFAULTS[m.g]||{},own=m.rules||{},out={};
    Object.keys(d0).forEach(k=>out[k]=d0[k]);
    Object.keys(own).forEach(k=>out[k]=own[k]);
    return out;
  };
  const bad=[];
  const note=(k,msg)=>bad.push(k+': '+msg);

  const seen={};
  MODELS.forEach(m=>{
    const key=m.m+' '+m.g, R=rulesFor(m);
    if(seen[key])note(key,'duplicate model entry');
    seen[key]=1;
    if(!m.p||!m.p.length)note(key,'no processor platforms');
    (m.p||[]).forEach(p=>{
      if(!PLATFORM_LABELS[p])note(key,'platform "'+p+'" has no PLATFORM_LABELS entry');
      if(!MEM_PER_SOCKET[p])note(key,'platform "'+p+'" has no MEM_PER_SOCKET entry');
    });
    if(m.d%m.s)note(key,m.d+' DIMM slots does not divide by '+m.s+' sockets');
    if(R.validCounts&&R.validCounts.some(n=>n>m.s||n<1))
      note(key,'validCounts ['+R.validCounts+'] outside 1..'+m.s);
    if(m.s>1&&R.fans&&R.fans.one!=null&&R.fans.two==null)
      note(key,'multi-socket but fans.one with no fans.two');
    // bayCapacity() reads /(\d{1,2})\s*(LFF|SFF)/ — anything else silently counts as 0 bays
    (m.bays||[]).forEach(b=>{
      if(!/^\d{1,2}\s*(ED)?(LFF|SFF)$/i.test(b))note(key,'bay string "'+b+'" is not a shape bayCapacity() can read');
    });
    if(R.rear2SFF&&m.bays){
      const miss=R.rear2SFF.filter(b=>m.bays.indexOf(b)<0);
      if(miss.length)note(key,'rear2SFF names bays it does not offer: '+miss.join(', '));
    }
    // a rear option that parses to no signature can never match the allow-list
    (R.rear||[]).forEach(o=>{
      let n=0;
      String(o).toLowerCase().split('+').forEach(cl=>{
        const mid=/mid[\s-]?tray|midtray|\bmid\b/.test(cl);
        const re=/(\d+)?\s*x?\s*(sff|lff|uff|m\.?2)\b/g;let mm,found=false;
        while((mm=re.exec(cl))){found=true;n++;}
        if(!found&&mid)n++;
      });
      if(!n)note(key,'rear option "'+o+'" parses to no signature (rule is dead)');
    });
    ['hsStdException','hsSku'].forEach(k=>{
      (R[k]||[]).forEach(code=>{
        if(!CPUS.some(c=>c[0]===code))note(key,k+' names "'+code+'", which is not in CPUS');
      });
    });
    if(R.psuMax!=null&&(R.psuMax<1||R.psuMax>8))note(key,'psuMax '+R.psuMax+' looks wrong');   // 8 = DL380a Gen12 (M-CRPS, 8 supplies for 8/10 double-wide GPUs)
    if(R.hsW&&R.fanW&&R.fanW<R.hsW)note(key,'fanW '+R.fanW+' below hsW '+R.hsW);
    const rk=RISERS[key];
    if(rk){
      if(R.riserMax===0)note(key,'riserMax 0 but it has riser kits');
      rk.forEach(k=>{
        if(k.cpu2&&m.s<2)note(key,'riser kit "'+k.n+'" needs CPU 2 on a 1-socket board');
        if(typeof k.s!=='number')note(key,'riser kit "'+k.n+'" has no slot count');
      });
      const pos={};rk.forEach(k=>{if(k.pos&&k.pos!=='any')pos[k.pos]=1;});
      if(typeof R.riserMax==='number'&&Object.keys(pos).length>R.riserMax)
        note(key,Object.keys(pos).length+' riser positions but riserMax '+R.riserMax);
      const dp={};rk.filter(k=>k.def).forEach(k=>{if(dp[k.pos])note(key,'two default risers for '+k.pos);dp[k.pos]=1;});
    }
  });
  const cpuSeen={};
  CPUS.forEach(c=>{
    if(cpuSeen[c[0]])note('CPUS','duplicate code '+c[0]);
    cpuSeen[c[0]]=1;
    if(!PLATFORM_LABELS[c[2]])note('CPUS',c[0]+' is on unknown platform '+c[2]);
    if(!(c[3]>0&&c[3]<1000))note('CPUS',c[0]+' has an odd TDP: '+c[3]);
    if(!(c[4]>0&&c[4]<=256))note('CPUS',c[0]+' has an odd core count: '+c[4]);
  });

  bad.length===0
    ?pass10('model/CPU/riser data is internally consistent across all '+MODELS.length+' models')
    :fail10('data inconsistencies ('+bad.length+'):\n      '+bad.join('\n      '));

  // --- a model whose platform has no seeded CPUs says so, instead of just
  // handing the trader an empty picker it is impossible to satisfy ---
  const mi10=d.getElementById('model-input');
  function setModel10(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi10.value='';fire(mi10,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.querySelector('.ci-main').textContent.trim()===label);
    if(!opt)return fail10('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  const unseeded=MODELS.filter(m=>!CPUS.some(c=>(m.p||[]).indexOf(c[2])>-1)).map(m=>m.m+' '+m.g);
  if(unseeded.length){
    setModel10(unseeded[0]);
    d.getElementById('checks').textContent.includes('no processors loaded in this tool yet')
      ?pass10(unseeded.length+' model(s) have no seeded processors ('+unseeded[0]+'…) and the sheet says so plainly')
      :fail10('a model with zero seeded processors gave no warning: '+unseeded[0]);
  }else{
    pass10('every model has at least one seeded processor');
  }

  // --- a front-bay config the model does not offer is flagged (the rear
  // field has always had this check; the front field had none) ---
  setModel10('DL360 G10');   // 1U: 4LFF / 8SFF / 10SFF, definitely not 24SFF
  d.getElementById('bays').value='24SFF';fire(d.getElementById('bays'),'input');
  d.getElementById('checks').textContent.includes('not a front-bay config listed for DL360 G10')
    ?pass10('a front-bay config this chassis does not offer is flagged')
    :fail10('24SFF on a DL360 G10 passed without comment');
  d.getElementById('bays').value='8SFF';fire(d.getElementById('bays'),'input');
  !d.getElementById('checks').textContent.includes('not a front-bay config listed')
    ?pass10('...and a listed one is not flagged')
    :fail10('8SFF on a DL360 G10 was wrongly flagged');
  d.getElementById('bays').value='';fire(d.getElementById('bays'),'input');

  // --- the drive capacity picker is in size order ---
  {
    const capInp=d.querySelector('#drives [data-k=cap]');
    fire(capInp,'focus');
    const shown=[...d.getElementById('ac-panel').querySelectorAll('.combo-item')].map(x=>x.textContent);
    const tb=s=>/TB/i.test(s)?parseFloat(s):parseFloat(s)/1000;
    const outOfOrder=shown.filter((s,i)=>i&&tb(s)<tb(shown[i-1]));
    (shown.length>10&&!outOfOrder.length)
      ?pass10('drive capacity list is in size order ('+shown[0]+' … '+shown[shown.length-1]+')')
      :fail10('capacity list out of order at: '+outOfOrder.join(', '));
  }
  runRound11();   // chained — round 10 has no nested timers
}

// ---- round 11: Gen12 (Intel Xeon 6) QuickSpecs verification, 2026-09-14 ----
// Chained from the end of round 10 — see the comment above runRound6().
// Sourced from each model's own QuickSpecs (DL110's wouldn't download from
// any mirror tried — left flagged rather than guessed at). See PROJECT.md
// "Verification status" and the memory notes for the source docs.
function runRound11(){
  function pass11(m){console.log('ok    '+m);}
  function fail11(m){console.log('FAIL  '+m);process.exitCode=1;}
  function grab(name){
    const start=html.indexOf('var '+name+'=');
    if(start<0)return null;
    let i=html.indexOf('=',start)+1;
    while(' \n\r\t'.includes(html[i]))i++;
    const open=html[i], close=open==='['?']':'}';
    let depth=0,q=null,esc=false,j=i;
    for(;j<html.length;j++){
      const c=html[j];
      if(esc){esc=false;continue;}
      if(q){ if(c==='\\')esc=true; else if(c===q)q=null; continue; }
      if(c==='\''||c==='"'){q=c;continue;}
      if(c==='/'&&html[j+1]==='*'){ j=html.indexOf('*/',j)+1; continue; }
      if(c==='/'&&html[j+1]==='/'){ j=html.indexOf('\n',j)-1; continue; }
      if(c===open)depth++;
      else if(c===close){depth--; if(!depth){j++;break;}}
    }
    try{ return eval(DATA_PRELUDE+'('+html.slice(i,j)+')'); }catch(e){ return null; }
  }
  const MODELS=grab('MODELS'), CPUS=grab('CPUS'), MEM_PER_SOCKET=grab('MEM_PER_SOCKET'),
        GEN_DEFAULTS=grab('GEN_DEFAULTS');
  if(!MODELS||!CPUS||!MEM_PER_SOCKET||!GEN_DEFAULTS)return fail11('could not re-read the data tables for round 11');
  const rulesFor11=m=>{
    const d0=GEN_DEFAULTS[m.g]||{},own=m.rules||{},out={};
    Object.keys(d0).forEach(k=>out[k]=d0[k]);
    Object.keys(own).forEach(k=>out[k]=own[k]);
    return out;
  };

  const g12=MODELS.filter(m=>m.g==='G12');
  g12.length===8
    ?pass11('all 8 Gen12 models are present (DL110/320/340/360/380/380a/580, ML350)')
    :fail11('expected 8 Gen12 models, found '+g12.length+': '+g12.map(m=>m.m).join(', '));

  const xeon6=CPUS.filter(c=>c[2]==='xeon6');
  xeon6.length>=30
    ?pass11('xeon6 CPU list is seeded ('+xeon6.length+' SKUs) — the picker is no longer empty')
    :fail11('xeon6 CPU list looks unseeded: only '+xeon6.length+' entries');
  xeon6.some(c=>c[0]==='6716P-B')
    ?pass11('DL110 G12’s fixed SoC (6716P-B) is in the list so its picker has something to select')
    :fail11('6716P-B (DL110 G12’s fixed SoC) missing from CPUS');

  // regression guard: 8TB is the DL380's TOTAL (2-socket) capacity, i.e.
  // 4096/socket, not 8192 — this was wrong before the 2026-09-14 audit fixed it
  MEM_PER_SOCKET.xeon6===4096
    ?pass11('MEM_PER_SOCKET.xeon6 is 4096 (per-socket), not the old wrong 8192 (that was the 2-socket total)')
    :fail11('MEM_PER_SOCKET.xeon6 is '+MEM_PER_SOCKET.xeon6+', expected 4096');

  // regression guard: the old hardcoded "no processors seeded" check must be
  // gone now that xeon6 actually has CPUs — it fired unconditionally for
  // EVERY xeon6 model regardless of whether any were seeded
  !/No processors are seeded for Gen12 yet/.test(html)
    ?pass11('the old unconditional "no processors seeded" check was removed (now inaccurate)')
    :fail11('stale hardcoded Gen12 CPU warning is still in the source');

  const mi11=d.getElementById('model-input');
  function setModel11(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi11.value='';fire(mi11,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.querySelector('.ci-main').textContent.trim()===label);
    if(!opt)return fail11('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }

  // --- DL580 G12: field-upgradeable 2->4 sockets only, no 1 or 3 ---
  setModel11('DL580 G12');
  const dl580Counts=[...d.querySelectorAll('#cpuq-btns button')].map(b=>b.getAttribute('data-n'));
  JSON.stringify(dl580Counts)===JSON.stringify(['2','4'])
    ?pass11('DL580 G12 offers only 2 or 4 processors (field-upgrade only, no 1P/3P)')
    :fail11('DL580 G12 processor-count buttons: '+dl580Counts.join(','));

  // --- DL380 G12: 3 riser positions ---
  setModel11('DL380 G12');
  const dl380RiserNote=d.getElementById('riser-note').textContent;
  dl380RiserNote.includes('3 riser position')
    ?pass11('DL380 G12 states 3 riser positions')
    :fail11('DL380 G12 riser-position note missing/wrong: "'+dl380RiserNote+'"');
  // 4 NAMED riser lines should trip the riserMax=3 check (an empty line
  // doesn't count — readLines(...).filter(x=>x.name) skips it)
  for(let i=0;i<4;i++){
    d.getElementById('add-riser').click();
    const rows=[...d.querySelectorAll('#risers [data-k=name]')];
    const last=rows[rows.length-1];
    last.value='Riser line '+i;fire(last,'input');
  }
  const dl380Checks=d.getElementById('checks').textContent;
  dl380Checks.includes('TOO MANY RISERS')
    ?pass11('DL380 G12 blocks more than 3 riser lines')
    :fail11('DL380 G12 did not block 4 named riser lines: '+dl380Checks.slice(0,200));
  [...d.querySelectorAll('#risers .kill')].forEach(k=>k.click());

  // --- DL360 G12: 5/7 fan split (data-level — fanq.max is always
  // Math.max(one,two,perf) regardless of the current CPU count by design,
  // and the live auto-fill value depends on `fanTouched`, which earlier
  // rounds may have already flipped; the {one,two,perf} shape itself is
  // what's actually being verified against QuickSpecs here) ---
  {
    const dl360=MODELS.find(m=>m.m==='DL360'&&m.g==='G12');
    const R360=dl360&&rulesFor11(dl360);
    (R360&&R360.fans&&R360.fans.one===5&&R360.fans.two===7&&R360.fans.perf===7)
      ?pass11('DL360 G12 fan rule is {one:5,two:7,perf:7} per its own QuickSpecs')
      :fail11('DL360 G12 fans rule: '+JSON.stringify(R360&&R360.fans));
  }

  // --- ML350 G12: 225W heatsink threshold, P-core Xeon 6 ---
  setModel11('ML350 G12');
  const ml350Sys=d.getElementById('sys-note').textContent;
  ml350Sys==='2 sockets, 32 DIMM slots'
    ?pass11('ML350 G12 sockets/DIMM slots match its own QuickSpecs (2 sockets, 32 DIMM)')
    :fail11('ML350 G12 sys-note: "'+ml350Sys+'"');

  // --- DL320 G12: two M-CRPS PSU bays (V20 rear view: 60mm Power Supply Slot 1 + Slot 2) — the old single-bay reading was wrong ---
  setModel11('DL320 G12');
  const dl320PsuMax=d.getElementById('psuq').getAttribute('max');
  dl320PsuMax==='2'
    ?pass11('DL320 G12 takes 2 power supplies (two M-CRPS bays)')
    :fail11('DL320 G12 PSU cap: '+dl320PsuMax+' (expected 2)');

  // --- DL110 G12: fixed-SoC note actually reaches the checks panel ---
  setModel11('DL110 G12');
  const dl110Checks=d.getElementById('checks').textContent;
  /fixed SoC/i.test(dl110Checks)
    ?pass11('DL110 G12 states its fixed-SoC note (not a socketed, swappable processor)')
    :fail11('DL110 G12 fixed-SoC note missing: '+dl110Checks.slice(0,300));

  // --- G12 gaps sourced 2026-09-16: DL380a/DL580 fan+heatsink, DL110 PSU/fan/riser/bay/OCP ---
  {
    const dl380a=MODELS.find(m=>m.m==='DL380a'&&m.g==='G12');
    const R380a=dl380a&&rulesFor11(dl380a);
    (R380a&&R380a.fans&&R380a.fans.one===4&&R380a.fans.two===4&&R380a.hsNoChoice===true&&
     R380a.validCounts&&R380a.validCounts.length===1&&R380a.validCounts[0]===2)
      ?pass11('DL380a G12: fixed 4-fan assemblies, hsNoChoice heatsink, dual-processor-only validCounts')
      :fail11('DL380a G12 rules: fans='+JSON.stringify(R380a&&R380a.fans)+' hsNoChoice='+(R380a&&R380a.hsNoChoice)+' validCounts='+JSON.stringify(R380a&&R380a.validCounts));
  }
  setModel11('DL380a G12');
  const dl380aCounts=[...d.querySelectorAll('#cpuq-btns button')].map(b=>b.getAttribute('data-n'));
  JSON.stringify(dl380aCounts)===JSON.stringify(['2'])
    ?pass11('DL380a G12 offers only 2 processors (dual-processor-only, no 1P)')
    :fail11('DL380a G12 processor-count buttons: '+dl380aCounts.join(','));

  {
    const dl580g12=MODELS.find(m=>m.m==='DL580'&&m.g==='G12');
    const R580g12=dl580g12&&rulesFor11(dl580g12);
    (R580g12&&R580g12.psuMax===4&&R580g12.hsSku&&R580g12.hsSku.length===7&&R580g12.hsSku.indexOf('6748P')>-1)
      ?pass11('DL580 G12: psuMax corrected to 4 (true physical bay count), hsSku lists all 7 confirmed CPUs')
      :fail11('DL580 G12 rules: psuMax='+(R580g12&&R580g12.psuMax)+' hsSku='+JSON.stringify(R580g12&&R580g12.hsSku));
  }

  setModel11('DL110 G12');
  const dl110Sys=d.getElementById('sys-note').textContent;
  dl110Sys==='1 socket, 4 DIMM slots'
    ?pass11('DL110 G12 sys-note reflects the corrected 4 DIMM slots (was wrongly 16)')
    :fail11('DL110 G12 sys-note: "'+dl110Sys+'"');
  {
    const dl110g12=MODELS.find(m=>m.m==='DL110'&&m.g==='G12');
    const R110g12=dl110g12&&rulesFor11(dl110g12);
    (R110g12&&R110g12.fans&&R110g12.fans.one===8&&R110g12.pcie&&R110g12.pcie.one===2)
      ?pass11('DL110 G12 fan count (8) and PCIe slot count (2) sourced from its own Data Sheet')
      :fail11('DL110 G12 rules: fans='+JSON.stringify(R110g12&&R110g12.fans)+' pcie='+JSON.stringify(R110g12&&R110g12.pcie));
  }
  runRound12();   // chained — round 11 has no nested timers of its own
}

// ---- round 12: PCIe slot count/width (FH vs LP) + real riser-kit lists,
// per model per its own QuickSpecs — a new axis started 2026-09-16. Most
// models still fall back to GENERIC_RISERS (a placeholder, not real data);
// this round guards the models that have gotten their own RISERS[] entry
// so far. See PROJECT.md for the running list of what's done vs open. ----
function runRound12(){
  function pass12(m){console.log('ok    '+m);}
  function fail12(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi12=d.getElementById('model-input');
  function setModel12(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi12.value='';fire(mi12,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail12('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function riserOpts12(){
    d.getElementById('risers').innerHTML='';
    d.getElementById('add-riser').click();
    const ri=d.querySelector('#risers [data-k=name]');
    ri.dispatchEvent(new w.Event('focus'));
    return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(el=>el.textContent);
  }

  // --- DL360 G11: Primary ships 1 FH + 1 LP slot; Secondary comes in two
  // mutually-exclusive kits (LP variant keeps Slot 2, FH variant disables it) ---
  setModel12('DL360 G11');
  let opts12=riserOpts12();
  (opts12.some(o=>/Default Primary Riser/.test(o)&&/FH \+ Slot 2 LP/.test(o)) &&
   opts12.some(o=>/LP Riser Kit.*P48903-B21/.test(o)) &&
   opts12.some(o=>/Full Height Riser Kit.*P48901-B21/.test(o)))
    ?pass12('DL360 G11: real riser kits offered (default FH+LP primary, LP and FH secondary variants), not the generic placeholder list')
    :fail12('DL360 G11 riser panel wrong: '+opts12.join(' | '));

  // --- DL380 G11: every slot on every riser is full-height — no LP at all ---
  setModel12('DL380 G11');
  opts12=riserOpts12();
  (opts12.length===6 && opts12.some(o=>/P48803-B21/.test(o)) && opts12.some(o=>/P48802-B21/.test(o)) &&
   opts12.some(o=>/Tertiary Riser Kit \(P48804-B21\)/.test(o)))
    ?pass12('DL380 G11: real 6-option riser list (primary/secondary default+upgrade, tertiary+FIO kit)')
    :fail12('DL380 G11 riser panel wrong: '+opts12.join(' | '));

  // --- DL320 G11: 2 real riser positions (Primary standard, Secondary
  // optional kit), not the generic 3-position placeholder ---
  setModel12('DL320 G11');
  opts12=riserOpts12();
  (opts12.length===2 && opts12.some(o=>/Primary Riser \(Slot 1/.test(o)) && opts12.some(o=>/P52753-B21/.test(o)))
    ?pass12('DL320 G11: real 2-option riser list (Primary standard, Secondary optional kit)')
    :fail12('DL320 G11 riser panel wrong: '+opts12.join(' | '));

  // --- G12 rack shares its riser platform with the matching G11 chassis —
  // DL360/DL380 G12 reuse (or closely mirror) the G11 part numbers ---
  setModel12('DL360 G12');
  opts12=riserOpts12();
  (opts12.some(o=>/Default Primary Riser/.test(o)&&/FH \+ Slot 2 LP/.test(o)) &&
   opts12.some(o=>/P48903-B21, shared with DL360 G11/.test(o)) &&
   opts12.some(o=>/P72598-B21/.test(o)))
    ?pass12('DL360 G12: real riser kits offered — same FH-disables-Slot2 tradeoff as G11, new G12-specific FH part number')
    :fail12('DL360 G12 riser panel wrong: '+opts12.join(' | '));

  setModel12('DL380 G12');
  opts12=riserOpts12();
  (opts12.length===6 && opts12.some(o=>/shared with DL380 G11/.test(o)) && opts12.some(o=>/P76451-B21/.test(o)) && opts12.some(o=>/P74737-B21/.test(o)))
    ?pass12('DL380 G12: real 6-option riser list, reusing G11 primary/secondary part numbers plus new G12 tertiary kits')
    :fail12('DL380 G12 riser panel wrong: '+opts12.join(' | '));

  setModel12('DL320 G12');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/P71430-B21/.test(o)) && opts12.some(o=>/P72152-B21/.test(o)) && opts12.some(o=>/P77555-B21/.test(o)))
    ?pass12('DL320 G12: real 3-option riser list (Primary/Secondary kits + the NS204i-t boot-controller riser), no factory default (unlike DL320 G11)')
    :fail12('DL320 G12 riser panel wrong: '+opts12.join(' | '));

  setModel12('DL340 G12');
  opts12=riserOpts12();
  (opts12.length===4 && ['P71430-B21','P75014-B21','P75818-B21','P74368-B21'].every(pn=>opts12.some(o=>o.indexOf(pn)>-1)))
    ?pass12('DL340 G12: 4-option riser list per V15 (Primary Slot 3, Secondary Slot 6, Rear Captive, NEBS), no factory default')
    :fail12('DL340 G12 riser panel wrong: '+opts12.join(' | '));

  // --- DL20/DL110 G11: single-socket entry rack, real per-model riser kits ---
  setModel12('DL20 G11');
  opts12=riserOpts12();
  (opts12.length===1 && opts12.some(o=>/Primary Riser \(Slot 1/.test(o)))
    ?pass12('DL20 G11: real 1-slot riser list (no fabricated 2nd slot from the DL320 copy-paste artifact)')
    :fail12('DL20 G11 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL110 G11');
  opts12=riserOpts12();
  (opts12.length===2 && opts12.some(o=>/Slots 1-2/.test(o)) && opts12.some(o=>/P54288-B21/.test(o)))
    ?pass12('DL110 G11: real 2-option riser list (2-slot default primary + optional secondary kit)')
    :fail12('DL110 G11 riser panel wrong: '+opts12.join(' | '));

  // --- ML350 G11: CORRECTED 2026-09-17 — was wrongly riserMax:0 ("PCIe on
  // the system board"), self-flagged as unchecked; it genuinely has 3 real
  // riser positions, identical structure to ML350 G12 ---
  setModel12('ML350 G11');
  (!d.getElementById('add-riser').hidden)
    ?pass12('ML350 G11: riser section now shown (was wrongly hidden — riserMax corrected 0->3)')
    :fail12('ML350 G11 riser section still hidden');
  opts12=riserOpts12();
  (opts12.length===5 && opts12.some(o=>/Default Primary Riser \(4x8/.test(o)) && opts12.some(o=>/Tertiary Riser Kit/.test(o)))
    ?pass12('ML350 G11: real 5-option riser list (Primary/Secondary default+FIO, Tertiary), matching ML350 G12\'s shared platform')
    :fail12('ML350 G11 riser panel wrong: '+opts12.join(' | '));
  setModel12('ML350 G12');
  opts12=riserOpts12();
  (opts12.length===5 && opts12.some(o=>/Tertiary Riser Kit/.test(o)))
    ?pass12('ML350 G12: real 5-option riser list, same shared platform as ML350 G11')
    :fail12('ML350 G12 riser panel wrong: '+opts12.join(' | '));

  // --- ML110 G11: 2 real riser cages are both GPU Riser Kits (the 2
  // default PCIe slots are on the system board, not a riser, per its
  // own doc's "Default Slots" vs "Optional GPU Riser Kit" distinction) ---
  setModel12('ML110 G11');
  opts12=riserOpts12();
  (opts12.length===2 && opts12.some(o=>/P53487-B21/.test(o)) && opts12.some(o=>/P53488-B21/.test(o)))
    ?pass12('ML110 G11: real 2-option riser list (both GPU Riser Kits), not the generic placeholder')
    :fail12('ML110 G11 riser panel wrong: '+opts12.join(' | '));

  // --- DL580 G12: single shared riser kit type, up to 6 cages ---
  setModel12('DL580 G12');
  opts12=riserOpts12();
  (opts12.length===1 && opts12.some(o=>/P80379-B21/.test(o)))
    ?pass12('DL580 G12: single real riser kit type offered (P80379-B21), not the generic placeholder list')
    :fail12('DL580 G12 riser panel wrong: '+opts12.join(' | '));

  // --- DL360/DL380 G10+: same chassis lineage's riser patterns already
  // exist one generation earlier than G11 ---
  setModel12('DL360 G10+');
  opts12=riserOpts12();
  (opts12.some(o=>/Default Primary Riser/.test(o)&&/FH \+ Slot 2 LP/.test(o)) &&
   opts12.some(o=>/P26471-B21/.test(o)) && opts12.some(o=>/P26467-B21/.test(o)))
    ?pass12('DL360 G10+: real riser kits offered — the FH-disables-Slot2 tradeoff already exists at G10+, one gen before G11')
    :fail12('DL360 G10+ riser panel wrong: '+opts12.join(' | '));
  setModel12('DL380 G10+');
  opts12=riserOpts12();
  (opts12.length===4 && opts12.some(o=>/Default Primary Riser/.test(o)) && opts12.some(o=>/P14588-B21/.test(o)))
    ?pass12('DL380 G10+: real riser list (default primary/secondary/tertiary + tertiary upgrade)')
    :fail12('DL380 G10+ riser panel wrong: '+opts12.join(' | '));

  // --- DL325/DL325v2/DL345/DL365/DL385/DL385v2 G10+: AMD rack riser data ---
  setModel12('DL325 G10+');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/P17264-B21/.test(o)) && opts12.some(o=>/P20421-B21/.test(o)))
    ?pass12('DL325 G10+: real 3-option riser list (default primary + 2 secondary variants)')
    :fail12('DL325 G10+ riser panel wrong: '+opts12.join(' | '));
  setModel12('DL325 G10+ v2');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/P17264-B21/.test(o)))
    ?pass12('DL325 G10+ v2: same riser platform/part numbers as v1')
    :fail12('DL325 G10+ v2 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL345 G10+');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/Slots 1-2/.test(o)) && opts12.some(o=>/P38641-B21/.test(o)))
    ?pass12('DL345 G10+: real 3-option riser list (default primary + secondary default/x16 variant)')
    :fail12('DL345 G10+ riser panel wrong: '+opts12.join(' | '));
  setModel12('DL365 G10+');
  opts12=riserOpts12();
  (opts12.some(o=>/Default Primary Riser/.test(o)&&/FH \+ Slot 2 LP/.test(o)) &&
   opts12.some(o=>/P26471-B21/.test(o)) && opts12.some(o=>/Secondary GPU Riser \(Full Height\)/.test(o)))
    ?pass12('DL365 G10+: same DL36X FH-disables-Slot2 riser tradeoff as DL360 G10+')
    :fail12('DL365 G10+ riser panel wrong: '+opts12.join(' | '));
  setModel12('DL385 G10+');
  opts12=riserOpts12();
  (opts12.length===4 && opts12.some(o=>/P14588-B21/.test(o)) && opts12.some(o=>/P14581-B21/.test(o)))
    ?pass12('DL385 G10+: real riser list, same DL38X platform as DL380 G10+ (both real tertiary kits, no free default)')
    :fail12('DL385 G10+ riser panel wrong: '+opts12.join(' | '));
  setModel12('DL385 G10+ v2');
  opts12=riserOpts12();
  (opts12.length===4 && opts12.some(o=>/P14588-B21/.test(o)))
    ?pass12('DL385 G10+ v2: same riser platform/part numbers as v1')
    :fail12('DL385 G10+ v2 riser panel wrong: '+opts12.join(' | '));

  // --- G10 rack (Intel + AMD): DL20/DL160/DL180/DL325/DL385 ---
  setModel12('DL20 G10');
  opts12=riserOpts12();
  (opts12.length===2 && opts12.some(o=>/P09145-B21/.test(o)) && opts12.some(o=>/P06667-B21/.test(o)))
    ?pass12('DL20 G10: real 2-option riser list (LP riser vs FlexibleLOM riser)')
    :fail12('DL20 G10 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL160 G10');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/866432-B21/.test(o)) && opts12.some(o=>/866436-B21/.test(o)))
    ?pass12('DL160 G10: real 3-option riser list (CPU1 default/FlexLOM + CPU2 kit)')
    :fail12('DL160 G10 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL180 G10');
  opts12=riserOpts12();
  (opts12.length===4 && opts12.some(o=>/878484-B21/.test(o)) && opts12.some(o=>/866945-B21/.test(o)))
    ?pass12('DL180 G10: real 4-option riser list (previously had no pcie/riserMax at all)')
    :fail12('DL180 G10 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL325 G10');
  opts12=riserOpts12();
  (opts12.length===2 && opts12.some(o=>/P04849-B21/.test(o)))
    ?pass12('DL325 G10: real 2-option riser list (default primary + secondary LP kit)')
    :fail12('DL325 G10 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL385 G10');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/870548-B21/.test(o)) && opts12.some(o=>/Tertiary Riser Kit/.test(o)))
    ?pass12('DL385 G10: real 3-option riser list, including the Tertiary position DL380 G10\'s own entry lacks')
    :fail12('DL385 G10 riser panel wrong: '+opts12.join(' | '));

  // --- DL360/DL380 G9: closes out every rack generation (G9-G12) for
  // this axis. DL360 G9 confirms the FH-disables-LP-slot tradeoff already
  // existed at G9, now seen across all 4 generations on this chassis. ---
  setModel12('DL360 G9');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/764642-B21/.test(o)) && opts12.some(o=>/764644-B21/.test(o)))
    ?pass12('DL360 G9: real riser kits offered — the FH-disables-Slot2 tradeoff already existed at G9')
    :fail12('DL360 G9 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL380 G9');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/719073-B21/.test(o)) && opts12.some(o=>/719076-B21/.test(o)))
    ?pass12('DL380 G9: real 3-option riser list (default primary + 2 secondary variants)')
    :fail12('DL380 G9 riser panel wrong: '+opts12.join(' | '));

  // --- G10+ entry-level rack (last gap in G10/G10+, the current
  // bread-and-butter tier): DL110 G10+ and DL20 G10+ ---
  setModel12('DL110 G10+');
  opts12=riserOpts12();
  (opts12.length===2 && opts12.some(o=>/P41827.*P41828-B21|P41828.*P41827-B21/.test(o)))
    ?pass12('DL110 G10+: real 2-option riser list (Primary default + Secondary field/FIO kit)')
    :fail12('DL110 G10+ riser panel wrong: '+opts12.join(' | '));
  setModel12('DL20 G10+');
  opts12=riserOpts12();
  (opts12.length===2 && opts12.some(o=>/P46114-B21/.test(o)) && opts12.some(o=>/P45433-B21/.test(o)))
    ?pass12('DL20 G10+: real 2-option riser list (LP FIO riser default vs GPU riser)')
    :fail12('DL20 G10+ riser panel wrong: '+opts12.join(' | '));

  // --- G9 entry-level rack (lower priority per the user, but the only
  // remaining gap on this axis): DL20/DL60/DL80/DL120/DL160/DL180 G9 ---
  setModel12('DL20 G9');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/854846-B21/.test(o)) && opts12.some(o=>/811271-B21/.test(o)))
    ?pass12('DL20 G9: real 3-option riser list (LP riser, FlexLOM riser, GPU kit)')
    :fail12('DL20 G9 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL60 G9');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/765508-B21/.test(o)) && opts12.some(o=>/765510-B21/.test(o)))
    ?pass12('DL60 G9: real 3-option riser list (CPU1 base/FlexLOM/FHHL kits)')
    :fail12('DL60 G9 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL80 G9');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/765515-B21/.test(o)) && opts12.some(o=>/765518-B21/.test(o)))
    ?pass12('DL80 G9: real 3-option riser list (FHHL/FlexLOM/GPU kits, optional, on top of 5 motherboard slots)')
    :fail12('DL80 G9 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL120 G9');
  opts12=riserOpts12();
  (opts12.length===4 && opts12.some(o=>/765510-B21/.test(o)) && opts12.some(o=>/779611-B21/.test(o)))
    ?pass12('DL120 G9: real 4-option riser list (CPU1 base/FlexLOM/FHHL/GPU kits)')
    :fail12('DL120 G9 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL160 G9');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/725585-B21/.test(o)) && opts12.some(o=>/725586-B21/.test(o)))
    ?pass12('DL160 G9: real 3-option riser list (CPU1 default/FlexLOM + optional CPU2 kit)')
    :fail12('DL160 G9 riser panel wrong: '+opts12.join(' | '));
  setModel12('DL180 G9');
  opts12=riserOpts12();
  (opts12.length===3 && opts12.some(o=>/725569-B21/.test(o)) && opts12.some(o=>/780965-B21/.test(o)))
    ?pass12('DL180 G9: real 3-option riser list (3-slot x8 / x16 / FlexLOM kits)')
    :fail12('DL180 G9 riser panel wrong: '+opts12.join(' | '));

  d.getElementById('risers').innerHTML='';
  runRound13();   // chained — round 12 has no nested timers of its own
}

// ---- round 13: user-reported 2026-09-17 — the Gen11 CPU picker listed
// tiers out of Bronze/Silver/Gold/Platinum order (a Bronze SKU added
// later had been misfiled after Gold), and the Gen12 (Xeon 6) CPU pool
// didn't separate E-core/P-core/Socket-Scalable per model at all — every
// G12 model shared one flat 31-SKU list with no cpuAllow enforcement,
// despite 2 of them (DL110/DL580) already having notes admitting a much
// narrower real pool. Fixed both; this round guards them. ----
function runRound13(){
  function pass13(m){console.log('ok    '+m);}
  function fail13(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi13=d.getElementById('model-input'), ci13=d.getElementById('cpu-input');
  function setModel13(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi13.value='';fire(mi13,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail13('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function cpuCodes13(){ci13.value='';fire(ci13,'input');return [...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(el=>el.textContent);}

  // --- Bronze/Silver/Gold/Platinum ordering (sp4/sp5, Gen11) ---
  setModel13('DL380 G11');
  let codes13=cpuCodes13();
  let b13=codes13.indexOf('B3408U'), s13=codes13.indexOf('S4410Y'), g13=codes13.indexOf('G5411N'), p13=codes13.indexOf('P8444H');
  (b13>=0 && b13<s13 && s13<g13 && g13<p13)
    ?pass13('DL380 G11 (sp4): CPU picker now lists Bronze before Silver/Gold/Platinum (B3408U was misfiled after Gold)')
    :fail13('DL380 G11 sp4 order still wrong: B='+b13+' S='+s13+' G='+g13+' P='+p13);
  setModel13('DL360 G11');
  codes13=cpuCodes13();
  let b5=codes13.indexOf('B3508U'), s5=codes13.indexOf('S4509Y'), g5=codes13.indexOf('G5515+'), p5=codes13.indexOf('P8558U');
  (b5>=0 && b5<s5 && s5<g5 && g5<p5)
    ?pass13('DL360 G11 (sp5): CPU picker now lists Bronze before Silver/Gold/Platinum (B3508U was misfiled after Gold)')
    :fail13('DL360 G11 sp5 order still wrong: B='+b5+' S='+s5+' G='+g5+' P='+p5);

  // --- Gen12 (Xeon 6): per-model cpuAllow now enforced, not just noted ---
  setModel13('DL110 G12');
  codes13=cpuCodes13();
  (codes13.length===1 && codes13[0]==='6716P-B')
    ?pass13('DL110 G12: CPU picker now offers ONLY its fixed SoC (6716P-B) — cpuAllow enforces the note that already existed')
    :fail13('DL110 G12 CPU list wrong: '+codes13.join(', '));
  setModel13('DL580 G12');
  codes13=cpuCodes13();
  (codes13.length===7 && ['6714P','6724P','6728P','6738P','6748P','6768P','6788P'].every(c=>codes13.includes(c)) &&
   !codes13.some(c=>/E$/.test(c)))
    ?pass13('DL580 G12: CPU picker now offers ONLY its 7 Socket-Scalable P-core SKUs, matching the pre-existing hsSku list — cpuAllow enforces it')
    :fail13('DL580 G12 CPU list wrong: '+codes13.join(', '));
  setModel13('ML350 G12');
  codes13=cpuCodes13();
  (codes13.length===18 && !codes13.some(c=>/E$/.test(c)) && ['6745P','6725P','6503P'].every(c=>codes13.includes(c)))
    ?pass13('ML350 G12: CPU picker has zero E-core SKUs — confirmed absent from its own doc, unlike every other G12 rack model')
    :fail13('ML350 G12 should be P-core-only, 18 SKUs (V17): '+codes13.join(', '));
  setModel13('DL320 G12');
  codes13=cpuCodes13();
  (codes13.length===32 && ['6511P','6521P','6731P','6741P','6761P','6781P','6503P','6725P','6732P','6745P'].every(c=>codes13.includes(c)) &&
   !codes13.some(c=>['6714P','6724P','6728P','6738P','6748P','6768P','6788P','6762P'].includes(c)))
    ?pass13('DL320 G12: 32-SKU pool per V20 — the 6 single-socket "1P" SKUs, 6503P/6725P/6732P/6745P, no Socket Scalable SKUs, no 6762P')
    :fail13('DL320 G12 CPU list wrong: '+codes13.join(', '));
  setModel13('DL340 G12');
  codes13=cpuCodes13();
  (codes13.length===33 && ['6745P','6774P','6503P','6725P','6732P','6511P'].every(c=>codes13.includes(c)))
    ?pass13('DL340 G12: 33-SKU pool per V15 incl. 6774P and the single-socket 6XX1P parts')
    :fail13('DL340 G12 CPU list wrong ('+codes13.length+' codes): '+codes13.join(', '));
  setModel13('DL360 G12');
  codes13=cpuCodes13();
  (codes13.length===34 && !codes13.includes('6511P') && codes13.includes('6745P') && codes13.includes('6714P'))
    ?pass13('DL360 G12: 34-SKU pool per V19 (Sep 2026) — same as DL380 G12, incl. 6745P and the Socket Scalable SKUs; no single-socket "1P" variants')
    :fail13('DL360 G12 CPU list wrong ('+codes13.length+' codes): '+codes13.join(', '));
  setModel13('DL380 G12');
  codes13=cpuCodes13();
  (codes13.length===34 && ['6503P','6725P','6732P','6762P'].every(c=>codes13.includes(c)) && ['6714P','6724P','6728P','6738P','6748P','6768P','6788P'].every(c=>codes13.includes(c)) && codes13.includes('6745P'))
    ?pass13('DL380 G12: widest G12 pool (34 SKUs, V19) — all 7 Socket Scalable SKUs confirmed orderable, same part numbers as DL580 G12')
    :fail13('DL380 G12 CPU list wrong ('+codes13.length+' codes): '+codes13.join(', '));
  setModel13('DL380a G12');
  codes13=cpuCodes13();
  (codes13.length===31 && !codes13.includes('6731E') && !codes13.includes('6505P') && ['6714P','6745P','6776P','6725P'].every(c=>codes13.includes(c)))
    ?pass13('DL380a G12: 31-SKU pool per V20 (adds Socket Scalable, 6745P, 6776P, 6725P), still no 6731E / 6505P')
    :fail13('DL380a G12 CPU list wrong ('+codes13.length+' codes): '+codes13.join(', '));
  // a mismatched value typed/pasted directly is still caught
  setModel13('DL580 G12');
  d.getElementById('cpu').value='6710E';fire(d.getElementById('cpu'),'input');
  d.getElementById('checks').textContent.includes('NOT SUPPORTED')
    ?pass13('DL580 G12: an E-core SKU (6710E) typed directly in is flagged, not silently accepted')
    :fail13('DL580 G12 cpuAllow typed-value check not caught: '+d.getElementById('checks').textContent.slice(0,220));
  d.getElementById('cpu').value='';fire(d.getElementById('cpu'),'input');

  // --- user-reported 2026-09-17: G12 rack models showed the "unverified"
  // badge despite this session's own sourced bays/pcie/riserMax/cpuAllow
  // work, all traced to each model's own cached QuickSpecs. Root cause:
  // verified:true was simply never set for 4 of the 8 G12 models
  // (DL380a/DL580/ML350 had it, DL320/DL340/DL360/DL380 didn't) — an
  // oversight from the original pass, not a real data gap. DL110 G12
  // correctly stays unverified (genuine unsourced PSU/riser gaps). ---
  ['DL320 G12','DL340 G12','DL360 G12','DL380 G12'].forEach(function(model){
    setModel13(model);
    d.getElementById('badge-v').classList.contains('on')
      ?pass13(model+': verified badge now on (DIMM/socket counts were already confirmed against its own QuickSpecs, just never flagged)')
      :fail13(model+' badge still not verified');
  });
  setModel13('DL110 G12');
  !d.getElementById('badge-v').classList.contains('on')
    ?pass13('DL110 G12: correctly stays unverified — genuine unsourced PSU/riser gaps remain')
    :fail13('DL110 G12 badge should not be verified yet');
  runRound14();   // chained — round 13 has no nested timers of its own
}

// ---- round 14: user-reported 2026-09-17 — start of a part-number
// verification project ("no guessing, 100% verified") beginning with
// G10 DL360/DL380. Found a real dead-code bug along the way: the
// per-model psu:[...] override existed on 5 models already but was
// never wired to the picker at all (a stale comment even documented
// this as deliberate). Re-wired it, built the same override mechanism
// for storage controllers (ctrl:[...], new), and populated real
// sourced HPE part numbers for DL360/DL380 G10 PSU + controllers.
// Also found and fixed 3 confirmed WRONG part numbers already sitting
// in DL360/DL380 G10's riser data (867980-B21, 875293-B21, 826694-B21
// misapplied) plus several genuinely missing ones. ----
function runRound14(){
  function pass14(m){console.log('ok    '+m);}
  function fail14(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi14=d.getElementById('model-input');
  function setModel14(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi14.value='';fire(mi14,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail14('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function psuOpts14(){const psu=d.getElementById('psu');psu.value='';fire(psu,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(el=>el.textContent);}
  function ctrlOpts14(){const ctrl=d.getElementById('ctrl');ctrl.value='';fire(ctrl,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(el=>el.textContent);}

  // --- the psu:[] dead-data bug: 5 models had real part numbers seeded
  // in their rules that never reached the picker at all ---
  setModel14('ML350 G10');
  let opts14=psuOpts14();
  (opts14.length===8 && opts14.some(o=>/865408-B21/.test(o)) && opts14.some(o=>/874571-B21/.test(o)))
    ?pass14('ML350 G10: psu:[] override now actually drives the picker (was dead data — 8 real part numbers incl. the 800W -48VDC tier added 2026-09-21)')
    :fail14('ML350 G10 psu panel wrong: '+opts14.join(' | '));
  setModel14('DL60 G9'); // a model with NO psu:[] override — must still fall back cleanly to plain PSUS
  opts14=psuOpts14();
  (opts14.length>0 && opts14.every(o=>/^\d+W$/.test(o)))
    ?pass14('DL60 G9 (no psu:[] override): still falls back to the plain generic PSUS wattage list')
    :fail14('DL60 G9 psu panel should be plain wattages: '+opts14.join(' | '));

  // --- DL360/DL380 G10: real PSU + storage-controller part numbers,
  // sourced 2026-09-17 directly from the already-cached QuickSpecs ---
  setModel14('DL360 G10');
  opts14=psuOpts14();
  (opts14.length===6 && opts14.some(o=>/865408-B21/.test(o)) && !opts14.some(o=>/P44712-B21|P17023-B21/.test(o)))
    ?pass14('DL360 G10: real 6-option PSU list, no 1600W-48VDC/1800-2200W (those are DL380-only, confirmed absent)')
    :fail14('DL360 G10 psu panel wrong: '+opts14.join(' | '));
  opts14=ctrlOpts14();
  (opts14.length===10 && opts14.some(o=>/^P408i-a \(804331-B21\)/.test(o)) && opts14.some(o=>/^P408i-a LH.*869081-B21/.test(o)) && !opts14.some(o=>/^P824i-p|^SR932i-p|^MR/.test(o)))
    ?pass14('DL360 G10: real controller list incl. LH (low-profile heatsink) GPU variants, no P824i-p/MR-series')
    :fail14('DL360 G10 ctrl panel wrong: '+opts14.join(' | '));
  setModel14('DL380 G10');
  opts14=psuOpts14();
  (opts14.length===8 && opts14.some(o=>/P44712-B21/.test(o)) && opts14.some(o=>/P17023-B21/.test(o)))
    ?pass14('DL380 G10: real 8-option PSU list, incl. the 2 higher-tier options DL360 G10 doesn\'t offer')
    :fail14('DL380 G10 psu panel wrong: '+opts14.join(' | '));
  opts14=ctrlOpts14();
  (opts14.length===8 && !opts14.some(o=>/LH/.test(o)) && opts14.some(o=>/^P824i-p/.test(o)))
    ?pass14('DL380 G10: real controller list, no LH variants (more chassis clearance), P824i-p flagged as confirmed-but-unsourced-PN rather than guessed')
    :fail14('DL380 G10 ctrl panel wrong: '+opts14.join(' | '));

  // --- ctrlCode() correctly extracts the leading code from a rich
  // "CODE (part number)" string, so the pre-existing CACHED_CTRLS/
  // NOCACHE_CTRLS/CTRL_GENS lookups keep working unchanged ---
  const ctrl14=d.getElementById('ctrl');
  ctrl14.value='P408i-a (804331-B21)';fire(ctrl14,'input');
  d.getElementById('bat-note').textContent.includes('write-back cache')
    ?pass14('ctrlCode(): battery suggestion still fires correctly for a rich "CODE (PN)" string')
    :fail14('ctrlCode() battery suggestion broken: '+d.getElementById('bat-note').textContent);
  setModel14('DL360 G10');
  ctrl14.value='MR416i-o (a future PN)';fire(ctrl14,'input');
  d.getElementById('checks').textContent.includes('CONTROLLER GENERATION')
    ?pass14('ctrlCode(): CONTROLLER GENERATION hard-stop still fires for a rich out-of-generation string')
    :fail14('ctrlCode() generation check broken: '+d.getElementById('checks').textContent.slice(0,200));
  ctrl14.value='';fire(ctrl14,'input');

  // --- 3 confirmed WRONG part numbers found already sitting in the
  // riser data, fixed; plus several genuinely missing ones filled in ---
  setModel14('DL360 G10');
  const riserPanel14=d.getElementById('add-riser');
  function riserOpts14(){d.getElementById('risers').innerHTML='';riserPanel14.click();const ri=d.querySelector('#risers [data-k=name]');ri.dispatchEvent(new w.Event('focus'));return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(el=>el.textContent);}
  let ropts14=riserOpts14();
  (ropts14.some(o=>/P23271-B21/.test(o)) && !ropts14.some(o=>/867980-B21/.test(o)) && !ropts14.some(o=>/8SFF NVMe Primary Riser/.test(o)))
    ?pass14('DL360 G10: obsolete riser PN 867980-B21 corrected to P23271-B21; the wrong/borrowed "8SFF NVMe" line removed')
    :fail14('DL360 G10 riser panel wrong: '+ropts14.join(' | '));
  setModel14('DL380 G10');
  ropts14=riserOpts14();
  (ropts14.some(o=>/873766-B21/.test(o)) && !ropts14.some(o=>/875293-B21/.test(o)))
    ?pass14('DL380 G10: Primary Riser Removal PN corrected (was 875293-B21, actually an unrelated memory RAS setting)')
    :fail14('DL380 G10 riser removal PN not fixed: '+ropts14.join(' | '));
  (ropts14.some(o=>/x16\/x16\/x16 Secondary GPU FIO Riser Kit \(P14373-B21\)/.test(o)) && ropts14.some(o=>/x16\/x16 Riser Kit \(826694-B21\)/.test(o)))
    ?pass14('DL380 G10: Secondary 3x16 GPU kit PN corrected to P14373-B21 (was wrongly 826694-B21, which is really the plain 2-slot kit)')
    :fail14('DL380 G10 secondary GPU riser PN not fixed: '+ropts14.join(' | '));
  (['826704-B21','873732-B21','867808-B21','867806-B21'].every(pn=>ropts14.some(o=>o.indexOf(pn)>-1)))
    ?pass14('DL380 G10: 4 genuinely missing riser part numbers filled in (826704/873732/867808/867806-B21)')
    :fail14('DL380 G10 still missing riser PNs: '+ropts14.join(' | '));
  d.getElementById('risers').innerHTML='';

  // --- user-reported 2026-09-17: the controller combo lost its Type-a/
  // PCI group headers when the per-model ctrl:[] override replaced the
  // generic list — a real regression, fixed by adding the same '—
  // Group —' strings the generic CTRLS list uses ---
  setModel14('DL360 G10');
  const ctrl14b=d.getElementById('ctrl');ctrl14b.value='';fire(ctrl14b,'input');
  const grp14=[...d.querySelectorAll('#ac-panel .combo-group')].map(el=>el.textContent);
  (grp14.length===2 && grp14.some(g=>/type.a/i.test(g)) && grp14.some(g=>/^pci/i.test(g)))
    ?pass14('DL360 G10: ctrl:[] override keeps the Type-a/PCI group headers (regression fixed)')
    :fail14('DL360 G10 ctrl groups missing: '+grp14.join(' | '));

  // --- new: the QUICKSPECS VERIFIED badge links to that model's real
  // HPE PSNow doc page (2026-09-17, QS_DOCS) ---
  setModel14('DL380 G10');
  const badgeV14=d.getElementById('badge-v');
  (badgeV14.tagName==='A' && badgeV14.getAttribute('href')==='https://www.hpe.com/psnow/doc/a00008180enw')
    ?pass14('DL380 G10: QUICKSPECS VERIFIED badge links to its real HPE doc page')
    :fail14('DL380 G10 badge link wrong: '+badgeV14.getAttribute('href'));
  // DL120 G10 was removed from the tool (2026-09-21) — no QuickSpecs could be found for it
  { const rk=d.getElementById('ct-r'); if(!rk.checked){rk.checked=true;fire(rk,'change');}
    const mi120=d.getElementById('model-input'); mi120.value='DL120'; fire(mi120,'input');
    const items120=[...d.querySelectorAll('#model-panel .combo-item')].map(el=>el.textContent.replace(/\s+/g,' '));
    (items120.some(x=>/DL120 G9/.test(x)) && !items120.some(x=>/DL120 G10/.test(x)))
      ?pass14('DL120 G10 is no longer offered (DL120 G9 still is)')
      :fail14('DL120 model list wrong: '+items120.join(' | ')); }

  // --- user-reported 2026-09-17, confirmed in DL380 G11's own doc: an
  // 8SFF U.3 x4 Mid Tray on an 8SFF front-bay build needs the SR932i-p
  // controller or the factory-only 32NVMe Bundle Kit — alert when
  // neither is selected (midtray8SFFCtrl) ---
  setModel14('DL380 G11');
  const bays14=d.getElementById('bays');bays14.value='8SFF';fire(bays14,'input');
  setRear('8SFF midtray');
  let chk14=d.getElementById('checks').textContent;
  chk14.includes('MIDTRAY CONTROLLER')
    ?pass14('DL380 G11: 8SFF + 8SFF midtray with no SR932i-p/bundle flags MIDTRAY CONTROLLER')
    :fail14('DL380 G11 midtray controller check did not fire: '+chk14.slice(0,220));
  const ctrl14c=d.getElementById('ctrl');ctrl14c.value='SR932i-p';fire(ctrl14c,'input');
  chk14=d.getElementById('checks').textContent;
  !chk14.includes('MIDTRAY CONTROLLER')
    ?pass14('DL380 G11: ...and picking SR932i-p clears the flag')
    :fail14('DL380 G11 midtray controller check should have cleared: '+chk14.slice(0,220));
  ctrl14c.value='';fire(ctrl14c,'input');
  clearRear();bays14.value='';fire(bays14,'input');
  runRound15();   // chained — round 14 has no nested timers of its own
}

// ---- round 15: user downloaded and dropped in the ML350 G9 QuickSpecs
// PDF this environment couldn't fetch itself (2026-09-17). Full
// re-verification against the real doc found 2 genuine data bugs, not
// just gaps: fans (two-CPU non-redundant was 5, real is 4; no redundant
// tier was modeled at all) and pcie (no one: value at all — confirmed
// 4 slots at 1P). PSU part numbers were already correct, just badly
// named ("Common Slot" instead of the doc's own "Flex Slot"); added 3
// more real PSU options and a full ctrl:[] controller list. Now
// verified:true. ----
function runRound15(){
  function pass15(m){console.log('ok    '+m);}
  function fail15(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi15=d.getElementById('model-input');
  function setModel15(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi15.value='';fire(mi15,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(el=>el.textContent.replace(/\s+/g,' ').includes(label));
    if(!opt)return fail15('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function grab15(name){
    const start=html.indexOf('var '+name+'=');
    if(start<0)return null;
    let i=html.indexOf('=',start)+1;
    while(' \n\r\t'.includes(html[i]))i++;
    const open=html[i], close=open==='['?']':'}';
    let depth=0,q=null,esc=false,j=i;
    for(;j<html.length;j++){
      const c=html[j];
      if(esc){esc=false;continue;}
      if(q){ if(c==='\\')esc=true; else if(c===q)q=null; continue; }
      if(c==='\''||c==='"'){q=c;continue;}
      if(c==='/'&&html[j+1]==='*'){ j=html.indexOf('*/',j)+1; continue; }
      if(c==='/'&&html[j+1]==='/'){ j=html.indexOf('\n',j)-1; continue; }
      if(c===open)depth++;
      else if(c===close){depth--; if(!depth){j++;break;}}
    }
    try{ return eval(DATA_PRELUDE+'('+html.slice(i,j)+')'); }catch(e){ return null; }
  }
  const MODELS15=grab15('MODELS'), GEN_DEFAULTS15=grab15('GEN_DEFAULTS');
  const rulesFor15=function(m){
    const d0=GEN_DEFAULTS15[m.g]||{},own=m.rules||{},out={};
    Object.keys(d0).forEach(function(k){out[k]=d0[k];});
    Object.keys(own).forEach(function(k){out[k]=own[k];});
    return out;
  };
  setModel15('ML350 G9');
  const ml350g9=MODELS15.find(function(x){return x.m==='ML350'&&x.g==='G9';});
  const R15=rulesFor15(ml350g9);
  (R15.fans.one===3 && R15.fans.two===4 && R15.fans.perf===8)
    ?pass15('ML350 G9: fans corrected to {one:3,two:4,perf:8} (was wrongly {one:3,two:5}, no redundant tier at all)')
    :fail15('ML350 G9 fans still wrong: '+JSON.stringify(R15.fans));
  (R15.pcie.one===4 && R15.pcie.two===9)
    ?pass15('ML350 G9: pcie corrected to {one:4,two:9} (was missing one: entirely)')
    :fail15('ML350 G9 pcie still wrong: '+JSON.stringify(R15.pcie));
  d.getElementById('badge-v').classList.contains('on')
    ?pass15('ML350 G9: now verified:true after the full re-check against the real PDF')
    :fail15('ML350 G9 should be verified now');
  const psu15=d.getElementById('psu');psu15.value='';fire(psu15,'input');
  let popts15=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (popts15.length===7 && popts15.some(function(o){return /720479-B21/.test(o);}) && popts15.some(function(o){return /Flex Slot/.test(o);}) && !popts15.some(function(o){return /Common Slot/.test(o);}))
    ?pass15('ML350 G9: real 7-option PSU list, "Flex Slot" naming corrected (was wrongly "Common Slot"), 3 new real options added')
    :fail15('ML350 G9 psu panel wrong: '+popts15.join(' | '));
  const ctrl15=d.getElementById('ctrl');ctrl15.value='';fire(ctrl15,'input');
  let copts15=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (copts15.some(function(o){return /^P440ar\/2GB.*726736-B21/.test(o);}) && copts15.some(function(o){return /^P840\/4GB.*726897-B21/.test(o);}))
    ?pass15('ML350 G9: real controller list with sourced part numbers (was the generic name-only list)')
    :fail15('ML350 G9 ctrl panel wrong: '+copts15.join(' | '));
  runRound16();   // chained — round 15 has no nested timers of its own
}

// ---- round 16: user asked to continue the part-number project into
// the rest of G10 rack (DL325/DL385/DL560/DL580), following DL360/
// DL380 G10 from the last batch (2026-09-17). ----
function runRound16(){
  function pass16(m){console.log('ok    '+m);}
  function fail16(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi16=d.getElementById('model-input');
  function setModel16(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi16.value='';fire(mi16,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail16('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function psuOpts16(){const psu=d.getElementById('psu');psu.value='';fire(psu,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}
  function ctrlOpts16(){const ctrl=d.getElementById('ctrl');ctrl.value='';fire(ctrl,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}

  setModel16('DL325 G10');
  let p16=psuOpts16();
  (p16.length===7 && p16.some(function(o){return /837074-B21/.test(o);}) && p16.some(function(o){return /P04983-B21/.test(o);}))
    ?pass16('DL325 G10: real 7-option PSU list, incl. the entry-tier FIO kit that needs no enablement kit')
    :fail16('DL325 G10 psu panel wrong: '+p16.join(' | '));
  let c16=ctrlOpts16();
  (c16.length===7 && c16.every(function(o){return !/^P408i-a \(|^P816i-a \(|^E208i-a \(/.test(o);}) && c16.some(function(o){return /^P408i-a LH/.test(o);}))
    ?pass16('DL325 G10: controller list is LH-only for embedded cards — no plain (non-LH) variant exists on this 1U chassis')
    :fail16('DL325 G10 ctrl panel wrong: '+c16.join(' | '));

  setModel16('DL385 G10');
  p16=psuOpts16();
  (p16.length===6 && p16.some(function(o){return /865408-B21/.test(o);}))
    ?pass16('DL385 G10: real 6-option PSU list (no enablement kit needed, unlike DL325 G10)')
    :fail16('DL385 G10 psu panel wrong: '+p16.join(' | '));
  c16=ctrlOpts16();
  (c16.length===8 && c16.some(function(o){return /^P824i-p \(870658-B21/.test(o);}))
    ?pass16('DL385 G10: real controller list, P824i-p PN backfilled from DL580 G10\'s doc')
    :fail16('DL385 G10 ctrl panel wrong: '+c16.join(' | '));

  setModel16('DL560 G10');
  p16=psuOpts16();
  (p16.length===6 && !p16.some(function(o){return /500W/.test(o);}) && p16.some(function(o){return /4x Power Supply Enablement/.test(o);}))
    ?pass16('DL560 G10: real 6-option PSU list (incl. the 4x enablement kit), no 500W tier at all on this 4-socket chassis')
    :fail16('DL560 G10 psu panel wrong: '+p16.join(' | '));
  c16=ctrlOpts16();
  (c16.length===8 && c16.some(function(o){return /^P408i-a LH/.test(o);}) && c16.some(function(o){return /P824i-p/.test(o);}))
    ?pass16('DL560 G10: LH-only embedded controllers, PLUS P824i-p (confirmed real once sourced from the current, not stale 2017, doc)')
    :fail16('DL560 G10 ctrl panel wrong: '+c16.join(' | '));

  setModel16('DL580 G10');
  p16=psuOpts16();
  (p16.length===5 && p16.some(function(o){return /865414-B21/.test(o);}) && p16.some(function(o){return /830272-B21/.test(o);}) && p16.some(function(o){return /P44712-B21/.test(o);}))
    ?pass16('DL580 G10: real 5-option PSU list once sourced from the current (not stale 2017) doc — 3 tiers were added since')
    :fail16('DL580 G10 psu panel wrong: '+p16.join(' | '));
  c16=ctrlOpts16();
  (c16.length===5 && !c16.some(function(o){return /-a \(|LH/.test(o);}) && c16.some(function(o){return /^P824i-p \(870658-B21\)$/.test(o);}))
    ?pass16('DL580 G10: no embedded/LH controllers at all, and P824i-p\'s real PN (870658-B21) found here directly')
    :fail16('DL580 G10 ctrl panel wrong: '+c16.join(' | '));

  setModel16('ML110 G10');
  c16=ctrlOpts16();
  (c16.length===5 && c16.some(function(o){return /^S100i/.test(o);}) && !c16.some(function(o){return /-a \(|P824i-p|P816i-a/.test(o);}))
    ?pass16('ML110 G10: real controller list — S100i + 4 PCIe plug-in cards, no "-a"/P816i-a/P824i-p at all on this tower')
    :fail16('ML110 G10 ctrl panel wrong: '+c16.join(' | '));

  setModel16('ML350 G10');
  c16=ctrlOpts16();
  (c16.length===8 && c16.some(function(o){return /^P408i-a — needs AROC.*\(804331-B21\)/.test(o);}) && c16.some(function(o){return /870658-B21/.test(o);}))
    ?pass16('ML350 G10: real 8-option controller list, plain (non-LH) "-a" variants, P824i-p PN (870658-B21) directly confirmed in this model\'s own doc — matches DL580 G10 exactly')
    :fail16('ML350 G10 ctrl panel wrong: '+c16.join(' | '));

  // --- ML110 G10 genuinely has its own SAS Expander SKU (P11359-B21),
  // a real gap in the original expander research pass — found while
  // sourcing this model's controller part numbers ---
  setModel16('ML110 G10');
  const bays16=d.getElementById('bays');bays16.value='16SFF';fire(bays16,'input');
  const ctrl16b=d.getElementById('ctrl');ctrl16b.value='P408i-p';fire(ctrl16b,'input');
  const expTxt16=d.getElementById('expander-note').textContent;
  (/P11359-B21/.test(expTxt16) && /8 ports/.test(expTxt16))
    ?pass16('ML110 G10: 16SFF on an 8-port P408i-p now suggests the real SAS Expander Card Kit (P11359-B21) — was previously untracked entirely')
    :fail16('ML110 G10 expander suggestion missing/wrong: '+expTxt16);
  ctrl16b.value='';fire(ctrl16b,'input');bays16.value='';fire(bays16,'input');
  runRound18();   // chained — round 16 has no nested timers of its own
}

// ---- round 18: user asked to finish G10 entry-level (DL20/DL160/
// DL180) to close out G10 entirely, before starting G10+ (2026-09-18).
// Same part-number rigor as the rest of G10. ----
function runRound18(){
  function pass18(m){console.log('ok    '+m);}
  function fail18(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi18=d.getElementById('model-input');
  function setModel18(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi18.value='';fire(mi18,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail18('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function psuOpts18(){const psu=d.getElementById('psu');psu.value='';fire(psu,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}
  function ctrlOpts18(){const ctrl=d.getElementById('ctrl');ctrl.value='';fire(ctrl,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}

  setModel18('DL20 G10');
  let p18=psuOpts18();
  (p18.length===4 && p18.some(function(o){return /P21649-B21/.test(o);}) && p18.some(function(o){return /OBSOLETE.*P06731-B21/.test(o);}))
    ?pass18('DL20 G10: real 4-option PSU list, obsolete 290W FIO variant flagged as such rather than silently offered')
    :fail18('DL20 G10 psu panel wrong: '+p18.join(' | '));
  let c18=ctrlOpts18();
  (c18.length===5 && c18.some(function(o){return /^S100i/.test(o);}) && c18.some(function(o){return /^P408i-a LH \(869081-B21\)/.test(o);}))
    ?pass18('DL20 G10: real 5-option controller list, LH-only embedded variants')
    :fail18('DL20 G10 ctrl panel wrong: '+c18.join(' | '));
  d.getElementById('badge-v').classList.contains('on')
    ?pass18('DL20 G10: now verified:true — DIMM count was already sourced against this doc, just never flagged')
    :fail18('DL20 G10 should be verified now');

  setModel18('DL160 G10');
  p18=psuOpts18();
  (p18.length===6 && p18.some(function(o){return /866442-B21/.test(o);}) && !p18.some(function(o){return /1600W/.test(o);}))
    ?pass18('DL160 G10: real 6-option PSU list (shared DL160/180 enablement kit), no 1600W tier (DL180-only)')
    :fail18('DL160 G10 psu panel wrong: '+p18.join(' | '));
  c18=ctrlOpts18();
  (c18.length===6 && c18.some(function(o){return /^P408i-a LH/.test(o);}) && !c18.some(function(o){return /P816i-a/.test(o);}))
    ?pass18('DL160 G10: LH-only embedded controllers, no P816i-a at all (DL180-only)')
    :fail18('DL160 G10 ctrl panel wrong: '+c18.join(' | '));

  setModel18('DL180 G10');
  p18=psuOpts18();
  (p18.length===7 && p18.some(function(o){return /866442-B21/.test(o);}) && p18.some(function(o){return /1600W/.test(o);}))
    ?pass18('DL180 G10: real 7-option PSU list — same shared enablement kit as DL160, plus the 1600W tier DL160 lacks')
    :fail18('DL180 G10 psu panel wrong: '+p18.join(' | '));
  c18=ctrlOpts18();
  (c18.length===7 && c18.some(function(o){return /^P816i-a.*\(804338-B21\)/.test(o);}) && c18.some(function(o){return /^P408i-a — needs cable kit \(804331-B21\)/.test(o);}))
    ?pass18('DL180 G10: PLAIN (non-LH) modular controllers incl. P816i-a — a real difference from DL160 G10\'s LH-only pattern')
    :fail18('DL180 G10 ctrl panel wrong: '+c18.join(' | '));
  runRound19();   // chained — round 18 has no nested timers of its own
}

// ---- round 19: user asked to move on to G10+ for the part-number
// project, starting with DL360/DL380 (2026-09-18). Found a real
// Gen10-Plus-specific PSU part-number revision (800W/1600W Platinum
// got new codes, not carried forward from G10) and 3 controller codes
// (MR216i-a/MR416i-a/SR416i-a) missing from the shared CTRLS list
// entirely. ----
function runRound19(){
  function pass19(m){console.log('ok    '+m);}
  function fail19(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi19=d.getElementById('model-input');
  function setModel19(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi19.value='';fire(mi19,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail19('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function psuOpts19(){const psu=d.getElementById('psu');psu.value='';fire(psu,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}
  function ctrlOpts19(){const ctrl=d.getElementById('ctrl');ctrl.value='';fire(ctrl,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}

  setModel19('DL360 G10+');
  let p19=psuOpts19();
  (p19.length===6 && p19.some(function(o){return /P38995-B21/.test(o);}) && p19.some(function(o){return /P38997-B21/.test(o);}) && p19.some(function(o){return /^500W/.test(o);}))
    ?pass19('DL360 G10+: real 6-option PSU list, incl. the Gen10-Plus-specific 800W/1600W Platinum codes (P38995/P38997-B21), not the old G10 ones')
    :fail19('DL360 G10+ psu panel wrong: '+p19.join(' | '));
  let c19=ctrlOpts19();
  (c19.length===16 && c19.some(function(o){return /^P408i-a LH.*869081-B21/.test(o);}) && c19.some(function(o){return /^MR216i-a \(P26325-B21\)/.test(o);}) && c19.some(function(o){return /^SR416i-a \(P12688-B21\)/.test(o);}))
    ?pass19('DL360 G10+: real 16-option controller list, both plain+LH embedded variants, incl. the newly-added MR216i-a/MR416i-a/SR416i-a "-a" Tri-Mode family')
    :fail19('DL360 G10+ ctrl panel wrong: '+c19.join(' | '));

  setModel19('DL380 G10+');
  p19=psuOpts19();
  (p19.length===6 && !p19.some(function(o){return /^500W/.test(o);}) && p19.some(function(o){return /P38995-B21/.test(o);}))
    ?pass19('DL380 G10+: real 6-option PSU list, no 500W tier at all (confirmed absent, unlike DL360 G10+)')
    :fail19('DL380 G10+ psu panel wrong: '+p19.join(' | '));
  c19=ctrlOpts19();
  (c19.length===13 && !c19.some(function(o){return /LH/.test(o);}) && c19.some(function(o){return /^SR416i-a \(P12688-B21\)/.test(o);}))
    ?pass19('DL380 G10+: real 13-option controller list, PLAIN-only modular variants (no LH at all) — a real difference from DL360 G10+')
    :fail19('DL380 G10+ ctrl panel wrong: '+c19.join(' | '));

  // --- the new shared CTRLS entries (MR216i-a/MR416i-a/SR416i-a) keep
  // the Type-a group header and stay properly generation-gated ---
  setModel19('DL360 G11'); // a model with NO ctrl:[] override, still uses generic CTRLS/CTRL_GENS
  c19=ctrlOpts19();
  (!c19.some(function(o){return /^MR216i-a$|^MR416i-a$|^SR416i-a$/.test(o);}))
    ?pass19('DL360 G11 (no ctrl override): the new "-a" Tri-Mode codes stay scoped to G10+ only, not offered here')
    :fail19('DL360 G11 should not offer the G10+-only "-a" Tri-Mode codes: '+c19.join(' | '));
  runRound20();
}

// --- Round 20: DL325/DL345/DL365/DL385 G10+ (and DL325/DL385's v2
// variants) real PSU + storage-controller part numbers, sourced
// 2026-09-18 directly from each model's own cached QuickSpecs ---
function runRound20(){
  function pass20(m){console.log('ok    '+m);}
  function fail20(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi20=d.getElementById('model-input');
  function setModel20(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi20.value='';fire(mi20,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail20('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function psuOpts20(){const psu=d.getElementById('psu');psu.value='';fire(psu,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}
  function ctrlOpts20(){const ctrl=d.getElementById('ctrl');ctrl.value='';fire(ctrl,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}

  setModel20('DL325 G10+'); // matches the v1 (Rome) MODELS entry, not the v2 one
  let p20=psuOpts20();
  (p20.length===6 && p20.some(function(o){return /865414-B21/.test(o);}) && p20.some(function(o){return /830272-B21/.test(o);}) && !p20.some(function(o){return /P38995-B21|P38997-B21/.test(o);}))
    ?pass20('DL325 G10+ v1: real 6-option PSU list using the OLD pre-revision codes (865414/830272-B21), not the newer P38995/P38997 ones')
    :fail20('DL325 G10+ v1 psu panel wrong: '+p20.join(' | '));
  let c20=ctrlOpts20();
  (c20.length===7 && c20.every(function(o){return !/MR216i-a|MR416i-a|SR416i-a|MR216i-p|MR416i-p|SR932i-p/.test(o);}) && c20.some(function(o){return /^P408i-a LH \(869081-B21\)/.test(o);}))
    ?pass20('DL325 G10+ v1: real 7-option controller list, LH-only, no Tri-Mode "-a"/"-p" family at all on this early board')
    :fail20('DL325 G10+ v1 ctrl panel wrong: '+c20.join(' | '));

  setModel20('DL325 G10+ v2');
  p20=psuOpts20();
  (p20.length===6 && p20.some(function(o){return /P38995-B21/.test(o);}) && p20.some(function(o){return /P38997-B21/.test(o);}))
    ?pass20('DL325 G10+ v2: real 6-option PSU list, carries the Gen10-Plus revision (P38995/P38997-B21) the v1 board lacks')
    :fail20('DL325 G10+ v2 psu panel wrong: '+p20.join(' | '));
  c20=ctrlOpts20();
  (c20.length===13 && c20.some(function(o){return /^P408i-a LH \(869081-B21\)/.test(o);}) && c20.some(function(o){return /^MR216i-a \(P26325-B21\)/.test(o);}))
    ?pass20('DL325 G10+ v2: real 13-option controller list, still LH-only but now WITH the full Tri-Mode "-a"/"-p" family')
    :fail20('DL325 G10+ v2 ctrl panel wrong: '+c20.join(' | '));

  setModel20('DL345 G10+');
  p20=psuOpts20();
  (p20.length===7 && p20.some(function(o){return /P38995-B21/.test(o);}) && p20.some(function(o){return /P17023-B21/.test(o);}))
    ?pass20('DL345 G10+: real 7-option PSU list, incl. the 1600W -48VDC tier (P17023-B21) DL325 G10+ lacks')
    :fail20('DL345 G10+ psu panel wrong: '+p20.join(' | '));
  c20=ctrlOpts20();
  (c20.length===13 && !c20.some(function(o){return /LH/.test(o);}) && c20.some(function(o){return /^MR216i-a \(P26325-B21\)/.test(o);}))
    ?pass20('DL345 G10+: real 13-option controller list, PLAIN (non-LH) modular variants with the full Tri-Mode family')
    :fail20('DL345 G10+ ctrl panel wrong: '+c20.join(' | '));

  setModel20('DL365 G10+');
  p20=psuOpts20();
  (p20.length===7 && p20.some(function(o){return /P38995-B21/.test(o);}) && p20.some(function(o){return /P17023-B21/.test(o);}))
    ?pass20('DL365 G10+: real 7-option PSU list, same tiers as DL345 G10+')
    :fail20('DL365 G10+ psu panel wrong: '+p20.join(' | '));
  c20=ctrlOpts20();
  (c20.length===13 && c20.some(function(o){return /^P408i-a LH \(869081-B21\)/.test(o);}) && c20.some(function(o){return /^MR216i-a \(P26325-B21\)/.test(o);}))
    ?pass20('DL365 G10+: real 13-option controller list, LH-only (unlike sibling DL345 G10+) with the full Tri-Mode family')
    :fail20('DL365 G10+ ctrl panel wrong: '+c20.join(' | '));

  setModel20('DL385 G10+'); // matches the v1 (Rome) MODELS entry, not the v2 one
  p20=psuOpts20();
  (p20.length===6 && p20.some(function(o){return /865414-B21/.test(o);}) && !p20.some(function(o){return /P38995-B21/.test(o);}))
    ?pass20('DL385 G10+ v1: real 6-option PSU list, same OLD pre-revision codes as DL325 G10+ v1')
    :fail20('DL385 G10+ v1 psu panel wrong: '+p20.join(' | '));
  c20=ctrlOpts20();
  (c20.length===7 && !c20.some(function(o){return /LH/.test(o);}) && c20.every(function(o){return !/MR216i-a|MR416i-a|SR416i-a/.test(o);}))
    ?pass20('DL385 G10+ v1: real 7-option controller list, PLAIN (non-LH), no Tri-Mode — opposite LH pattern from DL325 G10+ v1')
    :fail20('DL385 G10+ v1 ctrl panel wrong: '+c20.join(' | '));

  setModel20('DL385 G10+ v2');
  p20=psuOpts20();
  (p20.length===7 && p20.some(function(o){return /P38995-B21/.test(o);}) && p20.some(function(o){return /P17023-B21/.test(o);}))
    ?pass20('DL385 G10+ v2: real 7-option PSU list, carries the Gen10-Plus revision + 1600W -48VDC tier the v1 board lacks')
    :fail20('DL385 G10+ v2 psu panel wrong: '+p20.join(' | '));
  c20=ctrlOpts20();
  (c20.length===13 && !c20.some(function(o){return /LH/.test(o);}) && c20.some(function(o){return /^MR216i-a \(P26325-B21\)/.test(o);}))
    ?pass20('DL385 G10+ v2: real 13-option controller list, stays PLAIN (non-LH) but now WITH the full Tri-Mode family — mirrors DL380 G10+')
    :fail20('DL385 G10+ v2 ctrl panel wrong: '+c20.join(' | '));
  runRound21();
}

// --- Round 21: DL20/DL110/ML30 G10+ real PSU + storage-controller
// part numbers, sourced 2026-09-18 directly from each model's own
// cached QuickSpecs — closes out entry-level/tower G10+ ---
function runRound21(){
  function pass21(m){console.log('ok    '+m);}
  function fail21(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi21=d.getElementById('model-input');
  function setModel21(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi21.value='';fire(mi21,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail21('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function psuOpts21(){const psu=d.getElementById('psu');psu.value='';fire(psu,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}
  function ctrlOpts21(){const ctrl=d.getElementById('ctrl');ctrl.value='';fire(ctrl,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}

  setModel21('DL20 G10+');
  let p21=psuOpts21();
  (p21.length===5 && p21.some(function(o){return /P21649-B21/.test(o);}) && p21.some(function(o){return /FIO-only/.test(o);}))
    ?pass21('DL20 G10+: real 5-option PSU list, incl. the FIO-only 290W/RPS-kit caveats a refurb trader can\'t retrofit')
    :fail21('DL20 G10+ psu panel wrong: '+p21.join(' | '));
  let c21=ctrlOpts21();
  (c21.length===9 && c21.some(function(o){return /^P408i-a LH \(869081-B21\)/.test(o);}) && c21.some(function(o){return /^MR216i-a \(P26325-B21\)/.test(o);}) && !c21.some(function(o){return /^P408i-p |^E208i-p |SR932i-p/.test(o);}))
    ?pass21('DL20 G10+: real 9-option controller list, LH-only embedded + Tri-Mode, no internal PCIe plug-in or SR932i-p at all')
    :fail21('DL20 G10+ ctrl panel wrong: '+c21.join(' | '));

  setModel21('DL110 G10+');
  p21=psuOpts21();
  (p21.length===3 && p21.some(function(o){return /P43150-B21/.test(o);}) && p21.some(function(o){return /P54290-B21/.test(o);}))
    ?pass21('DL110 G10+: 3 real PSU options (700W -48VDC plus two AC tiers) from the latest doc — the older mirror wrongly showed a single DC-only option')
    :fail21('DL110 G10+ psu panel wrong: '+p21.join(' | '));
  c21=ctrlOpts21();
  (c21.length===1 && c21.some(function(o){return /Intel VROC/.test(o);}) && !c21.some(function(o){return /-B21/.test(o);}))
    ?pass21('DL110 G10+: no Smart Array controller of any kind exists — Intel VROC software RAID only, correctly has no part number')
    :fail21('DL110 G10+ ctrl panel wrong: '+c21.join(' | '));

  setModel21('ML30 G10+');
  p21=psuOpts21();
  (p21.length===5 && p21.some(function(o){return /P21652-B21/.test(o);}))
    ?pass21('ML30 G10+: pre-existing 5-option psu:[] override unchanged (one of the 5 models that already had this before the axis started)')
    :fail21('ML30 G10+ psu panel wrong: '+p21.join(' | '));
  c21=ctrlOpts21();
  (c21.length===6 && !c21.some(function(o){return /-a \(|^P816i|LH/.test(o);}) && c21.some(function(o){return /^MR216i-p \(P26324-B21\)/.test(o);}))
    ?pass21('ML30 G10+: real 6-option controller list, PCI plug-in only — no embedded "-a"/Tri-Mode-a controller exists on this tower at all')
    :fail21('ML30 G10+ ctrl panel wrong: '+c21.join(' | '));
  runRound22();
}

// --- Round 22: the "FlexibleLOM / OCP" field label/legend/placeholder
// now switch to the real per-model term (flrLabel()), user-reported
// 2026-09-18 — the generic combined label was confusing on chassis
// that only physically have ONE of the two ---
function runRound22(){
  function pass22(m){console.log('ok    '+m);}
  function fail22(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi22=d.getElementById('model-input');
  function setModel22(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi22.value='';fire(mi22,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail22('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }

  setModel22('DL380 G10'); // flrKind()==='flexlom'
  (d.getElementById('flr-label').textContent==='FlexibleLOM' && d.getElementById('flr-legend').textContent==='FlexibleLOM' && /366FLR/.test(d.getElementById('flr').placeholder))
    ?pass22('DL380 G10: field label/legend/placeholder switch to plain "FlexibleLOM" (pre-Gen10-Plus chassis)')
    :fail22('DL380 G10 flr label wrong: '+d.getElementById('flr-label').textContent);

  setModel22('DL360 G10+'); // flrKind()==='ocp'
  (d.getElementById('flr-label').textContent==='OCP 3.0' && d.getElementById('flr-legend').textContent==='OCP 3.0' && /BCM57414/.test(d.getElementById('flr').placeholder))
    ?pass22('DL360 G10+: field label/legend/placeholder switch to plain "OCP 3.0" (FlexibleLOM was retired at Gen10 Plus)')
    :fail22('DL360 G10+ flr label wrong: '+d.getElementById('flr-label').textContent);

  setModel22('DL20 G10+'); // flrKind()==='none'
  (d.getElementById('flr-label').textContent==='FlexibleLOM / OCP' && d.getElementById('flr').placeholder==='no slot on this chassis')
    ?pass22('DL20 G10+: no real slot either way, so the label correctly stays generic rather than picking a wrong specific term')
    :fail22('DL20 G10+ flr label wrong: '+d.getElementById('flr-label').textContent);

  // the slip's own "No <label> fitted" line uses the same dynamic term
  setModel22('DL360 G10+');
  d.getElementById('fl0').checked=true;fire(d.getElementById('fl0'),'change');
  (d.getElementById('slip').textContent.includes('No OCP 3.0 fitted'))
    ?pass22('DL360 G10+ slip: "No OCP 3.0 fitted" (not the generic "No FlexibleLOM / OCP fitted") once a model is picked')
    :fail22('DL360 G10+ slip "No" line wrong: '+d.getElementById('slip').textContent.slice(0,220));
  runRound23();
}

// --- Round 23: real per-model FlexibleLOM (G10) / OCP 3.0 (G10+) card
// lists, sourced 2026-09-18 directly from each model's own cached
// QuickSpecs — user asked to double-check compatibility for G10/G10+
// after noticing the field's label never changed. Found the catalogs
// vary far more per chassis than either the 2026-09-14 OCP pass or the
// original flat FLRS list assumed, plus 2 real bugs already sitting in
// the shared OCP_CARDS list (BCM57412/57416 PNs swapped; QL41132HQCU/
// QL41132HQRJ mislabeled 10/25Gb when they're 10Gb-only). ---
function runRound23(){
  function pass23(m){console.log('ok    '+m);}
  function fail23(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi23=d.getElementById('model-input');
  // round 22's last test picks the "No" pill, which disables #flr and
  // never re-enables it — reset here so this round starts clean.
  d.getElementById('fl1').checked=true;fire(d.getElementById('fl1'),'change');
  d.getElementById('flr').disabled=false;
  function setModel23(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi23.value='';fire(mi23,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail23('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  function flrOpts23(){const flr=d.getElementById('flr');flr.value='';fire(flr,'input');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});}

  setModel23('DL20 G10');
  let f23dl20=flrOpts23();
  (f23dl20.length===9 && f23dl20.some(function(o){return /^622FLR-SFP28/.test(o);}) && !f23dl20.some(function(o){return /^631FLR-SFP28|^640FLR-SFP28/.test(o);}))
    ?pass23('DL20 G10: real 9-card FlexibleLOM list — only the QL41401-based 622FLR-SFP28 25Gb option, no Mellanox/Broadcom 25Gb variants')
    :fail23('DL20 G10 flr panel wrong: '+f23dl20.join(' | '));

  setModel23('DL160 G10');
  let f23=flrOpts23();
  (f23.length===10 && f23.some(function(o){return /^640FLR-SFP28.*817749-B21/.test(o);}) && !f23.some(function(o){return /^562FLR-SFP\+/.test(o);}))
    ?pass23('DL160 G10: real 10-card FlexibleLOM list — missing only 562FLR-SFP+, which DL180 G10 (same sibling family) does have')
    :fail23('DL160 G10 flr panel wrong: '+f23.join(' | '));

  setModel23('DL180 G10');
  f23=flrOpts23();
  (f23.length===11 && f23.some(function(o){return /^562FLR-SFP\+/.test(o);}))
    ?pass23('DL180 G10: the FULL 11-card G10 catalog, incl. 562FLR-SFP+ which DL160 G10 lacks')
    :fail23('DL180 G10 flr panel wrong: '+f23.join(' | '));

  setModel23('DL380 G10');
  f23=flrOpts23();
  (f23.length===10 && !f23.some(function(o){return /^533FLR-T|^534FLR-SFP\+|^536FLR-T|^622FLR-SFP28/.test(o);}) && f23.some(function(o){return /Pensando/.test(o);}))
    ?pass23('DL380 G10: the narrowest G10 rack catalog (no 533/534/536/622), plus a unique Pensando smart-NIC option and the 547FLR-QSFP InfiniBand card')
    :fail23('DL380 G10 flr panel wrong: '+f23.join(' | '));

  setModel23('DL560 G10');
  f23=flrOpts23();
  (f23.length===13 && f23.some(function(o){return /^622FLR-SFP28/.test(o);}) && f23.some(function(o){return /^562FLR-T/.test(o);}))
    ?pass23('DL560 G10: real 13-card catalog once sourced from the CURRENT doc — matches DL580 G10, not the narrower list the stale 2017 doc implied')
    :fail23('DL560 G10 flr panel wrong: '+f23.join(' | '));

  setModel23('DL580 G10');
  f23=flrOpts23();
  (f23.length===13 && f23.some(function(o){return /^622FLR-SFP28/.test(o);}) && f23.some(function(o){return /^631FLR-SFP28/.test(o);}) && f23.some(function(o){return /^640FLR-SFP28/.test(o);}))
    ?pass23('DL580 G10: real 13-card catalog (all 3 25Gb tiers) once sourced from the current doc — matches DL560 G10\'s equally-corrected list')
    :fail23('DL580 G10 flr panel wrong: '+f23.join(' | '));

  // 547FLR-QSFP InfiniBand FlexibleLOM (879482-B21): in these models own docs, not in DL160/DL180/DL20 G10
  ['DL325 G10','DL360 G10','DL380 G10','DL385 G10','DL560 G10','DL580 G10'].forEach(function(label){
    setModel23(label);
    const fl=flrOpts23();
    fl.some(function(o){return /^547FLR-QSFP.*879482-B21/.test(o);})
      ?pass23(label+': 547FLR-QSFP InfiniBand FlexibleLOM (879482-B21) is offered (listed in its own doc)')
      :fail23(label+' is missing 547FLR-QSFP: '+fl.join(' | '));
  });
  ['DL20 G10','DL160 G10','DL180 G10'].forEach(function(label){
    setModel23(label);
    const fl=flrOpts23();
    !fl.some(function(o){return /547FLR/.test(o);})
      ?pass23(label+': no 547FLR-QSFP (not in its own doc)')
      :fail23(label+' wrongly offers 547FLR-QSFP');
  });

  ['ML30 G10','ML110 G10','ML350 G10'].forEach(function(label){
    setModel23(label);
    f23=flrOpts23();
    (f23.length===0 && d.getElementById('flr-note').textContent.includes('No FlexibleLOM/OCP mezzanine'))
      ?pass23(label+': correctly offers NO FlexibleLOM cards at all — this G10 tower has no slot, confirmed absent from its own doc')
      :fail23(label+' should offer nothing: '+f23.join(', ')+' / note: '+d.getElementById('flr-note').textContent);
  });

  setModel23('DL110 G10+');
  f23=flrOpts23();
  (f23.length===6 && f23.filter(function(o){return /E810/.test(o);}).length===3 && f23.some(function(o){return /NEBS/.test(o);}))
    ?pass23('DL110 G10+: 6 real OCP cards from the latest doc (the older mirror showed only 2), three flagged not NEBS compliant')
    :fail23('DL110 G10+ flr panel wrong: '+f23.join(' | '));

  setModel23('DL325 G10+'); // v1
  f23=flrOpts23();
  (f23.length===12 && !f23.some(function(o){return /^BCM5719|E810/.test(o);}) && f23.some(function(o){return /P31348-B21/.test(o);}))
    ?pass23('DL325 G10+ v1: no BCM5719, no E810 (both gained at v2); its current V27 doc does list the two OCP3 InfiniBand HDR cards')
    :fail23('DL325 G10+ v1 flr panel wrong: '+f23.join(' | '));

  setModel23('DL325 G10+ v2');
  f23=flrOpts23();
  (f23.length===15 && f23.some(function(o){return /^BCM5719/.test(o);}) && f23.some(function(o){return /^E810-CQDA2/.test(o);}) && f23.some(function(o){return /^InfiniBand HDR\/Eth 200Gb 1p/.test(o);}))
    ?pass23('DL325 G10+ v2: gains BCM5719 + both E810 cards + real OCP3 InfiniBand that v1 lacked entirely')
    :fail23('DL325 G10+ v2 flr panel wrong: '+f23.join(' | '));

  setModel23('DL360 G10+');
  f23=flrOpts23();
  (f23.length===14 && !f23.some(function(o){return /P31323-B21/.test(o);}) && f23.some(function(o){return /^InfiniBand HDR\/Eth 200Gb 2p.*P31348-B21/.test(o);}))
    ?pass23('DL360 G10+: real 14-card OCP list — corrected 2026-09-22, the "1p" InfiniBand card (P31323-B21) never appears anywhere in DL360\'s own doc and was dropped; the confirmed 2p card stays')
    :fail23('DL360 G10+ flr panel wrong: '+f23.join(' | '));

  // the shared OCP_CARDS fallback (used by G11/G12, and any future
  // unrecognized model) has 2 real bugs fixed this pass
  setModel23('DL325 G11'); // no flr:[] override (most Intel G11 models have their own now), falls back to OCP_CARDS
  f23=flrOpts23();
  (f23.some(function(o){return /^BCM57416 10Gb 2p \(P10097-B21\)/.test(o);}) && f23.some(function(o){return /^BCM57412 10Gb 2p \(P26256-B21\)/.test(o);}) && f23.some(function(o){return /^QL41132HQCU 10Gb 2p/.test(o);}) && !f23.some(function(o){return /^QL41132HQCU 10\/25Gb/.test(o);}))
    ?pass23('shared OCP_CARDS: BCM57412/57416 part-number swap fixed, QL41132HQCU/HQRJ "10/25Gb" mislabel fixed to plain 10Gb')
    :fail23('OCP_CARDS fallback still wrong: '+f23.join(' | '));
  (!f23.some(function(o){return /^361i|^530FLR-SFP\+/.test(o);}))
    ?pass23('shared fallback: confirms OCP_CARDS never had the FLRS-only 361i/530FLR-SFP+ entries to begin with')
    :fail23('OCP_CARDS unexpectedly contains a FLRS-only entry: '+f23.join(' | '));

  setModel23('DL60 G9'); // falls back to FLRS (no per-model override, out of this pass\'s G10/G10+ scope)
  f23=flrOpts23();
  (!f23.some(function(o){return /^361i|^530FLR-SFP\+/.test(o);}) && f23.some(function(o){return /^331FLR 4x1GbE \(629135-B22\)/.test(o);}))
    ?pass23('DL60 G9 (no flr override, falls back to FLRS): 361i (embedded chip, not a card) and unconfirmed 530FLR-SFP+ removed; real PNs added to the rest')
    :fail23('DL60 G9 flr fallback panel wrong: '+f23.join(' | '));
  runRound24();
}

// --- Round 24: 25 real sp1/sp2 Xeon Scalable CPU SKUs were missing from
// the shared CPUS array entirely, found by diffing DL360 G10's own
// "Choose Processor Options" list against the tool's existing pool
// (2026-09-18, part of the "finalize as many G10/G10+ options as
// possible" push). Fixed at the shared list level since these are real
// parts on ANY sp1/sp2 model, not DL360-specific. ---
function runRound24(){
  function pass24(m){console.log('ok    '+m);}
  function fail24(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi24=d.getElementById('model-input');
  function setModel24(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi24.value='';fire(mi24,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail24('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  setModel24('DL360 G10');
  const ci24=d.getElementById('cpu-input');ci24.value='';fire(ci24,'input');
  const cpuOpts=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  const newSkus=['5117','6134M','6143','8160M','8165','8170','8180M','4214Y','4215','5215L','5218B','5218N','5220S','6208U','6212U','6222V','6226','6230N','6238L','6240L','6240Y','6250L','6252N','8260L','8260Y'];
  const missing=newSkus.filter(function(sku){return !cpuOpts.some(function(o){return o.indexOf(sku)>-1;});});
  (missing.length===0)
    ?pass24('DL360 G10: all 25 real CPU SKUs sourced from its own QuickSpecs (previously missing entirely from the tool) are now selectable')
    :fail24('DL360 G10 still missing: '+missing.join(', '));
  runRound25();
}

// --- Round 25: DL560 G10's cached QuickSpecs was Version 1 (7-11-2017),
// which predates the 2nd Gen CPU launch entirely — user asked to check
// for stale sources across the project. Re-sourced from the CURRENT
// doc (V19, retired 1-July-2019, downloaded directly from hpe.com) and
// found 3 real errors the stale source introduced: FlexibleLOM list
// wrongly narrowed, P824i-p wrongly excluded (it's real, the old doc
// just predated it), and no cpuAllow had been built at all despite a
// clean, confirmed 77-SKU pool being available. ---
function runRound25(){
  function pass25(m){console.log('ok    '+m);}
  function fail25(m){console.log('FAIL  '+m);process.exitCode=1;}
  const mi25=d.getElementById('model-input');
  function setModel25(label){
    const towerEl=d.getElementById(/^ML/i.test(label)?'ct-t':'ct-r');
    if(!towerEl.checked){towerEl.checked=true;fire(towerEl,'change');}
    mi25.value='';fire(mi25,'input');
    const opt=[...d.querySelectorAll('#model-panel .combo-item')].find(function(el){return el.textContent.replace(/\s+/g,' ').includes(label);});
    if(!opt)return fail25('model not found: '+label);
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  setModel25('DL560 G10');
  const ci25=d.getElementById('cpu-input');ci25.value='';fire(ci25,'input');
  const cpuOpts25=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (cpuOpts25.length===77 && cpuOpts25.some(function(o){return o.indexOf('8280M')>-1;}) && cpuOpts25.some(function(o){return o.indexOf('5215M')>-1;}) && !cpuOpts25.some(function(o){return o.indexOf('6230R')>-1;}) && !cpuOpts25.some(function(o){return /\bS4\d{3}/.test(o);}))
    ?pass25('DL560 G10: cpuAllow now enforces the real 77-SKU Gold+/Platinum-only pool from the CURRENT doc, incl. 6 new M-suffix (2TB medium-memory-tier) SKUs, excluding Silver/Bronze and -R suffix parts never offered here')
    :fail25('DL560 G10 CPU list wrong: '+cpuOpts25.length+' options — '+cpuOpts25.slice(0,5).join(', ')+'...');

  setModel25('DL580 G10');
  const ci25b=d.getElementById('cpu-input');ci25b.value='';fire(ci25b,'input');
  const cpuOpts25b=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (cpuOpts25b.length===78 && cpuOpts25b.some(function(o){return o.indexOf('6140M')>-1;}) && !cpuOpts25b.some(function(o){return o.indexOf('6230R')>-1;}))
    ?pass25('DL580 G10: cpuAllow enforces its real 78-SKU pool (sourced from V20, not the end-of-life-pruned V52) — includes 6140M, a 7th M-suffix SKU not found on DL560 G10')
    :fail25('DL580 G10 CPU list wrong: '+cpuOpts25b.length+' options — '+cpuOpts25b.slice(0,5).join(', ')+'...');

  setModel25('DL380 G10');
  const ci25c=d.getElementById('cpu-input');ci25c.value='';fire(ci25c,'input');
  const cpuOpts25c=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (cpuOpts25c.some(function(o){return o.indexOf('6137')>-1;}) && cpuOpts25c.some(function(o){return o.indexOf('8260M')>-1;}))
    ?pass25('DL380 G10: Gold 6137 (Financial Sector kit, found in its v24 QuickSpecs) and the M-suffix parts are selectable')
    :fail25('DL380 G10 CPU list missing 6137/8260M');

  setModel25('DL325 G10');
  const ci25d=d.getElementById('cpu-input');ci25d.value='';fire(ci25d,'input');
  const cpuOpts25d=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (cpuOpts25d.length===24 && cpuOpts25d.some(function(o){return o.indexOf('7232P')>-1;}) && cpuOpts25d.some(function(o){return o.indexOf('7601')>-1;}) && !cpuOpts25d.some(function(o){return o.indexOf('7742')>-1;}))
    ?pass25('DL325 G10: cpuAllow enforces the 24-SKU EPYC pool (Naples + Rome) confirmed across V6/V15/V26 — no dual-socket-only 7742/7H12 etc.')
    :fail25('DL325 G10 CPU list wrong: '+cpuOpts25d.length+' options');

  setModel25('DL385 G10');
  const ci25e=d.getElementById('cpu-input');ci25e.value='';fire(ci25e,'input');
  const cpuOpts25e=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (cpuOpts25e.length===23 && cpuOpts25e.some(function(o){return o.indexOf('7601')>-1;}) && cpuOpts25e.some(function(o){return o.indexOf('7702')>-1;}) && !cpuOpts25e.some(function(o){return o.indexOf('7742')>-1 || o.indexOf('7H12')>-1;}))
    ?pass25('DL385 G10: cpuAllow enforces the 23 confirmed EPYC SKUs (11 Naples + 12 Rome), excluding Gen10 Plus-era 7742/7H12')
    :fail25('DL385 G10 CPU list wrong: '+cpuOpts25e.length+' options');
  const flr25=d.getElementById('flr');flr25.disabled=false;flr25.value='';fire(flr25,'input');
  const flrOpts25=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (flrOpts25.length===9 && flrOpts25.some(function(o){return /^622FLR-SFP28/.test(o);}) && !flrOpts25.some(function(o){return /^562FLR-T|Pensando|^537FLR/.test(o);}))
    ?pass25('DL385 G10: real 9-option FlexibleLOM list from the official V29 doc — differs from DL380 G10 (no 562FLR-T/537FLR/Pensando)')
    :fail25('DL385 G10 flr panel wrong: '+flrOpts25.join(' | '));

  setModel25('DL380 G10+');
  const ci25f=d.getElementById('cpu-input');ci25f.value='';fire(ci25f,'input');
  const cpuOpts25f=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (['5318N','5318S','6314U','8352S'].every(function(s){return cpuOpts25f.some(function(o){return o.indexOf(s)>-1;});}))
    ?pass25('DL380 G10+: Gold 5318N/5318S/6314U and Platinum 8352S (in its own QuickSpecs, missing from the shared sp3 list) are now selectable')
    :fail25('DL380 G10+ still missing sp3 CPUs');
  const flr25b=d.getElementById('flr');flr25b.disabled=false;flr25b.value='';fire(flr25b,'input');
  const flrOpts25b=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (flrOpts25b.length===16 && flrOpts25b.some(function(o){return /^BCM5719/.test(o);}) && flrOpts25b.some(function(o){return /^BCM57504/.test(o);}) && flrOpts25b.some(function(o){return /discontinued in the current doc/.test(o);}))
    ?pass25('DL380 G10+: OCP list is the union of the older mirror and the latest doc (adds BCM5719/BCM57412/BCM57504, keeps discontinued parts labelled)')
    :fail25('DL380 G10+ flr panel wrong: '+flrOpts25b.length+' options');

  // AMD G10+ boards: cpuAllow sizes from the union of the cached mirror and the latest hpe.com doc
  const amdExpect=[['DL325 G10+',19],['DL325 G10+ v2',26],['DL345 G10+',24],['DL365 G10+',26],['DL385 G10+',19],['DL385 G10+ v2',24],['DL110 G10+',12]];
  amdExpect.forEach(function(pair){
    setModel25(pair[0]);
    const cx=d.getElementById('cpu-input');cx.value='';fire(cx,'input');
    const opts=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
    (opts.length===pair[1])
      ?pass25(pair[0]+': cpuAllow enforces the '+pair[1]+'-SKU pool confirmed across the cached mirror and the latest hpe.com doc')
      :fail25(pair[0]+' CPU pool wrong: '+opts.length+' options, expected '+pair[1]);
  });
  setModel25('DL385 G10+ v2');
  const cv2=d.getElementById('cpu-input');cv2.value='';fire(cv2,'input');
  const v2opts=[...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(el){return el.textContent;});
  (v2opts.some(function(o){return o.indexOf('7402')>-1;}) && v2opts.some(function(o){return o.indexOf('7773X')>-1;}) && !v2opts.some(function(o){return o.indexOf('7742')>-1;}))
    ?pass25('DL385 G10+ v2: accepts the selected Rome parts (7252/7302/7402) alongside Milan, per the latest doc — but not the full Rome range')
    :fail25('DL385 G10+ v2 platform/CPU pool wrong');

  // --- model notes are build-guide text only (user directive 2026-09-21): no
  // sourcing history, no internal keys, and no essay-length notes ---
  function grab25(name){
    const start=html.indexOf('var '+name+'=');
    if(start<0)return null;
    let i=html.indexOf('=',start)+1;
    while(' \n\r\t'.includes(html[i]))i++;
    const open=html[i], close=open==='['?']':'}';
    let depth=0,q=null,esc=false,j=i;
    for(;j<html.length;j++){
      const c=html[j];
      if(esc){esc=false;continue;}
      if(q){ if(c==='\\')esc=true; else if(c===q)q=null; continue; }
      if(c==='\''||c==='"'){q=c;continue;}
      if(c==='/'&&html[j+1]==='*'){ j=html.indexOf('*/',j)+1; continue; }
      if(c==='/'&&html[j+1]==='\/'){ j=html.indexOf('\n',j)-1; continue; }
      if(c===open)depth++;
      else if(c===close){depth--; if(!depth){j++;break;}}
    }
    try{ return eval(DATA_PRELUDE+'('+html.slice(i,j)+')'); }catch(e){ return null; }
  }
  const MODELS25=grab25('MODELS')||[];
  const provRe=/\b20\d\d-\d\d-\d\d\b|sourced|this pass|confirmed absent|direct search|mirror|cached (?:doc|copy)|verified:true|cpuAllow|hsSku|BACKPLANE_|QuickSpecs a\d|stale-source/i;
  const badProv=[], tooLong=[];
  let noteCount25=0;
  MODELS25.forEach(function(m){
    ((m.rules&&m.rules.notes)||[]).forEach(function(n,idx){
      noteCount25++;
      if(provRe.test(n))badProv.push(m.m+' '+m.g+' ['+idx+']');
      if(n.length>500)tooLong.push(m.m+' '+m.g+' ['+idx+'] '+n.length);
    });
  });
  (MODELS25.length===59 && !MODELS25.some(function(m){return m.m==='DL120'&&m.g==='G10';}) && noteCount25>=400 && !badProv.length)
    ?pass25('model notes carry no sourcing history or internal keys ('+noteCount25+' notes across '+MODELS25.length+' models)')
    :fail25('model notes still hold provenance text: '+badProv.slice(0,8).join(', ')+' (models '+MODELS25.length+', notes '+noteCount25+')');
  !tooLong.length
    ?pass25('no model note runs past 500 characters (build-guide text, not a research log)')
    :fail25('over-long model notes: '+tooLong.join(', '));
  // the labels in the P824i-p controller entries must not narrate where the part number came from
  const provLabels=[];
  MODELS25.forEach(function(m){
    const r=m.rules||{};
    ['psu','ctrl','flr'].forEach(function(k){
      (r[k]||[]).forEach(function(l){ if(/sourced from|see note|own doc|not this one/i.test(l))provLabels.push(m.m+' '+m.g+' '+k+': '+l.slice(0,60)); });
    });
  });
  !provLabels.length
    ?pass25('psu/ctrl/flr list labels carry no "sourced from / see note" narration')
    :fail25('list labels with provenance text: '+provLabels.slice(0,5).join(' | '));

  // --- the spec slip is for the engineers: it names parts but carries no HPE part
  // numbers (2026-09-21). The pickers keep them for the sales side. ---
  const PN25=/\b[0-9P][0-9A-Z]{5}-(?=[0-9A-Z]*[0-9])[0-9A-Z]{3}\b/;
  function pick25(id,re){
    const inp=d.getElementById(id); inp.disabled=false; inp.value=''; fire(inp,'input'); fire(inp,'focus');
    const item=[...d.querySelectorAll('#ac-panel .combo-item')].find(function(el){return re.test(el.textContent.replace(/\s+/g,' ').trim());});
    if(!item)return null;
    const shown=item.textContent.replace(/\s+/g,' ').trim();
    item.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));   // attachList panels select on click
    return shown;
  }
  setModel25('DL360 G10');
  const risersEl25=d.getElementById('risers'); risersEl25.innerHTML='';
  const shownCtrl=pick25('ctrl',/^P408i-a LH/);
  const shownPsu=pick25('psu',/^800W Flex Slot Platinum/);
  const shownFlr=pick25('flr',/^562FLR-SFP\+/);
  const psuq25=d.getElementById('psuq'); psuq25.value='2'; fire(psuq25,'input');
  d.getElementById('add-riser').click();
  { const rn=[...risersEl25.querySelectorAll('[data-k=name]')].pop(); rn.value='Secondary 3-Slot Riser Kit (719073-B21)'; fire(rn,'input'); }
  const slip25=d.getElementById('slip').textContent;
  (shownCtrl && shownPsu && shownFlr && PN25.test(shownCtrl) && PN25.test(shownPsu) && PN25.test(shownFlr))
    ?pass25('the pickers still show part numbers to the sales side ('+shownCtrl+' | '+shownPsu+' | '+shownFlr+')')
    :fail25('picker labels lost their part numbers: '+[shownCtrl,shownPsu,shownFlr].join(' | '));
  (!PN25.test(slip25) && slip25.includes('P408i-a LH') && slip25.includes('2x 800W Flex Slot Platinum PS') && slip25.includes('562FLR-SFP+ 2x10Gb') && slip25.includes('Secondary 3-Slot Riser Kit'))
    ?pass25('spec slip names the controller, PSU, FlexibleLOM and riser but carries no part numbers')
    :fail25('slip still has part numbers or lost a name: '+slip25.slice(0,400));
  // a hand-typed bare part number is never blanked out, and a label with no part number stays whole
  const ctrl25=d.getElementById('ctrl'); ctrl25.value='804331-B21'; fire(ctrl25,'input');
  d.getElementById('slip').textContent.includes('804331-B21')
    ?pass25('a controller typed as a bare part number is kept on the slip as typed (never blanked)')
    :fail25('bare typed part number was dropped from the slip');
  ctrl25.value='No Smart Array controller exists on this chassis at all — Intel VROC embedded software RAID only'; fire(ctrl25,'input');
  d.getElementById('slip').textContent.includes('Intel VROC embedded software RAID only')
    ?pass25('a label without a part number keeps its whole text on the slip')
    :fail25('part-number-free label was trimmed');
  risersEl25.innerHTML='';
  ctrl25.value='';fire(ctrl25,'input');

  // --- the amber note under the SAS expander field follows the same decision as the EXPANDER
  // config check: whenever the build suggests one, the field says so too (2026-09-21) ---
  setModel25('DL380 G10');
  const bays25=d.getElementById('bays'); bays25.value='12LFF'; fire(bays25,'input');
  const expNote25=d.getElementById('expander-note'), exp25=d.getElementById('expander');
  exp25.value=''; fire(exp25,'input'); ctrl25.value=''; fire(ctrl25,'input');
  (/870549-B21/.test(expNote25.textContent) && expNote25.classList.contains('suggest') && /EXPANDER/.test(d.getElementById('checks').textContent))
    ?pass25('12 bays with no controller picked yet: amber note under the expander field names the DL380 G10 part, matching the EXPANDER check')
    :fail25('no-controller expander note wrong: "'+expNote25.textContent+'"');
  ctrl25.value='P408i-a'; fire(ctrl25,'input');
  (/8 ports/.test(expNote25.textContent) && /870549-B21/.test(expNote25.textContent))
    ?pass25('P408i-a (8 ports) with 12 bays: the note quotes the port count')
    :fail25('P408i-a expander note wrong: "'+expNote25.textContent+'"');
  ctrl25.value='P816i-a'; fire(ctrl25,'input');
  (expNote25.textContent==='' && !/EXPANDER/.test(d.getElementById('checks').textContent))
    ?pass25('P816i-a (16 ports) already addresses 12 bays: no expander note and no EXPANDER check')
    :fail25('P816i-a wrongly asks for an expander: "'+expNote25.textContent+'"');
  ctrl25.value='P408i-a'; fire(ctrl25,'input');
  exp25.value='12G SAS Expander Card (870549-B21)'; fire(exp25,'input');
  (expNote25.textContent==='' && !/EXPANDER/.test(d.getElementById('checks').textContent))
    ?pass25('picking an expander clears the note and the check')
    :fail25('expander note/check still showing after a pick: "'+expNote25.textContent+'"');
  exp25.value=''; fire(exp25,'input'); ctrl25.value=''; fire(ctrl25,'input'); bays25.value=''; fire(bays25,'input');

  // --- fan TDP step: worded like the heatsink one, shown up front, and a hard requirement ---
  // start from a blank sheet: earlier rounds leave a manual fan override, a FlexibleLOM, 2 PSUs etc. behind
  w.confirm=function(){return true;};
  d.getElementById('clear').click();
  const CPUS25=grab25('CPUS')||[];
  function pickCpuExact25(code){
    const ci=d.getElementById('cpu-input'); ci.value=''; fire(ci,'input');
    const opt=[...d.querySelectorAll('#cpu-panel .combo-item')].find(function(el){return el.querySelector('.ci-main').textContent===code;});
    if(!opt)return false;
    opt.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true})); return true;
  }
  const fanState25=function(){ const c=d.querySelector('input[name="fan"]:checked'); return c?c.value:''; };
  [['DL380 G11',206,'above 205W'],['DL345 G10+',280,'280W or higher'],['DL325 G10+ v2',280,'280W or higher'],
   ['DL380 G10+',206,'above 205W'],['DL360 G10+',205,'205W or higher'],['DL320 G12',186,'above 185W'],
   ['DL360 G12',186,'above 185W'],['ML350 G12',300,'300W or higher'],['DL325 G11',241,'above 240W']].forEach(function(t){
    const label=t[0], thr=t[1], words=t[2];
    const mo=MODELS25.find(function(m){return (m.m+' '+m.g)===label;});
    const allow=(mo.rules&&mo.rules.cpuAllow)||null;
    const pool=CPUS25.filter(function(c){return mo.p.indexOf(c[2])>-1&&(!allow||allow.indexOf(c[0])>-1)&&c[3];});
    const below=pool.filter(function(c){return c[3]<thr;}).sort(function(a,b){return b[3]-a[3];})[0];
    const above=pool.filter(function(c){return c[3]>=thr;}).sort(function(a,b){return a[3]-b[3];})[0];
    setModel25(label);
    if(!below||!above||!pickCpuExact25(below[0]))return fail25(label+': could not pick a CPU under the fan step');
    const why=d.getElementById('why-fan').textContent;
    (fanState25()==='Std Fans' && why.indexOf(words)>-1 && /below the high performance fan step/.test(why))
      ?pass25(label+': '+below[0]+' ('+below[3]+'W) keeps standard fans and the fan line states the step ("'+words+'")')
      :fail25(label+' fan line wrong under the step: '+fanState25()+' | '+why);
    if(!pickCpuExact25(above[0]))return fail25(label+': could not pick a CPU at the fan step');
    const chk=d.getElementById('checks').textContent;
    (fanState25()==='Perf Fans' && chk.indexOf(words)>-1 && /requires the high performance fan kit/.test(chk))
      ?pass25(label+': '+above[0]+' ('+above[3]+'W) sets Perf Fans automatically and says why ("'+words+'")')
      :fail25(label+' fans not raised at '+above[3]+'W: '+fanState25()+' | '+chk.slice(0,240));
  });
  // ...and it is mandatory: forcing Standard fans with a CPU over the step blocks the build, like NVMe does
  setModel25('DL380 G11');
  { const mo=MODELS25.find(function(m){return m.m==='DL380'&&m.g==='G11';});
    const hot=CPUS25.filter(function(c){return mo.p.indexOf(c[2])>-1&&c[3]>=206;}).sort(function(a,b){return a[3]-b[3];})[0];
    pickCpuExact25(hot[0]);
    d.getElementById('fn1').checked=true; fire(d.getElementById('fn1'),'change');
    (/Perf Fans is required/.test(d.getElementById('checks').textContent) && /Unsupported/.test(d.getElementById('count').textContent))
      ?pass25('DL380 G11: Standard fans forced with a '+hot[3]+'W CPU is a blocking error (performance fans are mandatory over the step)')
      :fail25('Standard fans over the fan step not blocked: '+d.getElementById('checks').textContent.slice(0,200));
    d.getElementById('clear').click(); }   // drops the manual fan override before the next checks
  // models with fixed fans / no CPU-wattage trigger in their QuickSpecs no longer inherit the G10+/G11 default step
  setModel25('DL110 G11');
  { const mo=MODELS25.find(function(m){return m.m==='DL110'&&m.g==='G11';});
    const hot=CPUS25.filter(function(c){return mo.p.indexOf(c[2])>-1&&c[3];}).sort(function(a,b){return b[3]-a[3];})[0];
    pickCpuExact25(hot[0]);
    (fanState25()!=='Perf Fans' && !/high performance fan kit/.test(d.getElementById('checks').textContent))
      ?pass25('DL110 G11 (fixed 7 fans): a '+hot[3]+'W CPU no longer forces performance fans')
      :fail25('DL110 G11 still gets a CPU-wattage fan requirement: '+fanState25()); }
  setModel25('DL325 G10+');
  { const mo=MODELS25.find(function(m){return m.m==='DL325'&&m.g==='G10+';});
    const hot=CPUS25.filter(function(c){return mo.p.indexOf(c[2])>-1&&(mo.rules.cpuAllow||[]).indexOf(c[0])>-1;}).sort(function(a,b){return b[3]-a[3];})[0];
    pickCpuExact25(hot[0]);
    (fanState25()==='Std Fans' && /not tied to processor wattage/.test(d.getElementById('why-fan').textContent))
      ?pass25('DL325 G10+ v1: '+hot[3]+'W CPU keeps standard fans; the fan line says fans are not tied to processor wattage on this model')
      :fail25('DL325 G10+ v1 fan line wrong: '+fanState25()+' | '+d.getElementById('why-fan').textContent); }
  setModel25('DL380 G10');
  { pickCpuExact25('S4110');
    (fanState25()==='Std Fans' && /not tied to processor wattage/.test(d.getElementById('why-fan').textContent))
      ?pass25('DL380 G10: the fan line explains fans follow NVMe / rear drives / GPU, not processor wattage')
      :fail25('DL380 G10 fan line wrong: '+d.getElementById('why-fan').textContent); }

  // --- heatsink pass (2026-09-21): models whose QuickSpecs list no orderable performance heatsink and no
  // wattage step get no recommendation; the G12 steps start one watt above the doc's "<=" value ---
  const hsState25=function(){ const c=d.querySelector('input[name="hs"]:checked'); return c?c.value:''; };
  ['DL160 G10','DL180 G10','ML110 G10','ML110 G11','DL110 G11','DL110 G10+','DL160 G9'].forEach(function(label){
    const mo=MODELS25.find(function(m){return (m.m+' '+m.g)===label;});
    const allow=(mo.rules&&mo.rules.cpuAllow)||null;
    const hot=CPUS25.filter(function(c){return mo.p.indexOf(c[2])>-1&&(!allow||allow.indexOf(c[0])>-1)&&c[3];}).sort(function(a,b){return b[3]-a[3];})[0];
    setModel25(label);
    if(!pickCpuExact25(hot[0]))return fail25(label+': could not pick '+hot[0]);
    (hsState25()==='Std Heatsinks' && /no standard-vs-performance heatsink choice/.test(d.getElementById('checks').textContent) && !/Recommended: Perf Heatsinks/.test(d.getElementById('checks').textContent))
      ?pass25(label+': a '+hot[3]+'W CPU gets no performance-heatsink recommendation (no such option in its QuickSpecs)')
      :fail25(label+' still recommends/asks for a heatsink choice: '+hsState25()+' | '+d.getElementById('checks').textContent.slice(0,200));
  });
  setModel25('DL340 G12');
  { const mo=MODELS25.find(function(m){return m.m==='DL340'&&m.g==='G12';});
    const allow=(mo.rules&&mo.rules.cpuAllow)||null;
    const pool=CPUS25.filter(function(c){return mo.p.indexOf(c[2])>-1&&(!allow||allow.indexOf(c[0])>-1)&&c[3];});
    const at250=pool.filter(function(c){return c[3]===250;})[0], over=pool.filter(function(c){return c[3]>250;}).sort(function(a,b){return a[3]-b[3];})[0];
    pickCpuExact25(at250[0]);
    (hsState25()==='Std Heatsinks')
      ?pass25('DL340 G12: a 250W CPU ('+at250[0]+') keeps the standard heatsink (doc: standard up to 250W)')
      :fail25('DL340 G12 250W CPU wrongly moved off standard heatsinks: '+hsState25());
    pickCpuExact25(over[0]);
    (hsState25()==='Perf Heatsinks')
      ?pass25('DL340 G12: '+over[0]+' ('+over[3]+'W) gets the performance heatsink (doc: above 250W)')
      :fail25('DL340 G12 '+over[3]+'W CPU not moved to performance heatsinks: '+hsState25()); }

  // ===== DL360 G11 / DL380 G11 audit against the V48 / V47 QuickSpecs (2026-09-21) =====
  w.confirm=function(){return true;};
  d.getElementById('clear').click();
  const chk26=function(){return d.getElementById('checks').textContent;};
  const setv26=function(id,val){const el=d.getElementById(id);el.value=val;fire(el,'input');};
  const cpuList26=function(){const ci=d.getElementById('cpu-input');ci.value='';fire(ci,'input');return [...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(e){return e.textContent;});};
  const opts26=function(id){const inp=d.getElementById(id);inp.disabled=false;inp.value='';fire(inp,'input');fire(inp,'focus');return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(e){return e.textContent;});};
  const speeds26=function(){return [...d.querySelectorAll('#dimm-speed-btns button')].map(function(b){return Number(b.getAttribute('data-sp'));});};

  // --- CPU pools: current orderable list plus SKUs the older docs still list; other models' parts excluded ---
  ['DL380 G11','DL360 G11'].forEach(function(label){
    setModel25(label);
    const cl=cpuList26();
    (cl.length===66 && cl.indexOf('P8593Q')>-1 && cl.indexOf('G6458Q')>-1 && cl.indexOf('P9462')>-1 && cl.indexOf('P8468H')<0 && cl.indexOf('G5412U')<0 && cl.indexOf('G6434H')<0 && cl.indexOf('G5512U')<0)
      ?pass25(label+': cpuAllow enforces the 66 SKUs its docs list (incl. discontinued 6458Q/8470Q), and keeps out the 4-socket H parts and other models\' U parts')
      :fail25(label+' CPU list wrong: '+cl.length+' options');
  });
  { const g6548=CPUS25.find(function(c){return c[0]==='G6548N';});
    (g6548&&g6548[3]===250)?pass25('Gold 6548N is 250W (both ordering lists; the DL380 feature table\'s 300W is a typo)'):fail25('G6548N TDP wrong: '+(g6548&&g6548[3])); }
  setModel25('DL380 G11'); pickCpuExact25('G6421N'); setv26('cpuq','2');
  /single-socket-only/.test(chk26())?pass25('Gold 6421N (0 UPI links) is single-socket-only, like 5411N and the U parts'):fail25('6421N not caught as single-socket: '+chk26().slice(0,160));
  setv26('cpuq','1');

  // --- per-CPU memory speed cap ---
  setModel25('DL380 G11'); pickCpuExact25('S4410Y');
  (speeds26().join()==='4000') ?pass25('DL380 G11 + Silver 4410Y: the speed buttons offer only 4000 MT/s (its cap)'):fail25('S4410Y speeds wrong: '+speeds26().join());
  setv26('dimmq','4'); setv26('dimm','32GB 4400 MT/s');
  (/MEMORY SPEED/.test(chk26()) && /4000 MT\/s/.test(chk26()))?pass25('a 4400 module on the 4000-capped Silver 4410Y is a hard stop naming the 4000 ceiling'):fail25('S4410Y cap not enforced: '+chk26().slice(0,200));
  pickCpuExact25('P8593Q');
  (speeds26().indexOf(5600)>-1 && speeds26().indexOf(4000)>-1)?pass25('DL380 G11 + Platinum 8593Q: up to 5600 MT/s offered'):fail25('P8593Q speeds wrong: '+speeds26().join());

  // --- DIMM kit part numbers (sales hint under the memory field, never on the slip) ---
  setModel25('DL380 G11'); pickCpuExact25('G6448Y'); setv26('dimmq','4'); setv26('dimm','64GB 4800 MT/s');
  (/P43331-B21/.test(d.getElementById('dimm-kit').textContent) && !/P43331/.test(d.getElementById('slip').textContent))
    ?pass25('64GB on a 4th Gen CPU shows the DDR5-4800 kit P43331-B21 under the field and not on the slip')
    :fail25('4th Gen kit hint wrong: "'+d.getElementById('dimm-kit').textContent+'"');
  pickCpuExact25('P8592+'); setv26('dimm','64GB 5600 MT/s');
  /P64707-B21/.test(d.getElementById('dimm-kit').textContent)?pass25('64GB on a 5th Gen CPU shows the DDR5-5600 kit P64707-B21'):fail25('5th Gen kit hint wrong: "'+d.getElementById('dimm-kit').textContent+'"');
  setv26('dimm','256GB 5600 MT/s');
  /P90554-B21/.test(d.getElementById('dimm-kit').textContent)?pass25('256GB 5600 kit is P90554-B21 (sp5 now offers 256GB)'):fail25('256GB 5th Gen kit hint wrong');
  pickCpuExact25('G6448Y'); setv26('dimm','256GB 4800 MT/s');
  (/P90050-B21/.test(d.getElementById('dimm-kit').textContent) && !/P90550/.test(d.getElementById('dimm-kit').textContent))
    ?pass25('256GB 4800 kit is P90050-B21 (the DL380 doc\'s P90550-B21 is a typo; its DL360 sibling and the -F21 twin say P90050)'):fail25('256GB 4th Gen kit wrong: "'+d.getElementById('dimm-kit').textContent+'"');

  // --- DL380 memory limits from the doc: 24SFF max 16 DIMMs; 256GB max 2 front cages; 128GB+ needs the HP fan kit ---
  setModel25('DL380 G11'); pickCpuExact25('G6438Y+'); setv26('cpuq','2'); setv26('bays','24SFF'); setv26('dimmq','20'); setv26('dimm','64GB 4800 MT/s');
  (/TOO MANY DIMMS/.test(chk26()) && d.getElementById('dimmq').max==='16')
    ?pass25('DL380 G11 24SFF: more than 16 DIMMs is blocked (doc: 16 DIMMs maximum with 24SFF) and the qty field caps at 16')
    :fail25('24SFF DIMM cap not enforced: max='+d.getElementById('dimmq').max+' '+chk26().slice(0,160));
  setv26('dimmq','8'); setv26('dimm','256GB 4800 MT/s');
  /256GB MEMORY/.test(chk26())?pass25('256GB DIMMs with the 24SFF chassis (3 front cages) are blocked'):fail25('256GB + 24SFF not blocked: '+chk26().slice(0,160));
  setv26('bays','16SFF');
  !/256GB MEMORY/.test(chk26())?pass25('...but 256GB with 16SFF (2 cages) is fine'):fail25('256GB + 16SFF wrongly blocked');
  setv26('bays','8SFF'); setv26('dimm','128GB 4800 MT/s'); setv26('dimmq','4');
  (/128GB memory modules require high performance fans/.test(chk26()))?pass25('128GB DIMMs require the high performance fan kit on the DL380 G11'):fail25('128GB fan rule missing: '+chk26().slice(0,200));
  setv26('cpuq','1'); setv26('dimm','96GB 4800 MT/s'); setv26('dimmq','8');
  !/96GB memory modules require high performance fans/.test(chk26())?pass25('...96GB alone does not force performance fans (128GB is the trigger where the doc is consistent)'):fail25('96GB wrongly forces fans');
  setv26('dimmq','5');
  /96GB MEMORY/.test(chk26())?pass25('5 x 96GB on one processor is flagged (4th Gen allows 8 or 16 per processor)'):fail25('96GB quantity rule missing');
  setv26('dimmq','8'); !/96GB MEMORY/.test(chk26())?pass25('8 x 96GB on one processor is fine'):fail25('96GB qty 8 wrongly flagged');

  // --- EE-LCC / HBM processors and large modules (both docs) ---
  setModel25('DL360 G11'); pickCpuExact25('S4509Y'); setv26('dimmq','4'); setv26('dimm','96GB 4400 MT/s');
  /96GB MEMORY/.test(chk26())?pass25('Silver 4509Y (EE-LCC die) cannot take 96GB modules'):fail25('4509Y + 96GB not blocked: '+chk26().slice(0,160));
  setv26('dimm','128GB 4400 MT/s');
  /128GB MEMORY/.test(chk26())?pass25('...nor non-3DS 128GB'):fail25('4509Y + 128GB not blocked');

  // --- lists with part numbers ---
  setModel25('DL380 G11');
  { const psu=opts26('psu'), ctrl=opts26('ctrl'), flr=opts26('flr'), bat=opts26('bat');
    (psu.length===5 && psu.every(function(o){return PN25.test(o);}))?pass25('DL380 G11 PSU picker: the 5 supplies its doc lists, each with its part number'):fail25('DL380 psu list wrong: '+psu.join(' | '));
    (ctrl.filter(function(o){return PN25.test(o);}).length===7 && ctrl.some(function(o){return /^SR932i-p.*P47184-B21/.test(o);}) && ctrl.some(function(o){return /^MR408i-o.*P58335-B21/.test(o);}))
      ?pass25('DL380 G11 controllers: SR932i-p, MR416i/MR216i -p/-o, MR408i-o and E208e-p, with part numbers'):fail25('DL380 ctrl list wrong: '+ctrl.join(' | '));
    (flr.length===11 && flr.every(function(o){return PN25.test(o);}) && flr.some(function(o){return /^BCM57608.*P73114-B21\)$/.test(o);}))
      ?pass25('DL380 G11 OCP 3.0 list: the 11 cards its doc lists (BCM57608 100Gb included, no "Gen12" tag)'):fail25('DL380 flr list wrong: '+flr.join(' | '));
    (bat.length===4 && bat.some(function(o){return /P02377-B21/.test(o);}) && bat.some(function(o){return /P01366-B21/.test(o);}))
      ?pass25('DL380 G11 battery list: 96W battery, hybrid capacitor(s), or none'):fail25('DL380 bat list wrong: '+bat.join(' | ')); }
  setModel25('DL360 G11');
  { const psu=opts26('psu'), flr=opts26('flr');
    (psu.length===7 && psu.some(function(o){return /^500W.*865408-B21/.test(o);}))?pass25('DL360 G11 PSU picker: 7 supplies incl. the 500W (4LFF only)'):fail25('DL360 psu list wrong: '+psu.join(' | '));
    (flr.length===11)?pass25('DL360 G11 OCP 3.0 list: 11 cards'):fail25('DL360 flr list wrong: '+flr.length); }
  // the slip still carries no part numbers for any of it
  setv26('psu','800W Flex Slot Platinum (P38995-B21)'); setv26('psuq','2'); setv26('ctrl','MR416i-p — x16 lanes, 8GB cache (P47777-B21)');
  setv26('bat','96W Smart Storage Lithium-ion battery with 145mm cable (P01366-B21; stand-alone P68039-B21)');
  { const sl=d.getElementById('slip').textContent;
    (!PN25.test(sl) && /2x 800W Flex Slot Platinum PS/.test(sl) && /MR416i-p \+ 96W Smart Storage Lithium-ion battery with 145mm cable/.test(sl))
      ?pass25('slip: controller + battery + PSU named without any part number'):fail25('slip carries a part number or lost a name: '+sl.slice(0,300)); }
  setv26('psu',''); setv26('ctrl',''); setv26('bat','');

  // --- bays: DL360 10SFF (8+2) and EDSFF chassis on both ---
  { const mods=[['DL360 G11',['4LFF','8SFF','10SFF','20EDSFF']],['DL380 G11',['8LFF','12LFF','8SFF','16SFF','24SFF','12EDSFF','36EDSFF']]];
    mods.forEach(function(t){
      setModel25(t[0]);
      const btn=[...d.querySelectorAll('#bays-btns button')].map(function(b){return b.textContent.trim();});
      t[1].every(function(b){return btn.indexOf(b)>-1;})?pass25(t[0]+': bay buttons '+t[1].join('/')):fail25(t[0]+' bay buttons wrong: '+btn.join('/'));
    }); }
  setModel25('DL360 G11'); setv26('bays','20EDSFF');
  /20 bays/.test(d.getElementById('bay-note').textContent)?pass25('20EDSFF counts as 20 drive bays'):fail25('EDSFF bay count wrong: '+d.getElementById('bay-note').textContent);
  setv26('ctrl','MR416i-p — x16 lanes, 8GB cache (P47777-B21)');
  /EDSFF CONTROLLER/.test(chk26())?pass25('an internal RAID controller on the EDSFF chassis is blocked (none exists for it)'):fail25('EDSFF + controller not blocked: '+chk26().slice(0,160));
  setv26('ctrl','E208e-p — external HBA, 8 lanes, no cache (804398-B21)');
  !/EDSFF CONTROLLER/.test(chk26())?pass25('...the external E208e-p HBA is allowed'):fail25('E208e-p wrongly blocked on EDSFF');
  setv26('ctrl','');
  setModel25('DL380 G11'); setv26('bays','12EDSFF'); d.getElementById('bp1').checked=true; fire(d.getElementById('bp1'),'change');
  /BACKPLANE MISMATCH/.test(chk26())?pass25('DL380 G11 EDSFF is NVMe-only: a SAS/SATA backplane is blocked'):fail25('DL380 EDSFF backplane not blocked: '+chk26().slice(0,160));
  pickCpuExact25('P8581V'); setv26('cpuq','1');
  /cannot be selected with the EDSFF chassis/.test(chk26())?pass25('Platinum 8581V is not offered on the DL380 G11 EDSFF chassis'):fail25('8581V + EDSFF not blocked');
  setv26('bays','');

  // --- fans / heatsinks ---
  setModel25('DL380 G11'); setv26('dimm',''); setv26('dimmq',''); pickCpuExact25('G6438Y+'); setv26('cpuq','2');
  d.getElementById('fanq').value==='6'?pass25('DL380 G11 with two processors: 6 standard fans (4 that ship + the 2-fan Standard Fan Kit) — HPE\'s user guide: dual processors need all six fan bays'):fail25('DL380 G11 2P standard fans wrong (want 6): '+d.getElementById('fanq').value);
  setModel25('DL360 G11'); pickCpuExact25('G6426Y'); setv26('cpuq','1');
  hsState25()==='Std Heatsinks'?pass25('DL360 G11 + 185W Gold 6426Y: standard heatsink'):fail25('DL360 185W heatsink wrong: '+hsState25());
  d.getElementById('bp2').checked=true; fire(d.getElementById('bp2'),'change');
  (hsState25()==='Perf Heatsinks' && /NVMe \/ 24G SAS drives require the performance heatsink/.test(chk26()))?pass25('DL360 G11: NVMe forces the performance heatsink even at 185W (doc)'):fail25('DL360 NVMe heatsink rule missing: '+hsState25());
  d.getElementById('bp1').checked=true; fire(d.getElementById('bp1'),'change');
  setv26('dimmq','4'); setv26('dimm','256GB 4800 MT/s');
  (hsState25()==='Perf Heatsinks' && /256GB memory modules require the performance heatsink/.test(chk26()))?pass25('DL360 G11: 256GB DIMMs require the performance heatsink'):fail25('DL360 256GB heatsink rule missing: '+chk26().slice(0,200));
  setv26('dimm',''); setv26('dimmq','');
  pickCpuExact25('P8580'); setv26('cpuq','1');
  /LIQUID COOLING REQUIRED/.test(chk26())?pass25('DL360 G11: a single 350W CPU needs liquid cooling (air only covers up to 300W)'):fail25('DL360 350W liquid rule missing: '+chk26().slice(0,200));
  { const RIS26=grab25('RISERS')||{};
    (RIS26['DL360 G11']||[]).some(function(k){return /P75407-B21/.test(k.n);})?pass25('DL360 G11 riser kits include the field-upgrade primary riser P75407-B21'):fail25('P75407 riser missing');
    (RIS26['DL380 G11']||[]).some(function(k){return /Tertiary.*P48804-B21/.test(k.n);})?pass25('DL380 G11 tertiary riser carries its part number P48804-B21'):fail25('P48804 tertiary name missing'); }

  // ===== DL360 / DL380 Gen11: rear-cage positions, rail / bezel / iLO hints, stand-up cards, NS204i-u (2026-09-21) =====
  const reset27=function(){d.getElementById('clear').click();};
  const addRear27=function(val){
    d.getElementById('add-rear').disabled=false;
    d.getElementById('add-rear').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    const rows=d.querySelectorAll('#rear-lines [data-k=v]'),inp=rows[rows.length-1];
    inp.value=val;fire(inp,'input');return inp;};
  const addLine27=function(btn,boxSel,val,q){
    d.getElementById(btn).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    const rows=d.querySelectorAll(boxSel+' .line'),row=rows[rows.length-1];
    const nm=row.querySelector('[data-k=name]');nm.value=val;fire(nm,'input');
    if(q){const qq=row.querySelector('[data-k=q]');qq.value=q;fire(qq,'input');}
    return row;};
  const addCard27=function(val,q){return addLine27('add-card','#cards',val,q);};
  const addRiser27=function(val,q){return addLine27('add-riser','#risers',val,q);};
  const slip27=function(){return d.getElementById('slip').textContent;};
  const fanState27=function(){const c=d.querySelector('input[name="fan"]:checked');return c?c.value:'';};
  const CAGE={
    p2sff:'2SFF rear, primary riser (P48810-B21)', s2sff:'2SFF rear, secondary riser (P48810-B21)', t2sff:'2SFF rear, tertiary riser (P48811-B21)',
    p2lff:'2LFF rear, primary riser (P48823-B21)', s2lff:'2LFF rear, secondary riser, low-profile (P51095-B21)', st2lff:'2LFF rear, secondary and tertiary risers (P48826-B21)',
    m4lff:'4LFF midtray (P48809-B21)', m8x1:'8SFF midtray, x1 Tri-Mode (P48815-B21)', m8x4:'8SFF midtray, x4 Tri-Mode (P48816-B21)'};

  // --- rear cages: one per riser position, chassis class decides which kits exist ---
  reset27(); setModel25('DL380 G11'); setv26('bays','24SFF');
  addRear27(CAGE.p2sff); addRear27(CAGE.s2sff); addRear27(CAGE.t2sff);
  (!/REAR CONFLICT|REAR NOT SUPPORTED/.test(chk26()))?pass25('DL380 G11 24SFF: 2SFF cages in the primary, secondary and tertiary positions are accepted together (6SFF rear)'):fail25('DL380 3-position rear wrongly blocked: '+chk26().slice(0,240));
  { const sl=slip27();
    (/24SFF \+ 2SFF rear, primary riser \+ 2SFF rear, secondary riser \+ 2SFF rear, tertiary riser/.test(sl) && !PN25.test(sl))
      ?pass25('slip: each rear cage keeps its riser position and drops its part number'):fail25('slip rear line wrong: '+sl.slice(0,200)); }
  /30 bays/.test(d.getElementById('bay-note').textContent)
    ?pass25('24SFF + three 2SFF rear cages = 30 drive bays'):fail25('bay count wrong: '+d.getElementById('bay-note').textContent);
  addRear27('2SFF rear');
  /at most 3 2SFF rear cages/.test(chk26())?pass25('a fourth 2SFF rear cage (typed) on the SFF chassis is blocked — the table allows 3'):fail25('4th 2SFF not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','24SFF');
  addRear27(CAGE.p2sff); addRear27(CAGE.p2sff);
  /Two rear cages are in the primary riser position/.test(chk26())?pass25('two cages in the same riser position are blocked'):fail25('same-position cages not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','24SFF'); addRear27(CAGE.p2lff);
  /REAR NOT SUPPORTED.*8LFF and 12LFF chassis only/.test(chk26())?pass25('a 2LFF rear cage on the 24SFF chassis is blocked (LFF chassis only)'):fail25('2LFF on SFF not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','12LFF'); addRear27(CAGE.p2sff);
  /REAR NOT SUPPORTED.*8SFF and 24SFF chassis only/.test(chk26())?pass25('the 2SFF primary/secondary riser cage on a 12LFF chassis is blocked (SFF chassis only)'):fail25('2SFF riser cage on LFF not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','12LFF'); addRear27(CAGE.p2lff); addRear27(CAGE.s2lff);
  (!/REAR CONFLICT|REAR NOT SUPPORTED/.test(chk26()))?pass25('DL380 G11 12LFF: primary + secondary 2LFF cages (4LFF rear) accepted'):fail25('4LFF rear wrongly blocked: '+chk26().slice(0,240));
  /uses up every PCIe slot/.test(chk26())?pass25('a 2LFF rear cage notes that it uses up its riser position\'s slots'):fail25('2LFF slot note missing');
  addRear27('2LFF rear');
  /at most 2 2LFF rear cages/.test(chk26())?pass25('a third 2LFF rear cage is blocked (the table allows 2)'):fail25('3rd 2LFF not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','12LFF'); addRear27(CAGE.s2lff); addRear27(CAGE.st2lff);
  /Two rear cages are in the secondary riser position/.test(chk26())?pass25('the secondary-and-tertiary 2LFF cage collides with a secondary-position cage'):fail25('ST vs S not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','12LFF'); addRear27(CAGE.s2lff);
  addRiser27('2U x16/x16/x16 Secondary Riser Kit (P51083-B21)');
  /REAR \/ RISER CONFLICT.*secondary riser position/.test(chk26())?pass25('a 2LFF secondary cage with a secondary riser kit is blocked (the QuickSpecs rule)'):fail25('S cage + secondary riser not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','12LFF'); addRear27(CAGE.st2lff);
  addRiser27('2U x16/x16 Tertiary Riser Kit (P48804-B21)');
  /REAR \/ RISER CONFLICT.*tertiary riser position/.test(chk26())?pass25('the secondary-and-tertiary 2LFF cage with a tertiary riser is blocked'):fail25('ST cage + tertiary riser not blocked: '+chk26().slice(0,240));
  // 2SFF riser cage needs the x8/x16/x8 secondary riser (and so CPU 2)
  reset27(); setModel25('DL380 G11'); setv26('bays','24SFF'); setv26('cpuq','1'); addRear27(CAGE.s2sff);
  /x8\/x16\/x8 Secondary Riser Kit \(P48802-B21\).*second processor, but one is selected/.test(chk26())?pass25('a 2SFF riser cage without the P48802 secondary riser is flagged (and the 2nd processor it needs)'):fail25('P48802 requirement missing: '+chk26().slice(0,240));
  addRiser27('2U x8/x16/x8 Secondary Riser Kit (P48802-B21)');
  (!/require the x8\/x16\/x8 Secondary Riser/.test(chk26()) && /blocks Slots 4 and 5/.test(chk26()))?pass25('...with P48802 fitted the flag clears and the "blocks Slots 4 and 5" note appears'):fail25('P48802 present handling wrong: '+chk26().slice(0,240));
  // mid-tray: one location; only the x4 cage needs SR932i-p on an 8SFF build
  reset27(); setModel25('DL380 G11'); setv26('bays','8SFF'); addRear27(CAGE.m4lff); addRear27(CAGE.m8x1);
  /More than one mid-tray cage/.test(chk26())?pass25('two mid-tray cages are blocked — one mid-tray bay'):fail25('two midtrays not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','8SFF'); addRear27(CAGE.m8x1);
  !/MIDTRAY CONTROLLER/.test(chk26())?pass25('the x1 Tri-Mode 8SFF mid-tray does not trigger the SR932i-p / bundle requirement'):fail25('x1 midtray wrongly flagged');
  reset27(); setModel25('DL380 G11'); setv26('bays','8SFF'); addRear27(CAGE.m8x4);
  /MIDTRAY CONTROLLER/.test(chk26())?pass25('the x4 8SFF mid-tray on an 8SFF build still requires SR932i-p or the bundle'):fail25('x4 midtray not flagged: '+chk26().slice(0,240));
  // EDSFF: only the tertiary 2SFF cage, one at most
  reset27(); setModel25('DL380 G11'); setv26('bays','12EDSFF'); addRear27(CAGE.p2sff);
  /REAR NOT SUPPORTED/.test(chk26())?pass25('EDSFF chassis: the primary/secondary 2SFF riser cage is not offered'):fail25('EDSFF P48810 not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); setv26('bays','12EDSFF'); addRear27(CAGE.t2sff);
  (!/REAR CONFLICT|REAR NOT SUPPORTED/.test(chk26()))?pass25('EDSFF chassis: one 2SFF rear cage (tertiary) accepted'):fail25('EDSFF T cage wrongly blocked: '+chk26().slice(0,240));
  addRear27('2SFF rear');
  /at most 1 2SFF rear cage/.test(chk26())?pass25('EDSFF chassis: a second 2SFF rear cage is blocked'):fail25('EDSFF 2nd 2SFF not blocked: '+chk26().slice(0,240));
  // typed lines that carry no position are still accepted (and counted)
  reset27(); setModel25('DL380 G11'); setv26('bays','24SFF'); addRear27('2SFF rear'); addRear27('4LFF midtray');
  (!/REAR CONFLICT|REAR NOT SUPPORTED/.test(chk26()))?pass25('a hand-typed "2SFF rear" + "4LFF midtray" still passes (no position to conflict)'):fail25('typed rear wrongly blocked: '+chk26().slice(0,240));
  // DL360 G11 has no rear bays at all
  reset27(); setModel25('DL360 G11'); addRear27('2SFF rear');
  /NO REAR BAYS/.test(chk26())?pass25('DL360 G11: any rear line is blocked — 1U, no rear or mid-tray bays'):fail25('DL360 G11 rear not blocked');

  // --- rail / bezel / iLO hints ---
  reset27(); setModel25('DL380 G11');
  { const rn=d.getElementById('rail-note').textContent;
    (/Easy Install Rail 3 Kit P52341-B21/.test(rn) && /P22020-B21/.test(rn) && !/P52343-B21/.test(rn))?pass25('DL380 G11 rail hint: Easy Install Rail 3 Kit P52341-B21 and the 2U cable management arm P22020-B21'):fail25('DL380 rail note wrong: '+rn); }
  reset27(); setModel25('DL360 G11'); setv26('bays','4LFF');
  { const rn=d.getElementById('rail-note').textContent;
    (/Rail 5 Kit P52343-B21/.test(rn) && !/P52341-B21/.test(rn) && /P70741-B21/.test(rn) && /P26489-B21/.test(rn))?pass25('DL360 G11 4LFF rail hint: Rail 5 Kit P52343-B21 (not Rail 3), both CMAs'):fail25('DL360 4LFF rail note wrong: '+rn); }
  setv26('bays','8SFF');
  { const rn=d.getElementById('rail-note').textContent;
    (/Rail 3 Kit P52341-B21/.test(rn) && !/P52343-B21/.test(rn))?pass25('DL360 G11 8SFF rail hint: Rail 3 Kit P52341-B21'):fail25('DL360 8SFF rail note wrong: '+rn); }
  setv26('bays','20EDSFF');
  /Rail 5 Kit P52343-B21/.test(d.getElementById('rail-note').textContent)?pass25('DL360 G11 20EDSFF rail hint: Rail 5 Kit'):fail25('DL360 EDSFF rail note wrong: '+d.getElementById('rail-note').textContent);
  setv26('bays','');
  { const rn=d.getElementById('rail-note').textContent;
    (/P52341-B21 \(8SFF \/ 10SFF\)/.test(rn) && /P52343-B21 \(4LFF \/ 20EDSFF\)/.test(rn))?pass25('DL360 G11 rail hint with no bay chosen lists both kits with the chassis each fits'):fail25('DL360 blank-bay rail note wrong: '+rn); }
  reset27(); setModel25('DL380 G11');
  { const bn=d.getElementById('bezel-note').textContent;
    (/P50400-B21/.test(bn) && /875519-B21/.test(bn))?pass25('DL380 G11 bezel hint: Gen11 2U Bezel Kit P50400-B21, lock kit 875519-B21'):fail25('DL380 bezel note wrong: '+bn); }
  d.getElementById('bz0').checked=true; d.getElementById('bk1').checked=true; fire(d.getElementById('bk1'),'change');
  (!d.getElementById('bk1').checked && d.getElementById('bkey-set').hidden)?pass25('a bezel key with no bezel is cleared and the key pills hidden (the lock kit needs the bezel kit)'):fail25('bezel key without bezel kept');
  d.getElementById('bz1').checked=true; fire(d.getElementById('bz1'),'change');
  !/A bezel key is ticked/.test(chk26())?pass25('...and clears once the bezel is on'):fail25('bezel flag did not clear');
  d.getElementById('bk0').checked=true; d.getElementById('bz0').checked=true;
  setModel25('DL360 G11');
  /No bezel or bezel-lock part number is listed/.test(d.getElementById('bezel-note').textContent)?pass25('DL360 G11 bezel hint: its QuickSpecs list no bezel part number — says so instead of guessing'):fail25('DL360 bezel note wrong: '+d.getElementById('bezel-note').textContent);
  ['DL380 G11','DL360 G11'].forEach(function(label){
    setModel25(label);
    const inote=d.getElementById('ilo-note').textContent;
    (/512485-B21/.test(inote) && /BD505A/.test(inote) && /E6U59ABE/.test(inote) && /E6U64ABE/.test(inote))?pass25(label+' iLO hint: Advanced licence 1-year 512485-B21 / 3-year BD505A and the electronic licences'):fail25(label+' iLO note wrong: '+inote);
    d.getElementById('il2').checked=true; fire(d.getElementById('il2'),'change');
    /ILO.*no separate Advanced Premium licence/.test(chk26())?pass25(label+': iLO Advanced Premium is flagged — the QuickSpecs list iLO Advanced only'):fail25(label+' Premium not flagged: '+chk26().slice(0,240));
    d.getElementById('il0').checked=true; fire(d.getElementById('il0'),'change');
  });
  setModel25('DL380 G9');
  (d.getElementById('rail-note').textContent==='' && d.getElementById('bezel-note').textContent==='' && d.getElementById('ilo-note').textContent==='')?pass25('models without sourced rail / bezel / iLO data (DL380 G9) show no hint'):fail25('DL380 G9 shows a hint');
  reset27(); setModel25('DL380 G11'); d.getElementById('rl1').checked=true; d.getElementById('bz1').checked=true; d.getElementById('il1').checked=true;
  fire(d.getElementById('il1'),'change');
  !/P52341|P22020|P50400|875519|512485|BD505A/.test(slip27())?pass25('slip: rail / bezel / iLO part numbers never appear'):fail25('slip carries a rail/bezel/iLO PN: '+slip27().slice(0,300));

  // --- stand-up NIC / FC HBA / NS204i-u lists ---
  const cardOpts27=function(){
    d.getElementById('add-card').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    const rows=d.querySelectorAll('#cards .line'),nm=rows[rows.length-1].querySelector('[data-k=name]');
    nm.value='';fire(nm,'input');fire(nm,'focus');
    const out=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(e){return e.textContent;});
    rows[rows.length-1].remove();return out;};
  reset27(); setModel25('DL380 G11');
  { const o=cardOpts27();
    (o.length===32 && o.every(function(x){return /\((?:[0-9P][0-9A-Z]{5}-[0-9A-Z]{3}|[RS][0-9][A-Z0-9]{3}A)\)$/.test(x)||/\(.*(?:[0-9P][0-9A-Z]{5}-[0-9A-Z]{3}).*\)$/.test(x);}))
      ?pass25('DL380 G11 card picker: 32 stand-up NIC / InfiniBand / FC / NS204i-u options, every one carrying its part number'):fail25('DL380 card list wrong ('+o.length+'): '+o.slice(0,4).join(' | '));
    ['E810-XXVDA2 10/25Gb 2p SFP28 (P08443-B21)','BCM57608 100Gb 2p QSFP112 (P73111-B21)','SN1610Q 32Gb FC 1p (R2E08A)','SN1700E 64Gb FC 2p (R7N78A)','Secure Network Adapter 10/25Gb 2p SFP28 NVMe-oF crypto (S2A69A)','I350-T4 1Gb 4p BASE-T (P21106-B21)'].every(function(x){return o.indexOf(x)>-1;})
      ?pass25('DL380 G11 card picker carries the doc\'s PNs (E810-XXVDA2 P08443-B21, BCM57608 P73111-B21, SN1610Q R2E08A, SN1700E R7N78A, the crypto card S2A69A, I350-T4 P21106-B21)'):fail25('DL380 card PNs missing');
    (!o.some(function(x){return /NVIDIA (?:A|L|H|T)\d|Tesla/.test(x);}))?pass25('no GPUs in the DL380 G11 stand-up list (out of scope)'):fail25('a GPU is in the list'); }
  reset27(); setModel25('DL360 G11');
  { const o=cardOpts27();
    (o.length===31 && !o.some(function(x){return /S2A69A/.test(x);}))?pass25('DL360 G11 card picker: 31 options — the same catalogue minus the DL380-only crypto card'):fail25('DL360 card list wrong ('+o.length+')'); }
  reset27(); setModel25('DL380 G9');
  { const o=cardOpts27();
    (o.indexOf('366T 4x1GbE')>-1 && !o.some(function(x){return /P08443-B21/.test(x);}))?pass25('models without their own card list keep the generic starter list'):fail25('DL380 G9 card list changed: '+o.slice(0,3).join(' | ')); }
  // slip strips the part numbers off the cards (hyphenated and suffix-less SKUs)
  reset27(); setModel25('DL380 G11');
  addCard27('SN1610Q 32Gb FC 1p (R2E08A)','1'); addCard27('E810-XXVDA2 10/25Gb 2p SFP28 (P08443-B21)','2');
  addCard27('NS204i-u Gen11 boot device, internal (P48183-B21, cable kit P52152-B21)','1');
  { const sl=slip27();
    (/1x SN1610Q 32Gb FC 1p(?!\s*\()/.test(sl) && /2x E810-XXVDA2 10\/25Gb 2p SFP28(?!\s*\()/.test(sl) && /1x NS204i-u Gen11 boot device, internal(?!\s*\()/.test(sl) && !/R2E08A|P08443|P48183|P52152/.test(sl))
      ?pass25('slip: card names keep model, ports and mounting, lose every part number (incl. the suffix-less R2E08A)'):fail25('slip cards wrong: '+sl.slice(0,400)); }

  // --- 100Gb+ adapters: fans, heatsinks, 256GB ---
  reset27(); setModel25('DL360 G11'); pickCpuExact25('G6426Y'); setv26('cpuq','1');
  addCard27('E810-XXVDA2 10/25Gb 2p SFP28 (P08443-B21)','1');
  (fanState27()!=='Perf Fans' && hsState25()==='Std Heatsinks')?pass25('DL360 G11: a 10/25Gb adapter does not trigger performance fans or heatsinks (control)'):fail25('25Gb wrongly forces perf: '+fanState27()+'/'+hsState25());
  reset27(); setModel25('DL360 G11'); pickCpuExact25('G6426Y'); setv26('cpuq','1');
  addCard27('E810-CQDA2 100Gb 2p QSFP28 (P21112-B21)','1');
  (fanState27()==='Perf Fans' && hsState25()==='Perf Heatsinks' && /100Gb-or-faster adapter.*high performance fan kit/.test(chk26()) && /100Gb-or-faster adapter.*performance heatsink/.test(chk26()))
    ?pass25('DL360 G11: a 100Gb PCIe adapter sets performance fans AND heatsinks (both QuickSpecs rules)'):fail25('DL360 100Gb rules wrong: '+fanState27()+'/'+hsState25()+' '+chk26().slice(0,240));
  reset27(); setModel25('DL360 G11'); pickCpuExact25('G6426Y'); setv26('cpuq','1');
  setv26('flr','E810-CQDA2 100Gb 2p (P22767-B21)');
  (fanState27()==='Perf Fans' && hsState25()==='Perf Heatsinks')?pass25('DL360 G11: a 100Gb OCP card triggers the same performance fans + heatsinks'):fail25('DL360 100Gb OCP rules wrong: '+fanState27()+'/'+hsState25());
  setv26('dimmq','8'); setv26('dimm','256GB 4800 MT/s');
  /256GB MEMORY.*E810-CQDA2 100Gb 2p/.test(chk26())?pass25('DL360 G11: 256GB DIMMs with a 100Gb OCP card are blocked (either way round)'):fail25('DL360 256GB + 100Gb not blocked: '+chk26().slice(0,300));
  setv26('flr',''); addCard27('BCM57608 100Gb 2p QSFP112 (P73111-B21)','1');
  /256GB MEMORY.*BCM57608 100Gb 2p QSFP112/.test(chk26())?pass25('DL360 G11: 256GB DIMMs with a 100Gb PCIe card are blocked'):fail25('DL360 256GB + PCIe 100Gb not blocked: '+chk26().slice(0,300));
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G5416S'); setv26('cpuq','1');
  addCard27('E810-CQDA2 100Gb 2p QSFP28 (P21112-B21)','1');
  (fanState27()==='Perf Fans' && hsState25()==='Std Heatsinks' && /25°C ambient only/.test(chk26()))
    ?pass25('DL380 G11: a 100Gb adapter needs performance fans (no heatsink rule) and shows the 25°C / x16-slot note'):fail25('DL380 100Gb rules wrong: '+fanState27()+'/'+hsState25()+' '+chk26().slice(0,240));
  setv26('dimmq','8'); setv26('dimm','256GB 4800 MT/s');
  !/256GB MEMORY/.test(chk26())?pass25('DL380 G11: 256GB DIMMs are not excluded by a 100GbE adapter (only by InfiniBand)'):fail25('DL380 256GB wrongly blocked by 100GbE');
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G6426Y'); setv26('cpuq','1'); setv26('dimmq','8'); setv26('dimm','256GB 4800 MT/s');
  addCard27('InfiniBand NDR 400Gb 1p OSFP MCX75310AAS-NEAT (P45641-H24)','1');
  (/256GB MEMORY.*InfiniBand/.test(chk26()) && /INFINIBAND.*OCP2 x16 Enablement Kit \(P48828-B21\)/.test(chk26()))?pass25('DL380 G11: InfiniBand + 256GB DIMMs blocked, and the IB requirements listed'):fail25('DL380 IB rules wrong: '+chk26().slice(0,300));
  setv26('dimm',''); setv26('dimmq',''); setv26('bays','24SFF');
  /NOT SUPPORTED.*InfiniBand adapters are not supported on the 24SFF chassis/.test(chk26())?pass25('DL380 G11: InfiniBand on the 24SFF chassis is blocked'):fail25('IB on 24SFF not blocked: '+chk26().slice(0,300));
  setv26('bays','12LFF');
  /InfiniBand adapters are not supported on the 12LFF chassis/.test(chk26())?pass25('DL380 G11: InfiniBand on the 12LFF chassis is blocked'):fail25('IB on 12LFF not blocked');

  // --- 4-port NICs (DL360: not in Slot 2, one without a secondary riser) ---
  reset27(); setModel25('DL360 G11');
  addCard27('BCM57504 10/25Gb 4p SFP28 (P26264-B21)','1');
  /4-PORT NIC.*cannot go in Slot 2.*allow 1 of them/.test(chk26())?pass25('DL360 G11: one 4-port PCIe NIC carries the Slot 2 / one-without-secondary-riser note'):fail25('4-port note missing: '+chk26().slice(0,240));
  addCard27('I350-T4 1Gb 4p BASE-T (P21106-B21)','1');
  /verify.*4-PORT NIC|4-PORT NIC.*2 listed/.test(chk26()) || /2 listed/.test(chk26())?pass25('DL360 G11: two 4-port cards with no secondary riser exceed the doc\'s limit of 1'):fail25('4-port excess not flagged: '+chk26().slice(0,240));
  addRiser27('x16 LP Riser Kit — Secondary (P48903-B21)'); setv26('cpuq','2');
  /allow 2 of them with the secondary riser/.test(chk26())?pass25('...with a secondary riser the limit is 2'):fail25('4-port limit with riser wrong: '+chk26().slice(0,240));

  // --- NS204i-u boot device ---
  reset27(); setModel25('DL360 G11'); pickCpuExact25('G6426Y'); setv26('cpuq','1');
  addCard27('NS204i-u Gen11 boot device, internal (P48183-B21, cable kit P48920-B21)','1');
  (hsState25()==='Perf Heatsinks' && /NS204i-u boot device requires the performance heatsink/.test(chk26()))?pass25('DL360 G11: any NS204i-u boot device sets the performance heatsink'):fail25('DL360 NS204i-u heatsink rule missing: '+hsState25());
  addCard27('E810-XXVDA2 10/25Gb 2p SFP28 (P08443-B21)','2');
  !/TOO MANY CARDS/.test(chk26())?pass25('DL360 G11: the internal NS204i-u takes no PCIe slot (2 NICs still fit the 2 slots)'):fail25('internal NS204i-u wrongly counted as a slot: '+chk26().slice(0,240));
  reset27(); setModel25('DL360 G11'); pickCpuExact25('G6426Y'); setv26('cpuq','1');
  addCard27('NS204i-u Gen11 boot device, hot-plug at rear (P48183-B21, cable kit P54702-B21)','1'); addCard27('E810-XXVDA2 10/25Gb 2p SFP28 (P08443-B21)','2');
  (/TOO MANY CARDS/.test(chk26()) && /replaces the Slot 2 cage/.test(chk26()))?pass25('DL360 G11: the rear (hot-plug) NS204i-u kit uses Slot 2 — 2 NICs + it exceed the 2 slots, and the note says why'):fail25('DL360 rear NS204i-u slot rule wrong: '+chk26().slice(0,300));
  reset27(); setModel25('DL360 G11'); setv26('cpuq','2');
  addCard27('NS204i-u v2 960GB boot device, hot-plug at rear (P81160-B21, cable kit P54702-B21)','1');
  addRiser27('x16 Full Height Riser Kit — Secondary (P48901-B21)');
  /NS204i-u.*cannot be fitted with the full-height secondary riser \(P48901-B21\)/.test(chk26())?pass25('DL360 G11: the rear NS204i-u kit with the full-height secondary riser is blocked'):fail25('NS204i-u + P48901 not blocked: '+chk26().slice(0,300));
  reset27(); setModel25('DL360 G11');
  addCard27('NS204i-u Gen11 boot device, internal (P48183-B21, cable kit P48920-B21)','1'); addCard27('NS204i-u v2 960GB boot device, hot-plug at rear (P81160-B21, cable kit P54702-B21)','1');
  /NS204i-u.*One NS204i-u boot device fits per server|One NS204i-u boot device fits per server/.test(chk26())?pass25('a second NS204i-u (internal + rear) is blocked — one per server'):fail25('2 NS204i-u not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G5416S'); setv26('cpuq','1');
  addCard27('NS204i-u v2 960GB SED boot device, hot-plug (externally accessible) (P81162-B21, cable kit P52152-B21, FIO bundle P54542-B21)','1');
  addCard27('E810-XXVDA2 10/25Gb 2p SFP28 (P08443-B21)','3');
  (!/TOO MANY CARDS/.test(chk26()) && hsState25()!=='Perf Heatsinks')?pass25('DL380 G11: the NS204i-u takes no PCIe slot and has no heatsink rule (3 NICs fit the 3 slots)'):fail25('DL380 NS204i-u handling wrong: '+hsState25()+' '+chk26().slice(0,240));
  reset27();

  // ===== DL380 fan counts (user-reported 2026-09-21: "takes 4 standard fans — 6 entered" on a 2-processor build) =====
  // HPE's DL380 Gen11 / Gen12 user guides: single processor = 4 fans + 2 blanks, dual processors = 6 fans.
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G5416S'); setv26('bays','8SFF'); setv26('cpuq','1');
  (fanState27()==='Std Fans' && d.getElementById('fanq').value==='4')?pass25('DL380 G11 8SFF, 1 processor: 4 standard fans'):fail25('DL380 G11 1P fans wrong: '+fanState27()+' x'+d.getElementById('fanq').value);
  setv26('cpuq','2');
  (fanState27()==='Std Fans' && d.getElementById('fanq').value==='6')?pass25('DL380 G11 8SFF, 2 processors: 6 standard fans'):fail25('DL380 G11 2P fans wrong: '+fanState27()+' x'+d.getElementById('fanq').value);
  /Standard Fan Kit \(P49146-B21, \+2 fans\) on top of the 4 that ship/.test(d.getElementById('why-fan').textContent)
    ?pass25('the fan explainer names the 2-fan Standard Fan Kit P49146-B21 for the second processor'):fail25('P49146 hint missing: '+d.getElementById('why-fan').textContent);
  setv26('fanq','6');
  !/FAN QTY/.test(chk26())?pass25('typing 6 fans on a 2-processor DL380 G11 is no longer flagged (the reported false alarm)'):fail25('6 fans on 2P still flagged: '+chk26().slice(0,240));
  setv26('fanq','4');
  /FAN QTY.*takes 6 standard fans — 4 entered/.test(chk26())?pass25('...and 4 fans on 2 processors is the one that gets flagged'):fail25('4 fans on 2P not flagged: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G5416S'); setv26('bays','12EDSFF'); setv26('cpuq','1');
  (d.getElementById('fanq').value==='6')?pass25('DL380 G11 12EDSFF ships with 6 standard fans, even with one processor'):fail25('DL380 G11 EDSFF fans wrong: '+d.getElementById('fanq').value);
  setv26('bays','12LFF');
  (d.getElementById('fanq').value==='4')?pass25('DL380 G11 12LFF still ships 4 (its doc says 4; only EDSFF ships 6)'):fail25('DL380 G11 12LFF fans wrong: '+d.getElementById('fanq').value);
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G5416S'); setv26('bays','24SFF'); setv26('cpuq','2');
  (fanState27()==='Perf Fans' && d.getElementById('fanq').value==='6')?pass25('DL380 G11 24SFF: 6 high performance fans'):fail25('DL380 G11 24SFF fans wrong: '+fanState27()+' x'+d.getElementById('fanq').value);
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G5416S'); setv26('bays','8SFF'); setv26('cpuq','1');
  d.getElementById('bp2').checked=true; fire(d.getElementById('bp2'),'change');
  (fanState27()==='Perf Fans' && d.getElementById('fanq').value==='6')?pass25('DL380 G11 with NVMe: the high performance kit is 6 fans'):fail25('DL380 G11 NVMe fans wrong: '+fanState27()+' x'+d.getElementById('fanq').value);
  // Gen12 has the same chassis: 4 ship on SFF/8LFF, 6 on 12LFF/EDSFF, the 24SFF ships 6 HP, two processors need 6
  reset27(); setModel25('DL380 G12'); setv26('bays','8SFF'); setv26('cpuq','1');
  (d.getElementById('fanq').value==='4')?pass25('DL380 G12 8SFF, 1 processor: 4 standard fans'):fail25('DL380 G12 1P fans wrong: '+d.getElementById('fanq').value);
  setv26('cpuq','2');
  (d.getElementById('fanq').value==='6')?pass25('DL380 G12 8SFF, 2 processors: 6 standard fans'):fail25('DL380 G12 2P fans wrong: '+d.getElementById('fanq').value);
  setv26('bays','12LFF'); setv26('cpuq','1');
  (d.getElementById('fanq').value==='6')?pass25('DL380 G12 12LFF ships 6 standard fans'):fail25('DL380 G12 12LFF fans wrong: '+d.getElementById('fanq').value);
  setv26('bays','24SFF');
  (fanState27()==='Perf Fans' && d.getElementById('fanq').value==='6')?pass25('DL380 G12 24SFF ships 6 high performance fans'):fail25('DL380 G12 24SFF fans wrong: '+fanState27()+' x'+d.getElementById('fanq').value);
  // control: the DL360 is unchanged (5 with one processor, 7 with two)
  reset27(); setModel25('DL360 G11'); pickCpuExact25('G6426Y'); setv26('bays','8SFF'); setv26('cpuq','1');
  const f1=d.getElementById('fanq').value; setv26('cpuq','2');
  (f1==='5' && d.getElementById('fanq').value==='7')?pass25('DL360 G11 fans unchanged: 5 with one processor, 7 with two'):fail25('DL360 G11 fans changed: '+f1+'/'+d.getElementById('fanq').value);
  reset27();

  // ===== DL560 G11 fans (user-reported audit request 2026-09-22, after the DL380 fan-count bug) =====
  // Its own QuickSpecs: air-cooled ships 6 fans and calls the kit itself the "High Performance Fan
  // Kit" — there is no separate standard tier, and the count does not depend on CPU count or TDP.
  reset27(); setModel25('DL560 G11'); pickCpuExact25('G6416H'); setv26('cpuq','2');
  (fanState27()==='Perf Fans' && d.getElementById('fanq').value==='6')
    ?pass25('DL560 G11: defaults to Perf Fans x6 for a low-TDP (165W) CPU — the kit is fixed, not wattage-triggered')
    :fail25('DL560 G11 low-TDP fans wrong: '+fanState27()+' x'+d.getElementById('fanq').value);
  /FANS.*has one fan kit for air cooling.*no standard-vs-performance choice/.test(chk26())
    ?pass25('DL560 G11: an info check explains there is no standard/performance fan choice')
    :fail25('DL560 G11 fanNoChoice info missing: '+chk26().slice(0,240));
  !/is \d+W — .*requires the high performance fan kit/.test(chk26())
    ?pass25('DL560 G11: no wattage-threshold fan reason shown (fanW:0 — the kit is not CPU-TDP-triggered)')
    :fail25('DL560 G11 wrongly shows a wattage-based fan reason: '+chk26().slice(0,240));
  reset27(); setModel25('DL560 G11'); pickCpuExact25('P8490H'); setv26('cpuq','2');
  (fanState27()==='Perf Fans' && d.getElementById('fanq').value==='6')
    ?pass25('DL560 G11: still Perf Fans x6 for a high-TDP (350W) CPU — same fixed kit, not a separate wattage-driven reason')
    :fail25('DL560 G11 high-TDP fans wrong: '+fanState27()+' x'+d.getElementById('fanq').value);
  reset27(); setModel25('DL560 G11'); pickCpuExact25('G6416H'); setv26('cpuq','1');
  (d.getElementById('fanq').value==='6')?pass25('DL560 G11: 1 processor still fills 6 fans (the doc ties the count to cooling method, not CPU count)'):fail25('DL560 G11 1P fans wrong: '+d.getElementById('fanq').value);
  setv26('cpuq','4');
  (d.getElementById('fanq').value==='6')?pass25('DL560 G11: 4 processors also fills 6 fans'):fail25('DL560 G11 4P fans wrong: '+d.getElementById('fanq').value);
  reset27(); setModel25('DL560 G11'); pickCpuExact25('G6416H'); setv26('cpuq','2');
  d.getElementById('fn1').checked=true; fire(d.getElementById('fn1'),'change');
  (d.getElementById('fanq').value==='6' && !/FAN QTY/.test(chk26()))
    ?pass25('DL560 G11: manually picking "Standard" does not fight the user or wrongly block — quantity is 6 either way (no real std/perf split exists)')
    :fail25('DL560 G11 manual Std pick handling wrong: qty='+d.getElementById('fanq').value+' checks='+chk26().slice(0,240));
  reset27();

  // ===== DL360 G10+ / DL380 G10+: bring up to the same info level as G10/G11 (2026-09-22) =====
  // Sources: DL360-G10+-v44.txt / DL380-G10+-v42.txt (both confirmed current, 2026-09-21 stale-source audit).
  const cpuOpts28=function(){const ci=d.getElementById('cpu-input');ci.disabled=false;ci.value='';fire(ci,'input');
    return [...d.querySelectorAll('#cpu-panel .combo-item .ci-main')].map(function(e){return e.textContent;});};

  ['DL360 G10+','DL380 G10+'].forEach(function(label){
    setModel25(label);
    const opts=cpuOpts28();
    (opts.length===34 && opts.some(function(o){return /8351N/.test(o);}) && opts.some(function(o){return /8352S/.test(o);}) && opts.some(function(o){return /6314U/.test(o);}) && !opts.some(function(o){return /5320T|6338T/.test(o);}))
      ?pass25(label+': cpuAllow enforces the 34-SKU sp3 pool — the 31 the current doc orders, plus 8351N/8352S/6314U kept from the older doc (refurb stock), excluding the DL110-only NEBS parts')
      :fail25(label+' cpuAllow wrong: '+opts.length+' options');
  });

  // 8351N: single-socket despite not being a "U" part (both docs' own note)
  setModel25('DL360 G10+');pickCpuExact25('P8351N');setv26('cpuq','2');
  /single-socket-only processor/.test(chk26())?pass25('DL360 G10+: Platinum 8351N is blocked at 2 processors (single-socket despite no "U" suffix)'):fail25('8351N single-socket not blocked: '+chk26().slice(0,200));
  setv26('cpuq','');

  // per-CPU memory speed cap now modeled for sp3 (previously a flat 2667/2933/3200 with no per-SKU narrowing)
  setModel25('DL360 G10+');pickCpuExact25('S4309Y');
  { const sp=[...d.querySelectorAll('#dimm-speed-btns button')].map(function(b){return Number(b.getAttribute('data-sp'));});
    (sp.length===1 && sp[0]===2667)?pass25('DL360 G10+ (Silver S4309Y): memory speed narrowed to 2667 only'):fail25('S4309Y speed panel wrong: '+sp.join(',')); }
  setv26('dimmq','2');setv26('dimm','16GB 3200 MT/s');
  /MEMORY SPEED.*S4309Y runs memory at up to 2667/.test(chk26())?pass25('DL360 G10+: 3200 MT/s DIMM on a 2667-capped CPU is a hard stop'):fail25('sp3 speed cap not enforced: '+chk26().slice(0,240));
  setv26('dimm','');setv26('dimmq','');
  setModel25('DL360 G10+');pickCpuExact25('P8352V');
  { const sp=[...d.querySelectorAll('#dimm-speed-btns button')].map(function(b){return Number(b.getAttribute('data-sp'));});
    (sp.length===2 && sp.indexOf(3200)<0)?pass25('DL360 G10+ (Platinum 8352V, 2933 cap): offers 2667/2933, not the platform 3200 ceiling'):fail25('8352V speed panel wrong: '+sp.join(',')); }
  setModel25('DL360 G10+');pickCpuExact25('P8380');
  { const sp=[...d.querySelectorAll('#dimm-speed-btns button')].map(function(b){return Number(b.getAttribute('data-sp'));});
    (sp.indexOf(3200)>-1)?pass25('DL360 G10+ (Platinum 8380, uncapped): still offers the full 3200'):fail25('8380 speed panel wrong: '+sp.join(',')); }

  // DIMM kit part numbers now shown (dimmKits), same mechanism as G11
  setModel25('DL360 G10+');pickCpuExact25('S4309Y');setv26('dimmq','2');setv26('dimm','16GB 2667 MT/s');
  /P06031-B21/.test(d.getElementById('dimm-kit').textContent)?pass25('DL360 G10+ DIMM kit hint shows the 16GB dual-rank part number P06031-B21'):fail25('DL360 G10+ dimm-kit hint missing: '+d.getElementById('dimm-kit').textContent);
  setv26('dimm','');setv26('dimmq','');

  // battery list with part numbers (bat rule), same mechanism as G11
  ['DL360 G10+','DL380 G10+'].forEach(function(label){
    setModel25(label);
    const o=opts26('bat');
    (o.length===3 && o.some(function(x){return /P01366-B21/.test(x);}) && o.some(function(x){return /P02377-B21/.test(x);}) && o.indexOf('No battery')>-1)
      ?pass25(label+': battery picker is the sourced 3-option list with part numbers')
      :fail25(label+' battery list wrong: '+o.join(' | '));
  });

  // fan quantity bug: DL360 G10+ was missing a `one:` key entirely (1-processor picks got no fan qty)
  setModel25('DL360 G10+');pickCpuExact25('S4309Y');setv26('cpuq','1');
  (fanState25()==='Std Fans' && d.getElementById('fanq').value==='5')
    ?pass25('DL360 G10+ 1 processor: 5 standard fans (previously unfilled — the rule had no `one:` key)')
    :fail25('DL360 G10+ 1P fans wrong: '+fanState25()+' x'+d.getElementById('fanq').value);
  setv26('cpuq','2');
  (d.getElementById('fanq').value==='7' && /Standard Fan Kit \(P37861-B21/.test(d.getElementById('why-fan').textContent))
    ?pass25('DL360 G10+ 2 processors: 7 fans, explainer names the Standard Fan Kit P37861-B21')
    :fail25('DL360 G10+ 2P fan hint wrong: '+d.getElementById('fanq').value+' / '+d.getElementById('why-fan').textContent);
  setModel25('DL380 G10+');pickCpuExact25('S4309Y');setv26('cpuq','1');
  (d.getElementById('fanq').value==='4')?pass25('DL380 G10+ 1 processor: 4 standard fans (unaffected, key already present)'):fail25('DL380 G10+ 1P fans wrong: '+d.getElementById('fanq').value);
  setv26('cpuq','2');
  (d.getElementById('fanq').value==='6' && /Standard Fan Kit \(P37042-B21/.test(d.getElementById('why-fan').textContent))
    ?pass25('DL380 G10+ 2 processors: 6 fans, explainer now names the Standard Fan Kit P37042-B21')
    :fail25('DL380 G10+ 2P fan hint wrong: '+d.getElementById('fanq').value+' / '+d.getElementById('why-fan').textContent);
  setv26('cpuq','');reset27();

  // ===== DL360 / DL380 G10+ stand-up cards (2026-09-22, fresh PDFs downloaded with permission) =====
  const cardOpts29=function(){
    d.getElementById('add-card').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    const rows=d.querySelectorAll('#cards .line'),nm=rows[rows.length-1].querySelector('[data-k=name]');
    nm.value='';fire(nm,'input');fire(nm,'focus');
    const out=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(e){return e.textContent;});
    rows[rows.length-1].remove();return out;};
  reset27(); setModel25('DL360 G10+');
  { const o=cardOpts29();
    (o.length===36 && o.some(function(x){return /SN1600E/.test(x);}) && !o.some(function(x){return /Slingshot/.test(x);}) && o.some(function(x){return /NS204i-p/.test(x);}))
      ?pass25('DL360 G10+ card picker: 36 stand-up options (Ethernet/InfiniBand/Omni-Path/FC + NS204i-p), incl. its 2 Emulex SN1600E parts, no Slingshot')
      :fail25('DL360 G10+ card list wrong ('+o.length+'): SN1600E='+o.some(function(x){return /SN1600E/.test(x);})+' Slingshot='+o.some(function(x){return /Slingshot/.test(x);}));
    ['E810-XXVDA2 10/25Gb 2p SFP28 (P08443-B21)','MCX623105AS-VDAT 200Gb 1p QSFP56 (P10180-B21)','InfiniBand NDR200 200Gb 1p OSFP MCX75310AAS-HEAT (P45642-B22)','SN1610Q 32Gb FC 1p (R2E08A)','Secure Network Adapter 10/25Gb 2p (S2A69A)'].every(function(x){return o.indexOf(x)>-1;})
      ?pass25('DL360 G10+ card picker carries the doc\'s real part numbers'):fail25('DL360 G10+ card PNs missing'); }
  reset27(); setModel25('DL380 G10+');
  { const o=cardOpts29();
    (o.length===35 && !o.some(function(x){return /SN1600E/.test(x);}) && o.some(function(x){return /Slingshot SA210S/.test(x);}) && o.some(function(x){return /NS204i-p/.test(x);}))
      ?pass25('DL380 G10+ card picker: 35 stand-up options — no SN1600E (DL360-only), has the Slingshot NIC (DL380-only) and NS204i-p')
      :fail25('DL380 G10+ card list wrong ('+o.length+')'); }
  reset27(); setModel25('DL380 G9');
  { const o=cardOpts29();
    (o.length===47 && o.indexOf('366T 4x1GbE')>-1 && !o.some(function(x){return /\(R2E08A\)|MCX75310AAS/.test(x);}))
      ?pass25('models without their own card list keep the generic 47-entry starter list (unaffected by the G10+ Ethernet/FC additions)'):fail25('DL380 G9 card list changed ('+o.length+'): '+o.slice(0,3).join(' | ')); }
  // slip strips the part numbers off these cards too (hyphenated and suffix-less SKUs, incl. HPE's Q0Lxx/OSFP style codes)
  reset27(); setModel25('DL360 G10+');
  d.getElementById('add-card').click();
  { const rows=d.querySelectorAll('#cards .line'),nm=rows[rows.length-1].querySelector('[data-k=name]'),q=rows[rows.length-1].querySelector('[data-k=q]');
    nm.value='SN1200E 16Gb FC 1p (Q0L13A)';fire(nm,'input');q.value='1';fire(q,'input');
    const sl=d.getElementById('slip').textContent;
    (/1x SN1200E 16Gb FC 1p(?!\s*\()/.test(sl) && !/Q0L13A/.test(sl))?pass25('slip: FC card keeps its name, drops the Q0L13A-style part number'):fail25('slip FC card wrong: '+sl.slice(0,240)); }
  reset27();

  // real correctness fix: the OCP-form "InfiniBand HDR/Eth 200Gb 1p" part number (P31323-B21) had
  // ZERO support in DL360's own doc (it does not appear anywhere in it) but was sitting in its flr
  // list — removed there; DL380's own doc references the part number (in a restrictions table) but
  // never names the product, so it stays there with an honest caveat instead of a guessed name.
  setModel25('DL360 G10+');
  { const flr=d.getElementById('flr');flr.disabled=false;flr.value='';fire(flr,'input');fire(flr,'focus');
    const o=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(e){return e.textContent;});
    !o.some(function(x){return /P31323-B21/.test(x);})?pass25('DL360 G10+ OCP list: the unsourced P31323-B21 entry is gone (never appears in its own doc)'):fail25('DL360 G10+ still offers unsourced P31323-B21');
    o.some(function(x){return /InfiniBand HDR\/Eth 200Gb 2p.*P31348-B21/.test(x);})?pass25('DL360 G10+ OCP list: the confirmed InfiniBand 2p card (P31348-B21) is still offered, with its real restrictions'):fail25('DL360 G10+ P31348 entry wrong'); }
  setModel25('DL380 G10+');
  { const flr=d.getElementById('flr');flr.disabled=false;flr.value='';fire(flr,'input');fire(flr,'focus');
    const o=[...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(e){return e.textContent;});
    o.some(function(x){return /never gives its full product name \(P31323-B21\)/.test(x);})?pass25('DL380 G10+ OCP list: P31323-B21 kept but flagged — the doc references the part number without ever naming the product'):fail25('DL380 G10+ P31323 handling wrong: '+o.filter(function(x){return /InfiniBand/.test(x);}).join(' | ')); }
  reset27();

  // ===== DL360/DL380 G10 + G10+: per-riser-position rear cages, G10 cpuAllow/battery, G10+ boot device (2026-09-22) =====
  // Sources: current DL360 Gen10 QuickSpecs (V74, a00008159enw) and DL380 Gen10 QuickSpecs (V77, a00008180enw),
  // both downloaded fresh with permission this pass; DL360/DL380 G10+'s own docs (already on hand).
  reset27();

  // --- G10 cpuAllow: the current docs prune most SKUs, so this is the union with the wider pre-pruning
  // snapshots already cached for this project (same "latest != best" pattern as the other axes) ---
  setModel25('DL360 G10');
  { const o=cpuList26();
    (o.length===106 && o.some(function(x){return /6140\b/.test(x);}) && o.some(function(x){return /5215L/.test(x);}) && o.some(function(x){return /8180M/.test(x);}) && !o.some(function(x){return x.indexOf('P8156')>-1;}))
      ?pass25('DL360 G10: cpuAllow enforces the 106-SKU 1st+2nd-Gen pool the current + wider doc snapshot confirm together (incl. 6140/5215L/8180M) — excludes Platinum 8156, which is real for DL380 but not this model')
      :fail25('DL360 G10 cpuAllow wrong: '+o.length+' options'); }
  setModel25('DL380 G10');
  { const o=cpuList26();
    (o.length===111 && o.some(function(x){return /6137\b/.test(x);}) && o.some(function(x){return /8260M/.test(x);}) && o.some(function(x){return x.indexOf('P8156')>-1;}) && !o.some(function(x){return /8160M/.test(x);}))
      ?pass25('DL380 G10: cpuAllow enforces the 111-SKU pool, incl. the Financial Sector Gold 6137 (876562-B21) and 8260M/8156 — excludes the 8160M "1.5TB memory" part, which is DL360-only')
      :fail25('DL380 G10 cpuAllow wrong: '+o.length+' options'); }

  // --- G10 battery list ---
  ['DL360 G10','DL380 G10'].forEach(function(label){
    setModel25(label);
    const o=opts26('bat');
    (o.length===3 && o.some(function(x){return /P01366-B21/.test(x);}) && o.some(function(x){return /P02377-B21/.test(x);}))
      ?pass25(label+': battery picker is the sourced 3-option list with part numbers')
      :fail25(label+' battery list wrong: '+o.join(' | '));
  });

  // --- DL360 G10 rear list: single position, real part numbers, no per-position modeling (1U, one location) ---
  setModel25('DL360 G10');
  { const o=[...d.querySelectorAll('#rearopts option')].map(function(x){return x.value;});
    (o.length===2 && o.indexOf('1SFF rear (867972-B21)')>-1 && o.indexOf('2x M.2 (dual uFF) rear — same rear backplane kit (867972-B21)')>-1 && !o.some(function(x){return /867978/.test(x);}))
      ?pass25('DL360 G10: both rear options are the one rear backplane kit 867972-B21 (867978-B21 is the M.2 primary riser, not a rear option), still one flat location')
      :fail25('DL360 G10 rear list wrong: '+o.join(' | ')); }

  // --- DL380 G10 per-riser-position rear cages (new rearCages mechanism, first use on a classic-G10 chassis) ---
  reset27(); setModel25('DL380 G10'); setv26('bays','24SFF');
  addRear27('2SFF rear, primary riser (826688-B21)'); addRear27('2SFF rear, secondary riser (826688-B21)');
  (!/REAR CONFLICT|REAR NOT SUPPORTED/.test(chk26()))?pass25('DL380 G10 24SFF: 2SFF cages in primary + secondary accepted together'):fail25('DL380 G10 P+S wrongly blocked: '+chk26().slice(0,240));
  addRear27('2SFF rear, primary riser (826688-B21)');
  /at most 2 2SFF rear cages/.test(chk26())?pass25('DL380 G10: a 3rd 2SFF rear cage is blocked — the doc caps it at 2 total'):fail25('DL380 G10 3rd 2SFF not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G10'); setv26('bays','12LFF');
  addRear27('3LFF rear, secondary riser (826685-B21)');
  (!/REAR NOT SUPPORTED/.test(chk26()))?pass25('DL380 G10 12LFF: the 3LFF rear cage (secondary position) is accepted'):fail25('DL380 G10 3LFF on LFF wrongly blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G10'); setv26('bays','8SFF');
  addRear27('3LFF rear, secondary riser (826685-B21)');
  /REAR NOT SUPPORTED.*8LFF and 12LFF chassis/.test(chk26())?pass25('DL380 G10: the 3LFF rear cage is blocked on an SFF chassis (LFF only)'):fail25('DL380 G10 3LFF on SFF not blocked: '+chk26().slice(0,240));
  reset27(); setModel25('DL380 G10'); setv26('bays','8SFF');
  addRear27('2SFF SAS/SATA rear (826687-B21)');
  (!/REAR NOT SUPPORTED|REAR CONFLICT/.test(chk26()))?pass25('DL380 G10: the front NVMe/Premium cage relocated to the rear (826687-B21, SAS/SATA there) is accepted as a plain line')
    :fail25('DL380 G10 826687 rear line wrongly blocked: '+chk26().slice(0,240));

  // --- DL380 G10+ per-riser-position rear cages ---
  reset27(); setModel25('DL380 G10+'); setv26('bays','24SFF');
  addRear27('2SFF rear, primary riser (P26920-B21)'); addRear27('2SFF rear, secondary riser (P26920-B21)'); addRear27('2SFF NVMe rear, tertiary riser (P26922-B21)');
  (!/REAR CONFLICT|REAR NOT SUPPORTED/.test(chk26()))?pass25('DL380 G10+ 24SFF: 2SFF cages in primary, secondary and tertiary (3, 6SFF total) accepted together'):fail25('DL380 G10+ P+S+T wrongly blocked: '+chk26().slice(0,300));
  addRear27('2SFF rear, tertiary riser (P26923-B21)');
  /Two rear cages are in the tertiary riser position/.test(chk26())?pass25('DL380 G10+: a second tertiary-position cage (P26923) conflicts with the one already there (P26922)'):fail25('DL380 G10+ 2nd tertiary not blocked: '+chk26().slice(0,300));
  reset27(); setModel25('DL380 G10+'); setv26('bays','12LFF');
  addRear27('2LFF rear, secondary riser (P25903-B21)'); addRear27('2LFF rear, tertiary riser (P14580-B21)');
  /"2LFF rear, secondary riser" and "2LFF rear, tertiary riser" cannot be selected together/.test(chk26())
    ?pass25('DL380 G10+: the secondary and tertiary 2LFF cages cannot combine — a documented cage-vs-cage exclusion, not a same-position clash')
    :fail25('DL380 G10+ 2LFF conflictsWith not caught: '+chk26().slice(0,300));
  reset27(); setModel25('DL380 G10+'); setv26('bays','12LFF'); setv26('cpuq','1');
  addRear27('2LFF rear, secondary riser (P25903-B21)');
  /needs the second processor/.test(chk26())?pass25('DL380 G10+: a rear cage in the secondary position is flagged as needing the 2nd processor'):fail25('DL380 G10+ secondary-needs-CPU2 not flagged: '+chk26().slice(0,300));
  setv26('cpuq','2');
  !/needs the second processor/.test(chk26())?pass25('...and clears once the 2nd processor is set'):fail25('DL380 G10+ CPU2 flag did not clear');
  reset27(); setModel25('DL380 G10+'); setv26('bays','8LFF');
  addRear27('2LFF rear, primary riser (P14579-B21)');
  (!/REAR NOT SUPPORTED/.test(chk26()))?pass25('DL380 G10+ 8LFF: the 2LFF primary rear cage is accepted'):fail25('DL380 G10+ 2LFF primary wrongly blocked: '+chk26().slice(0,240));
  addRear27('2LFF rear, primary riser (P14579-B21)');
  /Two rear cages are in the primary riser position/.test(chk26())?pass25('DL380 G10+: a second 2LFF cage claiming the same (primary) position is blocked — max one per position, so 2LFF rear tops out at 2 total (primary+secondary or primary+tertiary)'):fail25('DL380 G10+ duplicate-primary 2LFF not blocked: '+chk26().slice(0,240));

  // --- slip strips positions' part numbers, keeps the position wording ---
  reset27(); setModel25('DL380 G10+'); setv26('bays','24SFF'); addRear27('2SFF rear, primary riser (P26920-B21)');
  { const sl=slip27();
    (/24SFF \+ 2SFF rear, primary riser/.test(sl) && !/P26920/.test(sl))?pass25('DL380 G10+ slip: rear cage keeps its position, drops the part number'):fail25('DL380 G10+ slip rear wrong: '+sl.slice(0,200)); }

  // --- G10+ boot device: NS204i-p (stand-up card, both models) and NS204i-r (DL360-only riser) ---
  reset27(); setModel25('DL360 G10+'); pickCpuExact25('S4210'); setv26('cpuq','1');
  addCard27('NS204i-p NVMe PCIe3 x2 lanes boot device — needs High Performance Fan Kit (P12965-B21)','1');
  (fanState27()==='Perf Fans')?pass25('DL360 G10+: the NS204i-p boot device carries its fan-kit requirement in the card label and forces performance fans'):fail25('DL360 G10+ NS204i-p fan rule wrong: '+fanState27());
  reset27(); setModel25('DL380 G10+');
  { const o=cardOpts29();
    o.some(function(x){return /NS204i-p.*P12965-B21/.test(x);})?pass25('DL380 G10+ also offers the NS204i-p boot device (shared with DL360)'):fail25('DL380 G10+ NS204i-p missing'); }
  reset27(); setModel25('DL360 G10+');
  { const RIS26=grab25('RISERS')||{};
    (RIS26['DL360 G10+']||[]).some(function(k){return /NS204i-r.*P26463-B21/.test(k.n)&&k.pos==='primary';})
      ?pass25('DL360 G10+ riser kits include the NS204i-r primary riser (P26463-B21) — a riser-integrated boot device alternative')
      :fail25('DL360 G10+ NS204i-r riser missing'); }
  reset27();

  // ===== SAS expander section: real 2nd-controller picker + OCP-first controller sorting (2026-09-23) =====
  // User: G11 doesn't use SAS expander cards, it uses a second controller — the field offered a plain
  // "Second controller instead of expander" string with no way to say WHICH one. expandersFor() now lists
  // the model's own real controller options (same source as #ctrl) as "2nd controller: <name+PN>" whenever
  // no real expander-card SKU exists (most of G11/G12 and plenty else) — a genuine expander SKU is still
  // listed first where one exists. Controller lists are also reordered OCP-first, then PCI.
  reset27();
  const expOpts30=function(){
    const exp=d.getElementById('expander');exp.value='';fire(exp,'input');fire(exp,'focus');
    return [...d.querySelectorAll('#ac-panel .combo-item .ci-main')].map(function(e){return e.textContent;});};
  setModel25('DL380 G11');
  { const o=expOpts30();
    (!o.some(function(x){return /SAS Expander Card/.test(x);}) &&
     o.some(function(x){return x==='2nd controller: MR416i-o — x16 lanes, 8GB cache (P47781-B21)';}) &&
     o.some(function(x){return /2nd controller: E208e-p/.test(x);}) &&
     o[0].indexOf('2nd controller: MR416i-o')===0 && o.indexOf('None needed')>-1)
      ?pass25('DL380 G11 expander field: no SAS Expander Card (none exists for G11) — its own real controller list is offered as 2nd-controller options, OCP entries first')
      :fail25('DL380 G11 expander opts wrong: '+o.join(' | ')); }
  { const el=d.getElementById('expander-label');
    (el.textContent==='2nd controller / extra HBA' && /No SAS Expander Card exists for DL380 G11/.test(d.getElementById('expander-hint').textContent))
      ?pass25('DL380 G11: the field label/hint switch to "2nd controller" wording (no real expander SKU)')
      :fail25('DL380 G11 expander label/hint wrong: "'+el.textContent+'" / "'+d.getElementById('expander-hint').textContent+'"'); }
  setModel25('DL360 G11');
  { const o=expOpts30();
    (!o.some(function(x){return /SAS Expander Card/.test(x);}) && o.some(function(x){return /2nd controller: SR932i-p/.test(x);}))
      ?pass25('DL360 G11 expander field: also a real controller-picker (no expander SKU exists on this chassis either)')
      :fail25('DL360 G11 expander opts wrong: '+o.join(' | ')); }
  setModel25('DL380 G9');
  { const el=d.getElementById('expander-label');
    (el.textContent==='SAS expander / extra HBA' && !/2nd controller/.test(d.getElementById('expander-hint').textContent))
      ?pass25('DL380 G9: label stays "SAS expander" — this chassis genuinely has a real expander-card SKU (727250-B21)')
      :fail25('DL380 G9 expander label wrongly switched: "'+el.textContent+'"'); }
  { const o=expOpts30();
    (o[0].indexOf('727250-B21')>-1 && o.some(function(x){return /2nd controller:/.test(x);}))
      ?pass25('DL380 G9: the real expander card is still listed first, with 2nd-controller options as additional choices')
      :fail25('DL380 G9 expander opts wrong: '+o.join(' | ')); }

  // --- picking a 2nd-controller option and the slip / config-check wording ---
  reset27(); setModel25('DL380 G11'); setv26('bays','24SFF');
  { const exp=d.getElementById('expander');exp.value='';fire(exp,'input');fire(exp,'focus');
    const pick=[...d.querySelectorAll('#ac-panel .combo-item')].find(function(e){return e.textContent.indexOf('2nd controller: MR416i-p')===0;});
    pick.dispatchEvent(new w.MouseEvent('click',{bubbles:true})); }
  (d.getElementById('expander').value.indexOf('2nd controller: MR416i-p')===0)
    ?pass25('DL380 G11: picking a 2nd-controller option fills the field with the real name + part number')
    :fail25('DL380 G11 2nd-controller pick did not fill the field: '+d.getElementById('expander').value);
  { const sl=slip27();
    (/2nd controller: MR416i-p(?!\s*—)/.test(sl) && !/P47777-B21/.test(sl))
      ?pass25('slip: the 2nd-controller pick keeps its name, drops the part number and the "— detail" tail')
      :fail25('slip 2nd-controller line wrong: '+sl.slice(0,240)); }
  setv26('expander','');
  setv26('cpuq','1'); setv26('dimmq','16'); setv26('dimm','16GB 4800 MT/s');
  /needs a second controller — no SAS Expander Card exists for DL380 G11/.test(chk26())
    ?pass25('DL380 G11: the EXPANDER config check names "a second controller" and says plainly that no SAS Expander Card exists — not a generic "SAS expander or a second controller"')
    :fail25('DL380 G11 EXPANDER check wording wrong: '+chk26().slice(0,300));
  setv26('dimm',''); setv26('dimmq',''); setv26('cpuq','');
  reset27(); setModel25('DL380 G9'); setv26('bays','24SFF');
  /needs a SAS expander or a second controller/.test(chk26())
    ?pass25('DL380 G9: the EXPANDER check keeps the original "SAS expander or a second controller" wording — a real expander card exists here')
    :fail25('DL380 G9 EXPANDER check wording wrong: '+chk26().slice(0,300));
  setv26('bays','');

  // --- controller sorting: OCP mezzanine group before PCI plug-in group ---
  reset27();
  ['DL360 G11','DL380 G11'].forEach(function(label){
    setModel25(label);
    const o=opts26('ctrl');
    (o[0].indexOf('MR416i-o')===0 && o.indexOf('MR408i-o — x8 lanes, 4GB cache (P58335-B21)')<o.indexOf('SR932i-p — 32 lanes, 8GB wide cache, needs a x16 riser slot and the Storage Controller Enablement Cable Kit P48918-B21 (P47184-B21)'))
      ?pass25(label+': controller list is sorted OCP entries first, then PCI — matches how the trader actually shops (OCP mezzanine slot first)')
      :fail25(label+' controller order wrong: '+o.slice(0,5).join(' | '));
  });
  reset27();

  // ===== CPU detail readout (2026-09-23) =====
  // User: the closed combo only shows the bare code ("G6430") once picked, wasting
  // the extra name/core-count/clock/TDP the open dropdown's sub-text has. Added a
  // persistent #cpu-detail note fed by the same CPUS fields, display-only.
  function pickCpu25(code){
    const ci=d.getElementById('cpu-input');ci.value='';fire(ci,'input');
    const o=[...d.querySelectorAll('#cpu-panel .combo-item')].find(function(x){return x.querySelector('.ci-main').textContent===code;});
    if(o)o.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true}));
  }
  reset27(); setModel25('DL380 G11'); pickCpu25('G6430');
  (d.getElementById('cpu-detail').textContent==='Xeon Gold 6430 · 32C 2.1GHz · 270W')
    ?pass25('DL380 G11: picking G6430 shows its full name/core-count/clock/TDP under the combo, not just the bare code')
    :fail25('cpu-detail wrong after picking G6430: "'+d.getElementById('cpu-detail').textContent+'"');
  (!/32C 2\.1GHz/.test(slip27()))
    ?pass25('cpu-detail readout never reaches the spec slip (display-only)')
    :fail25('cpu-detail text leaked into the slip: '+slip27().slice(0,200));
  pickCpu25('G6458Q');
  (d.getElementById('cpu-detail').textContent.indexOf('liquid-cooled Speed Select')>-1)
    ?pass25('DL380 G11: switching CPU updates the readout, keeping the full descriptive suffix (G6458Q liquid-cooled Speed Select note)')
    :fail25('cpu-detail did not update for G6458Q: "'+d.getElementById('cpu-detail').textContent+'"');
  reset27();
  (d.getElementById('cpu-detail').textContent==='')
    ?pass25('cpu-detail clears on Clear/reset')
    :fail25('cpu-detail did not clear on reset: "'+d.getElementById('cpu-detail').textContent+'"');

  // ===== "Paste the client's request" — a thorough shorthand pass (2026-09-23, build .3) =====
  // User: try as many shorthand build write-ups as possible so a trader can paste a client's
  // actual request and instantly see what issues arise, without re-typing it by hand.
  const paste28=function(s){d.getElementById('paste-text').value=s;d.getElementById('paste-fill').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));return d.getElementById('paste-result').textContent;};

  // --- Unicode "×" normalises to "x" everywhere a multiplier is read ---
  reset27();paste28('DL360 G10, dual 6248, 8×32GB, 2×800W');
  (d.getElementById('model').value==='DL360 G10' && d.getElementById('cpuq').value==='2' &&
   d.getElementById('dimmq').value==='8' && d.getElementById('dimm').value==='32GB' &&
   d.getElementById('psuq').value==='2' && d.getElementById('psu').value==='800W')
    ?pass25('Unicode "×" (not the ASCII "x"/"*") is normalised up front — "8×32GB, 2×800W" parses exactly like "8x32GB, 2x800W"')
    :fail25('"×" normalisation failed: model='+d.getElementById('model').value+' cpuq='+d.getElementById('cpuq').value+' dimmq='+d.getElementById('dimmq').value+' dimm='+d.getElementById('dimm').value+' psuq='+d.getElementById('psuq').value+' psu='+d.getElementById('psu').value);

  // --- bare model number (no "DL"/"ML"), only trusted right against a gen mention ---
  reset27();paste28('5x 380g10, dual 6248');
  (d.getElementById('model').value==='DL380 G10' && d.getElementById('modelq').value==='5')
    ?pass25('bare "380g10" (no "DL") resolves to DL380 G10, and the leading "5x" still sets the build count')
    :fail25('bare model number failed: model="'+d.getElementById('model').value+'" modelq="'+d.getElementById('modelq').value+'"');
  reset27();paste28('a build with 2x 600GB drives and a 380W power draw, nothing else');
  (d.getElementById('model').value==='')
    ?pass25('a bare number with no adjacent gen mention ("380W") never gets misread as a model')
    :fail25('bare-number false positive: model="'+d.getElementById('model').value+'"');

  // --- "10.5" community slang for Gen10 Plus, and the DL380a-vs-DL380A case-bug fix ---
  reset27();paste28('dl380 g10.5, dual 6314U');
  (d.getElementById('model').value==='DL380 G10+')
    ?pass25('"dl380 g10.5" (slang for Gen10 Plus) resolves to DL380 G10+')
    :fail25('"g10.5" not resolved: model="'+d.getElementById('model').value+'"');
  reset27();paste28('DL380a Gen12');
  (d.getElementById('model').value==='DL380a G12')
    ?pass25('BUG FIX: "DL380a Gen12" now resolves — it used to uppercase the model’s own lowercase "a" suffix (DL380A vs the real DL380a) and silently never match')
    :fail25('DL380a case bug still present: model="'+d.getElementById('model').value+'"');

  // --- CPU quantity shorthand: reversed "x2", bare "N CPU", word-numbers, "both sockets" ---
  reset27();paste28('DL360 G10, 6248 x2');
  d.getElementById('cpuq').value==='2'?pass25('reversed "6248 x2" (qty AFTER the code) sets 2 processors'):fail25('reversed CPU qty missed: '+d.getElementById('cpuq').value);
  reset27();paste28('DL360 G10, 2 CPU, 6248');
  d.getElementById('cpuq').value==='2'?pass25('bare "2 CPU" (no "x") sets 2 processors'):fail25('"2 CPU" missed: '+d.getElementById('cpuq').value);
  reset27();setModel25('DL580 G9');paste28('DL580 G9, four E7-8890v4');
  d.getElementById('cpuq').value==='4'?pass25('word-number "four" sets 4 processors on a 4-socket board'):fail25('"four" cpu qty missed: '+d.getElementById('cpuq').value);
  reset27();paste28('DL360 G10, both sockets populated, 6248');
  d.getElementById('cpuq').value==='2'?pass25('"both sockets populated" resolves to the model’s own socket count (2 for DL360 G10)'):fail25('"both sockets" missed: '+d.getElementById('cpuq').value);

  // --- architecture name + clock speed narrow a core-count guess, even to a unique FOUND ---
  reset27();paste28('DL380 G11, Sapphire Rapids Gold, 24 core, 2.6GHz, 1 cpu');
  (d.getElementById('cpu').value==='G6442Y')
    ?pass25('"Sapphire Rapids Gold, 24 core, 2.6GHz" narrows to the one unique match (G6442Y) and picks it — as certain as a bare code')
    :fail25('architecture+clock narrowing failed: cpu="'+d.getElementById('cpu').value+'"');
  reset27();paste28('DL380 G11, 32 core, 1 cpu');
  { const pr=d.getElementById('paste-result').textContent;
    (d.getElementById('cpu').value==='' && /32-core/.test(pr) && /CHECK/.test(pr))
      ?pass25('"32 core" alone (no architecture/clock) stays a CHECK — several 32-core parts exist on this platform')
      :fail25('ambiguous core-only guess wrong: cpu="'+d.getElementById('cpu').value+'" result="'+pr.slice(0,200)+'"'); }

  // --- memory: speed capture, and a bare total wired into the real #memtarget suggester ---
  reset27();paste28('DL380 G11, 8x32GB 2933MHz');
  (d.getElementById('dimmq').value==='8' && d.getElementById('dimm').value==='32GB 2933 MT/s')
    ?pass25('"8x32GB 2933MHz" captures the speed too, not just size/qty')
    :fail25('memory speed capture failed: dimmq='+d.getElementById('dimmq').value+' dimm="'+d.getElementById('dimm').value+'"');
  reset27();paste28('DL360 G10, dual 6248, 4x32gb, 2x800 psu');   // pre-existing shorthand case — must still come out with NO stray leftover speed
  d.getElementById('dimm').value==='32GB'?pass25('a paste with no speed mentioned gives a clean "32GB" (no stray leftover speed from elsewhere)'):fail25('dimm value picked up an unwanted speed: "'+d.getElementById('dimm').value+'"');
  reset27();setModel25('DL380 G11');paste28('DL380 G11, 384GB total memory, 1 cpu');
  { const ms=d.getElementById('mem-suggestions');
    (d.getElementById('memtarget').value==='384GB' && !ms.hidden && ms.querySelectorAll('button').length>0)
      ?pass25('a bare "384GB total memory" mention feeds the real #memtarget suggester (live suggestions appear), not just a dead-end note')
      :fail25('memtarget wiring failed: memtarget="'+d.getElementById('memtarget').value+'" suggestions hidden='+ms.hidden); }
  reset27();paste28('DL380 G11, 1.5TB memory total');
  d.getElementById('memtarget').value==='1.5TB'?pass25('a TB total ("1.5TB memory total") also reaches #memtarget'):fail25('TB total missed: memtarget="'+d.getElementById('memtarget').value+'"');

  // --- PSU: tier-name note, "1+1"/"1+0" redundancy phrasing, reversed "Nw psu xN" ---
  reset27();paste28('DL380 G10, 800w Titanium psu');
  /Titanium/.test(d.getElementById('paste-result').textContent)
    ?pass25('a PSU efficiency tier ("Titanium") gets flagged to confirm against the real per-model list, not guessed at')
    :fail25('PSU tier note missing: '+d.getElementById('paste-result').textContent.slice(0,200));
  reset27();paste28('DL360 G10, 800w 1+1');
  (d.getElementById('psuq').value==='2'&&d.getElementById('psu').value==='800W')
    ?pass25('"800w 1+1" (redundant pair) sets 2x 800W')
    :fail25('"1+1" PSU phrasing missed: q='+d.getElementById('psuq').value+' w='+d.getElementById('psu').value);
  reset27();paste28('DL360 G10, 800w 1+0');
  d.getElementById('psuq').value==='1'?pass25('"800w 1+0" (single, non-redundant) sets qty 1'):fail25('"1+0" PSU phrasing missed: q='+d.getElementById('psuq').value);
  reset27();paste28('DL360 G10, 800w psu x2');
  d.getElementById('psuq').value==='2'?pass25('reversed "800w psu x2" (word between the number and the multiplier) still sets qty 2'):fail25('"800w psu x2" missed: q='+d.getElementById('psuq').value);

  // --- storage controller: exact model-code matches -> primary + 2nd controller, and the
  // 2nd-controller code is kept OUT of the generic card scan (no duplicate "card" row) ---
  reset27();setModel25('DL380 G11');paste28('DL380 G11, MR416i-o primary, MR216i-p second controller');
  (d.getElementById('ctrl').value.indexOf('MR416i-o')===0 && d.getElementById('expander').value==='2nd controller: MR216i-p — x16 lanes, no cache (P47785-B21)')
    ?pass25('two distinct real controller codes -> primary #ctrl + the 2nd-controller slot, both FOUND (exact codes from this model’s own list)')
    :fail25('primary+secondary controller match wrong: ctrl="'+d.getElementById('ctrl').value+'" expander="'+d.getElementById('expander').value+'"');
  { const cn=[...d.querySelectorAll('#cards [data-k=name]')].map(function(x){return x.value;});
    !cn.some(function(n){return /MR416i-o|MR216i-p/.test(n);})
      ?pass25('...and neither controller code also lands as a generic, unplaced "card" row')
      :fail25('controller codes leaked into the generic card scan: '+cn.join(', ')); }
  reset27();setModel25('DL380 G11');paste28('DL380 G11, dual MR416i-p controllers');
  (d.getElementById('ctrl').value.indexOf('MR416i-p')===0 && d.getElementById('expander').value.indexOf('2nd controller: MR416i-p')===0)
    ?pass25('"dual MR416i-p controllers" (one code, "dual" cue) sets the SAME real controller as both primary and 2nd controller')
    :fail25('dual-same-controller phrasing wrong: ctrl="'+d.getElementById('ctrl').value+'" expander="'+d.getElementById('expander').value+'"');
  reset27();setModel25('DL380 G11');paste28('DL380 G11, MR416i-o, add a second controller');
  /pick it from the 2nd controller field/.test(d.getElementById('paste-result').textContent)
    ?pass25('"add a second controller" with no second code named points the trader at the 2nd-controller field instead of guessing which part')
    :fail25('unnamed-second-controller guess missing: '+d.getElementById('paste-result').textContent.slice(0,300));

  // --- FlexibleLOM/OCP: exact model-code match (an OCP mezzanine code, not the old "NNNFLR" shape) ---
  reset27();setModel25('DL380 G11');paste28('DL380 G11, BCM57414 OCP nic');
  (d.querySelector('#fl1').checked && d.getElementById('flr').value.indexOf('BCM57414')===0)
    ?pass25('an exact OCP code (BCM57414) straight out of DL380 G11’s own real flr list is recognised — not just the older "NNNFLR" shorthand')
    :fail25('OCP exact-code match failed: fl1='+d.querySelector('#fl1').checked+' flr="'+d.getElementById('flr').value+'"');

  // --- NS204i-u (the 3rd variant, alongside the already-supported -p/-r) ---
  reset27();setModel25('DL380 G11');paste28('DL380 G11, NS204i-u boot device');
  [...d.querySelectorAll('#cards [data-k=name]')].some(function(x){return /NS204i-u boot/.test(x.value);})
    ?pass25('"NS204i-u" is recognised alongside the existing -p/-r boot-device shorthand')
    :fail25('NS204i-u not recognised: '+[...d.querySelectorAll('#cards [data-k=name]')].map(function(x){return x.value;}).join(', '));

  // --- battery: wattage-aware match against THIS model's own real list, model-specific ---
  reset27();setModel25('DL380 G11');paste28('DL380 G11, 16w battery');
  d.getElementById('bat').value.indexOf('16W Smart Hybrid Capacitor')===0
    ?pass25('DL380 G11: "16w battery" matches its own real 16W option (it has one)')
    :fail25('DL380 G11 16W battery match failed: "'+d.getElementById('bat').value+'"');
  reset27();setModel25('DL360 G11');paste28('DL360 G11, 16w battery');
  d.getElementById('bat').value==='96w bat'
    ?pass25('DL360 G11: "16w battery" falls back to the generic 96W guess (it has no 16W option — no false match)')
    :fail25('DL360 G11 wrongly matched a 16W battery it doesn’t have: "'+d.getElementById('bat').value+'"');

  // --- bays: EDSFF (a real gap — used to only match LFF/SFF), midtray keyword kept
  // (not overwritten with a blind " rear"), and MULTIPLE extra bay lines, not just one ---
  reset27();setModel25('DL380 G11');paste28('DL380 G11, 24EDSFF');
  d.getElementById('bays').value==='24EDSFF'?pass25('"24EDSFF" is now recognised as a front bay config (EDSFF was never matched before)'):fail25('EDSFF bays missed: "'+d.getElementById('bays').value+'"');
  reset27();setModel25('DL380 G10');paste28('DL380 G10, 8LFF, 2SFF midtray');
  { const rl=[...d.querySelectorAll('#rear-lines [data-k=v]')].map(function(x){return x.value;});
    rl.some(function(x){return /midtray/i.test(x);})
      ?pass25('"2SFF midtray" keeps the word "midtray" on the line (used to always say "rear" regardless)')
      :fail25('midtray keyword lost: '+rl.join(' | ')); }
  reset27();setModel25('DL380 G10+');paste28('DL380 G10+, 8LFF, 2SFF rear, 2SFF midtray');
  { const rl=[...d.querySelectorAll('#rear-lines [data-k=v]')].map(function(x){return x.value;});
    (rl.length===2 && rl.some(function(x){return /rear/i.test(x)&&!/midtray/i.test(x);}) && rl.some(function(x){return /midtray/i.test(x);}))
      ?pass25('THREE bay mentions (front + rear + midtray) now produce two separate rear lines, not just the one the old code capped at')
      :fail25('multi-rear-line parsing wrong: '+rl.join(' | ')); }

  // --- diskless / no-drives phrasing ---
  reset27();setModel25('DL380 G10');paste28('DL380 G10, diskless');
  d.getElementById('nodrives').checked?pass25('"diskless" checks the "no drives" box'):fail25('"diskless" did not check nodrives');
  reset27();setModel25('DL380 G10');paste28('DL380 G10, ships with no drives');
  d.getElementById('nodrives').checked?pass25('"ships with no drives" also checks it'):fail25('"ships with no drives" missed');

  // --- drives: bare capacity with zero descriptor (TB always, non-DIMM GB), RPM spelled
  // out in full, full-word RAID class, and U.2 -> NVMe ---
  reset27();setModel25('DL380 G10');paste28('DL380 G10, 4x 2TB');
  { const caps=[...d.querySelectorAll('#drives [data-k=cap]')].map(function(x){return x.value;});
    (caps.indexOf('2TB')>-1 && /had no interface\/speed\/class/.test(d.getElementById('paste-result').textContent))
      ?pass25('a bare "4x 2TB" (zero descriptor) still adds the drive line, flagged to confirm the interface — TB is never mistaken for memory')
      :fail25('bare-TB drive fallback failed: caps='+caps.join(',')+' result='+d.getElementById('paste-result').textContent.slice(0,200)); }
  reset27();setModel25('DL380 G10');paste28('DL380 G10, 8x 600GB');
  { const caps=[...d.querySelectorAll('#drives [data-k=cap]')].map(function(x){return x.value;});
    caps.indexOf('600GB')>-1?pass25('a bare "8x 600GB" (not a real DIMM size) also adds a drive line'):fail25('bare non-DIMM-GB drive fallback failed: '+caps.join(',')); }
  reset27();setModel25('DL380 G10');paste28('DL380 G10, dual 6248, 4x 32GB');
  { const caps=[...d.querySelectorAll('#drives [data-k=cap]')].map(function(x){return x.value;});
    (caps.indexOf('32GB')===-1 && d.getElementById('dimm').value==='32GB')
      ?pass25('...but a bare "4x 32GB" (a real DIMM size, no drive-ish words at all) still reads as MEMORY, not a drive — unchanged, deliberately conservative')
      :fail25('32GB wrongly split between drive/memory: drive caps='+caps.join(',')+' dimm="'+d.getElementById('dimm').value+'"'); }
  reset27();setModel25('DL380 G10');paste28('DL380 G10, 4x 1.2TB 10000rpm SAS');
  { const found=d.getElementById('paste-result').textContent;
    /10K/.test(found)?pass25('RPM spelled out in full ("10000rpm") displays as "10K", same as the abbreviated form')
      :fail25('spelled-out RPM not recognised: '+found.slice(0,200)); }
  reset27();setModel25('DL380 G10');paste28('DL380 G10, 4x 900GB Read Intensive SAS');
  /\bRI\b/.test(d.getElementById('paste-result').textContent)
    ?pass25('full-word drive class ("Read Intensive") maps to the "RI" code, same as typing it directly')
    :fail25('full-word drive class not recognised: '+d.getElementById('paste-result').textContent.slice(0,200));
  reset27();setModel25('DL380 G11');paste28('DL380 G11, 4x 3.84TB U.2 NVMe');
  { const ints=[...d.querySelectorAll('#drives [data-k=int]')].map(function(x){return x.value;});
    ints.indexOf('NVMe')>-1?pass25('"U.2" is read as an NVMe interface signal'):fail25('U.2 not mapped to NVMe: '+ints.join(',')); }

  // ===== Step 1 of the full-rundown plan: DL360/DL380 G10 + G10+ rails/bezel/intrusion/iLO, G10 memory kits +
  // stand-up cards, DL380 G11 EDSFF bundle + intrusion kit (build 2026.09.23.4) =====
  const M29=w.eval('MODELS'), R29=function(label){const m=M29.find(function(x){return x.m+' '+x.g===label;});return m?m.rules:{};};
  const bz29=function(){return d.getElementById('bezel-note').textContent;}, rl29=function(){return d.getElementById('rail-note').textContent;};
  const kit29=function(){return d.getElementById('dimm-kit').textContent;};
  // --- G10 DDR4 kits follow the processor generation (doc: 1st Gen takes only the 2666 kits) ---
  reset27(); setModel25('DL380 G10'); pickCpuExact25('G6148'); setv26('dimmq','12'); setv26('dimm','32GB 2666 MT/s');
  (/815100-B21/.test(kit29()) && !/P00924/.test(kit29()) && !/F21/.test(kit29()))
    ?pass25('DL380 G10 + 1st Gen Gold 6148: 32GB shows the DDR4-2666 kit 815100-B21 (no -F21 hint — the Gen10 docs list none)')
    :fail25('sp1 kit hint wrong: "'+kit29()+'"');
  pickCpuExact25('G6248'); setv26('dimm','32GB 2933 MT/s');
  /P00924-B21/.test(kit29())?pass25('...and a 2nd Gen Gold 6248 shows the DDR4-2933 kit P00924-B21'):fail25('sp2 kit hint wrong: "'+kit29()+'"');
  setv26('dimm','16GB 2933 MT/s');
  (/P00922-B21/.test(kit29()) && /P00920-B21/.test(kit29()))
    ?pass25('16GB 2933 shows the dual-rank kit P00922-B21 and names the single-rank alternate P00920-B21'):fail25('16GB alt kit missing: "'+kit29()+'"');
  setv26('dimmq','3');
  !/MEMORY QTY/.test(chk26())?pass25('G10: an odd DIMM count is not flagged — the even-quantity rule is a Gen10 Plus/Gen11 doc rule only'):fail25('G10 odd-DIMM wrongly flagged: '+chk26().slice(0,200));
  !/P00924|P00922|815100/.test(slip27())?pass25('G10 memory kit part numbers stay off the slip'):fail25('kit PN leaked onto the slip');
  reset27(); setModel25('DL380 G10+'); pickCpuExact25('G6330'); setv26('dimmq','3'); setv26('dimm','32GB 2933 MT/s');
  /MEMORY QTY/.test(chk26())?pass25('G10+ keeps its even-DIMM-quantity check'):fail25('G10+ odd DIMM count no longer flagged');
  !/F21/.test(kit29())?pass25('G10+ kit hint no longer suggests a -F21 twin (its docs list none)'):fail25('G10+ still shows -F21: '+kit29());
  // --- rails / bezel / intrusion / iLO hints ---
  [['DL360 G10','8SFF',/874543-B21/,/734811-B21/,/867998-B21/,/867984-B21/],['DL360 G10','4LFF',/789388-B21/,/734811-B21/,/867998-B21/,/867984-B21/],
   ['DL380 G10','24SFF',/733660-B21/,/733664-B21/,/867809-B21/,/867824-B21/],['DL380 G10','12LFF',/733662-B21/,/733664-B21/,/867809-B21/,/867824-B21/],
   ['DL360 G10+','10SFF',/P26485-B21/,/P26489-B21/,/867998-B21/,/P14604-B21/],['DL360 G10+','4LFF',/P26487-B21/,/P26489-B21/,/867998-B21/,/P14604-B21/],
   ['DL380 G10+','24SFF',/P22018-B21/,/P22020-B21/,/867809-B21/,/P14604-B21/],['DL380 G10+','8LFF',/P22019-B21/,/P22020-B21/,/867809-B21/,/P14604-B21/]
  ].forEach(function(t){
    reset27(); setModel25(t[0]); setv26('bays',t[1]);
    (t[2].test(rl29()) && t[3].test(rl29()) && t[4].test(bz29()) && /875519-B21/.test(bz29()) && t[5].test(bz29()) && /512485-B21/.test(d.getElementById('ilo-note').textContent))
      ?pass25(t[0]+' '+t[1]+': rail kit, CMA, bezel + lock, intrusion kit and iLO licence hints all sourced')
      :fail25(t[0]+' '+t[1]+' hints wrong: rails="'+rl29()+'" bezel="'+bz29()+'"');
  });
  (R29('DL380 G10').iloNoPremium!==true && R29('DL360 G10').iloNoPremium===true && R29('DL360 G10+').iloNoPremium===true && R29('DL380 G10+').iloNoPremium===true)
    ?pass25('iLO Advanced Premium: only DL380 G10\'s doc names the Premium Security Edition — the other three are flagged Advanced-only')
    :fail25('iloNoPremium flags wrong');
  // --- G10 stand-up cards: pruned current list unioned with the pre-pruning snapshot ---
  { const c360=R29('DL360 G10').cards||[], c380=R29('DL380 G10').cards||[];
    const has=function(l,pn){return l.some(function(x){return x.indexOf('('+pn+')')>-1;});};
    (has(c360,'811546-B21') && has(c360,'P08443-B21') && has(c360,'874253-B21') && has(c360,'R2E09A') && has(c360,'P12965-B21') && !has(c360,'P13188-B21') && !has(c360,'878783-B21'))
      ?pass25('DL360 G10 cards: current E810s + the older 366T/842QSFP28/FC list + NS204i-p; no DL380-only MCX512F/M.2 AIC')
      :fail25('DL360 G10 card list wrong ('+c360.length+')');
    (has(c380,'P13188-B21') && has(c380,'P21109-B21') && has(c380,'878783-B21') && has(c380,'P06154-B21') && has(c380,'P12965-B21'))
      ?pass25('DL380 G10 cards: MCX512F, X2522, the M.2 enablement AIC and the 200Gb HDR card with its aux-card note')
      :fail25('DL380 G10 card list wrong ('+c380.length+')');
    const all=c360.concat(c380), pns={};let clash='';
    all.forEach(function(x){const m=x.match(/\(([A-Z0-9]{5,6}(?:-B2\d)?)\)$/);if(!m)return;const nm=x.replace(/\s*\([^()]*\)$/,'');if(pns[m[1]]&&pns[m[1]]!==nm)clash=m[1];pns[m[1]]=nm;});
    !clash?pass25('G10 card lists: every part number maps to exactly one card name'):fail25('G10 card PN used for two names: '+clash); }
  // --- DL360 G10 rear fix: 867978-B21 is the M.2 primary riser, not a rear kit ---
  !R29('DL360 G10').rear.some(function(x){return /867978/.test(x);})?pass25('DL360 G10 rear list no longer carries the M.2 primary riser part number'):fail25('867978-B21 still in the rear list');
  // --- DL380 G11 EDSFF bundle ---
  reset27(); setModel25('DL380 G11'); pickCpuExact25('G6448Y'); setv26('cpuq','1'); setv26('bays','36EDSFF');
  (/EDSFF BUNDLE/.test(chk26()) && /P56075-B21/.test(chk26()) && /P56076-B21/.test(chk26()) && /P52153-B21/.test(chk26()) && /second processor/.test(chk26()))
    ?pass25('DL380 G11 EDSFF: bundle info (36/20EDSFF kits, 12EDSFF CPU1/2 cable kit) and a stop for a single processor')
    :fail25('EDSFF bundle checks wrong: '+chk26().slice(0,300));
  (fanState27()==='Perf Fans')?pass25('DL380 G11 EDSFF: the bundle forces the High-Performance Fan Kit'):fail25('EDSFF bundle did not force perf fans: '+fanState27());
  setv26('cpuq','2'); addRiser27('2U x16/x16 Tertiary Riser Kit (P48804-B21)');
  /tertiary riser cannot be fitted with the EDSFF bundle/.test(chk26())?pass25('DL380 G11 EDSFF: tertiary riser blocked'):fail25('EDSFF tertiary riser not blocked: '+chk26().slice(0,300));
  setv26('dimmq','24'); setv26('dimm','256GB 4800 MT/s');
  /at most 16 x 256GB/.test(chk26())?pass25('DL380 G11 EDSFF: more than 16 x 256GB DIMMs blocked'):fail25('EDSFF 256GB cap missing: '+chk26().slice(0,300));
  reset27(); setModel25('DL380 G11'); setv26('bays','8SFF');
  (!/EDSFF BUNDLE/.test(chk26()) && /P48922-B21/.test(bz29()))?pass25('DL380 G11 8SFF: no EDSFF bundle checks; bezel hint carries the intrusion cable kit P48922-B21'):fail25('DL380 G11 non-EDSFF wrong: bezel="'+bz29()+'"');


  // ===== Step 3: remaining G10 Intel racks — DL560/DL580/DL160/DL180/DL20 G10 (+ ML30 G10 CPU pool) (build 2026.09.23.5) =====
  const has30=function(l,pn){return (l||[]).some(function(x){return x.indexOf('('+pn+')')>-1;});};
  // --- card lists: names from each model's own doc, part numbers from clean tables ---
  (R29('DL560 G10').cards.length===37 && has30(R29('DL560 G10').cards,'Q0L13A') && has30(R29('DL560 G10').cards,'874253-B21') && !has30(R29('DL560 G10').cards,'P08443-B21'))
    ?pass25('DL560 G10 cards: 36 doc-listed adapters + M.2 kit; SN1200E 16Gb 1p is Q0L13A (the doc text prints Q0L11A, a shifted row); no E810 (not in its doc)')
    :fail25('DL560 G10 cards wrong ('+R29('DL560 G10').cards.length+')');
  (R29('DL580 G10').cards.length===37 && has30(R29('DL580 G10').cards,'878783-B21'))?pass25('DL580 G10 cards: same 37 as DL560 incl. the M.2 kit 878783-B21 (its V20 text prints 874253-B21 there — shifted)'):fail25('DL580 G10 cards wrong');
  (has30(R29('DL160 G10').cards,'829335-B21') && !has30(R29('DL180 G10').cards,'829335-B21') && R29('DL160 G10').cards.length===23 && R29('DL180 G10').cards.length===22)
    ?pass25('DL160 G10 lists the OP101 Omni-Path card, DL180 G10 does not (23 vs 22 cards)'):fail25('DL160/DL180 card lists wrong');
  (R29('DL20 G10').cards.length===27 && has30(R29('DL20 G10').cards,'Q0F09A') && !has30(R29('DL20 G10').cards,'764284-B21'))?pass25('DL20 G10 cards: 27, incl. CN1300R, no InfiniBand'):fail25('DL20 G10 cards wrong');
  // --- DL160/DL180: per-model kit table + no 128GB ---
  reset27(); setModel25('DL160 G10'); pickCpuExact25('G6148');
  { const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    sizes==='8,16,32,64'?pass25('DL160 G10 offers 8/16/32/64GB only (no 128GB kit in its QuickSpecs)'):fail25('DL160 sizes: '+sizes); }
  setv26('dimmq','4'); setv26('dimm','64GB 2666 MT/s');
  /no 64GB kit for 1st Gen/.test(chk26())?pass25('DL160 G10 + 1st Gen + 64GB: flagged — the doc lists no 64GB DDR4-2666 kit (no LRDIMMs on this model)'):fail25('DL160 1st-Gen 64GB not flagged: '+chk26().slice(0,200));
  pickCpuExact25('G6248'); setv26('dimm','64GB 2933 MT/s');
  (/P00930-B21/.test(kit29()) && !/P00926/.test(kit29()) && !/MEMORY KIT/.test(chk26()))?pass25('DL160 G10 + 2nd Gen 64GB: RDIMM P00930-B21 only, no LRDIMM alternate'):fail25('DL160 64GB 2933 wrong: '+kit29());
  setv26('dimm','128GB 2933 MT/s');
  /MEMORY SIZE/.test(chk26())?pass25('a typed 128GB on DL160 G10 is stopped'):fail25('128GB on DL160 not stopped');
  reset27(); setModel25('DL180 G10'); pickCpuExact25('G6148'); setv26('dimmq','4'); setv26('dimm','64GB 2666 MT/s');
  (/815101-B21/.test(kit29()) && !/MEMORY KIT/.test(chk26()))?pass25('DL180 G10 + 1st Gen 64GB: the LRDIMM 815101-B21 (DL180 does list it)'):fail25('DL180 64GB 2666 wrong: '+kit29());
  { const l=cpuList26(); (l.length===56 && l.indexOf('G6248')>-1 && l.indexOf('P8164')<0 && l.indexOf('P8280')<0)?pass25('DL180 G10 cpuAllow: 56 SKUs from its own doc (no 8164, no 82xx beyond 8253/8256)'):fail25('DL180 CPU list: '+l.length); }
  reset27(); setModel25('DL160 G10'); { const l=cpuList26(); (l.length===57 && l.indexOf('P8164')>-1)?pass25('DL160 G10 cpuAllow: 57 SKUs incl. Platinum 8164'):fail25('DL160 CPU list: '+l.length); }
  // --- DL20 / ML30 G10: E-2200 pool, UDIMM 8/16GB, 64GB max ---
  reset27(); setModel25('DL20 G10');
  { const l=cpuList26(); (l.indexOf('E-2278G')>-1 && l.indexOf('Pentium G5420')>-1 && l.indexOf('i3-9100')>-1 && l.indexOf('E-2288G')<0 && l.length===13)
      ?pass25('DL20 G10 CPUs: the E-2200 table + Pentium G5420/i3-9100 + retired E-2124/E-2136; E-2288G (in neither doc) gone'):fail25('DL20 CPU list: '+l.join(','));
    const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    sizes==='8,16'?pass25('DL20 G10 memory sizes: 8/16GB UDIMM only'):fail25('DL20 sizes: '+sizes); }
  pickCpuExact25('E-2236'); setv26('dimmq','4'); setv26('dimm','16GB 2666 MT/s');
  (/879507-B21/.test(kit29()) && /Standard Memory Kit 879507/.test(kit29()) && !/OVER MEMORY/.test(chk26()))?pass25('DL20 G10: 4 x 16GB (64GB) shows the UDIMM kit 879507-B21 and fits'):fail25('DL20 kit/limit wrong: '+kit29());
  setv26('ctrl','P408i-a LH (869081-B21)');
  (/BATTERY/.test(chk26()) && /782961-B21/.test(chk26()) && /12W/.test(d.getElementById('bat-note').textContent))?pass25('DL20 G10 + P408i-a without a battery: 12W battery 782961-B21 required (checked) and suggested'):fail25('DL20 battery rule missing: '+chk26().slice(0,200)+' / '+d.getElementById('bat-note').textContent);
  (/775612-B21/.test(rl29()) && /No cable management arm/.test(rl29()) && /866473-B21/.test(bz29()) && /867998-B21/.test(bz29()))?pass25('DL20 G10: short friction rail 775612-B21 (no CMA), bezel + intrusion kit hints'):fail25('DL20 rail/bezel wrong: '+rl29()+' / '+bz29());
  reset27(); setModel25('ML30 G10'); { const l=cpuList26(); (l.indexOf('E-2278G')<0 && l.indexOf('E-2244G')>-1 && l.length===11)?pass25('ML30 G10 CPUs: its own 11-SKU list — the DL20-only E-2278G/E-2286G do not leak onto it'):fail25('ML30 CPU list: '+l.join(',')); }
  // --- DL560/DL580 rails / bezel ---
  reset27(); setModel25('DL580 G10'); setv26('bays','24SFF');
  (/872151-B21/.test(rl29()) && /includes the cable management arm/.test(rl29()) && /869872-B21/.test(bz29()) && /867824-B21/.test(bz29()))?pass25('DL580 G10: 4U rail kit 872151-B21 includes the CMA; 4U bezel 869872-B21 + intrusion kit'):fail25('DL580 hints wrong: '+rl29()+' / '+bz29());
  reset27(); setModel25('DL560 G10'); setv26('bays','24SFF');
  (/733662-B21/.test(rl29()) && /720864-B21/.test(rl29()) && /720865-B21/.test(rl29()) && /No bezel/.test(bz29()))?pass25('DL560 G10: easy-install and ball-bearing rails with their CMAs; bezel note says no PN is listed'):fail25('DL560 hints wrong: '+rl29()+' / '+bz29());


  // ===== G10+ Intel: DL20 / DL110 / ML30 Gen10 Plus full rundown (build 2026.09.23.6) =====
  ['DL20 G10+','ML30 G10+'].forEach(function(label){
    reset27(); setModel25(label);
    const l=cpuList26();
    (l.length===11 && ['E-2324G','E-2334','E-2374G','E-2378','E-2378G','E-2386G','Pentium G6405'].every(function(c){return l.indexOf(c)>-1;}))
      ?pass25(label+': all 11 E-2300/Pentium processors from its doc (7 were missing)'):fail25(label+' CPU list: '+l.join(','));
    pickCpuExact25('E-2378'); setv26('dimmq','4'); setv26('dimm','32GB 3200 MT/s');
    /P43022-B21/.test(kit29())?pass25(label+': 32GB shows the UDIMM Standard Memory kit P43022-B21'):fail25(label+' kit: '+kit29());
  });
  reset27(); setModel25('ML30 G10+'); pickCpuExact25('E-2388G');
  (hsState25()==='Perf Heatsinks' && /P45221-B21/.test(chk26()))?pass25('ML30 G10+ + 95W E-2388G: performance heatsink P45221-B21 recommended'):fail25('ML30 G10+ heatsink step missing: '+hsState25());
  pickCpuExact25('E-2378'); hsState25()!=='Perf Heatsinks'?pass25('...but not for the 65W E-2378'):fail25('ML30 G10+ 65W wrongly on perf heatsinks');
  (/874578-B21/.test(rl29()) && /includes the cable management arm/.test(rl29()) && /standard/.test(bz29()))?pass25('ML30 G10+: tower-to-rack kit 874578-B21 as the rail hint; bezel key-lock is standard'):fail25('ML30 G10+ hints: '+rl29()+' / '+bz29());
  reset27(); setModel25('DL20 G10+'); pickCpuExact25('Pentium G6405'); addCard27('NS204i-p NVMe PCIe3 x2 lanes boot device, 2x 480GB M.2 RAID 1 (P12965-B21)');
  /NS204i-p.*not supported with the Pentium G6405/.test(chk26())?pass25('DL20 G10+: NS204i-p with the Pentium G6405 is stopped (doc: not supported with Pentium)'):fail25('DL20 G10+ NS204i-p/Pentium not stopped: '+chk26().slice(0,200));
  pickCpuExact25('E-2336');
  !/NS204i-p.*not supported/.test(chk26())?pass25('...and allowed with a Xeon'):fail25('NS204i-p wrongly stopped with a Xeon');
  setv26('ctrl','P408i-a LH (869081-B21)');
  /BATTERY.*782961-B21/.test(chk26())?pass25('DL20 G10+ + P408i-a without a battery: 12W battery 782961-B21 required'):fail25('DL20 G10+ battery rule missing');
  (/775612-B21/.test(rl29()) && /866473-B21/.test(bz29()))?pass25('DL20 G10+: short friction rail + bezel/intrusion hints'):fail25('DL20 G10+ hints wrong');
  reset27(); setModel25('DL110 G10+');
  { const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    sizes==='8,16,32,64,128'?pass25('DL110 G10+: 8-128GB only (no 256GB kit in its QuickSpecs)'):fail25('DL110 sizes: '+sizes); }
  pickCpuExact25('G6330'); setv26('dimmq','8'); setv26('dimm','128GB 2933 MT/s');
  (/P06037-B21/.test(kit29()) && /1TB/.test(d.getElementById('mem-note').textContent))?pass25('DL110 G10+: 8 x 128GB = 1TB, kit P06037-B21, 1TB ceiling'):fail25('DL110 memory: '+kit29()+' / '+d.getElementById('mem-note').textContent);
  (/P50427-B21/.test(rl29()) && /P50420-B21/.test(rl29()))?pass25('DL110 G10+: rail kit P50427-B21 names the required ear kit P50420-B21'):fail25('DL110 rails: '+rl29());
  { const c=R29('DL110 G10+').cards; (c.length===11 && c.some(function(x){return /E810-2CQDA2.*P41611-B21/.test(x);}))?pass25('DL110 G10+ cards: 10 with part numbers (the two newer Intel cards sourced from the DL110 Gen11 doc) + NS204i-p'):fail25('DL110 cards: '+c.length); }


  // ===== G11 Intel: DL20 / DL110 / DL320 / DL560 / ML30 / ML110 / ML350 Gen11 (build 2026.09.23.7) =====
  // --- xeone4: DL20/ML30 Gen11 are E-2400 + DDR5, not the E-2300/DDR4 pool they used to share with Gen10 Plus ---
  ['DL20 G11','ML30 G11'].forEach(function(label){
    reset27(); setModel25(label);
    const l=cpuList26();
    (l.length===9 && l.indexOf('E-2488')>-1 && l.indexOf('Pentium G7400')>-1 && l.indexOf('E-2388G')<0)
      ?pass25(label+': the 9 E-2400/Pentium G7400 processors from its doc — no Gen10 Plus E-2300 parts'):fail25(label+' CPU list: '+l.join(','));
    const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    const speeds=speeds26().join(',');
    (sizes==='16,32' && speeds==='4400')?pass25(label+': DDR5 UDIMM 16/32GB at 4400 MT/s only'):fail25(label+' memory: sizes '+sizes+' speeds '+speeds);
    pickCpuExact25('E-2456'); setv26('dimmq','4'); setv26('dimm','32GB 4400 MT/s');
    (/P64339-B21/.test(kit29()) && !/OVER MEMORY/.test(chk26()))?pass25(label+': 4 x 32GB (128GB) fits, kit P64339-B21'):fail25(label+' 32GB: '+kit29());
  });
  reset27(); setModel25('ML30 G11'); pickCpuExact25('E-2488');
  (hsState25()==='Perf Heatsinks' && /P65108-B21/.test(chk26()))?pass25('ML30 G11 + 95W E-2488: High Performance Heat Sink Kit P65108-B21'):fail25('ML30 G11 heatsink: '+hsState25());
  // --- DL110 G11: 8 DIMM slots (was 16), 1TB, telco N-suffix CPUs, 5423N blocks the secondary riser ---
  reset27(); setModel25('DL110 G11');
  (M29.find(function(m){return m.m+' '+m.g==='DL110 G11';}).d===8)?pass25('DL110 G11: 8 DIMM slots (1 per channel) — was wrongly 16'):fail25('DL110 G11 DIMM slots');
  { const l=cpuList26(); (l.length===18 && ['G5423N','G6403N','G6423N','G6433N','G6443N'].every(function(c){return l.indexOf(c)>-1;}))?pass25('DL110 G11: 18 processors incl. the 5 telco N-suffix Golds'):fail25('DL110 G11 CPUs: '+l.join(',')); }
  pickCpuExact25('G5423N'); addRiser27('x16 FHHL PCIe Secondary Riser Kit (P54288-B21)');
  /secondary riser cannot be fitted/.test(chk26())?pass25('DL110 G11 + Gold 5423N + secondary riser: stopped (doc rule)'):fail25('DL110 5423N riser rule missing: '+chk26().slice(0,200));
  { const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    sizes==='16,32,64,128'?pass25('DL110 G11: 16-128GB only'):fail25('DL110 G11 sizes: '+sizes); }
  setv26('dimmq','8'); setv26('dimm','128GB 4000 MT/s');
  (/P43334-B21/.test(kit29()) && !/MEMORY QTY/.test(chk26()))?pass25('DL110 G11 128GB = Quad Rank 3DS P43334-B21; DL360/DL380-only population rules not applied'):fail25('DL110 G11 128GB: '+kit29());
  (/775612-B21/.test(rl29()) && /P58197-B21/.test(rl29()))?pass25('DL110 G11 rails: 775612-B21 + ear kit P58197-B21'):fail25('DL110 G11 rails: '+rl29());
  // --- DL320 G11: rails by chassis, per-model kits ---
  reset27(); setModel25('DL320 G11'); setv26('bays','12LFF');
  (/P52353-B21/.test(rl29()) && !/P52349-B21/.test(rl29()))?pass25('DL320 G11 12LFF: Easy Install Rail 9 P52353-B21 only'):fail25('DL320 12LFF rails: '+rl29());
  setv26('bays','10SFF');
  (/P52349-B21/.test(rl29()) && /listed for/.test(rl29()))?pass25('DL320 G11 10SFF (no kit named for it): all rail kits shown with the chassis each is listed for'):fail25('DL320 10SFF rails: '+rl29());
  pickCpuExact25('G6548Y+'); setv26('dimmq','8'); setv26('dimm','128GB 5200 MT/s');
  /P64709-B21/.test(kit29())?pass25('DL320 G11 + 5th Gen 128GB: its own doc\'s 3DS kit P64709-B21 (not the DL380\'s P69976)'):fail25('DL320 128GB 5th Gen: '+kit29());
  setv26('dimm','256GB 5200 MT/s');
  /MEMORY SIZE/.test(chk26())?pass25('DL320 G11: 256GB stopped (not in its QuickSpecs)'):fail25('DL320 256GB not stopped');
  (/P55417-B21/.test(bz29()) && /P50450-B21/.test(bz29()))?pass25('DL320 G11: 1U common bezel P50450-B21 + its own intrusion kit P55417-B21'):fail25('DL320 bezel: '+bz29());
  // --- PSU / controller / OCP lists now per model ---
  { const r=R29('ML110 G11'); (r.psu.length===4 && r.ctrl.some(function(x){return /P47781-B21/.test(x);}) && !r.ctrl.some(function(x){return /SR932i/.test(x);}) && r.flr.length===9)
      ?pass25('ML110 G11: 4 PSUs, OCP + PCI controllers (no SR932i-p), 9 OCP adapters — all with part numbers'):fail25('ML110 G11 lists wrong'); }
  { const r=R29('DL560 G11'); (/P01367-B21/.test(r.bat.join()) && r.cards.filter(function(x){return /NS204i-u/.test(x);}).length===2)
      ?pass25('DL560 G11: 260mm-cable battery P01367-B21; NS204i-u front and rear enablement kits'):fail25('DL560 G11 bat/NS204'); }
  reset27(); setModel25('ML350 G11'); pickCpuExact25('P8480+'); setv26('dimmq','16'); setv26('dimm','128GB 4800 MT/s');
  (/P69974-B21/.test(kit29()) && /P43334-B21/.test(kit29()))?pass25('ML350 G11 128GB: Dual Rank P69974-B21 with the 3DS alternative P43334-B21'):fail25('ML350 128GB: '+kit29());
  (/P47394-B21/.test(rl29()) && /P47226-B21/.test(bz29()))?pass25('ML350 G11: tower-to-rack kit P47394-B21, intrusion kit P47226-B21'):fail25('ML350 hints');
  // --- GPU detector no longer fires on the crypto NIC ---
  reset27(); setModel25('DL380 G11'); addCard27('Secure Network Adapter 10/25Gb 2p SFP28 NVMe-oF crypto (S2A69A)');
  !/GPUs and accelerators require/.test(chk26()+d.querySelector('.col-form').textContent)?pass25('DL380 G11: the S2A69A crypto NIC is not mistaken for a GPU (its label used to start with "NVIDIA")'):fail25('crypto NIC still triggers the GPU fan rule');


  // ===== G10 towers: ML30 / ML110 / ML350 Gen10; NS204i-p fan rule scoped (build 2026.09.23.8) =====
  // --- NS204i-p needs the fan kit on DL360/DL380 Gen10 Plus only ---
  reset27(); setModel25('DL380 G10'); pickCpuExact25('G6248'); setv26('bays','8SFF');
  addCard27('NS204i-p NVMe PCIe3 x2 lanes boot device, 2x 480GB M.2 RAID 1 (P12965-B21)');
  fanState27()!=='Perf Fans'?pass25('DL380 G10 + NS204i-p: no fan-kit requirement (that rule is Gen10 Plus only)'):fail25('DL380 G10 NS204i-p wrongly forces perf fans');
  reset27(); setModel25('DL360 G10+'); pickCpuExact25('G6330'); setv26('bays','8SFF');
  addCard27('NS204i-p NVMe PCIe3 x2 lanes boot device — needs High Performance Fan Kit (P12965-B21)');
  fanState27()==='Perf Fans'?pass25('DL360 G10+ + NS204i-p: still forces the High Performance Fan Kit'):fail25('DL360 G10+ NS204i-p fan rule lost');
  // --- ML350 G10 fans: required kit, not "ships standard" ---
  reset27(); setModel25('ML350 G10'); pickCpuExact25('G6248'); setv26('cpuq','1'); setv26('bays','8SFF');
  fanState27()!=='Perf Fans'?pass25('ML350 G10 1P 8SFF: standard fans'):fail25('ML350 1P wrongly on the fan kit');
  setv26('cpuq','2');
  (fanState27()==='Perf Fans' && /second processor requires the fan kit.*874572-B21/.test(d.querySelector('.col-form').textContent))?pass25('ML350 G10 2P: Redundant Fan Cage Kit 874572-B21 required'):fail25('ML350 2P fan rule missing: '+fanState27());
  setv26('cpuq','1'); setv26('bays','24SFF');
  (/24SFF requires the fan kit/.test(d.querySelector('.col-form').textContent) && !/24SFF ships with high performance fans/.test(d.querySelector('.col-form').textContent))
    ?pass25('ML350 G10 24SFF: "requires the fan kit", not the rack wording "ships with high performance fans"'):fail25('ML350 24SFF fan wording wrong');
  { const l=cpuList26(); (l.length===109 && ['G6142M','P8170M','P8176M','P8280M','S4108'].every(function(c){return l.indexOf(c)>-1;}))?pass25('ML350 G10: 109 processors (1st Gen from the 2018 doc + 2nd Gen from 2020), incl. the 3 added M-suffix parts'):fail25('ML350 CPUs: '+l.length); }
  pickCpuExact25('G6248'); setv26('dimmq','12'); setv26('dimm','128GB 2933 MT/s');
  (/P00928-B21/.test(kit29()) && !/P11040/.test(kit29()))?pass25('ML350 G10 128GB 2nd Gen: its doc\'s 3DS kit P00928-B21'):fail25('ML350 128GB: '+kit29());
  { const c=R29('ML350 G10').cards; (c.length===39 && c.some(function(x){return /\(874253-B21\)/.test(x);}) && c.some(function(x){return /\(P08446-B21\)/.test(x);}))?pass25('ML350 G10 cards: 38 doc-listed (shifted V23 column realigned) + M.2 kit'):fail25('ML350 cards: '+c.length); }
  // --- ML110 G10 ---
  reset27(); setModel25('ML110 G10');
  { const l=cpuList26(); (l.length===19 && l.indexOf('G5218N')>-1 && l.indexOf('G6248')<0)?pass25('ML110 G10: its 19 low-TDP processors only'):fail25('ML110 CPUs: '+l.length); }
  { const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    sizes==='8,16,32'?pass25('ML110 G10: 8/16/32GB only'):fail25('ML110 sizes: '+sizes); }
  pickCpuExact25('S4110'); setv26('dimmq','6'); setv26('dimm','32GB 2400 MT/s');
  (/815100-B21/.test(kit29()) && /192GB/.test(d.getElementById('mem-note').textContent))?pass25('ML110 G10 1st Gen 32GB: 815100-B21, 192GB ceiling'):fail25('ML110 mem: '+kit29()+' / '+d.getElementById('mem-note').textContent);
  (/P01367-B21/.test(R29('ML110 G10').bat.join()) && /874578-B21/.test(rl29()))?pass25('ML110 G10: 260mm battery P01367-B21, tower-to-rack kit'):fail25('ML110 bat/rails');
  // --- ML30 G10 ---
  reset27(); setModel25('ML30 G10');
  (R29('ML30 G10').ctrl.length===5 && R29('ML30 G10').cards.length===9)?pass25('ML30 G10: controller list (S100i + 4 PCIe) and 9 stand-up NICs'):fail25('ML30 G10 lists');


  // ===== Paste: bare memory speed, "3 yr iLO", no phantom iLO card; G10 per-CPU memory speed caps (build 2026.09.23.9) =====
  reset27(); paste28('10x\nDL380 G10 12LFF\n1x 5218 2.3Ghz 16C\n2x 16GB 2666\n4x 3.84TB SAS\n8x 6TB SAS\nP816i-a + Bat\n366FLR 1Gb 4P\n2x 800w\nRails\n3 yr iLo');
  (d.getElementById('dimm').value==='16GB 2666 MT/s' && d.getElementById('dimmq').value==='2')?pass25('user-reported paste: bare "2x 16GB 2666" keeps the 2666 MT/s speed'):fail25('bare speed lost: "'+d.getElementById('dimm').value+'"');
  (d.getElementById('il1').checked && /3-year licence/.test(d.getElementById('paste-result').textContent))?pass25('"3 yr iLo" → iLO Advanced (3-year licence)'):fail25('"3 yr iLo" not read as the licence');
  ![...d.querySelectorAll('#cards [data-k=name]')].some(function(x){return /iLO dedicated NIC/.test(x.value);})?pass25('"iLo" in a paste no longer adds a phantom "iLO dedicated NIC" card'):fail25('phantom iLO card still added');
  { const sp=speeds26(); (sp.indexOf(2933)<0 && sp.indexOf(2666)>-1)?pass25('pasted Gold 5218 narrows the speed buttons to 2666 max (was still offering 2933)'):fail25('5218 speeds: '+sp.join(',')); }
  reset27(); paste28('DL360 G10, 1x Silver 4210, 4x 16GB 2933');
  /MEMORY SPEED.*4210 runs memory at up to 2400/.test(chk26())?pass25('Silver 4210 + 2933 memory: stopped — the 4210 runs DDR4 at 2400'):fail25('4210 speed cap missing: '+chk26().slice(0,200));
  reset27(); paste28('DL380 G10+, 2x 6330, 8x 32GB, 2x 800W 2400');
  d.getElementById('dimm').value==='32GB'?pass25('a "2400" after the PSU line is not taken as the memory speed'):fail25('stray 2400 grabbed: '+d.getElementById('dimm').value);
  reset27(); paste28('DL380 G10, 2x 6248, 8x 32GB 2400W');
  d.getElementById('dimm').value==='32GB'?pass25('"32GB 2400W" is not read as a 2400 MT/s speed'):fail25('wattage read as speed: '+d.getElementById('dimm').value);
  reset27(); setModel25('DL380 G10'); pickCpuExact25('B3204');
  speeds26().join(',')==='2133'?pass25('Bronze 3204: DDR4-2133 only'):fail25('Bronze speeds: '+speeds26().join(','));
  pickCpuExact25('G5222'); speeds26().indexOf(2933)>-1?pass25('Gold 5222 (the 52xx exception) keeps 2933'):fail25('5222 lost 2933');
  pickCpuExact25('G6130'); (speeds26().indexOf(2666)>-1 && speeds26().indexOf(2933)<0)?pass25('1st Gen Gold 6130: 2666 max'):fail25('6130 speeds: '+speeds26().join(','));


  // ===== G10+ AMD: DL325 (v1/v2) / DL345 / DL365 / DL385 (v1/v2) Gen10 Plus (build 2026.09.23.10) =====
  reset27(); setModel25('DL385 G10+ v2'); pickCpuExact25('EPYC 7543'); setv26('cpuq','2'); setv26('dimmq','16'); setv26('dimm','32GB 3200 MT/s');
  (/P07646-B21/.test(kit29()) && /P38454-B21/.test(kit29()) && !/P06033/.test(kit29()))?pass25('DL385 G10+ v2 (Milan) 32GB: the AMD kit P07646-B21 (+ single-rank P38454-B21), not the Intel sp3 kit'):fail25('AMD kit: '+kit29());
  setv26('dimmq','3');
  !/MEMORY QTY/.test(chk26())?pass25('AMD G10+: Intel-only memory population checks not applied'):fail25('Intel memory rules leaking onto AMD');
  reset27(); setModel25('DL345 G10+');
  { const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    sizes==='8,16,32,64,128,256'?pass25('Rome/Milan now offer the 8GB kit (P07638-B21) every AMD G10+ doc lists'):fail25('AMD sizes: '+sizes);
    setv26('dimmq','2'); setv26('dimm','8GB 3200 MT/s');
    (/P07638-B21/.test(kit29()) && (kit29().match(/P07638/g)||[]).length===1)?pass25('...8GB kit shown once even before a Rome/Milan CPU is picked'):fail25('8GB kit: '+kit29()); }
  reset27(); setModel25('DL325 G10+');
  { const sizes=[...d.querySelectorAll('#dimm-size-btns button')].map(function(b){return b.getAttribute('data-sz');}).join(',');
    sizes==='8,16,32,64,128'?pass25('DL325 G10+ v1: no 256GB kit in its doc'):fail25('DL325 v1 sizes: '+sizes); }
  (/P18544-B21/.test(rl29()) && /P18546-B21/.test(rl29()) && /P18547-B21/.test(bz29()) && /P14604-B21/.test(bz29()))?pass25('DL325 G10+ v1: 1075mm rail + CMA, DL325 bezel, intrusion kit'):fail25('DL325 v1 hints: '+rl29()+' / '+bz29());
  (/782961-B21/.test(R29('DL325 G10+').bat.join()) && /782961-B21/.test(R29('DL325 G10+ v2').bat.join()))?pass25('DL325 G10+ v1/v2: 12W battery 782961-B21'):fail25('DL325 battery');
  { const f=R29('DL365 G10+').flr; (f.some(function(x){return /P31323-B21/.test(x);}) && f.some(function(x){return /P31348-B21/.test(x);}))?pass25('DL365 G10+: OCP3 InfiniBand HDR 1p/2p added (old note wrongly said none)'):fail25('DL365 OCP IB missing'); }
  { const f=R29('DL385 G10+').flr; (f.some(function(x){return /P10106-B21/.test(x);}) && f.some(function(x){return /P42041-B21/.test(x);}))?pass25('DL385 G10+ v1: E810 + MCX631432AS OCP cards from the current V30 doc'):fail25('DL385 v1 OCP'); }
  { const c=R29('DL385 G10+ v2').cards; (c.length===42 && c.some(function(x){return /\(P25527-B21\)/.test(x);}) && c.some(function(x){return /\(P24437-B21\)/.test(x);}) && !c.some(function(x){return /nvidia/i.test(x);}))?pass25('DL385 G10+ v2 cards: 38 doc-listed + 2 NVMe adapters + NS204i-p + M.2 kit, incl. the non-PLUS X2522-25G'):fail25('DL385 v2 cards: '+c.length); }
  reset27(); setModel25('DL345 G10+'); setv26('bays','12LFF');
  (/P22019-B21/.test(rl29()) && /867809-B21/.test(bz29()))?pass25('DL345 G10+ 12LFF: DL38X LFF rail + 2U bezel'):fail25('DL345 hints: '+rl29());


  // ===== G10 AMD: DL325 / DL385 Gen10 (build 2026.09.23.11) =====
  reset27(); setModel25('DL385 G10'); pickCpuExact25('EPYC 7502'); setv26('cpuq','2');
  { const sp=speeds26(); (sp.join(',')==='2933')?pass25('DL385 G10 + Rome: 2933 MT/s only (Gen10 board — was offering 3200)'):fail25('DL385 G10 Rome speeds: '+sp.join(',')); }
  setv26('dimmq','16'); setv26('dimm','32GB 2933 MT/s');
  (/P19043-B21/.test(kit29()) && !/P07646|P06033/.test(kit29()))?pass25('DL385 G10 + Rome 32GB: the Gen10 AMD 2933 kit P19043-B21'):fail25('DL385 G10 Rome kit: '+kit29());
  setv26('dimm','32GB 3200 MT/s');
  /MEMORY SPEED/.test(chk26())?pass25('DL385 G10: a typed 3200 MT/s is stopped (the board runs Rome at 2933)'):fail25('3200 on DL385 G10 not stopped');
  pickCpuExact25('EPYC 7601'); setv26('dimm','64GB 2666 MT/s');
  { const sp=speeds26(); (sp.join(',')==='2666' && /P05592-B21/.test(kit29()) && /838085-B21/.test(kit29()))?pass25('DL385 G10 + Naples: 2666 only; 64GB = P05592-B21 (LRDIMM alternate 838085-B21)'):fail25('Naples: '+sp.join(',')+' / '+kit29()); }
  (/733660-B21/.test(rl29())||/733662-B21/.test(rl29()))&&/867809-B21/.test(bz29())&&/867824-B21/.test(bz29())?pass25('DL385 G10: 2U rails, bezel, intrusion kit'):fail25('DL385 G10 hints: '+rl29()+' / '+bz29());
  { const c=R29('DL385 G10').cards; (c.length===21 && c.some(function(x){return /\(P06154-B21\)/.test(x);}))?pass25('DL385 G10 cards: 20 from its current doc + M.2 kit'):fail25('DL385 G10 cards: '+c.length); }
  reset27(); setModel25('DL325 G10'); pickCpuExact25('EPYC 7402P');
  { const sp=speeds26(); sp.join(',')==='2933'?pass25('DL325 G10 + Rome: 2933 only'):fail25('DL325 G10 speeds: '+sp.join(',')); }
  (/734807-B21/.test(rl29()) && /866473-B21/.test(bz29()) && R29('DL325 G10').cards.length===39)?pass25('DL325 G10: 1U rail + CMA, intrusion kit, 39 cards (38 doc-listed + M.2 kit)'):fail25('DL325 G10 hints/cards');
  reset27(); setModel25('DL385 G10+'); pickCpuExact25('EPYC 7502');
  speeds26().indexOf(3200)>-1?pass25('DL385 G10+ (Gen10 Plus board) still runs Rome at 3200 — the 2933 cap is per model'):fail25('G10+ Rome lost 3200');


  // ===== QuickSpecs badge reads as a link (build 2026.09.23.12) =====
  reset27(); setModel25('DL380 G10');
  { const b=d.getElementById('badge-v');
    (b.classList.contains('on') && !b.classList.contains('nolink') && b.querySelector('.bv-go') && /View QuickSpecs/.test(b.textContent) && /DL380 G10 QuickSpecs on hpe\.com/.test(b.getAttribute('aria-label')||''))
      ?pass25('verified badge with a doc shows a visible "View QuickSpecs" link part and a model-specific label'):fail25('badge link cue missing'); }
  { const css=[...d.querySelectorAll('style')].map(function(s){return s.textContent;}).join('');
    (/\.badge\.v\.nolink \.bv-go\{display:none\}/.test(css) && /\.bv-long\{display:none\}/.test(css))
      ?pass25('badge CSS: link part hidden when there is no doc; long words dropped on phones'):fail25('badge CSS rules missing'); }


  // ===== TPM pills relabelled per model — no bare "None" (build 2026.09.23.13) =====
  const tpmState30=function(){return ['tp0','tp1','tp2'].filter(function(id){return !d.getElementById(id).hidden;}).map(function(id){return d.querySelector('label[for='+id+']').textContent+(d.getElementById(id).checked?'*':'');}).join(' / ');};
  reset27(); setModel25('DL380 G11');
  (tpmState30()==='TPM 2.0 (built in)*' && /TPM 2\.0 \(built in\)/.test(slip27()))?pass25('G11: only "TPM 2.0 (built in)", pre-selected, and on the slip'):fail25('G11 TPM: '+tpmState30()+' / '+slip27().slice(0,200));
  reset27(); setModel25('DL380 G10');
  (tpmState30()==='No TPM module* / TPM 2.0 module, 1.2 mode / TPM 2.0 module' && /No TPM module/.test(slip27()))?pass25('G10: "No TPM module" (default, stated on the slip) / TPM 2.0 module / 1.2 mode'):fail25('G10 TPM: '+tpmState30());
  d.getElementById('tp1').checked=true; fire(d.getElementById('tp1'),'change');
  (/TPM 2\.0 module, 1\.2 mode/.test(slip27()) && /872108-B21/.test(chk26()))?pass25('G10 1.2 mode: slip says "TPM 2.0 module, 1.2 mode"; check names the FIO setting 872108-B21'):fail25('G10 1.2 mode slip/check');
  reset27(); setModel25('DL80 G9');
  tpmState30()==='No TPM module* / TPM 1.2 module'?pass25('DL80 G9: TPM 1.2 module only (its doc lists no 2.0 kit)'):fail25('DL80 G9 TPM: '+tpmState30());
  reset27(); setModel25('DL380 G9');
  /745823-B21/.test(d.getElementById('tpm-note').textContent)&&/UEFI/.test(d.getElementById('tpm-note').textContent)?pass25('G9 note: 488069-B21 / 745823-B21, TPM 2.0 UEFI-only'):fail25('G9 TPM note');
  reset27(); setModel25('DL560 G10');
  tpmState30()==='No TPM module* / TPM 2.0 module'?pass25('DL560 G10: no 1.2-mode option (its doc lists no 872108-B21)'):fail25('DL560 G10 TPM: '+tpmState30());
  reset27(); setModel25('DL360 G10+');
  /P13771-B21/.test(d.getElementById('tpm-note').textContent)?pass25('G10+ rack: TPM 2.0 Gen10 Plus Kit P13771-B21'):fail25('G10+ TPM note');
  reset27(); setModel25('DL380 G10'); setModel25('DL380 G11');
  d.getElementById('tp2').checked?pass25('switching from a module board (No TPM) to a built-in board moves the pick to TPM 2.0 (built in)'):fail25('TPM pick not moved on model switch');


  // ===== Media bay pills per system (build 2026.09.23.14) =====
  const md30=function(){return ['md0','md1','md2','md3','md4'].filter(function(id){return !d.getElementById(id).hidden;}).map(function(id){return d.querySelector('label[for='+id+']').textContent+(d.getElementById(id).checked?'*':'');}).join(' / ');};
  reset27(); setModel25('DL380 G10');
  (md30()==='No optical drive* / DVD-ROM (internal) / DVD-RW (internal) / Universal media bay / USB DVD-RW (external)' && /826708-B21/.test(d.getElementById('media-note').textContent) && /No optical drive/.test(slip27()))
    ?pass25('DL380 G10: all four real options + "No optical drive" (on the slip), UMB kit 826708-B21 in the note'):fail25('DL380 G10 media: '+md30());
  reset27(); setModel25('DL360 G10');
  (md30().indexOf('Universal media bay')<0 && /868000-B21/.test(d.getElementById('media-note').textContent))?pass25('DL360 G10: no Universal Media Bay pill; note gives the 8SFF blank kit 868000-B21'):fail25('DL360 G10 media: '+md30());
  reset27(); setModel25('DL345 G10+');
  md30()==='No optical drive* / USB DVD-RW (external)'?pass25('DL345 G10+: external USB DVD-RW only (its doc lists no internal drive)'):fail25('DL345 G10+ media: '+md30());
  d.getElementById('md1').checked=true; fire(d.getElementById('md1'),'change');
  /MEDIA BAY.*lists no internal optical drive/.test(chk26())?pass25('...and a pasted/restored internal DVD on it is flagged'):fail25('DL345 internal DVD not flagged');
  reset27(); setModel25('DL110 G10+');
  (md30()==='No media bay on this chassis*' && /No media bay on this chassis/.test(slip27()))?pass25('DL110 G10+: single "No media bay on this chassis" (added to the no-media list)'):fail25('DL110 G10+ media: '+md30());
  reset27(); paste28('DL380 G10, 2x 6248, usb dvd');
  d.getElementById('md4').checked?pass25('paste "usb dvd" picks the external USB DVD-RW'):fail25('usb dvd paste not recognised');
  reset27(); setModel25('DL380 G10'); d.getElementById('md3').checked=true; fire(d.getElementById('md3'),'change'); setModel25('DL360 G10');
  d.getElementById('md0').checked?pass25('switching to a model without that option falls back to "No optical drive"'):fail25('hidden media pick kept');


  // ===== Builds count on the slip; riser / PCIe slot audit fixes (build 2026.09.23.15) =====
  reset27(); setModel25('DL380 G10');
  /^BUILD x1/.test(slip27().trim())?pass25('slip always states the build count ("BUILD x1" when left at the default)'):fail25('BUILD x1 missing: '+slip27().slice(0,60));
  setv26('modelq','10'); /^BUILD x10/.test(slip27().trim())?pass25('...and "BUILD x10" for 10'):fail25('BUILD x10 missing');
  const slots30=function(){addCard27('SN1610Q 32Gb FC 1p (R2E08A)');const t=d.getElementById('riser-slot-note').textContent;const m2=t.match(/of (\d+) PCIe/);return m2?+m2[1]:null;};
  // ML110 G11: 2 board slots + up to 2 riser slots
  reset27(); setModel25('ML110 G11'); pickCpuExact25('G5416S');
  { const a=slots30(); reset27(); setModel25('ML110 G11'); pickCpuExact25('G5416S'); addRiser27('GPU Riser Kit (P53487-B21) — Slot 2'); const b=slots30();
    (a===2&&b===3)?pass25('ML110 G11: 2 board slots, 3 with the first GPU riser (was 4 with none / 1 with one)'):fail25('ML110 G11 slots: '+a+' / '+b); }
  // DL80 G9: 5 board slots (3 on Proc 1); the FHHL riser nets +1
  reset27(); setModel25('DL80 G9'); pickCpuExact25('E5-2620v4'); setv26('cpuq','1');
  { const a=slots30(); reset27(); setModel25('DL80 G9'); pickCpuExact25('E5-2620v4'); setv26('cpuq','2'); addRiser27('Full Height Half Length Riser Kit (765515-B21)'); const b=slots30();
    (a===3&&b===6)?pass25('DL80 G9: 3 slots on 1 CPU with no riser; 6 on 2 CPUs with the FHHL riser (was capped at 2)'):fail25('DL80 G9 slots: '+a+' / '+b); }
  // DL580 G10: slots hang off all four processors (clean V16 table)
  reset27(); setModel25('DL580 G10'); pickCpuExact25('P8260'); setv26('cpuq','1');
  { const a=slots30(); reset27(); setModel25('DL580 G10'); pickCpuExact25('P8260'); setv26('cpuq','2'); addRiser27('Primary 7-slot Riser (878214-B21)'); addRiser27('Secondary + Tertiary 9-slot Riser (872340-B21)'); const b=slots30();
    reset27(); setModel25('DL580 G10'); pickCpuExact25('P8260'); setv26('cpuq','4'); addRiser27('Primary 7-slot Riser (878214-B21)'); addRiser27('Secondary + Tertiary 9-slot Riser (872340-B21)'); const c=slots30();
    (a===3&&b===8&&c===16)?pass25('DL580 G10: 3 usable slots on 1 CPU, 8 on 2, 16 on 4 (the 7-slot riser is NOT all on Proc 1)'):fail25('DL580 G10 slots: '+a+'/'+b+'/'+c); }
  // DL580 G9: 5 slots at 2P, 9 at 4P
  reset27(); setModel25('DL580 G9'); pickCpuExact25('E7-8880v4'); setv26('cpuq','2');
  { const a=slots30(); reset27(); setModel25('DL580 G9'); pickCpuExact25('E7-8880v4'); setv26('cpuq','4'); const b=slots30();
    (a===5&&b===9)?pass25('DL580 G9: 5 usable slots with 2 processors, 9 with 4 (was 9 for any)'):fail25('DL580 G9 slots: '+a+' / '+b); }
  // DL365 G11: standard chassis
  reset27(); setModel25('DL365 G11'); pickCpuExact25('EPYC 9124'); setv26('cpuq','1');
  { const a=slots30(); a===1?pass25('DL365 G11 1P: 1 slot (standard chassis; GPU risers only on the GPU chassis)'):fail25('DL365 G11 1P slots: '+a); }

  // ===== iLO / motherboard / backplane / rails / bezel per system (build 2026.09.23.16) =====
  const pills31=function(n){return [].filter.call(d.querySelectorAll('input[name='+n+']'),function(i){return !i.hidden;}).map(function(i){return d.querySelector('label[for='+i.id+']').textContent+(i.checked?'*':'');}).join(' / ');};
  reset27(); setModel25('DL380 G10');
  (pills31('ilo')==='iLO 5 Standard (included)* / iLO 5 Advanced / iLO 5 Advanced Premium Security' && /iLO 5 Standard \(included\)/.test(slip27()))
    ?pass25('G10: iLO pills name iLO 5; the slip says "iLO 5 Standard (included)"'):fail25('G10 iLO: '+pills31('ilo'));
  (pills31('mobo')==='Standard (embedded NIC)* / NC (no embedded NIC)' && /Standard motherboard \(embedded NIC\)/.test(slip27()))
    ?pass25('G10 choice board: "Standard (embedded NIC)" / "NC (no embedded NIC)", spelled out on the slip'):fail25('G10 mobo: '+pills31('mobo'));
  d.getElementById('il2').checked=true; fire(d.getElementById('il2'),'change');
  /iLO 5 Advanced Premium Security license/.test(slip27())?pass25('...Advanced Premium on the slip names iLO 5'):fail25('G10 premium slip');
  reset27(); setModel25('DL160 G9');
  (pills31('ilo')==='iLO 4 Standard (included)* / iLO 4 Advanced / iLO 4 Essentials' && pills31('bp')==='SAS / SATA only*')
    ?pass25('DL160 G9: iLO 4 with Essentials, no Advanced Premium; backplane "SAS / SATA only"'):fail25('DL160 G9: '+pills31('ilo')+' | '+pills31('bp'));
  reset27(); setModel25('ML10 G9');
  (pills31('ilo')==='No iLO (Intel AMT)*' && /No iLO \(Intel AMT\)/.test(slip27()))?pass25('ML10 G9: "No iLO (Intel AMT)" — it has no iLO'):fail25('ML10 G9 iLO: '+pills31('ilo'));
  reset27(); paste28('DL380 G9, 2x E5-2680 v4, ilo advanced premium');
  /no Advanced Premium Security licence/.test(chk26())?pass25('pasted Advanced Premium on a Gen9 is stopped (iLO 4 has no such tier)'):fail25('G9 premium paste not flagged');
  reset27(); paste28('DL160 G9, ilo essentials');
  (d.getElementById('il3').checked && /iLO 4 Essentials license/.test(slip27()))?pass25('paste "ilo essentials" picks iLO 4 Essentials'):fail25('essentials paste');
  reset27(); setModel25('DL380 G11');
  (pills31('mobo')==='No embedded NIC (every board)*' && /Motherboard: no embedded NIC/.test(slip27()) && /iLO 6 Standard/.test(slip27()))
    ?pass25('DL380 G11: single "No embedded NIC (every board)" pill, iLO 6 on the slip'):fail25('DL380 G11 mobo: '+pills31('mobo'));
  reset27(); setModel25('ML110 G11');
  (pills31('mobo')==='Standard (embedded NIC)*' && d.getElementById('bezel-row').hidden && d.getElementById('rail-label').textContent==='Tower-to-rack kit'
    && /standard on every ML110 Gen11/.test(d.getElementById('door-note').textContent) && /P47226-B21/.test(d.getElementById('door-note').textContent) && !/No bezel/.test(slip27()))
    ?pass25('ML110 G11 tower: no rack Bezel row / "No bezel" line, door note says the key-lock bezel is standard + intrusion kit, Rails reads as tower-to-rack'):fail25('ML110 G11 tower fields');
  d.getElementById('rl1').checked=true; fire(d.getElementById('rl1'),'change');
  /Tower-to-rack kit/.test(slip27())?pass25('...and the slip says "Tower-to-rack kit"'):fail25('tower rail slip');
  reset27(); setModel25('ML350 G9');
  /726567-B21/.test(d.getElementById('rail-note').textContent)?pass25('ML350 G9: tower-to-rack kit 726567-B21 in the note'):fail25('ML350 G9 rack kit note');
  reset27(); setModel25('DL380 G10');
  d.getElementById('bkey-set').hidden?pass25('bezel key pills are hidden until a bezel is picked'):fail25('bezel key visible without bezel');
  d.getElementById('bz1').checked=true; fire(d.getElementById('bz1'),'change');
  !d.getElementById('bkey-set').hidden?pass25('...and appear once Bezel = Yes'):fail25('bezel key not shown');

  // ===== DL380 G12 full rundown from QuickSpecs V19 (build 2026.09.24.1) =====
  reset27(); setModel25('DL380 G12');
  (d.getElementById('dimm-speed-btns').textContent==='5200 MT/s5600 MT/s6000 MT/s6400 MT/s')?pass25('DL380 G12 memory speeds: 5200 / 5600 / 6000 / 6400 (Gen12 table)'):fail25('DL380 G12 speeds: '+d.getElementById('dimm-speed-btns').textContent);
  ['6503P','6725P','6732P','6762P'].every(function(c){return pickCpuExact25(c);})?pass25('4 Xeon 6 SKUs added from V19 (6503P, 6725P, 6732P, 6762P) are pickable'):fail25('new Xeon 6 SKUs missing');
  setv26('cpuq','2'); pickCpuExact25('6710E'); setv26('dimmq','16'); setv26('dimm','64GB 6400 MT/s');
  /6710E runs memory at up to 5600/.test(chk26())?pass25('6710E caps memory at 5600'):fail25('6710E 5600 cap missing');
  /P69728-B21/.test(d.getElementById('dimm-kit').textContent)?pass25('64GB kit = P69728-B21 (DDR5-6400)'):fail25('xeon6 kit PN: '+d.getElementById('dimm-kit').textContent);
  pickCpuExact25('6737P'); setv26('dimmq','24');
  /2 DIMMs per channel.*6000/.test(chk26())?pass25('24 DIMMs on 2 CPUs at 6400 is stopped (2 DIMMs per channel = 6000)'):fail25('2DPC speed not flagged');
  setv26('dimm','64GB 6000 MT/s');
  !/2 DIMMs per channel/.test(chk26())?pass25('...6000 at 2 DIMMs per channel is fine'):fail25('6000 2DPC wrongly flagged');
  setv26('dimm','16GB 6000 MT/s');
  /16GB modules are 1 DIMM per channel only/.test(chk26())?pass25('16GB modules are limited to 1 DIMM per channel'):fail25('16GB 1DPC not flagged');
  setv26('dimmq','16'); setv26('dimm','16GB 6400 MT/s');
  !/16GB modules are 1 DIMM per channel only —/.test(chk26())?pass25('...16 x 16GB on 2 CPUs is fine'):fail25('16x16GB wrongly flagged');
  setv26('ctrl','MR416i-p — x16 lanes, 8GB cache (P47777-B21)');
  /Smart Storage battery or capacitor.*MR416i-p/.test(chk26())?pass25('MR416i-p without a battery is flagged (V19: required with MR416/MR408)'):fail25('G12 battery requirement missing');
  setv26('ctrl','MR932i-p — x32 lanes, PCIe Gen5, battery backup built in, SAS/NVMe SSDs only (P75697-B21)');
  !/BATTERY/.test(chk26())?pass25('MR932i-p needs no battery (backup built in)'):fail25('MR932i-p battery wrongly flagged');
  d.getElementById('add-drive').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  { const row=d.querySelectorAll('#drives .line');const r=row[row.length-1];[['q','2'],['cap','2.4TB'],['int','SAS']].forEach(function(p){const e=r.querySelector('[data-k='+p[0]+']');e.value=p[1];fire(e,'input');}); }
  /MR932i-p supports SAS SSDs and NVMe only/.test(chk26())?pass25('MR932i-p with an HDD line is flagged (SSDs only)'):fail25('MR932i-p HDD not flagged');
  reset27(); setModel25('DL380 G12'); setv26('cpuq','1'); pickCpuExact25('6737P'); addRear27('4LFF midtray');
  /mid-plane drive cage needs a processor at or under 225W/.test(chk26())?pass25('4LFF mid-plane with a 270W CPU is stopped (225W limit)'):fail25('mid-tray TDP not flagged');
  (/P70744-B21/.test(d.getElementById('rail-note').textContent) && /P50400-B21/.test(d.getElementById('bezel-note').textContent) && /P48922-B21/.test(d.getElementById('bezel-note').textContent))
    ?pass25('DL380 G12 rails P52341-B21 + CMA P70744-B21, bezel P50400-B21, intrusion P48922-B21'):fail25('DL380 G12 rail/bezel notes');

  // ===== Gen12 memory table (xeon6Mem) + DL360 G12 full rundown from QuickSpecs V19 (build 2026.09.24.1) =====
  reset27(); setModel25('DL360 G12'); setv26('cpuq','2'); pickCpuExact25('6740E'); setv26('dimmq','16'); setv26('dimm','16GB 5600 MT/s');
  /16GB modules are not supported with Xeon 6 E-core/.test(chk26())?pass25('Gen12: 16GB modules are stopped with an E-core processor'):fail25('E-core 16GB not flagged');
  setv26('dimmq','32'); setv26('dimm','64GB 6400 MT/s');
  /E-core \(6740E\) runs memory at up to 5200/.test(chk26())?pass25('Gen12 E-core at 2 DIMMs per channel: 5200'):fail25('E-core 2DPC 5200 not flagged');
  setv26('dimm','64GB 5200 MT/s');
  !/2 DIMMs per channel/.test(chk26())?pass25('...5200 at 2 DIMMs per channel is fine'):fail25('E-core 5200 wrongly flagged');
  setv26('dimmq','24');
  /HPE supports 1, 2, 4, 8, 16 DIMMs per processor with Xeon 6 E-core/.test(chk26())?pass25('E-core: 12 DIMMs per processor is not a supported population'):fail25('E-core 12/cpu not flagged');
  pickCpuExact25('6737P');
  !/MEMORY QTY/.test(chk26())?pass25('P-core: 12 DIMMs per processor is supported'):fail25('P-core 12/cpu wrongly flagged');
  setv26('dimm','64GB 6400 MT/s');
  /P-core \(6737P\) runs memory at up to 6000.*5200 on firmware before May 2026/.test(chk26())?pass25('P-core at 2 DIMMs per channel: 6000 (5200 before May 2026 firmware)'):fail25('P-core 2DPC not flagged');
  reset27(); setModel25('DL360 G12');
  (d.getElementById('bays-btns')?true:true) && ['4LFF','8SFF','10SFF','20EDSFF'].every(function(b){return w.MODELS.filter(function(x){return x.m==='DL360'&&x.g==='G12';})[0].bays.indexOf(b)>-1;})
    ?pass25('DL360 G12 bays: 4LFF, 8SFF (8+2), 10SFF / 20EDSFF hybrid'):fail25('DL360 G12 bays');
  setv26('bays','8SFF');
  (/P52341-B21/.test(d.getElementById('rail-note').textContent) && !/P52343-B21/.test(d.getElementById('rail-note').textContent) && /P70741-B21/.test(d.getElementById('rail-note').textContent))
    ?pass25('DL360 G12 8SFF: Rail 3 Kit P52341-B21 only, CMA 4 P70741-B21'):fail25('DL360 8SFF rail: '+d.getElementById('rail-note').textContent);
  setv26('bays','4LFF');
  /P52343-B21/.test(d.getElementById('rail-note').textContent)?pass25('DL360 G12 4LFF: Rail 5 Kit P52343-B21'):fail25('DL360 4LFF rail');
  /P50450-B21/.test(d.getElementById('bezel-note').textContent)?pass25('DL360 G12 bezel: Gen11 1U Common Bezel Kit P50450-B21'):fail25('DL360 G12 bezel');
  setv26('cpuq','2'); pickCpuExact25('6505P');
  addCard27('NS204i-u v2 480GB NVMe boot device, at rear — takes Slot 2 (P78279-B21, Rear Enablement Kit P72197-B21)');
  /rear-mounted NS204i-u boot device requires the high performance fan/.test(d.getElementById('why-fan').textContent+chk26())?pass25('DL360 G12 rear NS204i-u: performance fans required'):fail25('rear NS204 fan reason missing: '+d.getElementById('why-fan').textContent);
  addRiser27('x16 Full Height Riser Kit — Secondary (P72598-B21)');
  /rear NS204i-u kit cannot be fitted with the full-height secondary riser/.test(chk26())?pass25('...and it is stopped with the FH secondary riser P72598-B21'):fail25('rear NS204 + FH riser not stopped');
  reset27(); setModel25('DL360 G12'); setv26('ctrl','MR932i-p — x32 lanes, PCIe Gen5, full-height, SAS SSD / NVMe only (P75697-B21)');
  d.getElementById('add-drive').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  { const row=d.querySelectorAll('#drives .line');const r=row[row.length-1];[['q','2'],['cap','1.92TB'],['cls','RI'],['int','SATA SSD']].forEach(function(p){const e=r.querySelector('[data-k='+p[0]+']');e.value=p[1];fire(e,'input');}); }
  /no SATA drives and no HDDs/.test(chk26())?pass25('MR932i-p with a SATA SSD line is flagged (SAS SSD / NVMe only)'):fail25('MR932i-p SATA SSD not flagged');
  setv26('ctrl','MR408i-o — x8 lanes, 4GB cache, up to 8 drives (P58335-B21)');
  /Smart Storage battery or capacitor.*MR408i-o/.test(chk26())?pass25('DL360 G12 MR408i-o without a battery is flagged'):fail25('DL360 MR408i-o battery');

  // ===== DL320 G12 full rundown from QuickSpecs V20 (build 2026.09.24.1) =====
  reset27(); setModel25('DL320 G12'); pickCpuExact25('6737P'); setv26('dimmq','16'); setv26('dimm','64GB 6000 MT/s');
  /runs memory at up to 5200 MT\/s there, not 6000\.$/m.test(chk26())||/runs memory at up to 5200 MT\/s there, not 6000/.test(chk26())?pass25('DL320 G12: 2 DIMMs per channel runs 5200 (its own doc), not 6000'):fail25('DL320 2DPC 5200 not applied');
  setv26('dimmq','12'); setv26('dimm','64GB 6400 MT/s');
  /HPE supports 1, 2, 4, 6, 8, 16 DIMMs per processor/.test(chk26())?pass25('DL320 G12: 12 DIMMs is not a supported total (1/2/4/6/8/16)'):fail25('DL320 DIMM total not flagged');
  setv26('dimmq','6');
  !/MEMORY QTY/.test(chk26())?pass25('...6 DIMMs is fine'):fail25('DL320 6 DIMMs wrongly flagged');
  setv26('dimm','96GB 6400 MT/s');
  /96GB memory modules require high performance fans/.test(d.getElementById('why-fan').textContent+chk26())?pass25('DL320 G12: 96GB DIMMs need performance fans'):fail25('DL320 96GB fan: '+d.getElementById('why-fan').textContent);
  pickCpuExact25('6787P');
  /above 270W the DL320 G12 needs the Closed-loop Liquid Cooling FIO Heat Sink Kit P76605-B21/.test(chk26())?pass25('DL320 G12: a 350W CPU is flagged for closed-loop liquid cooling (above 270W)'):fail25('DL320 LC not flagged');
  reset27(); setModel25('DL320 G12'); pickCpuExact25('6505P'); setv26('flr','E810-XXVDA2 10/25Gb 2p (P10106-B21)');
  /25Gb-or-faster adapter/.test(d.getElementById('why-fan').textContent+chk26())?pass25('DL320 G12: a 10/25Gb OCP card needs performance fans'):fail25('DL320 25Gb fan: '+d.getElementById('why-fan').textContent);
  (d.getElementById('psuq').getAttribute('max')==='2' && [...d.querySelectorAll('#psus option')].some(function(o){return /M-CRPS/.test(o.value);}) || /M-CRPS/.test(JSON.stringify(w.MODELS.filter(function(x){return x.m==='DL320'&&x.g==='G12';})[0].rules.psu)))
    ?pass25('DL320 G12: two M-CRPS power supply bays (800W-2400W M-CRPS list)'):fail25('DL320 PSU list');
  setv26('bays','12LFF');
  (/P52353-B21/.test(d.getElementById('rail-note').textContent) && !/P52349-B21/.test(d.getElementById('rail-note').textContent))?pass25('DL320 G12 12LFF: Rail 9 Kit P52353-B21'):fail25('DL320 12LFF rail: '+d.getElementById('rail-note').textContent);
  setv26('ctrl','MR416i-p — x16 lanes, 8GB cache (P47777-B21)');
  /Li-ion battery or Smart Capacitor.*MR416i-p/.test(chk26())?pass25('DL320 G12: performance RAID controllers need a battery or capacitor'):fail25('DL320 battery');

  // ===== DL340 G12 full rundown from QuickSpecs V15 (build 2026.09.24.1) =====
  reset27(); setModel25('DL340 G12');
  (w.MODELS.filter(function(x){return x.m==='DL340'&&x.g==='G12';})[0].s===1 && !d.querySelector('#cpuq-btns [data-v="2"]'))
    ?pass25('DL340 G12 is single-socket (was wrongly 2-socket)'):fail25('DL340 socket count');
  pickCpuExact25('6505P'); setv26('dimmq','10'); setv26('dimm','32GB 5200 MT/s');
  /10 DIMMs \(9 or more\) require high performance fans/.test(d.getElementById('why-fan').textContent+chk26())?pass25('DL340 G12: 9+ DIMMs need performance fans'):fail25('DL340 DIMM-qty fan: '+d.getElementById('why-fan').textContent);
  setv26('dimmq','16'); setv26('dimm','32GB 6400 MT/s');
  /runs memory at up to 5200 MT\/s there, not 6400/.test(chk26())?pass25('DL340 G12: 16 DIMMs (2 per channel) runs 5200'):fail25('DL340 2DPC');
  setv26('bays','24SFF');
  /24SFF configuration takes the performance heatsink/.test(d.getElementById('why-hs').textContent+chk26())?pass25('DL340 G12 24SFF: performance heatsink at any wattage (V15 table)'):fail25('DL340 24SFF hs: '+d.getElementById('why-hs').textContent);
  setv26('bays','8SFF');
  !/configuration takes the performance heatsink/.test(d.getElementById('why-hs').textContent)?pass25('...8SFF with a 150W CPU stays on the standard heatsink'):fail25('DL340 8SFF hs wrongly perf');
  (/P55713-B21/.test(d.getElementById('bezel-note').textContent) && /P50400-B21/.test(d.getElementById('bezel-note').textContent) && /P69769-B21/.test(d.getElementById('rail-note').textContent))
    ?pass25('DL340 G12: bezel P50400-B21, intrusion P55713-B21, GPU-chassis rail P69769-B21 in the note'):fail25('DL340 bezel/rail notes');
  /3200W M-CRPS/.test(JSON.stringify(w.MODELS.filter(function(x){return x.m==='DL340'&&x.g==='G12';})[0].rules.psu))?pass25('DL340 G12 PSUs are M-CRPS up to 3200W'):fail25('DL340 PSU list');

  // ===== ML350 G12 full rundown from QuickSpecs V17 (build 2026.09.24.1) =====
  reset27(); setModel25('ML350 G12');
  (d.getElementById('dimm-size-btns').textContent.indexOf('16GB')<0 && /32GB/.test(d.getElementById('dimm-size-btns').textContent))?pass25('ML350 G12: no 16GB module offered (V17 lists 32GB and up)'):fail25('ML350 sizes: '+d.getElementById('dimm-size-btns').textContent);
  setv26('cpuq','2'); pickCpuExact25('6520P'); setv26('dimmq','32'); setv26('dimm','64GB 6400 MT/s');
  /runs memory at up to 5200 MT\/s there, not 6400/.test(chk26())?pass25('ML350 G12: 2 DIMMs per channel runs 5200'):fail25('ML350 2DPC');
  setv26('ctrl','MR408i-o — x8 lanes, 4GB cache, up to 8 drives (P58335-B21)');
  /260mm-cable kits.*MR408i-o/.test(chk26())?pass25('ML350 G12: MR408i-o needs a 260mm-cable battery or capacitor'):fail25('ML350 battery');
  /P01367-B21/.test(JSON.stringify(w.MODELS.filter(function(x){return x.m==='ML350'&&x.g==='G12';})[0].rules.bat))?pass25('ML350 G12 battery list is the 260mm kits (P01367-B21 …)'):fail25('ML350 bat list');
  addCard27('InfiniBand NDR 400Gb 1p OSFP MCX75310AAS-NEAT (P45641-H23)');
  /200Gb-or-faster adapter/.test(d.getElementById('why-fan').textContent+chk26())?pass25('ML350 G12: 200Gb+ adapters need the redundant fan kits'):fail25('ML350 200Gb fan: '+d.getElementById('why-fan').textContent);
  reset27(); setModel25('ML350 G12'); pickCpuExact25('6505P'); setv26('flr','E810-XXVDA2 10/25Gb 2p (P10106-B21)');
  !/Gb-or-faster adapter/.test(d.getElementById('why-fan').textContent)?pass25('...a 25Gb OCP card does not (threshold is 200Gb on the ML350)'):fail25('ML350 25Gb wrongly triggers fans');
  (/P47394-B21/.test(d.getElementById('rail-note').textContent) && /P47226-B21/.test(d.getElementById('door-note').textContent))?pass25('ML350 G12: tower-to-rack kit P47394-B21, intrusion kit P47226-B21'):fail25('ML350 rail/door notes');
  w.MODELS.filter(function(x){return x.m==='ML350'&&x.g==='G12';})[0].rules.rear.length===0?pass25('ML350 G12: unsourced "2x M.2 rear" option removed'):fail25('ML350 rear list');

  // ===== DL580 G12 (V11) + DL380a G12 (V20) full rundowns (build 2026.09.24.1) =====
  reset27(); setModel25('DL580 G12'); setv26('cpuq','2'); pickCpuExact25('6748P'); setv26('psuq','4');
  /with 2 processors takes 1 or 2 power supplies — not 4/.test(chk26())?pass25('DL580 G12: 2 processors take 1 or 2 PSUs (4 is stopped)'):fail25('DL580 psuByCpu 2P');
  setv26('cpuq','4'); setv26('psuq','3');
  /with 4 processors takes 2 or 4 power supplies — not 3/.test(chk26())?pass25('...4 processors take 2 or 4 (3 is stopped)'):fail25('DL580 psuByCpu 4P');
  setv26('dimmq','16'); setv26('dimm','64GB 6400 MT/s');
  /P69728-F21.*factory-integrated -F21 kits only/.test(d.getElementById('dimm-kit').textContent)?pass25('DL580 G12: memory kits are -F21 factory-integrated only (P69728-F21)'):fail25('DL580 kit: '+d.getElementById('dimm-kit').textContent);
  (d.getElementById('dimm-size-btns').textContent.indexOf('32GB')<0)?pass25('DL580 G12: no 16GB/32GB module offered (64GB and up)'):fail25('DL580 sizes: '+d.getElementById('dimm-size-btns').textContent);
  /M-CRPS/.test(JSON.stringify(w.MODELS.filter(function(x){return x.m==='DL580'&&x.g==='G12';})[0].rules.psu)) && !/Flex Slot/.test(JSON.stringify(w.MODELS.filter(function(x){return x.m==='DL580'&&x.g==='G12';})[0].rules.psu))
    ?pass25('DL580 G12 PSUs are M-CRPS only'):fail25('DL580 PSU list');
  /P81004-B21/.test(JSON.stringify(w.RISER_KITS?w.RISER_KITS['DL580 G12']:'')+d.body.textContent) || /P81004-B21/.test(JSON.stringify(w.MODELS.filter(function(x){return x.m==='DL580'&&x.g==='G12';})[0].rules.notes))
    ?pass25('DL580 G12: Riser 1/6 cable kit is P81004-B21 (was P71004-B21)'):fail25('DL580 riser cable PN');
  reset27(); setModel25('DL380a G12'); setv26('cpuq','2'); pickCpuExact25('6740E'); setv26('dimmq','24'); setv26('dimm','64GB 5200 MT/s');
  /HPE supports 2, 4, 8, 16 DIMMs per processor with Xeon 6 E-core/.test(chk26())?pass25('DL380a G12: 24 DIMMs not allowed with E-core (4/8/16/32 total)'):fail25('DL380a E-core counts');
  pickCpuExact25('6737P');
  !/MEMORY QTY/.test(chk26())?pass25('...24 DIMMs is fine with P-core'):fail25('DL380a P-core 24 wrongly flagged');
  (d.getElementById('psuq').getAttribute('max')==='8')?pass25('DL380a G12 takes up to 8 PSUs (was capped at 2)'):fail25('DL380a psuMax '+d.getElementById('psuq').getAttribute('max'));
  setv26('ctrl','MR416i-p — x16 lanes, 8GB cache, needs cable kit P76700-B21 (P47777-B21)');
  /96W Smart Storage battery or Smart Hybrid Capacitor.*MR416i-p/.test(chk26())?pass25('DL380a G12: MR416i-p needs a battery or capacitor'):fail25('DL380a battery');

  reset27();
}
