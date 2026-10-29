// Mô hình hình học 3D độc lập của Arduino Uno và các mô-đun minh họa.
// Mã hiển thị không quyết định hành vi điện tử; trạng thái đến từ simulator.js.
import * as T from "../assets/vendor/three.module.min.js";
import { labTerminalAnchor, validateLabLayout } from "./lab-layout.js";

const palette = {
  board: 0x176b7a, solder: 0x166070, dark: 0x172f38, metal: 0xc4cfcd,
  silk: 0xd7eee8, ground: 0xe8f0eb, plastic: 0xf8faf6,
  teal: 0x26af9d, coral: 0xf17b62, amber: 0xf0b866
};
const BASE_SCENE_ARIA = "Mô hình Arduino Uno 3D tương tác. Dùng phím mũi tên để xoay, +/− để thu phóng, Home để đặt lại và Enter để chọn bo mạch. Trên màn hình cảm ứng, vuốt ngang để xoay; vuốt dọc vẫn cuộn trang.";
const CONCEPTUAL_WIRING_NOTICE = "SƠ ĐỒ NET KHÁI NIỆM · KHÔNG PHẢI VỊ TRÍ LỖ BREADBOARD";
const CONCEPTUAL_WIRING_ARIA = "Lớp dây là sơ đồ net khái niệm từ netlist hiện tại, không phải vị trí lỗ breadboard hay mô phỏng dòng điện vật lý.";
const LAB_LAYOUT_NOTICE = "LAYOUT KHÁI NIỆM · KHÔNG PHẢI TỌA ĐỘ LỖ BREADBOARD";
const LAB_EDIT_ARIA = "Chế độ chỉnh bố trí 3D đang bật. Click hoặc chạm để chọn component; kéo component di động trên mặt phẳng bố trí. Các phím W A S D di chuyển component đã chọn theo lưới, Q/E xoay 90 độ, Escape bỏ chọn. Phím mũi tên vẫn điều khiển camera.";
const LAB_WORLD_SCALE = .72;
const SCENE_QUALITY_PROFILE = "v16";
const SCENE_LOD_BREAKPOINT = 560;
const LAB_TERMINAL_HIT_RADIUS = .20;
const LAB_TOUCH_TAP_THRESHOLD = 12;
const WIRING_LIMITS = Object.freeze({ maxWires: 48, maxTerminals: 32, maxNetLabels: 16, maxIssues: 96 });
const WIRING_COLORS = Object.freeze({
  checked: 0x188b80,
  warning: 0xd59b35,
  error: 0xd65f55,
  unverified: 0x7c8d89,
});
const material = (color, extras = {}) => new T.MeshStandardMaterial({ color, roughness: .62, metalness: .05, ...extras });
const createSharedMaterials = () => ({
  bodyMat: material(palette.board, { roughness: .4 }),
  plasticMat: material(palette.dark, { roughness: .7 }),
  metallicMat: material(palette.metal, { metalness: .6, roughness: .32 }),
  pinMat: material(0xb8c6c4, { metalness: .48 }),
  traceMat: material(0x287b88, { roughness: .72 }),
  socketMat: material(0x171f23, { roughness: .78 }),
  collarMat: material(0x6d7877, { roughness: .66 }),
  holeMat: material(0x9caead, { roughness: .82 }),
  railHoleMat: material(0xa6b4b0, { roughness: .82 }),
  terminalMat: new T.MeshBasicMaterial({ color: 0x405a58 }),
  terminalHaloMat: new T.MeshBasicMaterial({
    color: palette.teal, transparent: true, opacity: .40,
    depthWrite: false, side: T.DoubleSide,
  }),
  inspectionTerminalHaloMat: new T.MeshBasicMaterial({
    color: 0x6274d9, transparent: true, opacity: .76,
    depthWrite: false, side: T.DoubleSide,
  }),
  pendingTerminalHaloMat: new T.MeshBasicMaterial({
    color: palette.coral, transparent: true, opacity: .88,
    depthWrite: false, side: T.DoubleSide,
  }),
  pendingWireLineMat: new T.LineBasicMaterial({
    color: palette.coral, transparent: true, opacity: .56,
    depthWrite: false,
  }),
  hitMat: new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  selectionLineMat: new T.LineBasicMaterial({ color: palette.amber, transparent: true, opacity: .96 }),
  focusLineMat: new T.LineBasicMaterial({ color: palette.teal, transparent: true, opacity: .92 }),
});

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
  context.shadowColor = "rgba(13, 42, 38, .28)";
  context.shadowBlur = 3;
  context.shadowOffsetY = 1;
  context.fillText(text, 256, 54, 495);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = T.LinearFilter;
  texture.magFilter = T.LinearFilter;
  const mesh = new T.Mesh(new T.PlaneGeometry(width, width * 108 / 512),
    new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: T.DoubleSide }));
  mesh.position.set(x,y,z);
  if (!horizontal) mesh.rotation.x = -Math.PI / 2;
  mesh.userData = { kind: "scene-label", physicalVerified: false };
  parent.add(mesh);
  return mesh;
}
function fineDetail(object) {
  if (!object) return object;
  object.userData = { ...object.userData, sceneDetail: "fine", physicalVerified: false };
  return object;
}
function disposeTree(obj, keepMaterials = new Set()) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  obj.traverse(child => {
    if (!child.isMesh && !child.isSprite && !child.isLine) return;
    if (child.geometry) geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of childMaterials) {
      if (!m || keepMaterials.has(m)) continue;
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(item => item.dispose());
  geometries.forEach(geometry => geometry.dispose());
}
function wiringStatus(analysis) {
  if (!analysis || analysis.supported !== true) return "unverified";
  const severities = new Set(Array.isArray(analysis.issues) ? analysis.issues.map(item => item?.severity) : []);
  if (severities.has("error")) return "error";
  if (severities.has("warning")) return "warning";
  if (analysis.ok !== true) return "warning";
  return "checked";
}

function wiringStatusLabel(status) {
  if (status === "error") return "CÓ LỖI TOPOLOGY";
  if (status === "warning") return "CÓ CẢNH BÁO TOPOLOGY";
  if (status === "checked") return "TOPOLOGY ĐÃ KIỂM TRA";
  return "CHƯA CÓ PHÂN TÍCH TOPOLOGY";
}

function normalizeWiringModel(circuit, terminals, analysis) {
  const wireInput = Array.isArray(circuit?.wires) ? circuit.wires : [];
  const terminalInput = Array.isArray(terminals) ? terminals : [];
  const terminalMap = new Map();
  for (const item of terminalInput.slice(0, WIRING_LIMITS.maxTerminals)) {
    if (!item || typeof item.id !== "string" || terminalMap.has(item.id)) continue;
    terminalMap.set(item.id, { ...item });
  }

  const nets = Array.isArray(analysis?.nets) ? analysis.nets.slice(0, WIRING_LIMITS.maxTerminals) : [];
  const normalizedNets = nets.map((net, index) => ({
    id: typeof net?.id === "string" && net.id ? net.id : `net-${index + 1}`,
    terminals: new Set(Array.isArray(net?.terminals)
      ? net.terminals.slice(0, WIRING_LIMITS.maxTerminals).filter(id => typeof id === "string") : []),
  }));
  const issues = Array.isArray(analysis?.issues) ? analysis.issues.slice(0, WIRING_LIMITS.maxIssues) : [];
  const severityRank = { warning: 1, error: 2 };
  const statusForNet = net => {
    if (!analysis || analysis.supported !== true || !net) return "unverified";
    let rank = 0;
    for (const issue of issues) {
      const issueTerminals = Array.isArray(issue?.terminals)
        ? issue.terminals.slice(0, WIRING_LIMITS.maxTerminals) : [];
      if (!issueTerminals.some(id => net.terminals.has(id))) continue;
      rank = Math.max(rank, severityRank[issue?.severity] || 0);
    }
    return rank === 2 ? "error" : rank === 1 ? "warning" : "checked";
  };

  let omittedWires = Math.max(0, wireInput.length - WIRING_LIMITS.maxWires);
  const wires = [];
  const usedIds = new Set();
  for (const item of wireInput.slice(0, WIRING_LIMITS.maxWires)) {
    const from = typeof item?.from === "string" ? item.from : "";
    const to = typeof item?.to === "string" ? item.to : "";
    if (!from || !to || from === to || !terminalMap.has(from) || !terminalMap.has(to)) {
      omittedWires += 1;
      continue;
    }
    const net = normalizedNets.find(candidate => candidate.terminals.has(from) && candidate.terminals.has(to)) || null;
    const status = statusForNet(net);
    wires.push({
      id: typeof item.id === "string" ? item.id : `wire-${wires.length + 1}`,
      from, to, netId: net?.id || null, status,
    });
    usedIds.add(from); usedIds.add(to);
  }

  const usedTerminals = [...terminalMap.values()].filter(item => usedIds.has(item.id));
  const visibleNetIds = new Set(wires.map(item => item.netId).filter(Boolean));
  const visibleNets = normalizedNets.filter(net => visibleNetIds.has(net.id));
  return {
    wires,
    terminals: usedTerminals,
    nets: visibleNets,
    omittedWires,
    status: wiringStatus(analysis),
    analysisSupported: analysis?.supported === true,
  };
}

function conceptualTerminalLayout(terminals) {
  const positions = new Map();
  const count = terminals.length;
  if (!count) return positions;
  const rows = count > 20 ? 3 : count > 10 ? 2 : 1;
  const perRow = Math.ceil(count / rows);
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    const itemsInRow = Math.min(perRow, count - row * perRow);
    const x = itemsInRow === 1 ? 0 : -5.15 + (10.3 * column / (itemsInRow - 1));
    const z = rows === 1 ? 0 : -.24 + row * (.48 / Math.max(1, rows - 1));
    positions.set(terminals[index].id, new T.Vector3(x, .19, z));
  }
  return positions;
}

function conceptualWire(parent, start, end, status, index, userData) {
  const mid = start.clone().lerp(end, .5);
  mid.y += .34 + (index % 5) * .08;
  const curve = new T.QuadraticBezierCurve3(start, mid, end);
  const geometry = new T.TubeGeometry(curve, 18, .035, 6, false);
  const wireMaterial = new T.MeshBasicMaterial({ color: WIRING_COLORS[status], transparent: true, opacity: .94 });
  const mesh = new T.Mesh(geometry, wireMaterial);
  mesh.userData = { kind: "conceptual-wire", physicalLocation: false, ...userData };
  parent.add(mesh);
  return mesh;
}

