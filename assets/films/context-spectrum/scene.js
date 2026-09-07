import * as THREE from 'three';
import {DURATION,identity,levels,phases,nodeData,links} from './story.js';

const $=id=>document.getElementById(id),container=$('world');
const params=new URLSearchParams(location.search),capture=params.has('capture')||document.body.dataset.capture==='true';
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const C={bg:0x07111f,plane:0x102a40,line:0x335773,ink:0xf1f7ff,muted:0xa9c0d7,green:0x63f5b0,blue:0x80cbff,amber:0xffcb75,red:0xffa0ae};
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:capture,powerPreference:'high-performance'});}catch(e){
  $('fallback').hidden=false;document.body.classList.add('no-webgl');$('play').disabled=true;window.__sceneError=String(e);throw e;
}
renderer.setClearColor(C.bg);renderer.setPixelRatio(capture?1:Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,220);
scene.add(new THREE.HemisphereLight(0xcde9ff,0x07111f,2));
const light=new THREE.DirectionalLight(0xc9e7ff,2.2);light.position.set(-14,30,25);scene.add(light);
const solid=new THREE.BoxGeometry(4.9,.28,2.3),outline=new THREE.EdgesGeometry(solid);
const nodes=new Map(),layerObjects=[],edgeObjects=[],pickables=[];
let time=0,depth=0,manualDepth=null,orbit=0,playing=!reduced,loop=!capture,last=performance.now(),phaseIndex=-1,inspected=null,frameCount=0;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),ease=t=>t*t*t*(t*(t*6-15)+10);
const vec=(x,y,z)=>new THREE.Vector3(x,y,z);

function labelTexture(title,sub='',color='#f1f7ff'){
  const c=document.createElement('canvas');c.width=768;c.height=sub?180:112;
  const x=c.getContext('2d');x.textAlign='center';x.textBaseline='middle';
  x.fillStyle=color;x.font='600 60px "Avenir Next",Avenir,sans-serif';x.fillText(title,384,sub?61:56);
  if(sub){x.fillStyle='#a9c0d7';x.font='400 32px "Avenir Next",Avenir,sans-serif';x.fillText(sub,384,126);}
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.minFilter=THREE.LinearFilter;return tex;
}
function sprite(title,sub='',color='#f1f7ff',width=8.0){
  const material=new THREE.SpriteMaterial({map:labelTexture(title,sub,color),transparent:true,depthTest:false,depthWrite:false});
  const s=new THREE.Sprite(material);s.scale.set(width,width*(sub?180:112)/768,1);s.renderOrder=12;return s;
}
for(let l=0;l<4;l++){
  const y=-l*12,plane=new THREE.Mesh(new THREE.PlaneGeometry(34,23),new THREE.MeshBasicMaterial({color:C.plane,transparent:true,opacity:.14,side:THREE.DoubleSide,depthWrite:false}));
  plane.rotation.x=-Math.PI/2;plane.position.set(0,y-.3,0);scene.add(plane);
  const corners=[vec(-17,y,-11.5),vec(17,y,-11.5),vec(17,y,11.5),vec(-17,y,11.5),vec(-17,y,-11.5)];
  const border=new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners),new THREE.LineBasicMaterial({color:C.line,transparent:true,opacity:.6}));scene.add(border);
  const caption=sprite(`${levels[l].id}  ${levels[l].name}`,'','#80cbff',8);caption.position.set(-11,y+2.1,-12);scene.add(caption);
  layerObjects.push({l,plane,border,caption});
}
for(const data of nodeData){
  const position=vec(data.x,-data.l*12,data.z);
  const material=new THREE.MeshStandardMaterial({color:C.plane,roughness:.5,metalness:.22,transparent:true,opacity:.9});
  const mesh=new THREE.Mesh(solid,material);mesh.position.copy(position);mesh.userData.id=data.id;scene.add(mesh);pickables.push(mesh);
  const wire=new THREE.LineSegments(outline,new THREE.LineBasicMaterial({color:C.line,transparent:true,opacity:.6}));wire.position.copy(position);scene.add(wire);
  const name=sprite(data.name,data.sub);name.position.copy(position).add(vec(0,1.45,0));scene.add(name);
  const pin=new THREE.Mesh(new THREE.SphereGeometry(.095,8,8),new THREE.MeshBasicMaterial({color:C.green,transparent:true}));pin.position.copy(position).add(vec(-2.2,.28,.85));scene.add(pin);
  nodes.set(data.id,{...data,position,mesh,wire,name,pin});
}
function makeEdge(from,to,kind='normal'){
  const a=nodes.get(from).position.clone().add(vec(0,.4,0)),b=nodes.get(to).position.clone().add(vec(0,.4,0));
  const cross=Math.abs(a.y-b.y)>1;
  const mid=a.clone().lerp(b,.5).add(cross?vec(3,0,0):vec(0,1.0,0));
  const curve=new THREE.CatmullRomCurve3([a,mid,b]);
  const material=new THREE.MeshBasicMaterial({color:C.line,transparent:true,opacity:.35,depthWrite:false});
  const line=new THREE.Mesh(new THREE.TubeGeometry(curve,28,.035,5,false),material);scene.add(line);
  const marker=new THREE.Mesh(new THREE.ConeGeometry(.15,.48,8),new THREE.MeshBasicMaterial({color:C.line,transparent:true,opacity:.5}));
  marker.position.copy(curve.getPoint(.86));marker.quaternion.setFromUnitVectors(vec(0,1,0),curve.getTangent(.86).normalize());scene.add(marker);
  const packet=new THREE.Mesh(new THREE.SphereGeometry(.13,10,8),new THREE.MeshBasicMaterial({color:C.green,transparent:true,depthTest:false}));scene.add(packet);
  const edge={from,to,curve,line,marker,packet,cross,kind};edgeObjects.push(edge);return edge;
}
links.forEach(([a,b])=>makeEdge(a,b));
const forbidden=makeEdge('ui','store','forbidden');
const proofReturn=makeEdge('bundle','decision','return');
const proposal=makeEdge('decision','owner','return');
const repair=makeEdge('finding','work','repair');

