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
  setModel3('DL360 G11');
  const rOpts=[...d.querySelectorAll('#rearopts option')].map(o=>o.value);
  (rOpts.length===3 && !rOpts.some(o=>/mid/i.test(o)))
    ?pass3('rear datalist is per-model (DL360 G11: 3 options, no midtray)'):fail3('rear datalist not filtered: '+rOpts.join(', '));

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
  setModel7('DL380 G12');
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
  setModel7('DL380 G10');
  ctrl.dispatchEvent(new w.Event('focus'));
  let ctrlOpts=[...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);
  (!ctrlOpts.includes('MR416i-o') && !ctrlOpts.includes('MR216i-p') && !ctrlOpts.includes('MR416i-p') && !ctrlOpts.includes('SR932i-p') && ctrlOpts.includes('P408i-a'))
    ?pass7('DL380 G10: no OCP-mezz or MR-p/SR932i-p cards offered (Gen10 Plus+ only) — P408i-a still is')
    :fail7('DL380 G10 controller list wrong: '+ctrlOpts.join(', '));
  setModel7('DL380 G10+');
  ctrl.dispatchEvent(new w.Event('focus'));
  ctrlOpts=[...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);
  (ctrlOpts.includes('MR216i-p') && ctrlOpts.includes('SR932i-p') && ctrlOpts.includes('P408i-a') && !ctrlOpts.includes('MR416i-o'))
    ?pass7('DL380 G10+: MR-p/SR932i-p cards now offered, still no OCP-mezz (Gen11 only)')
    :fail7('DL380 G10+ controller list wrong: '+ctrlOpts.join(', '));
  setModel7('DL380 G11');
  ctrl.dispatchEvent(new w.Event('focus'));
  ctrlOpts=[...d.getElementById('ac-panel').querySelectorAll('.combo-item .ci-main')].map(el=>el.textContent);
  (ctrlOpts.includes('MR416i-o') && ctrlOpts.includes('MR216i-p') && ctrlOpts.includes('E208e-p') && !ctrlOpts.includes('P408i-a') && !ctrlOpts.includes('P408i-p'))
    ?pass7('DL380 G11: OCP-mezz + MR-p offered, old Smart Array P-series dropped (E208e-p is the one survivor)')
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
   expOpts7.includes('H241 external HBA') && !expOpts7.includes('E208e-p external HBA') && !expOpts7.includes('P408e-p external HBA'))
    ?pass7('DL380 G9: Gen9 expander part (727250-B21) + H241 HBA only — no fabricated 876907, no Gen10+/G11 HBAs')
    :fail7('DL380 G9 expander list wrong: '+expOpts7.join(', '));
  setModel7('DL380 G10');
  expOpts7=expOpts();
  (expOpts7.some(o=>/870549-B21/.test(o)) && !expOpts7.some(o=>/727250-B21/.test(o)) && !expOpts7.some(o=>/876907/.test(o)) &&
   expOpts7.includes('P408e-p external HBA') && !expOpts7.includes('H241 external HBA'))
    ?pass7('DL380 G10: Gen10 DL38X part (870549-B21), not the Gen9 one or the fabricated 876907')
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
  (!expOpts7.some(o=>/SAS Expander Card/.test(o)) && expOpts7.includes('Second controller instead of expander') && expOpts7.includes('None needed'))
    ?pass7('DL360 G10 never had an expander-card SKU at all — no card offered, just the generic fallbacks')
    :fail7('DL360 G10 should offer no expander card: '+expOpts7.join(', '));
  setModel7('DL380 G10+');
  expOpts7=expOpts();
  expOpts7.some(o=>/P23388-B21/.test(o))
    ?pass7('DL380 G10+ gets its own new part (P23388-B21), not the Gen10 870549-B21')
    :fail7('DL380 G10+ expander list wrong: '+expOpts7.join(', '));
  setModel7('DL380 G11');
  expOpts7=expOpts();
  (!expOpts7.some(o=>/SAS Expander Card/.test(o)) && expOpts7.includes('E208e-p external HBA') && !expOpts7.includes('H241 external HBA') && !expOpts7.includes('P408e-p external HBA'))
    ?pass7('DL380 G11: no expander card exists for this generation at all (confirmed dropped) — E208e-p HBA is the one survivor')
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
  setModel7('DL380 G11');pickCpu7('G5416S'); // Sapphire Rapids, sp4
  dOpts7=dimmOpts7();
  (dOpts7.some(o=>/^64GB 4800 MT\/s$/.test(o)) && dOpts7.some(o=>/^64GB 5600 MT\/s$/.test(o)) &&
   !dOpts7.some(o=>/2133|2400|2666|2933|3200/.test(o)))
    ?pass7('DL380 G11 (Sapphire Rapids): DDR5 combos only (4800/5600) — zero DDR4 speeds offered')
    :fail7('DL380 G11 dimm panel wrong: '+dOpts7.join(', '));
  (d.getElementById('dimm-size-btns').children.length>0 && [...d.querySelectorAll('#dimm-speed-btns button')].map(b=>b.textContent).join(',')==='4800 MT/s,5600 MT/s')
    ?pass7('DL380 G11 speed buttons are exactly "4800 MT/s"/"5600 MT/s", no DDR4 numbers')
    :fail7('DL380 G11 speed buttons wrong: '+[...d.querySelectorAll('#dimm-speed-btns button')].map(b=>b.textContent).join(','));
  // tapping a size then a speed button assembles one value, each preserving the other
  const szBtn7=d.querySelector('#dimm-size-btns button[data-sz="64"]'),spBtn7=d.querySelector('#dimm-speed-btns button[data-sp="5600"]');
  szBtn7.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  spBtn7.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  (dimm7.value==='64GB 5600 MT/s' && szBtn7.classList.contains('on') && spBtn7.classList.contains('on'))
    ?pass7('tapping size then speed assembles "64GB 5600 MT/s" and highlights both buttons')
    :fail7('dimm size/speed buttons did not assemble correctly: "'+dimm7.value+'"');
  dimm7.value='';fire(dimm7,'input');

  // --- a mismatched DDR4 speed typed/pasted/restored into a DDR5 build is
  // caught (hard stop) even though it can't be tapped from the panel any
  // more; capacity gets a softer verify, not a stop (lower confidence) ---
  setModel7('DL380 G11');pickCpu7('G5416S');
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

  // --- no port-count data for a Gen8/9 card (P440) -> no fabricated suggestion ---
  ctrl8.value='';fire(ctrl8,'input');ctrl8.value='P440';fire(ctrl8,'input');
  d.getElementById('expander-note').textContent===''
    ?pass8('P440 (no fixed port count known) gets no expander suggestion — avoids guessing')
    :fail8('unexpected expander suggestion for P440: "'+d.getElementById('expander-note').textContent+'"');
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
      if(c===open)depth++;
      else if(c===close){depth--; if(!depth){j++;break;}}
    }
    try{ return eval('('+html.slice(i,j)+')'); }catch(e){ return null; }
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
      if(!/^\d{1,2}\s*(LFF|SFF)$/i.test(b))note(key,'bay string "'+b+'" is not a shape bayCapacity() can read');
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
    if(R.psuMax!=null&&(R.psuMax<1||R.psuMax>4))note(key,'psuMax '+R.psuMax+' looks wrong');
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
      if(c===open)depth++;
      else if(c===close){depth--; if(!depth){j++;break;}}
    }
    try{ return eval('('+html.slice(i,j)+')'); }catch(e){ return null; }
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

  // --- DL320 G12: single PSU bay (not the usual 2) ---
  setModel11('DL320 G12');
  const dl320PsuMax=d.getElementById('psuq').getAttribute('max');
  dl320PsuMax==='1'
    ?pass11('DL320 G12 caps at 1 power supply (no redundant PSU bay on this chassis)')
    :fail11('DL320 G12 PSU cap: '+dl320PsuMax+' (expected 1)');

  // --- DL110 G12: fixed-SoC note actually reaches the checks panel ---
  setModel11('DL110 G12');
  const dl110Checks=d.getElementById('checks').textContent;
  dl110Checks.includes('FIXED SoC')
    ?pass11('DL110 G12 states its fixed-SoC note (not a socketed, swappable processor)')
    :fail11('DL110 G12 fixed-SoC note missing: '+dl110Checks.slice(0,300));
}