function makeConceptualWiringLayer(scene, model) {
  const layer = new T.Group();
  layer.position.set(1.15, .10, -3.14);
  layer.userData.kind = "conceptual-netlist";
  const panel = new T.Mesh(
    new T.BoxGeometry(12.3, .055, 1.62),
    new T.MeshBasicMaterial({ color: 0xf7fbf8, transparent: true, opacity: .88 })
  );
  panel.userData = { kind: "conceptual-panel", physicalLocation: false };
  layer.add(panel);

  canvasLabel(layer, CONCEPTUAL_WIRING_NOTICE, 0, .055, -.62, 6.0, 25, "#355f58");
  const statusText = `${model.wires.length} DÂY · ${model.nets.length} NET · ${wiringStatusLabel(model.status)}`;
  canvasLabel(layer, statusText, 0, .06, .61, 4.8, 27,
    model.status === "error" ? "#a8423b" : model.status === "warning" ? "#93671d" : "#356b62");
  canvasLabel(layer, "MÀU = TRẠNG THÁI TOPOLOGY · KHÔNG MÔ PHỎNG DÒNG/ÁP", 0, .058, .43, 4.9, 22, "#687c76");

  const positions = conceptualTerminalLayout(model.terminals);
  for (const terminal of model.terminals) {
    const pos = positions.get(terminal.id);
    if (!pos) continue;
    const node = new T.Mesh(
      new T.CylinderGeometry(.065, .065, .10, 12),
      new T.MeshBasicMaterial({ color: 0x405a58 })
    );
    node.position.copy(pos); node.position.y = .14;
    node.userData = { kind: "conceptual-terminal", terminalId: terminal.id, physicalLocation: false };
    layer.add(node);
    canvasLabel(layer, terminal.id.slice(0, 22), pos.x, .09, pos.z + .11, .78, 27, "#354f4b");
  }

  model.wires.forEach((item, index) => {
    const start = positions.get(item.from), end = positions.get(item.to);
    if (!start || !end) return;
    conceptualWire(layer, start, end, item.status, index, {
      wireId: item.id, from: item.from, to: item.to, netId: item.netId, status: item.status,
    });
  });

  const netLabels = model.nets.slice(0, WIRING_LIMITS.maxNetLabels);
  for (const net of netLabels) {
    const wire = model.wires.find(item => item.netId === net.id);
    if (!wire) continue;
    const a = positions.get(wire.from), b = positions.get(wire.to);
    if (!a || !b) continue;
    const status = wire.status;
    const suffix = status === "error" ? "LỖI" : status === "warning" ? "CẢNH BÁO" : status === "checked" ? "ĐÃ KIỂM TRA" : "CHƯA PHÂN TÍCH";
    const midpoint = a.clone().lerp(b, .5);
    canvasLabel(layer, `${net.id} · ${suffix}`, midpoint.x, .64, midpoint.z, 1.20, 24,
      status === "error" ? "#a8423b" : status === "warning" ? "#93671d" : status === "checked" ? "#246b62" : "#677874");
  }
  scene.add(layer);
  return layer;
}

function labWorldPoint(x, z, y = 0) {
  return new T.Vector3(x * LAB_WORLD_SCALE, y, z * LAB_WORLD_SCALE);
}

function unrotateLabVector(x, z, quarterTurns) {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 1: return { x: z, z: -x };
    case 2: return { x: -x, z: -z };
    case 3: return { x: -z, z: x };
    default: return { x, z };
  }
}

function labComponentHeight(kind) {
  if (kind === "arduino-uno") return .46;
  if (kind === "breadboard") return .34;
  if (kind === "ultrasonic-sensor") return .68;
  if (kind === "servo" || kind === "driver") return .62;
  if (kind === "power-source") return .55;
  return .48;
}

function outlineBoxGeometry(width, height, depth) {
  const source = new T.BoxGeometry(width, height, depth);
  const edges = new T.EdgesGeometry(source);
  source.dispose();
  return edges;
}

function labSelectionFrame(parent, width, depth, componentId, shared) {
  const frame = new T.LineSegments(
    outlineBoxGeometry(width + .14, .08, depth + .14),
    shared.selectionLineMat,
  );
  frame.position.y = .08;
  frame.visible = false;
  frame.userData = { kind: "lab-selection-frame", componentId, physicalLocation: false };
  parent.add(frame);
  return frame;
}

function labFocusFrame(parent, width, depth, componentId, shared) {
  const frame = new T.LineSegments(
    outlineBoxGeometry(width + .30, .06, depth + .30),
    shared.focusLineMat,
  );
  frame.position.y = .12;
  frame.visible = false;
  frame.userData = { kind: "lab-focus-frame", componentId, physicalLocation: false };
  parent.add(frame);
  return frame;
}

function labHitProxy(parent, width, depth, height, componentId, shared) {
  const proxy = new T.Mesh(
    new T.BoxGeometry(Math.max(.24, width), Math.max(.3, height + .35), Math.max(.24, depth)),
    shared.hitMat,
  );
  proxy.position.y = Math.max(.2, height / 2);
  proxy.userData = { kind: "lab-component-hit", componentId, physicalLocation: false };
  parent.add(proxy);
  return proxy;
}

function makeLabArduinoVisual(parent, width, depth, shared) {
  const body = box(parent, [width, .18, depth], shared.bodyMat, [0,.15,0]);
  body.castShadow = true;
  box(parent,[width * .43,.16,depth * .22],shared.plasticMat,[width * .08,.32,.05]);
  box(parent,[width * .16,.42,depth * .28],shared.metallicMat,[-width * .43,.38,-depth * .24]);
  const topZ = depth * .39;
  const bottomZ = -depth * .39;
  box(parent,[width * .76,.22,.30],shared.plasticMat,[-width * .02,.35,topZ]);
  box(parent,[width * .62,.22,.30],shared.plasticMat,[width * .12,.35,bottomZ]);
  canvasLabel(parent,"ARDUINO UNO R3",0,.285,.02,Math.max(1.6,width*.62),38);
  canvasLabel(parent,"DIGITAL D0–D13",0,.505,topZ - .30,Math.max(1.55,width*.58),29);
  canvasLabel(parent,"ANALOG A0–A5",width*.05,.505,bottomZ + .30,Math.max(1.5,width*.54),29);
  canvasLabel(parent,"5V · 3V3 · GND",width*.27,.505,depth*.16,Math.max(1.3,width*.42),27);
  const socketCount = 12;
  for (let i = 0; i < socketCount; i += 1) {
    const px = -width*.31 + i * (width*.62/(socketCount-1));
    fineDetail(cylinder(parent,.035,.035,.026,shared.socketMat,[px,.485,topZ],8));
  }
  for (let i = 0; i < 8; i += 1) {
    const px = -width*.23 + i * (width*.46/7);
    fineDetail(cylinder(parent,.035,.035,.026,shared.socketMat,[px,.485,bottomZ],8));
  }
  fineDetail(canvasLabel(parent,"HEADER VISUAL · KHÔNG PHẢI PIN MAP",0,.515,depth*.47,Math.max(1.8,width*.74),20,"#d9eee8"));
  fineDetail(canvasLabel(parent,"PWM ~ 3 · 5 · 6 · 9 · 10 · 11",0,.515,-depth*.47,Math.max(1.9,width*.78),18,"#c7e8df"));
  fineDetail(box(parent,[width*.15,.08,depth*.10],0x486c6f,[width*.31,.31,-depth*.10]));
  fineDetail(canvasLabel(parent,"RESET",width*.31,.52,-depth*.10,.60,20,"#d9eee8"));
}

function makeLabBreadboardVisual(parent, width, depth, shared) {
  const base=box(parent,[width,.26,depth],0xfdfefd,[0,.14,0]);
  base.userData={kind:"breadboard-visual",physicalVerified:false,breadboardHoleMapping:false};
  box(parent,[width*.90,.012,.025],0xd77b65,[0,.285,-depth*.37]);
  box(parent,[width*.90,.012,.025],0x65a9d5,[0,.285,depth*.37]);
  box(parent,[width*.84,.014,depth*.07],0xe0e6e3,[0,.292,0]);
  box(parent,[width*.86,.012,.026],0xd77b65,[0,.285,-depth*.44]);
  box(parent,[width*.86,.012,.026],0x65a9d5,[0,.285,depth*.44]);
  const columns = 12, bankRows = 5;
  for (let i = 0; i < columns; i += 1) {
    const x=-width*.39+i*(width*.78/(columns-1));
    for (const side of [-1,1]) {
      for (let j = 0; j < bankRows; j += 1) {
        const z=side*(depth*.08+j*(depth*.19/(bankRows-1)));
        fineDetail(cylinder(parent,.025,.025,.014,shared.holeMat,[x,.292,z],7));
      }
    }
    for (const railZ of [-depth*.405,depth*.405]) {
      fineDetail(cylinder(parent,.022,.022,.013,shared.railHoleMat,[x,.292,railZ],7));
    }
  }
  fineDetail(canvasLabel(parent,"VISUAL GRID · KHÔNG CÓ HOLE MAP",0,.305,depth*.31,Math.max(1.5,width*.72),18,"#7a8f89"));
  canvasLabel(parent,"BREADBOARD · KHÁI NIỆM",0,.30,-depth*.43,Math.max(1.5,width*.70),25,"#607c74");
}

