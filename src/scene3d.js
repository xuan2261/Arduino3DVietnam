// Mô hình hình học 3D độc lập của Arduino Uno và các mô-đun minh họa.
// Mã hiển thị không quyết định hành vi điện tử; trạng thái đến từ simulator.js.
import * as T from "../assets/vendor/three.module.min.js";

const palette = {
  board: 0x176b7a, solder: 0x166070, dark: 0x172f38, metal: 0xc4cfcd,
  silk: 0xd7eee8, ground: 0xe8f0eb, plastic: 0xf8faf6,
  teal: 0x26af9d, coral: 0xf17b62, amber: 0xf0b866
};
const material = (color, extras = {}) => new T.MeshStandardMaterial({ color, roughness: .62, metalness: .05, ...extras });
const bodyMat = material(palette.board, { roughness: .4 });
const plasticMat = material(palette.dark, { roughness: .7 });
const lightMat = material(palette.plastic, { roughness: .82 });
const metallicMat = material(palette.metal, { metalness: .6, roughness: .32 });
const pinMat = material(0xb8c6c4, { metalness: .48 });

function box(parent, size, colorOrMaterial, pos = [0,0,0], extras = {}) {
  const mesh = new T.Mesh(new T.BoxGeometry(...size), typeof colorOrMaterial === "number" ? material(colorOrMaterial, extras) : colorOrMaterial);
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function cylinder(parent, radiusTop, radiusBottom, height, colorOrMaterial, pos, radial = 24, rotateX = 0) {
  const obj = new T.Mesh(new T.CylinderGeometry(radiusTop, radiusBottom, height, radial), typeof colorOrMaterial === "number" ? material(colorOrMaterial) : colorOrMaterial);
  obj.position.set(...pos); obj.rotation.x = rotateX; obj.castShadow = true; parent.add(obj);
  return obj;
}
function canvasLabel(parent, text, x, y, z, width = 1.6, fontSize = 46, color = "#e8f7ed", horizontal = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 108;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, 512, 108);
  context.fillStyle = color;
  context.font = `700 ${fontSize}px sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillText(text, 256, 54, 495);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const mesh = new T.Mesh(new T.PlaneGeometry(width, width * 108 / 512),
    new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: T.DoubleSide }));
  mesh.position.set(x,y,z);
  if (!horizontal) mesh.rotation.x = -Math.PI / 2;
  parent.add(mesh);
  return mesh;
}
function disposeTree(obj) {
  obj.traverse(child => {
    if (!child.isMesh && !child.isSprite) return;
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of materials) {
      if (m?.map) m.map.dispose();
      if (m?.emissiveMap) m.emissiveMap.dispose();
      // Shared immutable materials are kept until teardown.
      if (![bodyMat, plasticMat, lightMat, metallicMat, pinMat].includes(m)) m?.dispose?.();
    }
  });
}
function wire(parent, start, end, color, arch = .95) {
  const a = new T.Vector3(...start), b = new T.Vector3(...end);
  const mid = a.clone().lerp(b, .5).add(new T.Vector3(0, arch, 0));
  const curve = new T.QuadraticBezierCurve3(a, mid, b);
  const tube = new T.Mesh(new T.TubeGeometry(curve, 40, .055, 8, false), material(color, { roughness: .45 }));
  parent.add(tube);
  for (const pos of [a,b]) cylinder(parent, .088, .088, .14, 0x273c43, pos.toArray(), 12);
  return tube;
}

function makeBoard(scene) {
  const board = new T.Group();
  board.position.x = -2.65;
  scene.add(board);
  box(board, [8.1,.23,5.15], bodyMat, [0,.34,0]);
  // Metal traces are represented as subtle decorative silk traces.
  for (let i = 0; i < 17; i++) {
    const z = -1.85 + (i % 9) * .43;
    const x = -2.65 + Math.floor(i / 9) * 4.2;
    box(board, [2.1,.008,.019], 0x287b88, [x,.462,z]);
  }
  // Mounting holes: four recessed-looking rings.
  for (const x of [-3.65,3.65]) for (const z of [-2.12,2.12]) {
    cylinder(board,.19,.19,.013,0xdbebd4,[x,.472,z],26);
    cylinder(board,.115,.115,.019,0x2e5860,[x,.486,z],26);
  }
  // Main ATmega328P body + visible side pins.
  box(board, [2.55,.23,1.05], plasticMat, [.3,.61,.33]);
  canvasLabel(board, "ATMEGA328P", .3,.743,.31, 1.92,37);
  for (let i=0;i<14;i++) {
    const px = -.86+i*.177;
    box(board,[.064,.03,.24],pinMat,[px,.56,-.32]);
    box(board,[.064,.03,.24],pinMat,[px,.56,.97]);
  }
  // USB B port and barrel connector.
  box(board,[.85,.93,1.13],metallicMat,[-3.96,.81,-1.12]);
  box(board,[.9,.58,.55],0x263238,[-3.81,.8,-1.12]);
  cylinder(board,.48,.48,.76,plasticMat,[-3.68,.78,1.41],26,Math.PI/2);
  cylinder(board,.20,.20,.78,metallicMat,[-3.67,.78,1.41],26,Math.PI/2);
  // Header rows and pin collars.
  const headers = [[-2.02,2.19,16], [.48,-2.19,14], [2.75,1.98,6]];
  for (const [x,z,count] of headers) {
    const delta = .34;
    const left = x-(count-1)*delta/2;
    box(board,[count*delta+.15,.38,.55],plasticMat,[x,.67,z]);
    for (let i=0;i<count;i++) {
      const p = left+i*delta;
      cylinder(board,.094,.094,.018,0x6d7877,[p,.867,z],10);
      cylinder(board,.043,.043,.023,0x161f25,[p,.88,z],9);
    }
  }
  canvasLabel(board,"UNO  R3",1.85,.468,.62,2.45,52);
  canvasLabel(board,"DIGITAL   D0–D13",-.9,.48,1.58,2.3,29);
  canvasLabel(board,"ANALOG    A0–A5",.7,.48,-1.53,2.0,32);
  canvasLabel(board,"ARDUINO 3D",1.8,.468,-1.12,2.05,30);
  // Physical onboard LED L (material animated through state update).
  const ledMat = material(0x4b6d56, { emissive: 0x36cc80, emissiveIntensity: .04 });
  const led = cylinder(board,.13,.13,.09,ledMat,[2.9,.56,-.76],18);
  led.userData.kind = "onboard-led";
  canvasLabel(board,"L",3.13,.48,-.74,.40,70);
  for (let i = 0; i < 4; i++) {
    box(board,[.25,.16,.31],0x1d4348,[2.7-i*.35,.54,1.03]);
  }
  return {board,led};
}

function makeBreadboard(scene) {
  const base = new T.Group();
  base.position.set(5.15,.01,0);
  scene.add(base);
  box(base,[5.25,.33,5.03],0xffffff,[0,.3,0]);
  box(base,[.19,.012,4.28],0xe2e6e5,[-.10,.48,0]);
  for (let row=0;row<11;row++) {
    const x=-2.17+row*.43;
    for (let col=0;col<10;col++) {
      const z=-2.0+col*.425;
      cylinder(base,.037,.037,.014,0x9caead,[x,.476,z],8);
    }
  }
  for (const z of [-2.28,2.28]) {
    box(base,[4.76,.008,.035],z < 0?0xd77b65:0x65a9d5,[0,.492,z]);
  }
  canvasLabel(base,"BREADBOARD",0,.51,-2.43,2.35,33,"#748b83");
  return base;
}

function createModule(scene, kind) {
  const module = new T.Group();
  module.position.set(5.15,.55,.10);
  scene.add(module);
  const state = { module, led: null, rotor: null, pointer: null, arm: null };
  const led = (radius=.38, color=0xe75e57) => {
    const ledMaterial = material(color,{transparent:true,opacity:.85,emissive:color,emissiveIntensity:.10,roughness:.30});
    const globe = cylinder(module,radius,radius,.47,ledMaterial,[0,.48,0],32);
    cylinder(module,radius*.85,radius*.85,.08,metallicMat,[0,.22,0],32);
    state.led = globe;
  };
  const resistor = () => {
    const grp=new T.Group();grp.rotation.z=Math.PI/2;grp.position.set(1.4,.5,.78);module.add(grp);
    cylinder(grp,.12,.12,.85,0xe7d2a6,[0,0,0],20);
    [-.23,-.08,.1,.29].forEach((v,i)=>cylinder(grp,.125,.125,.046,[0xa83d31,0x1a1b1f,0x7d5117,0xc9a64c][i],[0,v,0],20));
    box(grp,[.022,.48,.022],metallicMat,[0,.64,0]);
    box(grp,[.022,.48,.022],metallicMat,[0,-.64,0]);
  };
  switch(kind) {
    case "board":
      led(.45,0x36ca92);
      canvasLabel(module,"ĐÈN L",0,1.1,0,1.4,50,"#327f74",true);
      break;
    case "button": {
      box(module,[1.65,.26,1.4],0x262d32,[0,.28,0]);
      const cap=cylinder(module,.48,.48,.3,0xe56b5b,[0,.57,0],24);
      cap.userData.kind="button-cap";state.pointer=cap;
      led(.24); state.led.position.set(1.3,.52,-.35);resistor();
      break;
    }
    case "potentiometer": {
      cylinder(module,.75,.75,.26,0x32444b,[0,.32,0]);
      const knob=cylinder(module,.51,.51,.38,0xe3e7e1,[0,.65,0]); state.rotor=knob;
      box(knob,[.08,.015,.4],0x157d74,[0,.197,-.22]);
      led(.26); state.led.position.set(1.4,.46,0);
      break;
    }
    case "rgb":
      led(.75,0xeb638c);resistor();break;
    case "ldr":
    case "force":
    case "temperature": {
      const disk=cylinder(module,.71,.71,.22,kind==="temperature"?0x6ba1ad:0x99846e,[0,.45,0],32);
      if(kind==="ldr"){
        const track=box(module,[.85,.03,.09],0x3b3c2e,[0,.58,0]);track.rotation.y=-.4;
        box(module,[.05,.035,.84],0x3b3c2e,[0,.59,0]);
      }else if(kind==="temperature"){canvasLabel(module,"°C",0,.58,0,.85,77,"#fff");
      }else{canvasLabel(module,"FSR",0,.58,0,.95,62,"#edf6eb");}
      led(.26);state.led.position.set(1.35,.43,0);
      break;
    }
    case "ultrasonic":
      box(module,[2.45,.14,.96],0x24909a,[0,.41,0]);
      for(const x of [-.72,.72]) {
        cylinder(module,.48,.48,.24,metallicMat,[x,.56,0],32);
        cylinder(module,.32,.32,.02,0x697e83,[x,.695,0],32);
      }
      led(.22);state.led.position.set(1.28,.35,.6);
      break;
    case "buzzer":
    case "piano":
      cylinder(module,.78,.78,.58,0x202c31,[0,.48,0],42);
      cylinder(module,.43,.43,.03,0x11191c,[0,.788,0],42);
      canvasLabel(module,"BUZZER",0,.81,0,1.1,39,"#d2e4df");
      break;
    case "motor":
    case "stepper": {
      const m = cylinder(module,.67,.67,2.2,0x829597,[0,.73,0],30,Math.PI/2);
      m.rotation.z=Math.PI/2;
      cylinder(module,.24,.24,.78,metallicMat,[1.24,.75,0],22,0);
      const rotor=box(module,[.23,.11,2],0x186b67,[1.36,.78,0]);state.rotor=rotor;
      canvasLabel(module,kind==="motor"?"ĐỘNG CƠ DC":"STEPPER",0,1.63,0,2.25,43,"#397670",true);
      break;
    }
    case "servo": {
      box(module,[1.7,.77,1.1],0x314654,[0,.59,0]);
      cylinder(module,.41,.41,.18,0xf4f0e4,[0,1.05,0]);
      const arm=new T.Group();arm.position.set(0,1.16,0);module.add(arm);
      box(arm,[2.2,.1,.22],0xe2dfd2,[0,0,0]);state.arm=arm;
      break;
    }
    case "plant":
      cylinder(module,.92,.64,.92,0xb9825d,[0,.36,0],24);
      cylinder(module,.7,.7,.04,0x567757,[0,.85,0],24);
      for(const k of [-1,0,1]){
        const leaf=cylinder(module,.12,.29,.85,0x52ac72,[k*.35,1.26,.05],12);
        leaf.rotation.z=k*.45;
      }
      led(.20);state.led.position.set(1.2,.40,.05);
      break;
    case "project":
      led(.34);state.led.position.set(.9,.65,.1);
      cylinder(module,.51,.51,.13,0x89ad8c,[-.85,.4,.25]);
      cylinder(module,.34,.34,.28,0xd0dcdb,[-.85,.65,.25]);
      break;
    default: led();resistor();
  }
  return state;
}

export function mountScene(host, onSelect = () => {}) {
  if (!host?.isConnected) throw new Error("Không tìm thấy vùng hiển thị 3D");
  const scene = new T.Scene();
  scene.background = new T.Color(palette.ground);
  const ground = new T.Mesh(new T.PlaneGeometry(200,200),material(0xe9f1eb,{roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.06;ground.receiveShadow=true;scene.add(ground);
  const hemi = new T.HemisphereLight(0xffffff,0x7fa19c,2.2);scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff,2.55);
  sun.position.set(-2,14,11);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
  sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=15;sun.shadow.camera.bottom=-15;
  scene.add(sun);
  const camera = new T.PerspectiveCamera(38,1,.1,100);
  let theta=.45,phi=.88,radius=16.7,raf=0,disposed=false,moved=false,drag=null;
  let activeModule=null,activeWires=null,board=null,breadboard=null,renderer;
  const minRadius=10,maxRadius=33;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.28;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=T.PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-label","Mô hình Arduino Uno 3D. Dùng chuột kéo để xoay; dùng các nút phía dưới để điều khiển.");
    renderer.domElement.tabIndex=0;
    host.replaceChildren(renderer.domElement);
  } catch(error) {
    throw new Error("Trình duyệt không tạo được WebGL: " + (error?.message || "Không rõ nguyên nhân"));
  }
  board=makeBoard(scene);breadboard=makeBreadboard(scene);
  const defaultPosition=()=>{theta=.48;phi=.94;radius=16.7;};
  function updateCamera() {
    camera.position.set(radius*Math.sin(phi)*Math.sin(theta),radius*Math.cos(phi)+5,radius*Math.sin(phi)*Math.cos(theta));
    camera.lookAt(1.15,.35,0);
  }
  function draw(){raf=0;if(disposed||document.hidden)return;updateCamera();renderer.render(scene,camera);}
  function invalidate(){if(!raf && !disposed && !document.hidden) raf=requestAnimationFrame(draw);}
  function resize(){
    if(disposed)return;
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
    camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);invalidate();
  }
  const observer = new ResizeObserver(resize);observer.observe(host);
  const canvas=renderer.domElement;
  function down(event){
    if(event.button!==0)return;
    drag={x:event.clientX,y:event.clientY,pointerId:event.pointerId};
    moved=false;canvas.setPointerCapture?.(event.pointerId);
  }
  function move(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.abs(dx)+Math.abs(dy)>.3)moved=true;
    theta-=dx*.008;phi=Math.max(.27,Math.min(1.45,phi+dy*.008));
    drag.x=event.clientX;drag.y=event.clientY;invalidate();
  }
  function up(event){
    if(!drag||event.pointerId!==drag.pointerId)return;
    drag=null;
    try{canvas.releasePointerCapture?.(event.pointerId);}catch{}
    if(!moved)onSelect("Arduino Uno R3");
  }
  function wheel(event) {
    event.preventDefault();
    radius=Math.min(maxRadius,Math.max(minRadius,radius+Math.sign(event.deltaY)*1.3));
    invalidate();
  }
  const onVisibility=()=>{if(!document.hidden)invalidate();};
  const onKey=(event)=>{if(document.activeElement!==canvas)return;if(event.key==="ArrowLeft"){theta-=.13;invalidate();event.preventDefault();}if(event.key==="ArrowRight"){theta+=.13;invalidate();event.preventDefault();}if(event.key==="ArrowUp"){phi=Math.max(.27,phi-.12);invalidate();event.preventDefault();}if(event.key==="ArrowDown"){phi=Math.min(1.45,phi+.12);invalidate();event.preventDefault();}};
  canvas.addEventListener("pointerdown",down);
  canvas.addEventListener("pointermove",move);
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",up);
  canvas.addEventListener("wheel",wheel,{passive:false});
  canvas.addEventListener("keydown",onKey);
  document.addEventListener("visibilitychange",onVisibility);
  window.addEventListener("resize",resize);

  function setLesson(lesson) {
    if(disposed)return;
    if(activeModule){scene.remove(activeModule.module);disposeTree(activeModule.module);}
    if(activeWires){scene.remove(activeWires);disposeTree(activeWires);}
    activeModule=createModule(scene, lesson.id===1?"board":
      ({2:"led",3:"button",4:"potentiometer",5:"rgb",6:"ldr",7:"ultrasonic",8:"buzzer",9:"piano",10:"motor",11:"temperature",12:"servo",13:"stepper",14:"plant",15:"force",16:"project"})[lesson.id] || "led");
    activeWires = new T.Group();scene.add(activeWires);
    const count=Math.min(6,Math.max(2,lesson.wiring.length));
    const colors=[0x3aa9a0,0xe6a558,0xdb745e,0x376a9e,0x606d67,0x8a8bdb];
    for(let i=0;i<count;i++) {
      const z=-1.6+i*.57;
      wire(activeWires,[1.3,.95,z*.92],[2.9,.88,z*.81],colors[i],.76+.2*(i%3));
    }
    invalidate();
  }
  function update(snapshot){
    if(disposed)return;
    if(board){
      board.led.material.emissiveIntensity=snapshot.led ? 3.6 : .06;
      board.led.material.color.set(snapshot.led ? 0xc1ffdf : 0x446c5c);
    }
    if(activeModule?.led) {
      const glow=activeModule.led.material;
      glow.color.set(snapshot.kind==="rgb" ? snapshot.rgb : 0xf17b62);
      glow.emissive?.set(snapshot.kind==="rgb" ? snapshot.rgb : 0xf17b62);
      glow.emissiveIntensity=snapshot.brightness ? .15+snapshot.brightness*3.1 : .02;
      glow.opacity=snapshot.brightness ? .9 : .50;
    }
    if(activeModule?.pointer?.userData.kind==="button-cap"){
      activeModule.pointer.position.y=snapshot.button?.46:.57;
    }
    if(activeModule?.arm) activeModule.arm.rotation.y=(snapshot.angle-90)*Math.PI/180;
    if(activeModule?.rotor){
      if(snapshot.kind==="potentiometer")activeModule.rotor.rotation.y=(Number(snapshot.value.match(/\d+/)?.[0]||0)/1023)*Math.PI*1.7;
      if(snapshot.kind==="motor")activeModule.rotor.rotation.x= snapshot.motorDirection * snapshot.motorSpeed * 3;
      if(snapshot.kind==="stepper")activeModule.rotor.rotation.x=snapshot.angle*Math.PI/180;
    }
    invalidate();
  }
  function control(action){
    if(disposed)return;
    if(action==="left")theta-=.32;
    else if(action==="right")theta+=.32;
    else if(action==="in")radius=Math.max(minRadius,radius-2);
    else if(action==="out")radius=Math.min(maxRadius,radius+2);
    else if(action==="reset")defaultPosition();
    invalidate();
  }
  resize();
  return {setLesson,update,control,resize,dispose() {
    if(disposed)return;disposed=true;
    if(raf)cancelAnimationFrame(raf);
    observer.disconnect();
    document.removeEventListener("visibilitychange",onVisibility);
    window.removeEventListener("resize",resize);
    canvas.removeEventListener("pointerdown",down);
    canvas.removeEventListener("pointermove",move);
    canvas.removeEventListener("pointerup",up);
    canvas.removeEventListener("pointercancel",up);
    canvas.removeEventListener("wheel",wheel);
    canvas.removeEventListener("keydown",onKey);
    if(activeModule){scene.remove(activeModule.module);disposeTree(activeModule.module);}
    if(activeWires){scene.remove(activeWires);disposeTree(activeWires);}
    if(board){scene.remove(board.board);disposeTree(board.board);}
    if(breadboard){scene.remove(breadboard);disposeTree(breadboard);}
    scene.remove(ground);disposeTree(ground);ground.material.dispose();
    [bodyMat,plasticMat,lightMat,metallicMat,pinMat].forEach(m=>m.dispose());
    renderer.dispose();
    renderer.forceContextLoss?.();
    canvas.remove();
  }};
}