// One packet of context persists across every change of scale.
const packetGroup=new THREE.Group();scene.add(packetGroup);
const packetBase=new THREE.Mesh(new THREE.BoxGeometry(3.4,.5,2),new THREE.MeshStandardMaterial({color:0x173c39,metalness:.3,roughness:.3}));packetGroup.add(packetBase);
const packetBorder=new THREE.LineSegments(new THREE.EdgesGeometry(packetBase.geometry),new THREE.LineBasicMaterial({color:C.amber}));packetGroup.add(packetBorder);
const packetName=sprite('Blueprint @1.0.0','Identity retained','#ffcb75',5.7);packetName.position.set(0,2.9,0);packetGroup.add(packetName);
const sheets=[];
for(let i=0;i<7;i++){
  const sheet=new THREE.Mesh(new THREE.BoxGeometry(3.0,.09,1.7),new THREE.MeshBasicMaterial({color:i===0?C.amber:C.green,transparent:true,opacity:.8}));
  packetGroup.add(sheet);sheets.push(sheet);
}
// Inherited-rule link retains its origin instead of detaching when the camera moves.
const tetherGeometry=new THREE.BufferGeometry().setFromPoints([vec(0,0,0),vec(0,0,0)]);
const tether=new THREE.Line(tetherGeometry,new THREE.LineDashedMaterial({color:C.amber,transparent:true,opacity:.55,dashSize:.35,gapSize:.22}));scene.add(tether);

function resize(){const w=container.clientWidth,h=container.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.setViewOffset(w,h,w>700?-w*.105:0,0,w,h);camera.updateProjectionMatrix();if(!playing)draw(time);}
new ResizeObserver(resize).observe(container);