function makeLabGenericVisual(parent, component, shared) {
  const width = component.width * LAB_WORLD_SCALE;
  const depth = component.depth * LAB_WORLD_SCALE;
  const height = labComponentHeight(component.visualKind);
  const { metallicMat, plasticMat } = shared;
  switch (component.visualKind) {
    case "arduino-uno":
      makeLabArduinoVisual(parent,width,depth,shared);
      break;
    case "breadboard":
      makeLabBreadboardVisual(parent,width,depth,shared);
      break;
    case "resistor": {
      const body = new T.Group();
      body.rotation.z = Math.PI / 2;
      body.position.y = .34;
      parent.add(body);
      cylinder(body,.10,.10,Math.max(.56,width*.58),0xe7d2a6,[0,0,0],18);
      [-.16,-.05,.07,.18].forEach((v,index)=>{
        fineDetail(cylinder(body,.104,.104,.034,[0xa83d31,0x1a1b1f,0x7d5117,0xc9a64c][index],[0,v,0],16));
      });
      box(body,[.018,Math.max(.40,width*.34),.018],metallicMat,[0,Math.max(.38,width*.48),0]);
      box(body,[.018,Math.max(.40,width*.34),.018],metallicMat,[0,-Math.max(.38,width*.48),0]);
      break;
    }
    case "led":
    case "rgb-led": {
      const color = component.visualKind === "rgb-led" ? 0xd86596 : palette.coral;
      cylinder(parent,Math.min(.30,width*.24),Math.min(.30,width*.24),.42,color,[0,.37,0],24);
      cylinder(parent,Math.min(.24,width*.19),Math.min(.24,width*.19),.05,metallicMat,[0,.14,0],20);
      break;
    }
    case "button":
      box(parent,[width*.72,.22,depth*.72],plasticMat,[0,.20,0]);
      cylinder(parent,Math.min(.28,width*.24),Math.min(.28,width*.24),.24,palette.coral,[0,.43,0],22);
      fineDetail(canvasLabel(parent,"PUSH",0,.56,0,Math.max(.55,width*.44),18,"#f7e5df"));
      break;
    case "potentiometer":
      cylinder(parent,Math.min(.36,width*.27),Math.min(.36,width*.27),.22,0x32444b,[0,.22,0],24);
      cylinder(parent,Math.min(.24,width*.18),Math.min(.24,width*.18),.28,0xe3e7e1,[0,.47,0],20);
      break;
    case "photoresistor": {
      const disk=cylinder(parent,Math.min(.34,width*.24),Math.min(.34,width*.24),.10,0xb3936f,[0,.24,0],24);
      fineDetail(box(disk,[.34,.015,.045],0x3b3c2e,[0,.055,0]));
      fineDetail(box(disk,[.045,.015,.34],0x3b3c2e,[0,.057,0]));
      canvasLabel(parent,"LDR",0,.39,0,Math.max(.65,width*.52),24,"#eef7f2");
      break;
    }
    case "force-sensor": {
      cylinder(parent,Math.min(.34,width*.25),Math.min(.34,width*.25),.07,0x7d918e,[0,.22,0],26);
      fineDetail(cylinder(parent,Math.min(.22,width*.16),Math.min(.22,width*.16),.012,0xdbe8e3,[0,.263,0],24));
      canvasLabel(parent,"FSR",0,.36,0,Math.max(.62,width*.50),24,"#eef7f2");
      break;
    }
    case "temperature-sensor": {
      box(parent,[width*.44,.30,depth*.32],0x27353a,[0,.28,0]);
      for(const x of [-width*.14,0,width*.14])fineDetail(box(parent,[.025,.24,.025],metallicMat,[x,.08,0]));
      canvasLabel(parent,"TEMP",0,.47,0,Math.max(.66,width*.55),22,"#eef7f2");
      break;
    }
    case "soil-sensor": {
      box(parent,[width*.58,.16,depth*.52],0x6d8b70,[0,.31,0]);
      fineDetail(box(parent,[width*.16,.48,.08],0x8aa188,[-width*.16,.04,0]));
      fineDetail(box(parent,[width*.16,.48,.08],0x8aa188,[width*.16,.04,0]));
      canvasLabel(parent,"SOIL",0,.48,0,Math.max(.66,width*.54),22,"#eef7f2");
      break;
    }
    case "ultrasonic-sensor":
      box(parent,[width*.80,.15,depth*.70],0x24909a,[0,.24,0]);
      for (const x of [-width*.22,width*.22]) {
        cylinder(parent,Math.min(.24,depth*.22),Math.min(.24,depth*.22),.19,metallicMat,[x,.39,0],22);
      }
      break;
    case "buzzer":
      cylinder(parent,Math.min(.34,width*.27),Math.min(.34,width*.27),.42,0x202c31,[0,.31,0],28);
      cylinder(parent,Math.min(.18,width*.14),Math.min(.18,width*.14),.025,0x11191c,[0,.53,0],22);
      break;
    case "driver":
      box(parent,[width*.82,.18,depth*.76],0x315f67,[0,.22,0]);
      box(parent,[width*.34,.16,depth*.32],plasticMat,[0,.37,0]);
      fineDetail(box(parent,[width*.17,.15,depth*.22],0x2b3034,[-width*.24,.37,0]));
      fineDetail(box(parent,[width*.17,.15,depth*.22],0x2b3034,[width*.24,.37,0]));
      fineDetail(canvasLabel(parent,"DRIVER",0,.52,0,Math.max(.72,width*.55),20,"#dcece7"));
      break;
    case "servo": {
      box(parent,[width*.72,.42,depth*.64],0x314654,[0,.30,0]);
      cylinder(parent,Math.min(.22,width*.16),Math.min(.22,width*.16),.10,0xf4f0e4,[0,.57,0],20);
      box(parent,[width*.72,.06,.12],0xe2dfd2,[0,.66,0]);
      break;
    }
    case "power-source":
      box(parent,[width*.78,.38,depth*.72],0x5d7278,[0,.28,0]);
      fineDetail(cylinder(parent,.08,.08,.08,0xd66759,[-width*.20,.51,0],14));
      fineDetail(cylinder(parent,.08,.08,.08,0x2a3337,[width*.20,.51,0],14));
      canvasLabel(parent,"+   NGUỒN   −",0,.49,0,Math.max(.9,width*.68),25,"#f5f7f2");
      break;
    default:
      box(parent,[width*.76,.26,depth*.70],0x78918d,[0,.24,0]);
      break;
  }
  if (component.visualKind !== "arduino-uno" && component.visualKind !== "breadboard") {
    canvasLabel(parent,component.label,0,height + .12,0,Math.max(.72,width*.84),24,"#355f58");
  }
  return { width, depth, height };
}

function makeBoard(scene, shared) {
  const { bodyMat, plasticMat, metallicMat, pinMat } = shared;
  const board = new T.Group();
  board.position.x = -2.65;
  board.userData={kind:"arduino-uno-visual",physicalVerified:false};
  scene.add(board);
  // Visual proportions follow the published Uno Rev3 board aspect ratio only.
  // Scene units are not millimetres and no pin/header coordinate is physical truth.
  box(board, [7.20,.23,5.60], bodyMat, [0,.34,0]);
  // Metal traces are represented as subtle decorative silk traces.
  for (let i = 0; i < 17; i++) {
    const z = -1.85 + (i % 9) * .43;
    const x = -2.65 + Math.floor(i / 9) * 4.2;
    fineDetail(box(board, [2.1,.008,.019], shared.traceMat, [x,.462,z]));
  }
  // Mounting holes: four recessed-looking rings.
  for (const x of [-3.18,3.18]) for (const z of [-2.42,2.42]) {
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
  fineDetail(canvasLabel(board,"USB-B",-3.22,.49,-1.12,.78,21,"#dceee8"));
  fineDetail(canvasLabel(board,"DC IN",-3.05,.49,1.41,.82,21,"#dceee8"));
  // Header rows are visually grouped for readability; they are not a verified pin map.
  const headers = [
    [-1.68,2.36,8,"D0–D7"],
    [1.25,2.36,8,"D8–D13"],
    [-1.36,-2.36,8,"POWER"],
    [1.72,-2.36,6,"A0–A5"],
  ];
  for (const [x,z,count,label] of headers) {
    const delta = .34;
    const left = x-(count-1)*delta/2;
    box(board,[count*delta+.15,.38,.55],plasticMat,[x,.67,z]);
    for (let i=0;i<count;i++) {
      const p = left+i*delta;
      cylinder(board,.094,.094,.018,shared.collarMat,[p,.867,z],10);
      cylinder(board,.043,.043,.023,shared.socketMat,[p,.88,z],9);
    }
    fineDetail(canvasLabel(board,label,x,.49,z>0?2.02:-2.02,1.18,18,"#d8eee7"));
  }
  fineDetail(canvasLabel(board,"DIGITAL HEADER · VISUAL",-.90,.485,2.02,2.55,20,"#d8eee7"));
  fineDetail(canvasLabel(board,"POWER / ANALOG HEADER · VISUAL",.68,.485,-2.02,2.80,19,"#d8eee7"));
  fineDetail(canvasLabel(board,"PWM ~ 3 · 5 · 6 · 9 · 10 · 11",-.70,.488,1.33,2.70,19,"#c5e6dd"));
  canvasLabel(board,"UNO  R3",1.85,.468,.62,2.45,52);
  canvasLabel(board,"DIGITAL   D0–D13",-.9,.48,1.58,2.3,29);
  canvasLabel(board,"ANALOG    A0–A5",.7,.48,-1.53,2.0,32);
  canvasLabel(board,"D0  D2  D4  D6  D8  D10  D12",-.95,.485,1.84,2.75,22);
  canvasLabel(board,"A0   A1   A2   A3   A4   A5",.72,.485,-1.78,2.25,23);
  canvasLabel(board,"5V · 3V3 · GND",2.54,.485,1.55,1.35,22);
  canvasLabel(board,"ARDUINO 3D",1.8,.468,-1.12,2.05,30);
  const reset=box(board,[.38,.14,.42],0x547a7d,[2.75,.56,.35]);
  reset.userData={kind:"reset-button-visual",physicalVerified:false};
  fineDetail(canvasLabel(board,"RESET",2.75,.49,.63,.72,23,"#dceee8"));
  const crystal=box(board,[.82,.12,.28],metallicMat,[1.20,.55,.22]);
  crystal.userData={kind:"crystal-visual",physicalVerified:false};
  fineDetail(canvasLabel(board,"16 MHz",1.20,.49,-.02,.76,20,"#dceee8"));
  fineDetail(canvasLabel(board,"VISUAL LABELS · KHÔNG PHẢI PIN MAP",.25,.49,-1.15,3.25,18,"#b9dbd2"));
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

function makeBreadboard(scene, shared) {
  const base = new T.Group();
  base.position.set(5.15,.01,0);
  base.userData={kind:"breadboard-visual",physicalVerified:false,breadboardHoleMapping:false};
  scene.add(base);
  box(base,[5.25,.33,5.03],0xffffff,[0,.3,0]);
  box(base,[4.55,.012,.18],0xe2e6e5,[0,.48,0]);
  for (let column=0;column<11;column++) {
    const x=-2.15+column*(4.30/10);
    for(const side of [-1,1]){
      for(let row=0;row<5;row++){
        const z=side*(.38+row*(1.36/4));
        const hole=fineDetail(cylinder(base,.037,.037,.014,shared.holeMat,[x,.476,z],8));
        hole.userData={...hole.userData,kind:"breadboard-visual-hole",breadboardHoleMapping:false};
      }
    }
  }
  for (const z of [-2.28,2.28]) {
    box(base,[4.76,.008,.035],z < 0?0xd77b65:0x65a9d5,[0,.492,z]);
    for(let i=0;i<12;i++){
      const x=-2.05+i*(4.1/11);
      const hole=fineDetail(cylinder(base,.032,.032,.012,shared.railHoleMat,[x,.482,z],7));
      hole.userData={...hole.userData,kind:"breadboard-rail-visual-hole",breadboardHoleMapping:false};
    }
  }
  fineDetail(canvasLabel(base,"RAIL VISUAL",0,.50,2.12,1.15,20,"#748b83"));
  fineDetail(canvasLabel(base,"NO VERIFIED HOLE MAP",0,.50,-2.10,1.75,19,"#748b83"));
  canvasLabel(base,"BREADBOARD",0,.51,-2.43,2.35,33,"#748b83");
  return base;
}

function createModule(scene, kind, shared) {
  const { metallicMat } = shared;
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
  const sharedMaterials = createSharedMaterials();
  const sharedMaterialSet = new Set(Object.values(sharedMaterials));
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
  let theta=.45,phi=.88,zoom=1,raf=0,disposed=false,contextLost=false,moved=false,drag=null;
  let activeModule=null,activeWiringLayer=null,board=null,breadboard=null,renderer,currentLessonId=null;
  let activeLabLayer=null,activeLabLayout=null,lastWiringModel=null,selectedLabComponentId=null;
  let inspectedLabTerminalId=null,inspectedLabTerminalMode="none",inspectionBadge=null;
  let pendingWireTerminalId=null,pendingWireHoverTerminalId=null,pendingWirePreviewLine=null;
  let focusedLabComponentId=null,currentLod="full",rendererPixelRatio=1,fineDetailCount=0;
  let labWireLayer=null;
  let lodInitialized=false,lastViewportWidth=0,lastViewportHeight=0;
  const labComponents=new Map(),labTerminals=new Map(),labWireObjects=[],labPickables=[];
  let labEdit={enabled:false,onSelectComponent:null,onMoveComponent:null,onTerminalSelect:null};
  const raycaster=new T.Raycaster(),pointerNdc=new T.Vector2(),dragPlane=new T.Plane(new T.Vector3(0,1,0),0);
  const minZoom=.42,maxZoom=2.25;

  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.28;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=T.PCFSoftShadowMap;
    renderer.domElement.setAttribute("role","application");
    renderer.domElement.setAttribute("aria-keyshortcuts","ArrowLeft ArrowRight ArrowUp ArrowDown Home Enter Space");
    renderer.domElement.setAttribute("aria-label",BASE_SCENE_ARIA);
    renderer.domElement.tabIndex=0;
    host.replaceChildren(renderer.domElement);
  } catch(error) {
    disposeTree(ground);
    sharedMaterialSet.forEach(item => item.dispose());
    throw new Error("Trình duyệt không tạo được WebGL: " + (error?.message || "Không rõ nguyên nhân"));
  }
  board=makeBoard(scene,sharedMaterials);breadboard=makeBreadboard(scene,sharedMaterials);
  const defaultPosition=()=>{theta=.48;phi=.94;zoom=1;};
  function labCameraTarget(){
    if(activeLabLayout&&focusedLabComponentId){
      const entry=labComponents.get(focusedLabComponentId);
      if(entry){
        return new T.Vector3(
          entry.x*LAB_WORLD_SCALE,
          Math.max(.35,labComponentHeight(entry.component.visualKind)*.48),
          entry.z*LAB_WORLD_SCALE
        );
      }
    }
    if(activeLabLayout){
      return new T.Vector3(
        ((activeLabLayout.bounds.minX+activeLabLayout.bounds.maxX)/2)*LAB_WORLD_SCALE,
        .35,
        ((activeLabLayout.bounds.minZ+activeLabLayout.bounds.maxZ)/2)*LAB_WORLD_SCALE
      );
    }
    return new T.Vector3(1.15,.35,0);
  }
  function updateCamera() {
    // At portrait widths the same fixed camera distance clips the board and
    // breadboard. Fit the full lab first, then apply the learner's zoom.
    const fitted = Math.max(16.7, 18.5 /
      (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.max(.45, camera.aspect)));
    const radius = Math.min(48, Math.max(8, fitted * zoom));
    camera.position.set(radius*Math.sin(phi)*Math.sin(theta),radius*Math.cos(phi)+5,radius*Math.sin(phi)*Math.cos(theta));
    camera.lookAt(labCameraTarget());
  }
  function draw(){raf=0;if(disposed||contextLost||document.hidden)return;updateCamera();renderer.render(scene,camera);}
  function invalidate(){if(!raf && !disposed && !contextLost && !document.hidden) raf=requestAnimationFrame(draw);}
  function applySceneLod(w,h,force=false){
    const nextLod=(w<SCENE_LOD_BREAKPOINT||h<340)?"reduced":"full";
    const lodChanged=!lodInitialized||nextLod!==currentLod;
    currentLod=nextLod;
    const nextPixelRatio=Math.min(window.devicePixelRatio||1,nextLod==="reduced"?1.25:1.7);
    if(Math.abs(nextPixelRatio-rendererPixelRatio)>1e-6){
      rendererPixelRatio=nextPixelRatio;
      renderer.setPixelRatio(rendererPixelRatio);
    }
    renderer.shadowMap.enabled=nextLod==="full";
    sun.castShadow=nextLod==="full";
    if(force||lodChanged){
      fineDetailCount=0;
      scene.traverse(child=>{
        if(child?.userData?.sceneDetail!=="fine")return;
        fineDetailCount+=1;
        child.visible=nextLod==="full";
      });
    }
    lodInitialized=true;
    if(renderer.domElement){
      renderer.domElement.dataset.sceneQuality=SCENE_QUALITY_PROFILE;
      renderer.domElement.dataset.sceneLod=nextLod;
      renderer.domElement.dataset.scenePixelRatio=String(rendererPixelRatio);
      renderer.domElement.dataset.sceneFineDetailCount=String(fineDetailCount);
      renderer.domElement.dataset.scenePhysicalMap="none";
    }
  }
  function resize(force=false){
    if(disposed||contextLost)return;
    const forceResize=force===true;
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
    const sizeChanged=forceResize||w!==lastViewportWidth||h!==lastViewportHeight;
    if(sizeChanged){
      lastViewportWidth=w;lastViewportHeight=h;
      camera.aspect=w/h;camera.updateProjectionMatrix();
    }
    applySceneLod(w,h,forceResize);
    if(sizeChanged)renderer.setSize(w,h,false);
    invalidate();
  }
  const observer = new ResizeObserver(resize);observer.observe(host);
  const canvas=renderer.domElement;
  canvas.dataset.sceneContext="ready";
  const baseShortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home Enter Space";
  function updateInspectionBadge(){
    const show=inspectedLabTerminalMode==="read-only-label"&&inspectedLabTerminalId!==null;
    if(show&&!inspectionBadge){
      inspectionBadge=document.createElement("div");
      inspectionBadge.dataset.sceneInspectionBadge="read-only";
      inspectionBadge.setAttribute("aria-hidden","true");
      inspectionBadge.style.cssText=[
        "position:absolute","left:14px","bottom:56px","z-index:3","pointer-events:none",
        "max-width:min(78%,360px)","padding:7px 10px","border:1px solid rgba(98,116,217,.58)",
        "border-radius:8px","background:rgba(20,37,42,.88)","color:#eef1ff",
        "font:700 12px/1.35 system-ui,sans-serif","letter-spacing:.02em",
        "box-shadow:0 4px 14px rgba(0,0,0,.20)",
      ].join(";");
      host.append(inspectionBadge);
    }
    if(inspectionBadge){
      inspectionBadge.hidden=!show;
      inspectionBadge.textContent=show
        ? `Đang xem terminal: ${inspectedLabTerminalId} · nhãn read-only`
        : "";
    }
  }
  function refreshCanvasAccessibility() {
    const parts=[BASE_SCENE_ARIA];
    if(canvas.dataset.wiringMode && canvas.dataset.wiringMode!=="none")parts.push(CONCEPTUAL_WIRING_ARIA);
    if(activeLabLayout)parts.push("Bố trí component và terminal dùng tọa độ khái niệm, không phải vị trí lỗ breadboard được xác minh.");
    if(labEdit.enabled)parts.push(LAB_EDIT_ARIA);
    if(inspectedLabTerminalId){
      parts.push(`Terminal đang xem: ${inspectedLabTerminalId}. Đây là trạng thái đọc-only từ Inspector, không tạo kết nối hoặc xác nhận vị trí vật lý.`);
    }
    if(pendingWireTerminalId){
      parts.push(`Terminal đầu đang chờ nối: ${pendingWireTerminalId}. Đây chỉ là xem trước trực quan; chưa tạo dây hoặc kết nối điện.`);
    }
    canvas.setAttribute("aria-label",parts.join(" "));
    canvas.setAttribute("aria-keyshortcuts",labEdit.enabled
      ? baseShortcuts+" W A S D Q E Escape"
      : baseShortcuts);
  }
  function resetWiringMetadata() {
    canvas.dataset.wiringMode="none";
    canvas.dataset.wiringWireCount="0";
    canvas.dataset.wiringNetCount="0";
    canvas.dataset.wiringStatus="none";
    canvas.dataset.wiringPhysicalMap="none";
    canvas.removeAttribute("title");
    refreshCanvasAccessibility();
  }
  function resetLabMetadata(){
    canvas.dataset.labLayoutMode="none";
    canvas.dataset.labComponentCount="0";
    canvas.dataset.labTerminalCount="0";
    canvas.dataset.labWireCount="0";
    canvas.dataset.labFocusedComponent="";
    canvas.dataset.labPhysicalVerified="false";
    canvas.dataset.labBreadboardHoleMapping="false";
    canvas.dataset.labElectricalPower="false";
    canvas.dataset.labSelectedComponent="";
    canvas.dataset.labEdit=labEdit.enabled?"on":"off";
    canvas.dataset.labSelectionFeedback="none";
    canvas.dataset.labFocusFeedback="none";
    canvas.dataset.labTerminalFeedback="base";
    canvas.dataset.labTerminalHighlightCount="0";
    canvas.dataset.labInspectedTerminal="";
    canvas.dataset.labInspectionFeedback="none";
    canvas.dataset.labPendingWireTerminal="";
    canvas.dataset.labPendingWireHoverTerminal="";
    canvas.dataset.labPendingWirePreview="none";
    updateInspectionBadge();
  }
  resetLabMetadata();
  resetWiringMetadata();
  function clearLabWireLayer(){
    if(labWireLayer){
      activeLabLayer?.remove(labWireLayer);
      disposeTree(labWireLayer);
      labWireLayer=null;
    }
    labWireObjects.length=0;
    canvas.dataset.labWireCount="0";
  }
  function updateLabWireGeometry(){
    if(!labWireObjects.length)return;
    scene.updateMatrixWorld(true);
    for(const item of labWireObjects){
      const from=labTerminals.get(item.from)?.marker;
      const to=labTerminals.get(item.to)?.marker;
      if(!from||!to)continue;
      const start=new T.Vector3(),end=new T.Vector3();
      from.getWorldPosition(start);to.getWorldPosition(end);
      const mid=start.clone().lerp(end,.5);
      mid.y=Math.max(start.y,end.y)+.32;
      const position=item.line.geometry.getAttribute("position");
      position.setXYZ(0,start.x,start.y,start.z);
      position.setXYZ(1,mid.x,mid.y,mid.z);
      position.setXYZ(2,end.x,end.y,end.z);
      position.needsUpdate=true;
      item.line.geometry.computeBoundingSphere();
    }
  }
  function refreshLabWireLayer(){
    clearLabWireLayer();
    if(!activeLabLayer||!activeLabLayout||!lastWiringModel?.wires?.length)return;
    labWireLayer=new T.Group();
    labWireLayer.userData={kind:"lab-conceptual-wires",physicalLocation:false,physicalVerified:false};
    activeLabLayer.add(labWireLayer);
    for(const wire of lastWiringModel.wires){
      if(!labTerminals.has(wire.from)||!labTerminals.has(wire.to))continue;
      const geometry=new T.BufferGeometry();
      geometry.setAttribute("position",new T.Float32BufferAttribute(9,3));
      const line=new T.Line(geometry,new T.LineBasicMaterial({
        color:WIRING_COLORS[wire.status]??WIRING_COLORS.unverified,
        transparent:true,opacity:.94
      }));
      line.userData={
        kind:"lab-conceptual-wire",wireId:wire.id,from:wire.from,to:wire.to,
        netId:wire.netId,status:wire.status,physicalLocation:false,physicalVerified:false,
      };
      labWireLayer.add(line);
      labWireObjects.push({line,from:wire.from,to:wire.to});
    }
    updateLabWireGeometry();
    canvas.dataset.labWireCount=String(labWireObjects.length);
  }
  function canonicalLabComponent(componentId){
    return activeLabLayout?.components?.find(item=>item.id===componentId)||null;
  }
  function clearPendingWireHover(redraw=false){
    const changed=pendingWireHoverTerminalId!==null||pendingWirePreviewLine?.visible===true||
      canvas.dataset.labPendingWirePreview==="ghost";
    pendingWireHoverTerminalId=null;
    if(pendingWirePreviewLine)pendingWirePreviewLine.visible=false;
    canvas.dataset.labPendingWireHoverTerminal="";
    canvas.dataset.labPendingWirePreview="none";
    if(redraw&&changed)invalidate();
  }
  function clearPendingWireState(redraw=false){
    pendingWireTerminalId=null;
    clearPendingWireHover(false);
    canvas.dataset.labPendingWireTerminal="";
    if(redraw){
      refreshLabInteractionFeedback();
      refreshCanvasAccessibility();
      invalidate();
    }
  }
  function ensurePendingWirePreviewLine(){
    if(pendingWirePreviewLine||!activeLabLayer)return pendingWirePreviewLine;
    const geometry=new T.BufferGeometry();
    geometry.setAttribute("position",new T.Float32BufferAttribute(9,3));
    pendingWirePreviewLine=new T.Line(geometry,sharedMaterials.pendingWireLineMat);
    pendingWirePreviewLine.visible=false;
    pendingWirePreviewLine.userData={
      kind:"lab-pending-wire-preview",committed:false,
      physicalLocation:false,physicalVerified:false,electricalState:false,
    };
    activeLabLayer.add(pendingWirePreviewLine);
    return pendingWirePreviewLine;
  }
  function updatePendingWirePreviewGeometry(){
    if(!pendingWirePreviewLine||!pendingWireTerminalId||!pendingWireHoverTerminalId)return;
    const from=labTerminals.get(pendingWireTerminalId)?.marker;
    const to=labTerminals.get(pendingWireHoverTerminalId)?.marker;
    if(!from||!to){clearPendingWireHover(false);return;}
    scene.updateMatrixWorld(true);
    const start=new T.Vector3(),end=new T.Vector3();
    from.getWorldPosition(start);to.getWorldPosition(end);
    const mid=start.clone().lerp(end,.5);
    mid.y=Math.max(start.y,end.y)+.20;
    const position=pendingWirePreviewLine.geometry.getAttribute("position");
    position.setXYZ(0,start.x,start.y,start.z);
    position.setXYZ(1,mid.x,mid.y,mid.z);
    position.setXYZ(2,end.x,end.y,end.z);
    position.needsUpdate=true;
    pendingWirePreviewLine.geometry.computeBoundingSphere();
  }
  function refreshLabInteractionFeedback(){
    let highlightedTerminals=0;
    for(const [id,entry] of labComponents){
      entry.selection.visible=id===selectedLabComponentId;
      if(entry.focus)entry.focus.visible=id===focusedLabComponentId;
    }
    const haloInspection=inspectedLabTerminalMode==="lab-halo"&&
      inspectedLabTerminalId!==null&&labTerminals.has(inspectedLabTerminalId);
    if(inspectedLabTerminalMode==="lab-halo"&&!haloInspection){
      inspectedLabTerminalId=null;
      inspectedLabTerminalMode="none";
    }
    for(const [terminalId,item] of labTerminals){
      const highlighted=labEdit.enabled&&item.componentId===selectedLabComponentId;
      const inspected=haloInspection&&terminalId===inspectedLabTerminalId;
      const pending=labEdit.enabled&&terminalId===pendingWireTerminalId;
      if(item.halo)item.halo.visible=highlighted;
      if(item.inspectionHalo)item.inspectionHalo.visible=inspected;
      if(item.pendingHalo)item.pendingHalo.visible=pending;
      item.marker.scale.setScalar(pending?1.42:inspected?1.32:highlighted?1.18:1);
      if(highlighted)highlightedTerminals+=1;
    }
    canvas.dataset.labSelectionFeedback=selectedLabComponentId?"outline":"none";
    canvas.dataset.labFocusFeedback=focusedLabComponentId?"outline":"none";
    canvas.dataset.labTerminalFeedback=highlightedTerminals?"selected-component":"base";
    canvas.dataset.labTerminalHighlightCount=String(highlightedTerminals);
    canvas.dataset.labInspectedTerminal=inspectedLabTerminalId||"";
    canvas.dataset.labInspectionFeedback=inspectedLabTerminalMode==="lab-halo"
      ? "highlight" : inspectedLabTerminalMode==="read-only-label" ? "label" : "none";
    canvas.dataset.labPendingWireTerminal=pendingWireTerminalId||"";
    updateInspectionBadge();
  }
  function setLabVisualTransform(entry,x,z,quarterTurns){
    entry.x=x;entry.z=z;entry.quarterTurns=((quarterTurns%4)+4)%4;
    entry.root.position.set(x*LAB_WORLD_SCALE,0,z*LAB_WORLD_SCALE);
    entry.root.rotation.y=-entry.quarterTurns*Math.PI/2;
    updateLabWireGeometry();
    updatePendingWirePreviewGeometry();
    invalidate();
  }
  function restoreLabComponent(componentId){
    const entry=labComponents.get(componentId),component=canonicalLabComponent(componentId);
    if(entry&&component)setLabVisualTransform(entry,component.x,component.z,component.quarterTurns);
  }
  function selectLabComponent(componentId,source="api",emit=false){
    if(componentId!==null&&!labComponents.has(componentId))throw new RangeError("Không có component trong lab layout: "+componentId);
    selectedLabComponentId=componentId;
    canvas.dataset.labSelectedComponent=componentId||"";
    refreshLabInteractionFeedback();
    if(emit&&labEdit.onSelectComponent){
      const component=componentId===null?null:canonicalLabComponent(componentId);
      labEdit.onSelectComponent(componentId,Object.freeze({
        component,
        source,
        action:componentId===null?"deselect":"select",
        physicalVerified:false
      }));
    }
    invalidate();
  }
  function clearLabLayout(redraw=true){
    const hadFocus=focusedLabComponentId!==null;
    clearLabWireLayer();
    if(activeLabLayer){
      scene.remove(activeLabLayer);
      disposeTree(activeLabLayer,sharedMaterialSet);
      activeLabLayer=null;
    }
    activeLabLayout=null;
    labComponents.clear();labTerminals.clear();labPickables.length=0;selectedLabComponentId=null;focusedLabComponentId=null;
    inspectedLabTerminalId=null;inspectedLabTerminalMode="none";
    clearPendingWireState(false);pendingWirePreviewLine=null;
    if(hadFocus)zoom=1;
    if(board?.board)board.board.visible=true;
    if(breadboard)breadboard.visible=true;
    if(activeModule?.module)activeModule.module.visible=true;
    if(activeWiringLayer)activeWiringLayer.visible=true;
    resetLabMetadata();
    refreshCanvasAccessibility();
    if(redraw&&!contextLost){
      applySceneLod(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),true);
    }
    if(redraw)invalidate();
    return Object.freeze({mode:"none",componentCount:0,terminalCount:0,physicalVerified:false});
  }
  function labBoundsSummary(layout){
    return Object.freeze({
      minX:layout.bounds.minX*LAB_WORLD_SCALE,
      maxX:layout.bounds.maxX*LAB_WORLD_SCALE,
      minZ:layout.bounds.minZ*LAB_WORLD_SCALE,
      maxZ:layout.bounds.maxZ*LAB_WORLD_SCALE,
    });
  }
  function getLabViewState(){
    const target=labCameraTarget();
    const claims=Object.freeze({
      physicalVerified:false,
      breadboardHoleMapping:false,
      electricalPower:false,
    });
    const cameraState=Object.freeze({
      theta,phi,zoom,
      targetX:target.x,targetY:target.y,targetZ:target.z,
    });
    return Object.freeze({
      viewVersion:1,
      qualityProfile:SCENE_QUALITY_PROFILE,
      mode:activeLabLayout?"conceptual-layout":"legacy",
      disposed,
      lessonId:Number.isFinite(currentLessonId)?currentLessonId:null,
      focusedComponentId:focusedLabComponentId,
      selectedComponentId:selectedLabComponentId,
      editEnabled:labEdit.enabled,
      lod:currentLod,
      camera:cameraState,
      worldScale:LAB_WORLD_SCALE,
      worldBounds:activeLabLayout?labBoundsSummary(activeLabLayout):null,
      renderer:Object.freeze({
        pixelRatio:rendererPixelRatio,
        shadows:renderer?.shadowMap?.enabled===true,
        fineDetailCount,
      }),
      claims,
    });
  }
  function focusLabComponent(componentId){
    if(componentId!==null&&(typeof componentId!=="string"||!componentId)){
      throw new TypeError("componentId focus phải là chuỗi không rỗng hoặc null");
    }
    if(componentId===null){
      focusedLabComponentId=null;
      zoom=1;
      canvas.dataset.labFocusedComponent="";
      refreshLabInteractionFeedback();
      invalidate();
      return getLabViewState();
    }
    if(!activeLabLayout)throw new RangeError("Không có lab layout để focus component");
    const entry=labComponents.get(componentId);
    if(!entry)throw new RangeError("Không có component trong lab layout: "+componentId);
    focusedLabComponentId=componentId;
    const logicalSpan=Math.max(entry.component.width,entry.component.depth);
    zoom=Math.max(.42,Math.min(.58,.40+logicalSpan*.02));
    canvas.dataset.labFocusedComponent=componentId;
    refreshLabInteractionFeedback();
    invalidate();
    return getLabViewState();
  }
  function setInspectedTerminal(terminalId,layout=null){
    if(disposed)return Object.freeze({terminalId:null,active:false,mode:"none",physicalVerified:false});
    if(terminalId===null){
      inspectedLabTerminalId=null;
      inspectedLabTerminalMode="none";
      refreshLabInteractionFeedback();
      refreshCanvasAccessibility();
      invalidate();
      return Object.freeze({terminalId:null,active:false,mode:"none",physicalVerified:false});
    }
    if(typeof terminalId!=="string"||!terminalId||terminalId.trim()!==terminalId){
      throw new TypeError("terminalId inspection phải là ID canonical không rỗng hoặc null");
    }
    if(terminalId.length>80)throw new RangeError("terminalId inspection vượt giới hạn 80 ký tự");
    let nextMode="none";
    if(activeLabLayout){
      if(!labTerminals.has(terminalId)){
        throw new RangeError("Terminal không thuộc lab layout bài học đang hiển thị: "+terminalId);
      }
      nextMode="lab-halo";
    }else{
      if(!layout)throw new RangeError("Không có lab layout canonical để xác minh terminal inspection");
      const validation=validateLabLayout(layout,layout?.terminals);
      if(!validation.ok){
        throw new RangeError("Lab layout inspection không hợp lệ: "+validation.errors.join("; "));
      }
      if(currentLessonId!==null&&Number.isFinite(currentLessonId)&&layout.lessonId!==currentLessonId){
        throw new RangeError("Lab layout inspection không thuộc bài học đang hiển thị");
      }
      if(!layout.terminals.some(item=>item?.id===terminalId)){
        throw new RangeError("Terminal không thuộc lab layout inspection: "+terminalId);
      }
      nextMode="read-only-label";
    }
    inspectedLabTerminalId=terminalId;
    inspectedLabTerminalMode=nextMode;
    refreshLabInteractionFeedback();
    refreshCanvasAccessibility();
    invalidate();
    return Object.freeze({
      terminalId:inspectedLabTerminalId,
      active:inspectedLabTerminalId!==null,
      mode:inspectedLabTerminalMode,
      physicalVerified:false,
    });
  }
  function setPendingWireTerminal(terminalId){
    if(disposed)return Object.freeze({terminalId:null,active:false,mode:"none",physicalVerified:false});
    if(terminalId===null){
      clearPendingWireState(false);
      refreshLabInteractionFeedback();
      refreshCanvasAccessibility();
      invalidate();
      return Object.freeze({terminalId:null,active:false,mode:"none",physicalVerified:false});
    }
    if(typeof terminalId!=="string"||!terminalId||terminalId.trim()!==terminalId){
      throw new TypeError("terminalId pending-wire phải là ID canonical không rỗng hoặc null");
    }
    if(terminalId.length>80)throw new RangeError("terminalId pending-wire vượt giới hạn 80 ký tự");
    if(!labEdit.enabled||!activeLabLayout){
      throw new RangeError("Pending-wire preview chỉ khả dụng trong edit lab layout đang mount");
    }
    if(!labTerminals.has(terminalId)){
      throw new RangeError("Terminal pending-wire không thuộc lab layout đang chỉnh sửa: "+terminalId);
    }
    pendingWireTerminalId=terminalId;
    clearPendingWireHover(false);
    refreshLabInteractionFeedback();
    refreshCanvasAccessibility();
    invalidate();
    return Object.freeze({
      terminalId:pendingWireTerminalId,
      active:true,
      mode:"first-terminal-preview",
      physicalVerified:false,
    });
  }
  function setLabLayout(layout){
    if(disposed)return Object.freeze({mode:"none",componentCount:0,terminalCount:0,physicalVerified:false});
    if(layout==null)return clearLabLayout(true);
    const validation=validateLabLayout(layout,layout?.terminals);
    if(!validation.ok)throw new RangeError("Lab layout 3D không hợp lệ: "+validation.errors.join("; "));
    if(currentLessonId!==null&&Number.isFinite(currentLessonId)&&layout.lessonId!==currentLessonId){
      throw new RangeError("Lab layout 3D không thuộc bài học đang hiển thị");
    }
    const previousSelection=selectedLabComponentId;
    const previousFocus=focusedLabComponentId;
    const previousZoom=zoom;
    clearLabLayout(false);
    activeLabLayout=layout;
    activeLabLayer=new T.Group();
    activeLabLayer.userData={
      kind:"conceptual-lab-layout",lessonId:layout.lessonId,units:layout.units,
      physicalVerified:false,breadboardHoleMapping:false,electricalPower:false,
    };
    scene.add(activeLabLayer);
    const boundaryWidth=(layout.bounds.maxX-layout.bounds.minX)*LAB_WORLD_SCALE;
    const boundaryDepth=(layout.bounds.maxZ-layout.bounds.minZ)*LAB_WORLD_SCALE;
    const boundary=box(
      activeLabLayer,[boundaryWidth,.025,boundaryDepth],0xf4f8f4,[0,.005,0],
      {transparent:true,opacity:.42}
    );
    boundary.userData={kind:"lab-logical-ground",physicalLocation:false,physicalVerified:false};
    canvasLabel(
      activeLabLayer,LAB_LAYOUT_NOTICE,0,.04,
      layout.bounds.minZ*LAB_WORLD_SCALE+.26,5.6,25,"#496b64"
    );
    for(const component of layout.components){
      const root=new T.Group();
      root.userData={
        kind:"lab-component",componentId:component.id,visualKind:component.visualKind,
        fixed:component.fixed,physicalLocation:false,physicalVerified:false,
      };
      activeLabLayer.add(root);
      const visual=makeLabGenericVisual(root,component,sharedMaterials);
      const selection=labSelectionFrame(
        root,component.width*LAB_WORLD_SCALE,component.depth*LAB_WORLD_SCALE,component.id,sharedMaterials
      );
      const focus=labFocusFrame(
        root,component.width*LAB_WORLD_SCALE,component.depth*LAB_WORLD_SCALE,component.id,sharedMaterials
      );
      const hit=labHitProxy(
        root,component.width*LAB_WORLD_SCALE,component.depth*LAB_WORLD_SCALE,visual.height,component.id,sharedMaterials
      );
      const entry={
        component,root,selection,focus,hit,
        x:component.x,z:component.z,quarterTurns:component.quarterTurns
      };
      labComponents.set(component.id,entry);
      labPickables.push(hit);
      for(const terminalId of component.terminalIds){
        const anchor=labTerminalAnchor(layout,terminalId);
        const localRotated={x:anchor.x-component.x,z:anchor.z-component.z};
        const local=unrotateLabVector(
          localRotated.x,localRotated.z,component.quarterTurns
        );
        const marker=new T.Mesh(
          new T.CylinderGeometry(.075,.075,.13,12),
          sharedMaterials.terminalMat,
        );
        marker.position.set(
          local.x*LAB_WORLD_SCALE,visual.height+.10,local.z*LAB_WORLD_SCALE
        );
        marker.userData={
          kind:"lab-terminal-marker",terminalId,componentId:component.id,
          terminalKind:anchor.kind,polarity:anchor.polarity,
          physicalLocation:false,physicalVerified:false,
        };
        root.add(marker);
        const halo=new T.Mesh(
          new T.RingGeometry(.10,.17,20),
          sharedMaterials.terminalHaloMat,
        );
        halo.rotation.x=-Math.PI/2;
        halo.position.set(marker.position.x,marker.position.y+.075,marker.position.z);
        halo.visible=false;
        halo.userData={
          kind:"lab-terminal-affordance",terminalId,componentId:component.id,
          physicalLocation:false,physicalVerified:false,
        };
        root.add(halo);
        const inspectionHalo=new T.Mesh(
          new T.RingGeometry(.19,.28,24),
          sharedMaterials.inspectionTerminalHaloMat,
        );
        inspectionHalo.rotation.x=-Math.PI/2;
        inspectionHalo.position.set(marker.position.x,marker.position.y+.082,marker.position.z);
        inspectionHalo.visible=false;
        inspectionHalo.userData={
          kind:"lab-terminal-inspection-affordance",terminalId,componentId:component.id,
          physicalLocation:false,physicalVerified:false,readOnly:true,
        };
        root.add(inspectionHalo);
        const pendingHalo=new T.Mesh(
          new T.RingGeometry(.13,.22,24),
          sharedMaterials.pendingTerminalHaloMat,
        );
        pendingHalo.rotation.x=-Math.PI/2;
        pendingHalo.position.set(marker.position.x,marker.position.y+.088,marker.position.z);
        pendingHalo.visible=false;
        pendingHalo.userData={
          kind:"lab-terminal-pending-wire-affordance",terminalId,componentId:component.id,
          committed:false,physicalLocation:false,physicalVerified:false,electricalState:false,
        };
        root.add(pendingHalo);
        const terminalHit=new T.Mesh(
          new T.SphereGeometry(LAB_TERMINAL_HIT_RADIUS,10,8),
          sharedMaterials.hitMat,
        );
        terminalHit.position.copy(marker.position);
        terminalHit.userData={
          kind:"lab-terminal",terminalId,componentId:component.id,
          terminalKind:anchor.kind,polarity:anchor.polarity,
          physicalLocation:false,physicalVerified:false,
        };
        root.add(terminalHit);
        labPickables.push(terminalHit);
        canvasLabel(
          root,terminalId.slice(0,22),
          marker.position.x,visual.height+.12,marker.position.z+.09,.72,23,"#355f4b"
        );
        labTerminals.set(terminalId,{marker,halo,inspectionHalo,pendingHalo,hit:terminalHit,componentId:component.id,anchor});
      }
      setLabVisualTransform(entry,component.x,component.z,component.quarterTurns);
    }
    if(board?.board)board.board.visible=false;
    if(breadboard)breadboard.visible=false;
    if(activeModule?.module)activeModule.module.visible=false;
    if(activeWiringLayer)activeWiringLayer.visible=false;
    refreshLabWireLayer();
    const nextSelection=previousSelection&&labComponents.has(previousSelection)
      ? previousSelection : null;
    selectLabComponent(nextSelection,"layout",false);
    if(previousFocus&&labComponents.has(previousFocus)){
      focusedLabComponentId=previousFocus;
      zoom=previousZoom;
      canvas.dataset.labFocusedComponent=previousFocus;
    }else{
      focusedLabComponentId=null;
      canvas.dataset.labFocusedComponent="";
    }
    refreshLabInteractionFeedback();
    canvas.dataset.labLayoutMode="conceptual-layout";
    canvas.dataset.labComponentCount=String(layout.components.length);
    canvas.dataset.labTerminalCount=String(layout.terminals.length);
    canvas.dataset.labPhysicalVerified="false";
    canvas.dataset.labBreadboardHoleMapping="false";
    canvas.dataset.labElectricalPower="false";
    applySceneLod(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),true);
    refreshCanvasAccessibility();
    invalidate();
    return Object.freeze({
      mode:"conceptual-layout",lessonId:layout.lessonId,units:layout.units,
      componentCount:layout.components.length,terminalCount:layout.terminals.length,
      worldScale:LAB_WORLD_SCALE,worldBounds:labBoundsSummary(layout),
      anchorModel:"conceptual-perimeter",physicalVerified:false,
      breadboardHoleMapping:false,electricalPower:false,
    });
  }
  function validateLabEditCallback(value,label){
    if(value!==undefined&&value!==null&&typeof value!=="function"){
      throw new TypeError(label+" phải là function hoặc null");
    }
  }
  function setLabEdit(options={}){
    if(disposed)return Object.freeze({enabled:false,selectedComponentId:null});
    if(!options||typeof options!=="object"||Array.isArray(options)){
      throw new TypeError("Lab edit options phải là object");
    }
    validateLabEditCallback(options.onSelectComponent,"onSelectComponent");
    validateLabEditCallback(options.onMoveComponent,"onMoveComponent");
    validateLabEditCallback(options.onTerminalSelect,"onTerminalSelect");
    const hasSelected=Object.prototype.hasOwnProperty.call(options,"selectedComponentId");
    const requestedSelected=hasSelected
      ? (options.selectedComponentId==null?null:String(options.selectedComponentId))
      : undefined;
    if(hasSelected&&requestedSelected!==null&&!labComponents.has(requestedSelected)){
      throw new RangeError("Không có component trong lab layout: "+requestedSelected);
    }
    const nextEditEnabled=Boolean(options.enabled);
    const editTransition=nextEditEnabled!==labEdit.enabled;
    labEdit={
      enabled:nextEditEnabled,
      onSelectComponent:options.onSelectComponent===undefined
        ? labEdit.onSelectComponent : options.onSelectComponent,
      onMoveComponent:options.onMoveComponent===undefined
        ? labEdit.onMoveComponent : options.onMoveComponent,
      onTerminalSelect:options.onTerminalSelect===undefined
        ? labEdit.onTerminalSelect : options.onTerminalSelect,
    };
    if(editTransition){
      inspectedLabTerminalId=null;inspectedLabTerminalMode="none";
      clearPendingWireState(false);
    }
    canvas.dataset.labEdit=labEdit.enabled?"on":"off";
    canvas.style.touchAction=labEdit.enabled?"none":"";
    canvas.style.cursor=labEdit.enabled?"grab":"";
    if(hasSelected){
      selectLabComponent(requestedSelected,"api",false);
    }else if(!labEdit.enabled){
      if(selectedLabComponentId)restoreLabComponent(selectedLabComponentId);
      selectLabComponent(null,"api",false);
    }
    refreshLabInteractionFeedback();
    refreshCanvasAccessibility();
    return Object.freeze({
      enabled:labEdit.enabled,
      selectedComponentId:selectedLabComponentId,
    });
  }
  function clampLabTarget(component,x,z,quarterTurns){
    const rotated=quarterTurns%2!==0;
    const width=rotated?component.depth:component.width;
    const depth=rotated?component.width:component.depth;
    const grid=activeLabLayout.grid;
    const snappedX=Math.round(x/grid)*grid;
    const snappedZ=Math.round(z/grid)*grid;
    return {
      x:Math.max(
        activeLabLayout.bounds.minX+width/2,
        Math.min(activeLabLayout.bounds.maxX-width/2,snappedX)
      ),
      z:Math.max(
        activeLabLayout.bounds.minZ+depth/2,
        Math.min(activeLabLayout.bounds.maxZ-depth/2,snappedZ)
      ),
    };
  }
  function emitLabMove(entry,kind,source,deltaQuarterTurns=0){
    labEdit.onMoveComponent?.(
      entry.component.id,entry.x,entry.z,Object.freeze({
      kind,source,
      x:entry.x,z:entry.z,quarterTurns:entry.quarterTurns,
      deltaQuarterTurns,physicalVerified:false,
    }));
  }
  function pointerRay(event){
    const rect=canvas.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return null;
    updateCamera();
    camera.updateMatrixWorld();
    pointerNdc.set(
      ((event.clientX-rect.left)/rect.width)*2-1,
      -((event.clientY-rect.top)/rect.height)*2+1
    );
    raycaster.setFromCamera(pointerNdc,camera);
    return raycaster.ray;
  }
  function labHit(event){
    if(!activeLabLayout)return null;
    if(!pointerRay(event))return null;
    scene.updateMatrixWorld(true);
    const hits=raycaster.intersectObjects(labPickables,false);
    if(!hits.length)return null;
    const terminal=hits.find(hit=>hit.object.userData.kind==="lab-terminal");
    return terminal||hits[0];
  }
  function updatePendingWireHover(event){
    if(!pendingWireTerminalId||!labEdit.enabled||!activeLabLayout){
      clearPendingWireHover(true);
      return;
    }
    const hit=labHit(event);
    const targetId=hit?.object?.userData?.kind==="lab-terminal"
      ? hit.object.userData.terminalId : null;
    if(!targetId||targetId===pendingWireTerminalId||!labTerminals.has(targetId)){
      clearPendingWireHover(true);
      return;
    }
    pendingWireHoverTerminalId=targetId;
    const line=ensurePendingWirePreviewLine();
    if(!line){clearPendingWireHover(true);return;}
    updatePendingWirePreviewGeometry();
    line.visible=true;
    canvas.dataset.labPendingWireHoverTerminal=targetId;
    canvas.dataset.labPendingWirePreview="ghost";
    invalidate();
  }
  function labGroundPoint(event){
    const ray=pointerRay(event);
    if(!ray)return null;
    const result=new T.Vector3();
    return ray.intersectPlane(dragPlane,result)?result:null;
  }
  function pointerTapThreshold(pointerType){
    if(pointerType==="touch")return LAB_TOUCH_TAP_THRESHOLD;
    if(pointerType==="pen")return 7;
    return 4;
  }
  function pointerDragBase(event,extra={}){
    return {
      x:event.clientX,
      y:event.clientY,
      startClientX:event.clientX,
      startClientY:event.clientY,
      pointerId:event.pointerId,
      pointerType:event.pointerType||"mouse",
      tapThreshold:pointerTapThreshold(event.pointerType||"mouse"),
      ...extra,
    };
  }
  function restorePointerSelection(pointerState){
    const previous=pointerState?.previousSelectionId??null;
    if(previous===null||labComponents.has(previous)){
      selectLabComponent(previous,"pointer-cancel",false);
    }
  }
  function clearWiringLayer(redraw=true) {
    if(activeWiringLayer){scene.remove(activeWiringLayer);disposeTree(activeWiringLayer);activeWiringLayer=null;}
    lastWiringModel=null;
    clearLabWireLayer();
    resetWiringMetadata();
    if(redraw)invalidate();
    return {mode:"none",shownWires:0,omittedWires:0,netCount:0,status:"none",analysisSupported:false,physicalMapping:"none"};
  }
  function down(event){
    if(event.button!==0||drag)return;
    clearPendingWireHover(false);
    moved=false;
    if(labEdit.enabled&&activeLabLayout){
      const hit=labHit(event);
      if(hit?.object?.userData?.kind==="lab-terminal"){
        const terminalId=hit.object.userData.terminalId;
        const componentId=hit.object.userData.componentId;
        const previousSelectionId=selectedLabComponentId;
        selectLabComponent(componentId,"pointer-preview",false);
        drag=pointerDragBase(event,{
          kind:"terminal",terminalId,componentId,previousSelectionId
        });
        try{canvas.setPointerCapture?.(event.pointerId);}catch{}
        return;
      }
      if(hit?.object?.userData?.kind==="lab-component-hit"){
        const componentId=hit.object.userData.componentId;
        const entry=labComponents.get(componentId);
        const previousSelectionId=selectedLabComponentId;
        selectLabComponent(componentId,"pointer-preview",false);
        const point=!entry?.component.fixed?labGroundPoint(event):null;
        drag=pointerDragBase(event,{
          kind:entry?.component.fixed?"lab-fixed":"lab-component",
          componentId,previousSelectionId,
          startX:entry?.x,startZ:entry?.z,
          grabDx:point&&entry?entry.x-point.x/LAB_WORLD_SCALE:0,
          grabDz:point&&entry?entry.z-point.z/LAB_WORLD_SCALE:0,
        });
        try{canvas.setPointerCapture?.(event.pointerId);}catch{}
        return;
      }
    }
    drag=pointerDragBase(event,{
      kind:"camera",
      legacySelect:!labEdit.enabled,
      labBackground:labEdit.enabled&&Boolean(activeLabLayout),
    });
    try{canvas.setPointerCapture?.(event.pointerId);}catch{}
  }
  function move(event){
    if(!drag){
      updatePendingWireHover(event);
      return;
    }
    if(event.pointerId!==drag.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    const totalDx=event.clientX-drag.startClientX;
    const totalDy=event.clientY-drag.startClientY;
    if(!moved&&Math.hypot(totalDx,totalDy)>drag.tapThreshold)moved=true;
    if(drag.kind==="lab-component"){
      if(moved){
        event.preventDefault();
        const entry=labComponents.get(drag.componentId),point=labGroundPoint(event);
        if(entry&&point){
          const target=clampLabTarget(
            entry.component,
            point.x/LAB_WORLD_SCALE+drag.grabDx,
            point.z/LAB_WORLD_SCALE+drag.grabDz,
            entry.quarterTurns
          );
          setLabVisualTransform(entry,target.x,target.z,entry.quarterTurns);
        }
      }
    }else if(drag.kind==="camera"&&moved){
      theta-=dx*.008;
      phi=Math.max(.27,Math.min(1.45,phi+dy*.008));
      invalidate();
    }
    drag.x=event.clientX;drag.y=event.clientY;invalidate();
  }
  function finishPointer(event, select) {
    if(!drag||event.pointerId!==drag.pointerId)return;
    clearPendingWireHover(false);
    const finished=drag;
    drag=null;
    try{canvas.releasePointerCapture?.(event.pointerId);}catch{}
    if(finished.kind==="lab-component"){
      const entry=labComponents.get(finished.componentId);
      if(!select){
        restoreLabComponent(finished.componentId);
        restorePointerSelection(finished);
      }else{
        selectLabComponent(finished.componentId,"pointer",true);
        if(moved&&entry)emitLabMove(entry,"move","drag");
      }
      return;
    }
    if(finished.kind==="terminal"){
      if(select&&!moved){
        selectLabComponent(finished.componentId,"pointer",true);
        const terminal=activeLabLayout?.terminalMap?.[finished.terminalId]||null;
        if(labEdit.onTerminalSelect){
          labEdit.onTerminalSelect(finished.terminalId,Object.freeze({
            componentId:finished.componentId,
            terminal,
            source:"pointer",
            physicalVerified:false,
          }));
        }
      }else{
        restorePointerSelection(finished);
      }
      return;
    }
    if(finished.kind==="lab-fixed"){
      if(select&&!moved)selectLabComponent(finished.componentId,"pointer",true);
      else restorePointerSelection(finished);
      return;
    }
    if(select&&!moved&&finished.labBackground){
      selectLabComponent(null,"background",true);
      return;
    }
    if(select&&!moved&&finished.legacySelect)onSelect("Arduino Uno R3");
  }
  const up=event=>finishPointer(event,true);
  const cancel=event=>{clearPendingWireHover(true);finishPointer(event,false);};
  const leave=()=>{if(!drag)clearPendingWireHover(true);};
  function wheel(event) {
    event.preventDefault();
    zoom=Math.min(maxZoom,Math.max(minZoom,zoom+Math.sign(event.deltaY)*.10));
    invalidate();
  }
  const onVisibility=()=>{if(!document.hidden)invalidate();};
  const onKey=(event)=>{
    if(document.activeElement!==canvas)return;
    let handled=true;
    if(event.key==="ArrowLeft")theta-=.13;
    else if(event.key==="ArrowRight")theta+=.13;
    else if(event.key==="ArrowUp")phi=Math.max(.27,phi-.12);
    else if(event.key==="ArrowDown")phi=Math.min(1.45,phi+.12);
    else if(["+","=","Add"].includes(event.key))zoom=Math.max(minZoom,zoom-.10);
    else if(["-","_","Subtract"].includes(event.key))zoom=Math.min(maxZoom,zoom+.10);
    else if(event.key==="Home"){
      defaultPosition();
      focusedLabComponentId=null;
      canvas.dataset.labFocusedComponent="";
      refreshLabInteractionFeedback();
    }
    else if(labEdit.enabled&&activeLabLayout&&["w","a","s","d"].includes(event.key.toLowerCase())){
      const entry=labComponents.get(selectedLabComponentId);
      if(!entry||entry.component.fixed){handled=false;}
      else{
        const grid=activeLabLayout.grid;
        const key=event.key.toLowerCase();
        const dx=key==="a"?-grid:key==="d"?grid:0;
        const dz=key==="w"?-grid:key==="s"?grid:0;
        const target=clampLabTarget(
          entry.component,entry.x+dx,entry.z+dz,entry.quarterTurns
        );
        setLabVisualTransform(entry,target.x,target.z,entry.quarterTurns);
        emitLabMove(entry,"move","keyboard");
      }
    }
    else if(labEdit.enabled&&activeLabLayout&&["q","e"].includes(event.key.toLowerCase())){
      const entry=labComponents.get(selectedLabComponentId);
      if(!entry||entry.component.fixed){handled=false;}
      else{
        const delta=event.key.toLowerCase()==="q"?-1:1;
        const next=((entry.quarterTurns+delta)%4+4)%4;
        const target=clampLabTarget(entry.component,entry.x,entry.z,next);
        setLabVisualTransform(entry,target.x,target.z,next);
        emitLabMove(entry,"rotate","keyboard",delta);
      }
    }
    else if(labEdit.enabled&&event.key==="Escape"){
      selectLabComponent(null,"keyboard",true);
    }
    else if(event.key==="Enter"||event.key===" "){
      if(labEdit.enabled&&selectedLabComponentId){
        selectLabComponent(selectedLabComponentId,"keyboard",true);
      }else{
        onSelect("Arduino Uno R3");
      }
    }
    else handled=false;
    if(handled){event.preventDefault();invalidate();}
  };
  const onContextLost=event=>{
    event.preventDefault();
    if(contextLost)return;
    contextLost=true;
    canvas.dataset.sceneContext="lost";
    canvas.setAttribute("aria-busy","true");
    if(drag){try{canvas.releasePointerCapture?.(drag.pointerId);}catch{}}
    drag=null;
    clearPendingWireState(false);
    refreshLabInteractionFeedback();
    refreshCanvasAccessibility();
    if(raf){cancelAnimationFrame(raf);raf=0;}
    // Three r180 recreates its WebGL caches on restore. Dispatching resource
    // disposal while the old context is already lost removes the old cache
    // listeners without destroying the CPU-side geometry/material/texture
    // objects, so the same scene can be uploaded cleanly to the new context.
    disposeTree(scene);
  };
  const onContextRestored=()=>{
    if(disposed)return;
    contextLost=false;
    canvas.dataset.sceneContext="ready";
    canvas.removeAttribute("aria-busy");
    refreshLabInteractionFeedback();
    resize(true);
  };
  canvas.addEventListener("pointerdown",down);
  canvas.addEventListener("pointermove",move);
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",cancel);
  canvas.addEventListener("lostpointercapture",cancel);
  canvas.addEventListener("pointerleave",leave);
  canvas.addEventListener("wheel",wheel,{passive:false});
  canvas.addEventListener("keydown",onKey);
  canvas.addEventListener("webglcontextlost",onContextLost,false);
  canvas.addEventListener("webglcontextrestored",onContextRestored,false);
  document.addEventListener("visibilitychange",onVisibility);
  window.addEventListener("resize",resize);

  function setLesson(lesson) {
    if(disposed)return;
    clearLabLayout(false);
    currentLessonId=Number(lesson?.id);
    clearWiringLayer(false);
    if(activeModule){scene.remove(activeModule.module);disposeTree(activeModule.module,sharedMaterialSet);}
    activeModule=createModule(scene, lesson.id===1?"board":
      ({2:"led",3:"button",4:"potentiometer",5:"rgb",6:"ldr",7:"ultrasonic",8:"buzzer",9:"piano",10:"motor",11:"temperature",12:"servo",13:"stepper",14:"plant",15:"force",16:"project"})[lesson.id] || "led",sharedMaterials);
    if(!contextLost)applySceneLod(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),true);
    invalidate();
  }
  function setWiring(circuit,terminals=[],analysis=null){
    if(disposed)return {mode:"none",shownWires:0,omittedWires:0,netCount:0,status:"none",analysisSupported:false,physicalMapping:"none"};
    if(circuit==null)return clearWiringLayer(true);
    if(!circuit || typeof circuit!=="object" || Array.isArray(circuit))throw new TypeError("Netlist 3D không hợp lệ");
    const circuitLessonId=Number(circuit.lessonId);
    if(currentLessonId!==null && Number.isFinite(currentLessonId) && circuitLessonId!==currentLessonId){
      clearWiringLayer(false);
      throw new RangeError("Netlist 3D không thuộc bài học đang hiển thị");
    }
    if(analysis && Number.isFinite(Number(analysis.lessonId)) && Number(analysis.lessonId)!==circuitLessonId){
      clearWiringLayer(false);
      throw new RangeError("Kết quả phân tích netlist thuộc bài học khác");
    }
    clearWiringLayer(false);
    const model=normalizeWiringModel(circuit,terminals,analysis);
    lastWiringModel=model;
    activeWiringLayer=makeConceptualWiringLayer(scene,model);
    if(activeLabLayout){
      activeWiringLayer.visible=false;
      refreshLabWireLayer();
    }
    const summary={
      mode:"conceptual-netlist",
      shownWires:model.wires.length,
      omittedWires:model.omittedWires,
      netCount:model.nets.length,
      status:model.status,
      analysisSupported:model.analysisSupported,
      physicalMapping:"none",
    };
    canvas.dataset.wiringMode=summary.mode;
    canvas.dataset.wiringWireCount=String(summary.shownWires);
    canvas.dataset.wiringNetCount=String(summary.netCount);
    canvas.dataset.wiringStatus=summary.status;
    canvas.dataset.wiringPhysicalMap="none";
    canvas.title=CONCEPTUAL_WIRING_NOTICE;
    refreshCanvasAccessibility();
    invalidate();
    return summary;
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
    else if(action==="in")zoom=Math.max(minZoom,zoom-.12);
    else if(action==="out")zoom=Math.min(maxZoom,zoom+.12);
    else if(action==="reset"){
      defaultPosition();
      focusedLabComponentId=null;
      canvas.dataset.labFocusedComponent="";
      refreshLabInteractionFeedback();
    }
    invalidate();
  }
  resize();
  return {setLesson,setWiring,setLabLayout,setLabEdit,focusLabComponent,setInspectedTerminal,setPendingWireTerminal,getLabViewState,update,control,resize,dispose() {
    if(disposed)return;
    const wasContextLost=contextLost;
    disposed=true;
    if(raf){cancelAnimationFrame(raf);raf=0;}
    if(drag){try{canvas.releasePointerCapture?.(drag.pointerId);}catch{}drag=null;}
    observer.disconnect();
    document.removeEventListener("visibilitychange",onVisibility);
    window.removeEventListener("resize",resize);
    canvas.removeEventListener("pointerdown",down);
    canvas.removeEventListener("pointermove",move);
    canvas.removeEventListener("pointerup",up);
    canvas.removeEventListener("pointercancel",cancel);
    canvas.removeEventListener("lostpointercapture",cancel);
    canvas.removeEventListener("pointerleave",leave);
    canvas.removeEventListener("wheel",wheel);
    canvas.removeEventListener("keydown",onKey);
    canvas.removeEventListener("webglcontextlost",onContextLost,false);
    canvas.removeEventListener("webglcontextrestored",onContextRestored,false);
    // In Three r180, resources may retain dispose listeners from a pre-restore
    // WebGL context. Losing the owned context first releases GPU resources as a
    // unit and prevents stale listeners from deleting handles in the new
    // context while CPU-side geometry/material disposal still runs normally.
    if(!wasContextLost)renderer.forceContextLoss?.();
    if(activeLabLayer){
      scene.remove(activeLabLayer);
      disposeTree(activeLabLayer,sharedMaterialSet);
      activeLabLayer=null;
    }
    labComponents.clear();
    labTerminals.clear();
    labPickables.length=0;
    labWireObjects.length=0;
    labWireLayer=null;
    activeLabLayout=null;
    focusedLabComponentId=null;
    inspectedLabTerminalId=null;
    inspectedLabTerminalMode="none";
    pendingWireTerminalId=null;
    pendingWireHoverTerminalId=null;
    pendingWirePreviewLine=null;
    canvas.dataset.labInspectedTerminal="";
    canvas.dataset.labInspectionFeedback="none";
    canvas.dataset.labPendingWireTerminal="";
    canvas.dataset.labPendingWireHoverTerminal="";
    canvas.dataset.labPendingWirePreview="none";
    if(inspectionBadge){inspectionBadge.remove();inspectionBadge=null;}
    if(activeModule){scene.remove(activeModule.module);disposeTree(activeModule.module,sharedMaterialSet);}
    if(activeWiringLayer){scene.remove(activeWiringLayer);disposeTree(activeWiringLayer);activeWiringLayer=null;}
    if(board){scene.remove(board.board);disposeTree(board.board,sharedMaterialSet);}
    if(breadboard){scene.remove(breadboard);disposeTree(breadboard);}
    scene.remove(ground);disposeTree(ground);
    sharedMaterialSet.forEach(item=>item.dispose());
    renderer.dispose();
    canvas.remove();
  }};
}