function phaseAt(t){let i=phases.findIndex((p,j)=>j<phases.length-1&&t>=p.at&&t<phases[j+1].at);return i<0?phases.length-1:i;}
function hud(p,i){
  if(phaseIndex===i)return;phaseIndex=i;
  $('headline').textContent=p.title;$('mechanic').textContent=p.body;$('action').textContent=p.action;$('retained').textContent=p.retained;
  $('context-fields').replaceChildren(...p.chips.map((chip,index)=>{const e=document.createElement('li');e.textContent=chip;e.className=/Blueprint|No direct/.test(chip)?'inherited':/outside|Other|Out-of/.test(chip)?'excluded':p.kind==='evidence'||p.kind==='return'?'evidence':'';e.style.setProperty('--i',index);return e;}));
  document.body.dataset.kind=p.kind;
  $('live-status').textContent=`${p.action}. ${p.retained}`;
}
function draw(t){
  const i=phaseAt(t),p=phases[i],previous=phases[Math.max(0,i-1)];
  const progress=reduced?1:ease(clamp((t-p.at)/5));
  const auto=previous.depth+(p.depth-previous.depth)*progress;
  depth=manualDepth===null?auto:manualDepth;
  const nearest=Math.round(depth),returning=['violation','repair','evidence','unknown','return','review'].includes(p.kind);
  const displayIndex=manualDepth===null?i:[0,2,3,4][nearest];
  hud(phases[displayIndex],displayIndex);
  $('code-detail').hidden=depth<2.55;
  const explore=manualDepth!==null;
  $('code-source').textContent='facts.dependencies.filter(\n  (d) => d.from === rule.from\n      && d.to === rule.to\n)';
  $('code-line').textContent=(explore||['inspect','violation'].includes(p.kind))?'command-center → brain-store':'command-center → context-service → brain-store';
  $('code-status').textContent=(explore||['inspect','violation'].includes(p.kind))?'Observed direct dependency · forbidden by the inherited rule':p.kind==='unknown'?'Coverage incomplete · decision remains unknown':'Illustrative corrected dependency · evidence still needs coverage and review';
  // Architectural meaning determines every camera traversal. The slow azimuth change
  // is periodic, so the loop returns to precisely the same pose.
  const radius=58-depth*8,azimuth=.25+Math.sin(t/DURATION*Math.PI*2)*.11+orbit;
  const center=vec(0,-depth*12-(1-depth/3)*11,0);
  camera.position.set(center.x+radius*Math.sin(azimuth),center.y+radius*.61,center.z+radius*Math.cos(azimuth));camera.lookAt(center);
  const active=new Set(manualDepth===null?p.active:nodeData.filter(n=>n.l===nearest).map(n=>n.id));
  for(const object of layerObjects){
    const d=Math.abs(object.l-depth),strength=Math.exp(-d*1.4);
    object.plane.material.opacity=.025+.085*strength;
    object.border.material.opacity=.14+.53*strength;
    object.caption.material.opacity=.24+.76*strength;
  }
  for(const n of nodes.values()){
    const d=Math.abs(n.l-depth),level=clamp(1-d*.94),on=active.has(n.id),strength=level*(on?1:.29);
    n.mesh.material.opacity=.04+.86*strength;n.mesh.material.color.setHex(on?0x16413c:C.plane);
    const color=(p.kind==='violation'&&['ui','store','finding'].includes(n.id))?C.red:(p.kind==='unknown'&&['coverage','decision'].includes(n.id))?C.amber:(returning?C.blue:C.green);
    n.wire.material.color.setHex(on?color:C.line);n.wire.material.opacity=.04+.9*strength;
    n.name.material.opacity=clamp(level*(on?1:.45));n.name.visible=n.name.material.opacity>.06;
    n.pin.material.color.setHex(color);n.pin.material.opacity=strength;
  }
  for(const [j,e] of edgeObjects.entries()){
    const a=nodes.get(e.from),b=nodes.get(e.to),level=clamp(1-Math.min(Math.abs(a.l-depth),Math.abs(b.l-depth))*.75);
    let on=active.has(e.from)&&active.has(e.to),color=returning?C.blue:C.green;
    if(e.cross&&e.kind==='normal'){on=true;color=C.amber;}
    if(e.kind==='forbidden'){on=p.kind==='violation';color=C.red;}
    if(e.kind==='repair'){on=p.kind==='repair';color=C.amber;}
    if(e.kind==='return'){on=['return','review','unknown','evidence'].includes(p.kind);color=p.kind==='unknown'||p.kind==='review'?C.amber:C.blue;}
    const special=e.kind!=='normal';
    e.line.visible=!special||on;e.marker.visible=e.line.visible;
    e.line.material.color.setHex(on?color:C.line);e.line.material.opacity=on?.7*level:.08*level;
    e.marker.material.color.setHex(color);e.marker.material.opacity=on?.9*level:.12*level;
    e.packet.visible=on&&level>.15&&!reduced;e.packet.material.color.setHex(color);e.packet.material.opacity=level;
    const f=(t*.2+j*.17)%1;e.packet.position.copy(e.curve.getPoint(f));
  }
  packetGroup.position.set(-12+Math.max(0,depth-2)*6,-depth*12+2.5,12);
  packetGroup.rotation.y=Math.sin(t/DURATION*Math.PI*2)*.12;
  const narrowing=clamp(depth/2),evidence=['evidence','return','review','unknown'].includes(p.kind);
  sheets.forEach((s,k)=>{
    const excluded=k>3&&!evidence,spread=excluded?narrowing:0;
    s.position.set(spread*(k-2)*2.2,.5+k*.2,spread*2.5);
    s.material.opacity=excluded?.75*(1-spread):.82;
    s.material.color.setHex(k===0?C.amber:evidence?C.blue:C.green);
  });
  const origin=nodes.get('blueprint').position,attributes=tetherGeometry.attributes.position;
  attributes.setXYZ(0,origin.x,origin.y+.5,origin.z);attributes.setXYZ(1,packetGroup.position.x,packetGroup.position.y,packetGroup.position.z);attributes.needsUpdate=true;tether.computeLineDistances();
  renderer.render(scene,camera);frameCount++;
  $('depth').value=depth;$('time').value=t;
  document.querySelectorAll('[data-level]').forEach(b=>{const on=Number(b.dataset.level)===nearest;b.setAttribute('aria-pressed',String(on));});
  $('level-name').textContent=`${levels[nearest].id} / ${levels[nearest].name}`;
  $('direction').textContent=manualDepth===null?(returning?'Evidence returns':'Context narrows'):'Explore the spectrum';
  $('clock').textContent=`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')} / 1:30`;
  window.__spectrumState={time:t,depth,phase:p.kind,playing,loop,manual:manualDepth!==null,webgl:true,frameCount,drawCalls:renderer.info.render.calls,identity,rule:'no-ui-direct-db',nodeCount:nodes.size};
}
function playState(){ $('play').textContent=playing?'Pause loop':'Play loop';$('mode').textContent=manualDepth===null?'Guided loop':'Exploring'; }
function seek(ms){playing=false;manualDepth=null;time=clamp(ms/1000,0,DURATION);phaseIndex=-1;window.__CLIP_DONE__=false;draw(time);playState();}
window.__seek=seek;window.__CLIP_TOTAL_MS__=DURATION*1000;window.__CLIP_DONE__=false;
window.__play=()=>{playing=true;manualDepth=null;phaseIndex=-1;last=performance.now();window.__CLIP_DONE__=false;playState();};
window.__setDepth=value=>{playing=false;manualDepth=clamp(Number(value),0,3);draw(time);playState();};
$('play').addEventListener('click',()=>{if(playing)playing=false;else{if(time>=DURATION)time=0;window.__play();}playState();});
$('restart').addEventListener('click',()=>{time=0;manualDepth=null;playing=!reduced;last=performance.now();phaseIndex=-1;draw(0);playState();});
$('depth').addEventListener('input',e=>window.__setDepth(e.target.value));
$('time').addEventListener('input',e=>seek(Number(e.target.value)*1000));
$('repeat').checked=loop;$('repeat').addEventListener('change',e=>loop=e.target.checked);
document.querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click',()=>window.__setDepth(b.dataset.level)));
document.querySelectorAll('[data-time]').forEach(b=>b.addEventListener('click',()=>seek(Number(b.dataset.time)*1000)));
$('full').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('experience').requestFullscreen();}catch{$('live-status').textContent='Full screen unavailable. Use the MP4 link below.';}});
// A selected node supplies an explanation; it never changes any product state.
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();let down=null;
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,orbit};});
renderer.domElement.addEventListener('pointermove',e=>{if(down&&e.buttons&&e.pointerType!=='touch'){orbit=down.orbit+(e.clientX-down.x)*.003;if(!playing)draw(time);}});
renderer.domElement.addEventListener('pointerup',e=>{
  if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;if(moved>6)return;
  const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects(pickables.filter(m=>m.material.opacity>.3))[0];if(hit){inspected=nodes.get(hit.object.userData.id);$('inspection').hidden=false;$('inspect-name').textContent=inspected.name;$('inspect-detail').textContent=inspected.detail;}
});
$('close-inspect').addEventListener('click',()=>{$('inspection').hidden=true;inspected=null;});
new IntersectionObserver(([entry])=>{if(!entry.isIntersecting&&!capture){playing=false;playState();}},{threshold:.05}).observe($('experience'));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!capture){playing=false;playState();}});
document.addEventListener('keydown',e=>{if(['INPUT','BUTTON','A','TEXTAREA','SUMMARY'].includes(document.activeElement?.tagName))return;if(e.code==='Space'){e.preventDefault();$('play').click();}if(e.code==='ArrowDown'){e.preventDefault();window.__setDepth(depth+.15);}if(e.code==='ArrowUp'){e.preventDefault();window.__setDepth(depth-.15);}});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();playing=false;$('fallback').hidden=false;playState();});
renderer.domElement.addEventListener('webglcontextrestored',()=>{$('fallback').hidden=true;draw(time);});
if(params.has('t'))seek(Number(params.get('t'))*1000);resize();playState();
let previousRender=0;
function frame(now){const dt=(now-last)/1000;last=now;
  if(playing){time+=clamp(dt,0,.25);if(time>=DURATION){if(loop&&!capture){time%=DURATION;phaseIndex=-1;}else{time=DURATION;playing=false;window.__CLIP_DONE__=true;playState();}}}
  if((playing||frameCount<2)&&now-previousRender>=(capture?32:16)){draw(time);previousRender=now;}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
