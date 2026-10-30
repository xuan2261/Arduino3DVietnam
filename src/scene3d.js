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
const COMPONENT_VISUAL_PROFILE = "conceptual-components-v1";
const TERMINAL_FEEDBACK_PROFILE = "contrast-rings-v1";
const SCENE_LOD_BREAKPOINT = 560;
const LAB_TERMINAL_HIT_RADIUS = .20;
const LAB_TOUCH_TAP_THRESHOLD = 12;
const LAB_COMMITTED_WIRE_ROUTE_POINTS = 8;
const LAB_COMMITTED_WIRE_PICK_THRESHOLD = Math.min(.20,Math.max(.08,.16));
const LAB_COMMITTED_WIRE_REPAIR_POINTS = 4;
const LAB_AUTHORED_GUIDE_ROUTE_POINTS = 6;
const LAB_WIRE_ID_MAX = 80;
const BREADBOARD_STUDY_ROWS = Object.freeze("ABCDEFGHIJ".split(""));
const BREADBOARD_STUDY_COLUMNS = 63;
const BREADBOARD_STUDY_HOLE_COUNT = BREADBOARD_STUDY_ROWS.length * BREADBOARD_STUDY_COLUMNS;
const BREADBOARD_STUDY_PROFILE_ID_MAX = 80;
const BREADBOARD_STUDY_ROW_Z = Object.freeze([-.30,-.24,-.18,-.12,-.06,.06,.12,.18,.24,.30]);
const BREADBOARD_HOLE_LINK_ROUTE_POINTS = 3;
const BREADBOARD_HOLE_LINK_MODES = new Set(["off","await-start","await-end","ready"]);
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
  terminalContrastMat: new T.MeshBasicMaterial({
    color: 0x10272b, transparent: true, opacity: .92,
    depthWrite: false, depthTest: false, side: T.DoubleSide,
  }),
  terminalHaloMat: new T.MeshBasicMaterial({
    color: palette.teal, transparent: true, opacity: .40,
    depthWrite: false, depthTest: false, side: T.DoubleSide,
  }),
  inspectionTerminalHaloMat: new T.MeshBasicMaterial({
    color: 0x6274d9, transparent: true, opacity: .76,
    depthWrite: false, depthTest: false, side: T.DoubleSide,
  }),
  hoverTerminalHaloMat: new T.MeshBasicMaterial({
    color: 0xf7db63, transparent: true, opacity: .96,
    depthWrite: false, depthTest: false, side: T.DoubleSide,
  }),
  pendingTerminalHaloMat: new T.MeshBasicMaterial({
    color: palette.coral, transparent: true, opacity: .98,
    depthWrite: false, depthTest: false, side: T.DoubleSide,
  }),
  committedTerminalHaloMat: new T.MeshBasicMaterial({
    color: 0xffd36a, transparent: true, opacity: .98,
    depthWrite: false, depthTest: false, side: T.DoubleSide,
  }),
  pendingWireLineMat: new T.LineBasicMaterial({
    color: palette.coral, transparent: true, opacity: .96,
    depthWrite: false, depthTest: false,
  }),
  highlightedWireBackdropMat: new T.LineBasicMaterial({
    color: 0x10272b, transparent: true, opacity: .96,
    depthWrite: false, depthTest: false,
  }),
  highlightedWireLineMat: new T.LineBasicMaterial({
    color: 0xffd36a, transparent: true, opacity: .96,
    depthWrite: false, depthTest: false,
  }),
  committedWireRepairValidMat: new T.LineBasicMaterial({
    color: 0x74d9c8, transparent: true, opacity: .98,
    depthWrite: false, depthTest: false,
  }),
  committedWireRepairInvalidMat: new T.LineBasicMaterial({
    color: palette.coral, transparent: true, opacity: .98,
    depthWrite: false, depthTest: false,
  }),
  authoredGuideBackdropMat: new T.LineBasicMaterial({
    color: 0x10272b, transparent: true, opacity: .88,
    depthWrite: false, depthTest: false,
  }),
  authoredGuideDashMat: new T.LineDashedMaterial({
    color: 0x74d9c8, transparent: true, opacity: .98,
    dashSize: .18, gapSize: .10,
    depthWrite: false, depthTest: false,
  }),
  breadboardStudyHoleMat: new T.MeshBasicMaterial({
    color: 0x314846, transparent: true, opacity: .86,
    depthWrite: false, depthTest: true,
  }),
  breadboardStudySelectedMat: new T.MeshBasicMaterial({
    color: palette.amber, transparent: true, opacity: .98,
    depthWrite: false, depthTest: false, side: T.DoubleSide,
  }),
  breadboardHoleLinkValidMat: new T.LineBasicMaterial({
    color: 0x74d9c8, transparent: true, opacity: .98,
    depthWrite: false, depthTest: false,
  }),
  breadboardHoleLinkInvalidMat: new T.LineBasicMaterial({
    color: palette.coral, transparent: true, opacity: .98,
    depthWrite: false, depthTest: false,
  }),
  breadboardHoleLinkReadyMat: new T.LineDashedMaterial({
    color: palette.amber, transparent: true, opacity: .98,
    dashSize: .065, gapSize: .035,
    depthWrite: false, depthTest: false,
  }),
  contactStripMat: material(0xb7c3bf, { metalness: .16, roughness: .48 }),
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
function canvasTag(parent, text, x, y, z, width = .95) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0,0,512,128);
  context.fillStyle = "rgba(21, 39, 43, .90)";
  context.fillRect(8,10,496,108);
  context.strokeStyle = "rgba(232, 242, 238, .46)";
  context.lineWidth = 4;
  context.strokeRect(10,12,492,104);
  context.fillStyle = "#f3fbf8";
  context.font = "700 42px sans-serif";
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillText(text,256,64,468);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = T.LinearFilter;
  texture.magFilter = T.LinearFilter;
  const mesh = new T.Mesh(
    new T.PlaneGeometry(width,width*128/512),
    new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:T.DoubleSide})
  );
  mesh.position.set(x,y,z);
  mesh.rotation.x=-Math.PI/2;
  mesh.visible=false;
  mesh.renderOrder=4;
  mesh.userData={kind:"lab-terminal-feedback-label",physicalLocation:false,physicalVerified:false};
  parent.add(mesh);
  return mesh;
}
function fineDetail(object) {
  if (!object) return object;
  object.userData = { ...object.userData, sceneDetail: "fine", physicalVerified: false };
  return object;
}
function conceptualVisualFeature(object, visualKind, feature, role = "silhouette") {
  if (!object) return object;
  object.userData = {
    ...object.userData,
    conceptualFeature: true,
    visualKind,
    visualFeature: feature,
    fidelityRole: role,
    physicalLocation: false,
    physicalVerified: false,
    electricalAuthority: false,
  };
  return object;
}
function instancedCylinders(parent, positions, radius, height, materialRef, radial, kind) {
  if (!Array.isArray(positions) || positions.length === 0) return null;
  const mesh = new T.InstancedMesh(
    new T.CylinderGeometry(radius,radius,height,radial),
    materialRef,
    positions.length,
  );
  const matrix = new T.Matrix4();
  positions.forEach((position,index)=>{
    matrix.makeTranslation(position[0],position[1],position[2]);
    mesh.setMatrixAt(index,matrix);
  });
  mesh.instanceMatrix.needsUpdate=true;
  mesh.castShadow=false;
  mesh.receiveShadow=false;
  mesh.userData={
    kind,
    visualInstanceCount:positions.length,
    physicalLocation:false,
    physicalVerified:false,
  };
  parent.add(mesh);
  return mesh;
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

function breadboardStudyHoleIndex(holeId) {
  if(typeof holeId!=="string")return -1;
  const match=/^([A-J])([1-9]|[1-5][0-9]|6[0-3])$/.exec(holeId);
  if(!match)return -1;
  const rowIndex=BREADBOARD_STUDY_ROWS.indexOf(match[1]);
  return rowIndex<0?-1:rowIndex*BREADBOARD_STUDY_COLUMNS+(Number(match[2])-1);
}

function breadboardStudyHoleId(instanceId) {
  if(!Number.isInteger(instanceId)||instanceId<0||instanceId>=BREADBOARD_STUDY_HOLE_COUNT)return null;
  const rowIndex=Math.floor(instanceId/BREADBOARD_STUDY_COLUMNS);
  const column=instanceId%BREADBOARD_STUDY_COLUMNS+1;
  return BREADBOARD_STUDY_ROWS[rowIndex]+String(column);
}

function breadboardStudyLocalPosition(component,holeId,target=new T.Vector3()) {
  const instanceId=breadboardStudyHoleIndex(holeId);
  if(instanceId<0)return null;
  const rowIndex=Math.floor(instanceId/BREADBOARD_STUDY_COLUMNS);
  const columnIndex=instanceId%BREADBOARD_STUDY_COLUMNS;
  const width=component.width*LAB_WORLD_SCALE;
  const depth=component.depth*LAB_WORLD_SCALE;
  const x=-width*.39+(width*.78*columnIndex/(BREADBOARD_STUDY_COLUMNS-1));
  const z=depth*BREADBOARD_STUDY_ROW_Z[rowIndex];
  return target.set(x,.318,z);
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
  // Functional labels follow docs/UNO_REFERENCE_NEXT.md (official Arduino A000066 sources).
  // Header rail/socket geometry remains illustrative logical display geometry, not CAD.
  const body = conceptualVisualFeature(
    box(parent, [width, .18, depth], shared.bodyMat, [0,.15,0]),
    "arduino-uno", "board-profile"
  );
  body.castShadow = true;
  conceptualVisualFeature(
    box(parent,[width * .43,.16,depth * .22],shared.plasticMat,[width * .08,.32,.05]),
    "arduino-uno","controller-package"
  );
  conceptualVisualFeature(
    box(parent,[width * .16,.42,depth * .28],shared.metallicMat,[-width * .43,.38,-depth * .24]),
    "arduino-uno","usb-b-silhouette"
  );
  const barrel = conceptualVisualFeature(
    cylinder(parent,depth*.12,depth*.12,width*.18,shared.plasticMat,[width*.42,.33,depth*.22],20),
    "arduino-uno","dc-barrel-silhouette"
  );
  barrel.rotation.z=Math.PI/2;
  const topZ = depth * .39;
  const bottomZ = -depth * .39;
  const topRail=box(parent,[width * .76,.22,.30],shared.plasticMat,[-width * .02,.35,topZ]);
  const bottomRail=box(parent,[width * .62,.22,.30],shared.plasticMat,[width * .12,.35,bottomZ]);
  topRail.userData={kind:"uno-header-rail-visual",group:"digital",physicalLocation:false,physicalVerified:false};
  bottomRail.userData={kind:"uno-header-rail-visual",group:"power-analog",physicalLocation:false,physicalVerified:false};
  fineDetail(box(parent,[width*.69,.015,.075],0x273236,[-width*.02,.468,topZ]));
  fineDetail(box(parent,[width*.55,.015,.075],0x273236,[width*.12,.468,bottomZ]));
  conceptualVisualFeature(
    canvasLabel(parent,"ARDUINO UNO R3",0,.285,.02,Math.max(1.6,width*.62),38),
    "arduino-uno","board-name","marking"
  );
  fineDetail(conceptualVisualFeature(
    canvasLabel(parent,"MCU",width*.08,.435,.05,Math.max(.58,width*.20),20,"#d9eee8"),
    "arduino-uno","controller-marking","marking"
  ));
  canvasLabel(parent,"DIGITAL D0–D13",0,.505,topZ - .30,Math.max(1.55,width*.58),29);
  canvasLabel(parent,"ANALOG A0–A5",width*.05,.505,bottomZ + .30,Math.max(1.5,width*.54),29);
  canvasLabel(parent,"5V · 3V3 · GND",width*.27,.505,depth*.16,Math.max(1.3,width*.42),27);
  const socketCount = 12;
  const topSockets=[];
  for (let i = 0; i < socketCount; i += 1) {
    const px = -width*.31 + i * (width*.62/(socketCount-1));
    topSockets.push([px,.485,topZ]);
  }
  fineDetail(instancedCylinders(parent,topSockets,.035,.026,shared.socketMat,8,"uno-header-socket-instances"));
  const bottomSockets=[];
  for (let i = 0; i < 8; i += 1) {
    const px = -width*.23 + i * (width*.46/7);
    bottomSockets.push([px,.485,bottomZ]);
  }
  fineDetail(instancedCylinders(parent,bottomSockets,.035,.026,shared.socketMat,8,"uno-header-socket-instances"));
  fineDetail(conceptualVisualFeature(
    canvasLabel(parent,"HEADER VISUAL · KHÔNG PHẢI PIN MAP",0,.515,depth*.47,Math.max(1.8,width*.74),20,"#d9eee8"),
    "arduino-uno","header-nonauthoritative-marking","marking"
  ));
  fineDetail(canvasLabel(parent,"PWM ~ 3 · 5 · 6 · 9 · 10 · 11",0,.515,-depth*.47,Math.max(1.9,width*.78),18,"#c7e8df"));
  fineDetail(box(parent,[width*.15,.08,depth*.10],0x486c6f,[width*.31,.31,-depth*.10]));
  fineDetail(canvasLabel(parent,"RESET",width*.31,.52,-depth*.10,.60,20,"#d9eee8"));
}

function makeLabBreadboardVisual(parent, width, depth, shared) {
  const base=conceptualVisualFeature(
    box(parent,[width,.26,depth],0xfdfefd,[0,.14,0]),
    "breadboard","body-profile"
  );
  base.userData={...base.userData,kind:"breadboard-visual",physicalVerified:false,breadboardHoleMapping:false};
  const leftBank=box(parent,[width*.88,.022,depth*.33],0xf4f7f5,[0,.285,-depth*.18]);
  const rightBank=box(parent,[width*.88,.022,depth*.33],0xf4f7f5,[0,.285,depth*.18]);
  leftBank.userData={kind:"breadboard-contact-bank-visual",breadboardConnectivity:false,physicalVerified:false};
  rightBank.userData={kind:"breadboard-contact-bank-visual",breadboardConnectivity:false,physicalVerified:false};
  box(parent,[width*.90,.012,.025],0xd77b65,[0,.285,-depth*.37]);
  box(parent,[width*.90,.012,.025],0x65a9d5,[0,.285,depth*.37]);
  const trench=conceptualVisualFeature(
    box(parent,[width*.86,.020,depth*.075],0xcbd4d0,[0,.276,0]),
    "breadboard","center-trench"
  );
  trench.userData={...trench.userData,kind:"breadboard-center-trench-visual",breadboardConnectivity:false,physicalVerified:false};
  fineDetail(box(parent,[width*.84,.012,.012],0x9eaaa6,[0,.295,-depth*.045]));
  fineDetail(box(parent,[width*.84,.012,.012],0x9eaaa6,[0,.295,depth*.045]));
  conceptualVisualFeature(
    box(parent,[width*.86,.012,.026],0xd77b65,[0,.285,-depth*.44]),
    "breadboard","rail-red","marking"
  );
  conceptualVisualFeature(
    box(parent,[width*.86,.012,.026],0x65a9d5,[0,.285,depth*.44]),
    "breadboard","rail-blue","marking"
  );
  const columns = 12, bankRows = 5;
  const bankHoles=[];
  for (let i = 0; i < columns; i += 1) {
    const x=-width*.39+i*(width*.78/(columns-1));
    for (const side of [-1,1]) {
      for (let j = 0; j < bankRows; j += 1) {
        const z=side*(depth*.08+j*(depth*.19/(bankRows-1)));
        bankHoles.push([x,.302,z]);
      }
    }
  }
  const bankHoleMesh=fineDetail(instancedCylinders(parent,bankHoles,.025,.014,shared.holeMat,7,"breadboard-hole-instances"));
  if(bankHoleMesh)bankHoleMesh.userData.breadboardHoleMapping=false;
  const railHoles=[];
  for(let i=0;i<columns;i++){
    const x=-width*.39+i*(width*.78/(columns-1));
    for (const railZ of [-depth*.405,depth*.405]) railHoles.push([x,.300,railZ]);
  }
  const railHoleMesh=fineDetail(instancedCylinders(parent,railHoles,.022,.013,shared.railHoleMat,7,"breadboard-rail-hole-instances"));
  if(railHoleMesh)railHoleMesh.userData.breadboardHoleMapping=false;
  for(const side of [-1,1]){
    for(let row=0;row<bankRows;row++){
      const z=side*(depth*.08+row*(depth*.19/(bankRows-1)));
      const strip=box(parent,[width*.77,.010,.018],shared.contactStripMat,[0,.291,z]);
      strip.userData={kind:"breadboard-contact-strip-visual",breadboardConnectivity:false,electricalAuthority:false,physicalVerified:false};
      fineDetail(strip);
    }
  }
  fineDetail(conceptualVisualFeature(
    canvasLabel(parent,"VISUAL GRID · KHÔNG CÓ HOLE MAP",0,.305,depth*.31,Math.max(1.5,width*.72),18,"#7a8f89"),
    "breadboard","hole-map-warning","marking"
  ));
  conceptualVisualFeature(
    canvasLabel(parent,"BREADBOARD · KHÁI NIỆM",0,.30,-depth*.43,Math.max(1.5,width*.70),25,"#607c74"),
    "breadboard","board-name","marking"
  );
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
      const bodyLength=Math.max(.56,width*.58);
      conceptualVisualFeature(
        cylinder(body,.10,.10,bodyLength,0xe7d2a6,[0,0,0],18),
        "resistor","axial-body"
      );
      for(const endY of [-bodyLength*.50,bodyLength*.50]){
        fineDetail(conceptualVisualFeature(
          cylinder(body,.115,.115,.055,0xd5c29c,[0,endY,0],16),
          "resistor","end-cap"
        ));
      }
      [-.16,-.05,.07,.18].forEach((v,index)=>{
        fineDetail(conceptualVisualFeature(
          cylinder(body,.104,.104,.034,[0x627d77,0x35514d,0x81968f,0x4b6862][index],[0,v,0],16),
          "resistor","neutral-identification-band","marking"
        ));
      });
      conceptualVisualFeature(
        box(body,[.018,Math.max(.40,width*.34),.018],metallicMat,[0,Math.max(.38,width*.48),0]),
        "resistor","lead"
      );
      conceptualVisualFeature(
        box(body,[.018,Math.max(.40,width*.34),.018],metallicMat,[0,-Math.max(.38,width*.48),0]),
        "resistor","lead"
      );
      break;
    }
    case "led":
    case "rgb-led": {
      const color = component.visualKind === "rgb-led" ? 0xd86596 : palette.coral;
      const globeMat=material(color,{transparent:true,opacity:.82,roughness:.28});
      const globeRadius=Math.min(.29,width*.23);
      const globe=new T.Mesh(new T.SphereGeometry(globeRadius,24,16),globeMat);
      globe.position.set(0,.43,0);
      globe.castShadow=true;
      parent.add(globe);
      conceptualVisualFeature(globe,component.visualKind,"domed-lens");
      conceptualVisualFeature(
        cylinder(parent,Math.min(.24,width*.19),Math.min(.24,width*.19),.08,0xc7d0cb,[0,.18,0],20),
        component.visualKind,"lens-base"
      );
      fineDetail(conceptualVisualFeature(
        box(parent,[globeRadius*.58,.035,.035],0xf5e4dd,[globeRadius*.42,.45,0]),
        component.visualKind,"flat-side-cue","marking"
      ));
      const leadCount=component.visualKind==="rgb-led"?4:2;
      for(let index=0;index<leadCount;index+=1){
        const span=leadCount===1?0:(index/(leadCount-1)-.5)*Math.min(.34,width*.30);
        fineDetail(conceptualVisualFeature(
          box(parent,[.024,index%2===0?.24:.19,.024],metallicMat,[span,index%2===0?.03:.055,0]),
          component.visualKind,"lead"
        ));
      }
      fineDetail(conceptualVisualFeature(
        canvasLabel(parent,component.visualKind==="rgb-led"?"RGB":"LED",0,.72,0,Math.max(.54,width*.44),20,"#eef7f2"),
        component.visualKind,"type-marking","marking"
      ));
      break;
    }
    case "button":
      conceptualVisualFeature(
        box(parent,[width*.72,.22,depth*.72],plasticMat,[0,.20,0]),
        "button","square-base"
      );
      conceptualVisualFeature(
        cylinder(parent,Math.min(.28,width*.24),Math.min(.28,width*.24),.24,palette.coral,[0,.43,0],22),
        "button","push-cap"
      );
      for(const x of [-width*.24,width*.24])for(const z of [-depth*.24,depth*.24]){
        fineDetail(conceptualVisualFeature(
          box(parent,[.024,.17,.024],metallicMat,[x,.045,z]),
          "button","terminal-leg"
        ));
      }
      fineDetail(conceptualVisualFeature(
        canvasLabel(parent,"PUSH",0,.56,0,Math.max(.55,width*.44),18,"#f7e5df"),
        "button","push-marking","marking"
      ));
      break;
    case "potentiometer": {
      const knobRadius=Math.min(.24,width*.18);
      conceptualVisualFeature(
        cylinder(parent,Math.min(.36,width*.27),Math.min(.36,width*.27),.22,0x32444b,[0,.22,0],24),
        "potentiometer","round-body"
      );
      conceptualVisualFeature(
        cylinder(parent,knobRadius,knobRadius,.28,0xe3e7e1,[0,.47,0],20),
        "potentiometer","knob"
      );
      fineDetail(conceptualVisualFeature(
        box(parent,[knobRadius*1.15,.025,.045],0x53656a,[0,.62,0]),
        "potentiometer","knob-slot","marking"
      ));
      for(const x of [-width*.18,0,width*.18])fineDetail(conceptualVisualFeature(
        box(parent,[.022,.18,.022],metallicMat,[x,.055,depth*.16]),
        "potentiometer","terminal-leg"
      ));
      fineDetail(conceptualVisualFeature(
        canvasLabel(parent,"POT",0,.66,-depth*.18,Math.max(.58,width*.46),19,"#eef7f2"),
        "potentiometer","type-marking","marking"
      ));
      break;
    }
    case "photoresistor": {
      const disk=conceptualVisualFeature(
        cylinder(parent,Math.min(.34,width*.24),Math.min(.34,width*.24),.10,0xb3936f,[0,.24,0],24),
        "photoresistor","sensor-disc"
      );
      fineDetail(box(disk,[.34,.015,.045],0x3b3c2e,[0,.055,0]));
      fineDetail(box(disk,[.045,.015,.34],0x3b3c2e,[0,.057,0]));
      conceptualVisualFeature(
        canvasLabel(parent,"LDR",0,.39,0,Math.max(.65,width*.52),24,"#eef7f2"),
        "photoresistor","type-marking","marking"
      );
      break;
    }
    case "force-sensor": {
      conceptualVisualFeature(
        cylinder(parent,Math.min(.34,width*.25),Math.min(.34,width*.25),.07,0x7d918e,[0,.22,0],26),
        "force-sensor","sensor-pad"
      );
      fineDetail(cylinder(parent,Math.min(.22,width*.16),Math.min(.22,width*.16),.012,0xdbe8e3,[0,.263,0],24));
      conceptualVisualFeature(
        canvasLabel(parent,"FSR",0,.36,0,Math.max(.62,width*.50),24,"#eef7f2"),
        "force-sensor","type-marking","marking"
      );
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
      conceptualVisualFeature(
        box(parent,[width*.80,.15,depth*.70],0x24909a,[0,.24,0]),
        "ultrasonic-sensor","board-profile"
      );
      for (const x of [-width*.22,width*.22]) {
        conceptualVisualFeature(
          cylinder(parent,Math.min(.24,depth*.22),Math.min(.24,depth*.22),.19,metallicMat,[x,.39,0],22),
          "ultrasonic-sensor","transducer"
        );
      }
      break;
    case "buzzer":
      conceptualVisualFeature(
        cylinder(parent,Math.min(.34,width*.27),Math.min(.34,width*.27),.42,0x202c31,[0,.31,0],28),
        "buzzer","cylindrical-body"
      );
      conceptualVisualFeature(
        cylinder(parent,Math.min(.18,width*.14),Math.min(.18,width*.14),.025,0x11191c,[0,.53,0],22),
        "buzzer","sound-port"
      );
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
    conceptualVisualFeature(
      canvasLabel(parent,component.label,0,height + .12,0,Math.max(.72,width*.84),24,"#355f58"),
      component.visualKind,"component-label","marking"
    );
  }
  return { width, depth, height };
}

function makeBoard(scene, shared) {
  const { bodyMat, plasticMat, metallicMat, pinMat } = shared;
  const board = new T.Group();
  board.position.x = -2.65;
  board.userData={kind:"arduino-uno-visual",physicalVerified:false};
  scene.add(board);
  // Visual proportions/labels follow the official-source boundary recorded in
  // docs/UNO_REFERENCE_NEXT.md and docs/SCENE3D_V16.md.
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
  const headerCollars=[];
  const headerSockets=[];
  for (const [x,z,count,label] of headers) {
    const delta = .34;
    const left = x-(count-1)*delta/2;
    const rail=box(board,[count*delta+.15,.38,.55],plasticMat,[x,.67,z]);
    rail.userData={kind:"uno-header-rail-visual",group:label,physicalLocation:false,physicalVerified:false};
    fineDetail(box(board,[count*delta-.08,.014,.13],0x252e31,[x,.869,z]));
    for (let i=0;i<count;i++) {
      const p = left+i*delta;
      headerCollars.push([p,.867,z]);
      headerSockets.push([p,.88,z]);
    }
    fineDetail(canvasLabel(board,label,x,.49,z>0?2.02:-2.02,1.18,18,"#d8eee7"));
  }
  fineDetail(instancedCylinders(board,headerCollars,.094,.018,shared.collarMat,10,"uno-header-collar-instances"));
  fineDetail(instancedCylinders(board,headerSockets,.043,.023,shared.socketMat,9,"uno-header-socket-instances"));
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
  const upperBank=box(base,[4.72,.022,1.62],0xf5f7f6,[0,.474,-1.05]);
  const lowerBank=box(base,[4.72,.022,1.62],0xf5f7f6,[0,.474,1.05]);
  upperBank.userData={kind:"breadboard-contact-bank-visual",breadboardConnectivity:false,physicalVerified:false};
  lowerBank.userData={kind:"breadboard-contact-bank-visual",breadboardConnectivity:false,physicalVerified:false};
  const trench=box(base,[4.62,.020,.22],0xc9d1cf,[0,.466,0]);
  trench.userData={kind:"breadboard-center-trench-visual",breadboardConnectivity:false,physicalVerified:false};
  fineDetail(box(base,[4.52,.012,.025],0x9fa9a6,[0,.486,-.105]));
  fineDetail(box(base,[4.52,.012,.025],0x9fa9a6,[0,.486,.105]));
  const bankHoles=[];
  for (let column=0;column<11;column++) {
    const x=-2.15+column*(4.30/10);
    for(const side of [-1,1]){
      for(let row=0;row<5;row++){
        const z=side*(.38+row*(1.36/4));
        bankHoles.push([x,.489,z]);
      }
    }
  }
  const bankHoleMesh=fineDetail(instancedCylinders(base,bankHoles,.037,.014,shared.holeMat,8,"breadboard-hole-instances"));
  if(bankHoleMesh)bankHoleMesh.userData.breadboardHoleMapping=false;
  for(const side of [-1,1]){
    for(let row=0;row<5;row++){
      const z=side*(.38+row*(1.36/4));
      const strip=box(base,[4.22,.010,.026],shared.contactStripMat,[0,.478,z]);
      strip.userData={kind:"breadboard-contact-strip-visual",breadboardConnectivity:false,electricalAuthority:false,physicalVerified:false};
      fineDetail(strip);
    }
  }
  const railHoles=[];
  for (const z of [-2.28,2.28]) {
    box(base,[4.76,.008,.035],z < 0?0xd77b65:0x65a9d5,[0,.492,z]);
    for(let i=0;i<12;i++){
      const x=-2.05+i*(4.1/11);
      railHoles.push([x,.496,z]);
    }
  }
  const railHoleMesh=fineDetail(instancedCylinders(base,railHoles,.032,.012,shared.railHoleMat,7,"breadboard-rail-hole-instances"));
  if(railHoleMesh)railHoleMesh.userData.breadboardHoleMapping=false;
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
      cap.userData.kind="button-cap";
      cap.userData.lessonButtonActuatorId="lesson-3-button";
      state.pointer=cap;
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
      state.pointer=cylinder(module,.34,.34,.28,0xd0dcdb,[-.85,.65,.25]);
      state.pointer.userData.kind="button-cap";
      state.pointer.userData.lessonButtonActuatorId="lesson-16-button";
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
  let highlightedLabWireId=null;
  let inspectedLabTerminalId=null,inspectedLabTerminalMode="none",inspectionBadge=null;
  let hoveredLabTerminalId=null;
  let pendingWireTerminalId=null,pendingWireHoverTerminalId=null,pendingWirePreviewLine=null;
  let terminalLinkDragSourceId=null,terminalLinkDragTargetId=null;
  let committedWireRepairIntent={
    enabled:false,wireId:null,from:null,to:null,anchorTerminalId:null,onRerouteTarget:null
  };
  let committedWireRepairLine=null,committedWireRepairTargetId=null,committedWireRepairPreview="none";
  let committedWireRepairLayoutRef=null,committedWireRepairLessonId=null;
  let lessonButtonActuation={enabled:false,lessonId:null,onPressChange:null};
  let lessonButtonActuationPressed=false,lessonButtonActuationPointerId=null;
  let lessonButtonActuationPointerType=null,lessonButtonActuationSourceId=null;
  let authoredPairGuide=null,authoredPairGuideRestorePair=null,authoredPairGuideLayer=null;
  let authoredPairGuideBackdropLine=null,authoredPairGuideDashLine=null;
  let breadboardHoleStudy={
    enabled:false,profileId:null,selectedHoleId:null,onHoleSelect:null
  };
  let breadboardHoleStudyLayer=null,breadboardHoleStudyMesh=null,breadboardHoleStudyHalo=null;
  let breadboardHoleStudyComponentId=null,breadboardHoleStudyLayoutRef=null;
  let breadboardHoleLinkIntent={
    mode:"off",profileId:null,firstHoleId:null,secondHoleId:null,onHoleLinkDrop:null
  };
  let breadboardHoleLinkLine=null,breadboardHoleLinkHoverId=null,breadboardHoleLinkPreview="none";
  let focusedLabComponentId=null,currentLod="full",rendererPixelRatio=1,fineDetailCount=0,fineDetailInstanceCount=0;
  let labWireLayer=null;
  let labWireGeometryRevision=0;
  let lodInitialized=false,lastViewportWidth=0,lastViewportHeight=0;
  const labComponents=new Map(),labTerminals=new Map(),labWireObjects=[],labPickables=[];
  let labEdit={
    enabled:false,onSelectComponent:null,onMoveComponent:null,onTerminalSelect:null,
    onTerminalDragStart:null,onTerminalLink:null,onCommittedWireInspect:null
  };
  const raycaster=new T.Raycaster(),committedWireRaycaster=new T.Raycaster();
  committedWireRaycaster.params.Line.threshold=LAB_COMMITTED_WIRE_PICK_THRESHOLD;
  const pointerNdc=new T.Vector2(),dragPlane=new T.Plane(new T.Vector3(0,1,0),0);
  const breadboardHoleLinkMatrix=new T.Matrix4();
  const breadboardHoleLinkStart=new T.Vector3(),breadboardHoleLinkEnd=new T.Vector3();
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
      fineDetailInstanceCount=0;
      scene.traverse(child=>{
        if(child?.userData?.sceneDetail!=="fine")return;
        fineDetailCount+=1;
        const instances=Number(child.userData.visualInstanceCount);
        fineDetailInstanceCount+=Number.isInteger(instances)&&instances>0?instances:1;
        child.visible=nextLod==="full";
      });
      if(activeLabLayout&&labWireObjects.length)updateLabWireGeometry();
    }
    lodInitialized=true;
    if(renderer.domElement){
      renderer.domElement.dataset.sceneQuality=SCENE_QUALITY_PROFILE;
      renderer.domElement.dataset.sceneLod=nextLod;
      renderer.domElement.dataset.scenePixelRatio=String(rendererPixelRatio);
      renderer.domElement.dataset.sceneFineDetailCount=String(fineDetailCount);
      renderer.domElement.dataset.sceneFineDetailObjectCount=String(fineDetailCount);
      renderer.domElement.dataset.sceneFineDetailInstanceCount=String(fineDetailInstanceCount);
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
  function refreshSceneVisualDiagnostics(){
    let unoHeaderSockets=0,breadboardVisualHoles=0,breadboardContactStrips=0,instancedVisuals=0;
    let componentFeatures=0,componentMarkings=0,terminalContrastAffordances=0;
    const componentVisualKinds=new Set();
    scene.traverse(child=>{
      const kind=child?.userData?.kind;
      const count=Number(child?.userData?.visualInstanceCount);
      const instances=Number.isInteger(count)&&count>0?count:0;
      if(instances)instancedVisuals+=instances;
      if(kind==="uno-header-socket-instances")unoHeaderSockets+=instances;
      if(kind==="breadboard-hole-instances"||kind==="breadboard-rail-hole-instances"){
        breadboardVisualHoles+=instances;
      }
      if(kind==="breadboard-contact-strip-visual")breadboardContactStrips+=1;
      if(child?.userData?.conceptualFeature===true){
        componentFeatures+=1;
        if(typeof child.userData.visualKind==="string"&&child.userData.visualKind){
          componentVisualKinds.add(child.userData.visualKind);
        }
        if(child.userData.fidelityRole==="marking")componentMarkings+=1;
      }
      if(kind==="lab-terminal-contrast-backdrop")terminalContrastAffordances+=1;
    });
    canvas.dataset.sceneVisualProfile="conceptual-r3-fidelity-v2";
    canvas.dataset.sceneComponentVisualProfile=COMPONENT_VISUAL_PROFILE;
    canvas.dataset.sceneUnoHeaderSocketVisualCount=String(unoHeaderSockets);
    canvas.dataset.sceneBreadboardHoleVisualCount=String(breadboardVisualHoles);
    canvas.dataset.sceneBreadboardContactStripVisualCount=String(breadboardContactStrips);
    canvas.dataset.sceneInstancedVisualCount=String(instancedVisuals);
    canvas.dataset.sceneComponentVisualFeatureCount=String(componentFeatures);
    canvas.dataset.sceneComponentVisualKindCount=String(componentVisualKinds.size);
    canvas.dataset.sceneComponentMarkingCount=String(componentMarkings);
    canvas.dataset.sceneTerminalFeedbackProfile=TERMINAL_FEEDBACK_PROFILE;
    canvas.dataset.sceneTerminalContrastAffordanceCount=String(terminalContrastAffordances);
    canvas.dataset.sceneCadMapping="none";
    canvas.dataset.sceneElectricalAuthority="none";
  }
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
    if(lessonButtonActuation.enabled){
      parts.push(`Nút nhấn 3D của bài ${lessonButtonActuation.lessonId} gửi input mô phỏng khi giữ pointer; điều khiển HTML vẫn là lựa chọn bàn phím tương đương và đây không phải xác nhận nút vật lý.`);
    }
    if(inspectedLabTerminalId){
      parts.push(`Terminal đang xem: ${inspectedLabTerminalId}. Đây là trạng thái đọc-only từ Inspector, không tạo kết nối hoặc xác nhận vị trí vật lý.`);
    }
    if(pendingWireTerminalId){
      parts.push(`Terminal đầu đang chờ nối: ${pendingWireTerminalId}. Đây chỉ là xem trước trực quan; chưa tạo dây hoặc kết nối điện.`);
    }
    if(highlightedLabWireId){
      parts.push(`Dây đang được đánh dấu: ${highlightedLabWireId}. Đây chỉ là nhấn mạnh đường dây khái niệm đã có trong graph canonical.`);
    }
    if(committedWireRepairIntent.enabled){
      parts.push(
        `Xem trước đổi đầu dây ${committedWireRepairIntent.wireId} đang bật; giữ terminal ${committedWireRepairIntent.anchorTerminalId}. `+
        "Kéo trong 3D chỉ đề xuất terminal đích, không tự sửa graph hoặc xác nhận kết nối."
      );
    }
    if(authoredPairGuide){
      parts.push(
        `Gợi ý cặp terminal authored: ${authoredPairGuide.from} đến ${authoredPairGuide.to}. `+
        "Đây chỉ là đường hướng dẫn trực quan, không tạo dây, không xác nhận kết nối điện hoặc vị trí vật lý."
      );
    }
    if(canvas.dataset.labBreadboardHoleStudyMode==="conceptual-strip-study"){
      const selected=canvas.dataset.labBreadboardHoleSelected;
      parts.push(
        "Chế độ học lỗ breadboard khái niệm đang bật với 630 ID A1 đến J63. "+
        (selected?`Đang chọn ${selected}. `:"")+
        "Đây là định danh học tập trực quan, không xác nhận vị trí lỗ vật lý, rail hoặc kết nối điện."
      );
    }
    if(breadboardHoleLinkIntent.mode!=="off"){
      const pair=breadboardHoleLinkIntent.firstHoleId&&breadboardHoleLinkIntent.secondHoleId
        ? ` Cặp hiện tại ${breadboardHoleLinkIntent.firstHoleId} đến ${breadboardHoleLinkIntent.secondHoleId}.`
        : breadboardHoleLinkIntent.firstHoleId
          ? ` Lỗ đầu hiện tại ${breadboardHoleLinkIntent.firstHoleId}.` : "";
      parts.push(
        `Intent nối hai lỗ breadboard đang ở chế độ ${breadboardHoleLinkIntent.mode}.${pair} `+
        "Đường hiển thị chỉ là gợi ý trực quan; không tự tạo dây, placement hoặc circuit-router edge."
      );
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
    canvas.dataset.labWireRouteMode="none";
    canvas.dataset.labWireRoutePointCount="0";
    canvas.dataset.labWireGeometryRevision="0";
    canvas.dataset.labHighlightedWire="";
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
    canvas.dataset.labTerminalDragSource="";
    canvas.dataset.labTerminalDragTarget="";
    canvas.dataset.labTerminalDragPreview="none";
    canvas.dataset.labCommittedWireRepairMode="off";
    canvas.dataset.labCommittedWireRepairWire="";
    canvas.dataset.labCommittedWireRepairAnchor="";
    canvas.dataset.labCommittedWireRepairMovedEndpoint="";
    canvas.dataset.labCommittedWireRepairTarget="";
    canvas.dataset.labCommittedWireRepairPreview="none";
    canvas.dataset.labCommittedWireRepairElectricalAuthority="false";
    canvas.dataset.labCommittedWireRepairPhysicalVerified="false";
    canvas.dataset.labAuthoredGuideMode="none";
    canvas.dataset.labAuthoredGuideFrom="";
    canvas.dataset.labAuthoredGuideTo="";
    canvas.dataset.labBreadboardHoleStudyMode="none";
    canvas.dataset.labBreadboardHoleStudyProfile="";
    canvas.dataset.labBreadboardHoleSelected="";
    canvas.dataset.labBreadboardHoleCount="0";
    canvas.dataset.labBreadboardHolePhysicalVerified="false";
    canvas.dataset.labHoleLinkMode="off";
    canvas.dataset.labHoleLinkFirst="";
    canvas.dataset.labHoleLinkSecond="";
    canvas.dataset.labHoleLinkHover="";
    canvas.dataset.labHoleLinkPreview="none";
    canvas.dataset.labHoleLinkElectricalAuthority="false";
    canvas.dataset.labHoveredTerminal="";
    canvas.dataset.labTerminalLabelFeedback="none";
    canvas.dataset.labTerminalContrastFeedback="none";
    canvas.dataset.labCommittedWireEndpointFeedbackCount="0";
    canvas.dataset.labWireHighlightFeedback="none";
    updateInspectionBadge();
  }
  resetLabMetadata();
  resetWiringMetadata();
  canvas.dataset.lessonButtonActuationMode="off";
  canvas.dataset.lessonButtonActuation="off";
  canvas.dataset.lessonButtonActuationLesson="";
  canvas.dataset.lessonButtonPressed="false";
  canvas.dataset.lessonButtonCapY="";
  canvas.dataset.lessonButtonPhysicalVerified="false";
  canvas.dataset.lessonButtonElectricalAuthority="false";
  refreshSceneVisualDiagnostics();
  function clearLabWireLayer(clearHighlight=true,preserveRevision=false){
    if(labWireLayer){
      activeLabLayer?.remove(labWireLayer);
      disposeTree(labWireLayer,sharedMaterialSet);
      labWireLayer=null;
    }
    labWireObjects.length=0;
    if(!preserveRevision)labWireGeometryRevision=0;
    canvas.dataset.labWireCount="0";
    canvas.dataset.labWireRouteMode="none";
    canvas.dataset.labWireRoutePointCount="0";
    canvas.dataset.labWireGeometryRevision=String(labWireGeometryRevision);
    if(clearHighlight){
      highlightedLabWireId=null;
      canvas.dataset.labHighlightedWire="";
      canvas.dataset.labWireHighlightFeedback="none";
      canvas.dataset.labCommittedWireEndpointFeedbackCount="0";
      refreshLabInteractionFeedback();
    }
  }
  function refreshLabWireHighlight(){
    const modelHas=highlightedLabWireId!==null&&
      lastWiringModel?.wires?.some(wire=>wire.id===highlightedLabWireId)===true;
    const rendered=modelHas
      ? labWireObjects.find(item=>item.wireId===highlightedLabWireId)||null
      : null;
    if(!rendered)highlightedLabWireId=null;
    for(const item of labWireObjects){
      if(item.highlightBackdropLine)item.highlightBackdropLine.visible=item.wireId===highlightedLabWireId;
      if(item.highlightLine)item.highlightLine.visible=item.wireId===highlightedLabWireId;
    }
    canvas.dataset.labHighlightedWire=highlightedLabWireId||"";
    canvas.dataset.labWireHighlightFeedback=highlightedLabWireId?"contrast-line+endpoints":"none";
    refreshLabInteractionFeedback();
  }
  function sameCommittedWireIdentity(left,right){
    if(!left||!right||left.id!==right.id)return false;
    return (left.from===right.from&&left.to===right.to)||
      (left.from===right.to&&left.to===right.from);
  }
  function sameCommittedWireRepairIdentity(intent,canonical){
    // The repair intent uses the public field `wireId`, while committed
    // graph wires use `id`. Comparing these raw records directly falsely
    // rejects EVERY legitimate repair gesture even when the selected route
    // and both endpoints are current and canonical.
    return !!intent&&sameCommittedWireIdentity({
      id:intent.wireId,from:intent.from,to:intent.to,
    },canonical);
  }
  function updateLabWireGeometry(){
    if(!labWireObjects.length)return;
    scene.updateMatrixWorld(true);
    for(let index=0;index<labWireObjects.length;index+=1){
      const item=labWireObjects[index];
      const from=labTerminals.get(item.from)?.marker;
      const to=labTerminals.get(item.to)?.marker;
      if(!from||!to)continue;
      const start=new T.Vector3(),end=new T.Vector3();
      from.getWorldPosition(start);to.getWorldPosition(end);
      const direction=end.x>=start.x?1:-1;
      const lead=Math.min(.36,Math.max(.16,Math.abs(end.x-start.x)*.12));
      const routeOffset=((index%5)-2)*.085;
      const laneY=Math.max(start.y,end.y)+.34+(index%4)*.065;
      const midX=(start.x+end.x)/2+routeOffset;
      const points=[
        start,
        new T.Vector3(start.x,laneY,start.z),
        new T.Vector3(start.x+direction*lead,laneY,start.z),
        new T.Vector3(midX,laneY,start.z),
        new T.Vector3(midX,laneY,end.z),
        new T.Vector3(end.x-direction*lead,laneY,end.z),
        new T.Vector3(end.x,laneY,end.z),
        end,
      ];
      const position=item.line.geometry.getAttribute("position");
      for(let pointIndex=0;pointIndex<LAB_COMMITTED_WIRE_ROUTE_POINTS;pointIndex+=1){
        const point=points[pointIndex];
        position.setXYZ(pointIndex,point.x,point.y,point.z);
      }
      position.needsUpdate=true;
      item.line.geometry.computeBoundingSphere();
    }
    labWireGeometryRevision+=1;
    canvas.dataset.labWireGeometryRevision=String(labWireGeometryRevision);
  }
  function refreshLabWireLayer(preserveRevision=false){
    clearLabWireLayer(false,preserveRevision);
    if(!activeLabLayer||!activeLabLayout||!lastWiringModel?.wires?.length){
      refreshLabWireHighlight();
      return;
    }
    labWireLayer=new T.Group();
    labWireLayer.userData={kind:"lab-conceptual-wires",physicalLocation:false,physicalVerified:false};
    activeLabLayer.add(labWireLayer);
    for(const wire of lastWiringModel.wires){
      if(!labTerminals.has(wire.from)||!labTerminals.has(wire.to))continue;
      const geometry=new T.BufferGeometry();
      geometry.setAttribute("position",new T.Float32BufferAttribute(LAB_COMMITTED_WIRE_ROUTE_POINTS*3,3));
      const line=new T.Line(geometry,new T.LineBasicMaterial({
        color:WIRING_COLORS[wire.status]??WIRING_COLORS.unverified,
        transparent:true,opacity:.94
      }));
      line.userData={
        kind:"lab-conceptual-wire",wireId:wire.id,from:wire.from,to:wire.to,
        netId:wire.netId,status:wire.status,physicalLocation:false,physicalVerified:false,
        routeModel:"elevated-multisegment",routePointCount:LAB_COMMITTED_WIRE_ROUTE_POINTS,
      };
      const highlightBackdropLine=new T.Line(geometry,sharedMaterials.highlightedWireBackdropMat);
      highlightBackdropLine.visible=false;
      highlightBackdropLine.position.y=.010;
      highlightBackdropLine.renderOrder=5;
      highlightBackdropLine.userData={
        kind:"lab-conceptual-wire-highlight-backdrop",wireId:wire.id,
        committed:true,visualOnly:true,physicalLocation:false,physicalVerified:false,electricalAuthority:false,
      };
      const highlightLine=new T.Line(geometry,sharedMaterials.highlightedWireLineMat);
      highlightLine.visible=false;
      highlightLine.position.y=.024;
      highlightLine.renderOrder=6;
      highlightLine.userData={
        kind:"lab-conceptual-wire-highlight",wireId:wire.id,
        committed:true,visualOnly:true,physicalLocation:false,physicalVerified:false,electricalAuthority:false,
      };
      labWireLayer.add(line);
      labWireLayer.add(highlightBackdropLine);
      labWireLayer.add(highlightLine);
      labWireObjects.push({line,highlightBackdropLine,highlightLine,wireId:wire.id,from:wire.from,to:wire.to});
    }
    updateLabWireGeometry();
    canvas.dataset.labWireCount=String(labWireObjects.length);
    canvas.dataset.labWireRouteMode=labWireObjects.length?"elevated-multisegment":"none";
    canvas.dataset.labWireRoutePointCount=labWireObjects.length?String(LAB_COMMITTED_WIRE_ROUTE_POINTS):"0";
    refreshLabWireHighlight();
  }
  function canonicalLabComponent(componentId){
    return activeLabLayout?.components?.find(item=>item.id===componentId)||null;
  }
  function clearLabTerminalHover(redraw=false){
    const changed=hoveredLabTerminalId!==null;
    hoveredLabTerminalId=null;
    if(changed){
      refreshLabInteractionFeedback();
      if(redraw)invalidate();
    }
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
    pendingWirePreviewLine.renderOrder=8;
    pendingWirePreviewLine.userData={
      kind:"lab-pending-wire-preview",committed:false,
      visualOnly:true,physicalLocation:false,physicalVerified:false,electricalState:false,electricalAuthority:false,
    };
    activeLabLayer.add(pendingWirePreviewLine);
    return pendingWirePreviewLine;
  }
  function updateWirePreviewGeometry(fromId,toId){
    if(!pendingWirePreviewLine||!fromId||!toId)return false;
    const from=labTerminals.get(fromId)?.marker;
    const to=labTerminals.get(toId)?.marker;
    if(!from||!to)return false;
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
    return true;
  }
  function updatePendingWirePreviewGeometry(){
    if(!updateWirePreviewGeometry(pendingWireTerminalId,pendingWireHoverTerminalId)){
      clearPendingWireHover(false);
    }
  }
  function authoredGuideResult(){
    return Object.freeze({
      active:authoredPairGuide!==null,
      mode:authoredPairGuide?"view-only":"none",
      from:authoredPairGuide?.from??null,
      to:authoredPairGuide?.to??null,
      physicalVerified:false,
      electricalAuthority:false,
    });
  }
  function isCanonicalAuthoredGuideTerminal(terminalId,layout=activeLabLayout){
    if(!layout||typeof terminalId!=="string")return false;
    const terminalMap=layout.terminalMap;
    const canonical=terminalMap&&Object.prototype.hasOwnProperty.call(terminalMap,terminalId)
      ? terminalMap[terminalId] : null;
    return canonical?.terminalId===terminalId&&labTerminals.has(terminalId);
  }
  function clearAuthoredPairGuide(redraw=false){
    const changed=authoredPairGuide!==null||authoredPairGuideLayer!==null;
    if(authoredPairGuideLayer){
      activeLabLayer?.remove(authoredPairGuideLayer);
      disposeTree(authoredPairGuideLayer,sharedMaterialSet);
    }
    authoredPairGuide=null;
    authoredPairGuideLayer=null;
    authoredPairGuideBackdropLine=null;
    authoredPairGuideDashLine=null;
    authoredPairGuideRestorePair=null;
    canvas.dataset.labAuthoredGuideMode="none";
    canvas.dataset.labAuthoredGuideFrom="";
    canvas.dataset.labAuthoredGuideTo="";
    if(changed)refreshCanvasAccessibility();
    if(redraw&&changed)invalidate();
    return authoredGuideResult();
  }
  function updateAuthoredPairGuideGeometry(){
    if(!authoredPairGuide||!authoredPairGuideBackdropLine||!authoredPairGuideDashLine)return false;
    const from=labTerminals.get(authoredPairGuide.from)?.marker;
    const to=labTerminals.get(authoredPairGuide.to)?.marker;
    if(!from||!to)return false;
    scene.updateMatrixWorld(true);
    const start=new T.Vector3(),end=new T.Vector3();
    from.getWorldPosition(start);to.getWorldPosition(end);
    const laneY=Math.max(start.y,end.y)+.28;
    const midX=(start.x+end.x)/2;
    const points=[
      start,
      new T.Vector3(start.x,laneY,start.z),
      new T.Vector3(midX,laneY,start.z),
      new T.Vector3(midX,laneY,end.z),
      new T.Vector3(end.x,laneY,end.z),
      end,
    ];
    const position=authoredPairGuideDashLine.geometry.getAttribute("position");
    for(let index=0;index<LAB_AUTHORED_GUIDE_ROUTE_POINTS;index+=1){
      const point=points[index];
      position.setXYZ(index,point.x,point.y,point.z);
    }
    position.needsUpdate=true;
    authoredPairGuideDashLine.geometry.computeBoundingSphere();
    authoredPairGuideDashLine.computeLineDistances();
    return true;
  }
  function mountAuthoredPairGuide(pair){
    if(!activeLabLayer||!isCanonicalAuthoredGuideTerminal(pair.from)||!isCanonicalAuthoredGuideTerminal(pair.to)){
      return false;
    }
    const geometry=new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(LAB_AUTHORED_GUIDE_ROUTE_POINTS*3,3)
    );
    authoredPairGuideLayer=new T.Group();
    authoredPairGuideLayer.userData={
      kind:"lab-authored-pair-guide",from:pair.from,to:pair.to,
      viewOnly:true,committed:false,visualOnly:true,
      physicalLocation:false,physicalVerified:false,electricalAuthority:false,
    };
    authoredPairGuideBackdropLine=new T.Line(geometry,sharedMaterials.authoredGuideBackdropMat);
    authoredPairGuideBackdropLine.renderOrder=3;
    authoredPairGuideBackdropLine.userData={
      kind:"lab-authored-pair-guide-contrast",from:pair.from,to:pair.to,
      viewOnly:true,committed:false,visualOnly:true,
      physicalLocation:false,physicalVerified:false,electricalAuthority:false,
    };
    authoredPairGuideDashLine=new T.Line(geometry,sharedMaterials.authoredGuideDashMat);
    authoredPairGuideDashLine.renderOrder=4;
    authoredPairGuideDashLine.userData={
      kind:"lab-authored-pair-guide-dash",from:pair.from,to:pair.to,
      viewOnly:true,committed:false,visualOnly:true,
      physicalLocation:false,physicalVerified:false,electricalAuthority:false,
    };
    authoredPairGuideLayer.add(authoredPairGuideBackdropLine);
    authoredPairGuideLayer.add(authoredPairGuideDashLine);
    activeLabLayer.add(authoredPairGuideLayer);
    authoredPairGuide=Object.freeze({from:pair.from,to:pair.to});
    if(!updateAuthoredPairGuideGeometry()){
      clearAuthoredPairGuide(false);
      return false;
    }
    canvas.dataset.labAuthoredGuideMode="view-only";
    canvas.dataset.labAuthoredGuideFrom=pair.from;
    canvas.dataset.labAuthoredGuideTo=pair.to;
    refreshCanvasAccessibility();
    invalidate();
    return true;
  }
  function normalizeAuthoredPairGuide(pair){
    if(!pair||typeof pair!=="object"||Array.isArray(pair)){
      throw new TypeError("Authored terminal pair phải là object {from,to} hoặc null");
    }
    const prototype=Object.getPrototypeOf(pair);
    if(prototype!==Object.prototype&&prototype!==null){
      throw new TypeError("Authored terminal pair phải dùng own properties");
    }
    const ownKeys=Reflect.ownKeys(pair);
    if(ownKeys.length!==2||
      !Object.prototype.hasOwnProperty.call(pair,"from")||
      !Object.prototype.hasOwnProperty.call(pair,"to")){
      throw new TypeError("Authored terminal pair phải có đúng own fields from và to");
    }
    const from=pair.from,to=pair.to;
    for(const [label,terminalId] of [["from",from],["to",to]]){
      if(typeof terminalId!=="string"||!terminalId||terminalId.trim()!==terminalId){
        throw new TypeError(label+" authored terminal phải là canonical ID không rỗng");
      }
      if(terminalId.length>80)throw new RangeError(label+" authored terminal vượt giới hạn 80 ký tự");
      if(["__proto__","prototype","constructor"].includes(terminalId)){
        throw new RangeError(label+" authored terminal không phải canonical own ID");
      }
    }
    if(from===to)throw new RangeError("Authored terminal pair phải gồm hai terminal khác nhau");
    if(contextLost)throw new RangeError("Authored terminal guide không khả dụng khi WebGL context đang mất");
    if(!activeLabLayout)throw new RangeError("Authored terminal guide cần active conceptual lab layout");
    if(labEdit.enabled)throw new RangeError("Authored terminal guide chỉ khả dụng khi lab edit đang tắt");
    if(drag?.kind==="terminal"||terminalLinkDragSourceId!==null||terminalLinkDragTargetId!==null){
      throw new RangeError("Authored terminal guide không khả dụng trong terminal gesture đang hoạt động");
    }
    if(!isCanonicalAuthoredGuideTerminal(from)||!isCanonicalAuthoredGuideTerminal(to)){
      throw new RangeError("Authored terminal pair không thuộc active canonical lab layout");
    }
    return Object.freeze({from,to});
  }
  function setAuthoredPairGuide(pair){
    if(disposed)return authoredGuideResult();
    if(pair===null)return clearAuthoredPairGuide(true);
    const normalized=normalizeAuthoredPairGuide(pair);
    clearAuthoredPairGuide(false);
    if(!mountAuthoredPairGuide(normalized)){
      throw new RangeError("Không thể dựng authored terminal guide trên active lab layout");
    }
    return authoredGuideResult();
  }
  function breadboardHoleStudyStatus(ok){
    const active=canvas.dataset.labBreadboardHoleStudyMode==="conceptual-strip-study"&&
      breadboardHoleStudyLayer!==null&&breadboardHoleStudyMesh!==null;
    return Object.freeze({
      ok:Boolean(ok),
      enabled:breadboardHoleStudy.enabled===true,
      active,
      profileId:breadboardHoleStudy.profileId,
      selectedHoleId:breadboardHoleStudy.selectedHoleId,
      holeCount:BREADBOARD_STUDY_HOLE_COUNT,
      mode:active?"conceptual-strip-study":"none",
      physicalVerified:false,
    });
  }
  function activeBreadboardStudyEntry(){
    if(!activeLabLayout||!activeLabLayer||activeLabLayer.visible===false)return null;
    for(const [componentId,entry] of labComponents){
      if(entry?.component?.visualKind!=="breadboard"||entry.root?.visible===false)continue;
      return {componentId,entry};
    }
    return null;
  }
  function clearBreadboardHoleStudyVisual(redraw=false){
    const changed=breadboardHoleStudyLayer!==null||
      canvas.dataset.labBreadboardHoleStudyMode!=="none";
    resetBreadboardHoleLinkIntent(false);
    if(breadboardHoleStudyLayer){
      breadboardHoleStudyLayer.parent?.remove(breadboardHoleStudyLayer);
      disposeTree(breadboardHoleStudyLayer,sharedMaterialSet);
    }
    breadboardHoleStudyLayer=null;
    breadboardHoleStudyMesh=null;
    breadboardHoleStudyHalo=null;
    breadboardHoleStudyComponentId=null;
    breadboardHoleStudyLayoutRef=null;
    canvas.dataset.labBreadboardHoleStudyMode="none";
    canvas.dataset.labBreadboardHoleStudyProfile="";
    canvas.dataset.labBreadboardHoleSelected="";
    canvas.dataset.labBreadboardHoleCount="0";
    canvas.dataset.labBreadboardHolePhysicalVerified="false";
    if(changed)refreshCanvasAccessibility();
    if(redraw&&changed)invalidate();
  }
  function resetBreadboardHoleStudy(redraw=false){
    cancelBreadboardHoleStudyPointer(false);
    clearBreadboardHoleStudyVisual(false);
    breadboardHoleStudy={
      enabled:false,profileId:null,selectedHoleId:null,onHoleSelect:null
    };
    if(redraw)invalidate();
    return breadboardHoleStudyStatus(true);
  }
  function refreshBreadboardHoleStudySelection(){
    if(!breadboardHoleStudyHalo||!breadboardHoleStudyLayer){
      canvas.dataset.labBreadboardHoleSelected="";
      return false;
    }
    const entry=labComponents.get(breadboardHoleStudyComponentId);
    const selected=breadboardHoleStudy.selectedHoleId;
    const position=entry&&selected
      ? breadboardStudyLocalPosition(entry.component,selected,new T.Vector3()) : null;
    if(!position){
      breadboardHoleStudyHalo.visible=false;
      canvas.dataset.labBreadboardHoleSelected="";
      return false;
    }
    breadboardHoleStudyHalo.position.copy(position);
    breadboardHoleStudyHalo.position.y+=.026;
    breadboardHoleStudyHalo.visible=true;
    canvas.dataset.labBreadboardHoleSelected=selected;
    return true;
  }
  function mountBreadboardHoleStudyVisual(){
    if(!breadboardHoleStudy.enabled||!labEdit.enabled||contextLost||disposed)return false;
    const found=activeBreadboardStudyEntry();
    if(!found)return false;
    const {componentId,entry}=found;
    const width=entry.component.width*LAB_WORLD_SCALE;
    const depth=entry.component.depth*LAB_WORLD_SCALE;
    const spacing=width*.78/(BREADBOARD_STUDY_COLUMNS-1);
    const radius=Math.max(.007,Math.min(.018,spacing*.40,depth*.013));
    const geometry=new T.CylinderGeometry(radius,radius,.012,6);
    breadboardHoleStudyMesh=new T.InstancedMesh(
      geometry,sharedMaterials.breadboardStudyHoleMat,BREADBOARD_STUDY_HOLE_COUNT
    );
    const matrix=new T.Matrix4(),position=new T.Vector3();
    for(let instanceId=0;instanceId<BREADBOARD_STUDY_HOLE_COUNT;instanceId+=1){
      const holeId=breadboardStudyHoleId(instanceId);
      breadboardStudyLocalPosition(entry.component,holeId,position);
      matrix.makeTranslation(position.x,position.y,position.z);
      breadboardHoleStudyMesh.setMatrixAt(instanceId,matrix);
    }
    breadboardHoleStudyMesh.instanceMatrix.needsUpdate=true;
    breadboardHoleStudyMesh.castShadow=false;
    breadboardHoleStudyMesh.receiveShadow=false;
    breadboardHoleStudyMesh.userData={
      kind:"lab-breadboard-hole-study-instances",
      profileId:breadboardHoleStudy.profileId,
      identityModel:"row-major-A1-through-J63",
      visualInstanceCount:BREADBOARD_STUDY_HOLE_COUNT,
      conceptualStudy:true,railInference:false,breadboardHoleMapping:false,
      electricalAuthority:false,physicalLocation:false,physicalVerified:false,
    };
    breadboardHoleStudyHalo=new T.Mesh(
      new T.RingGeometry(radius*1.45,radius*2.65,18),
      sharedMaterials.breadboardStudySelectedMat
    );
    breadboardHoleStudyHalo.rotation.x=-Math.PI/2;
    breadboardHoleStudyHalo.visible=false;
    breadboardHoleStudyHalo.renderOrder=12;
    breadboardHoleStudyHalo.userData={
      kind:"lab-breadboard-hole-study-selection",
      conceptualStudy:true,visualOnly:true,railInference:false,
      breadboardHoleMapping:false,electricalAuthority:false,
      physicalLocation:false,physicalVerified:false,
    };
    breadboardHoleStudyLayer=new T.Group();
    breadboardHoleStudyLayer.userData={
      kind:"lab-breadboard-hole-study",
      profileId:breadboardHoleStudy.profileId,
      holeCount:BREADBOARD_STUDY_HOLE_COUNT,
      conceptualStudy:true,railInference:false,breadboardHoleMapping:false,
      electricalAuthority:false,physicalLocation:false,physicalVerified:false,
    };
    breadboardHoleStudyLayer.add(breadboardHoleStudyMesh);
    breadboardHoleStudyLayer.add(breadboardHoleStudyHalo);
    entry.root.add(breadboardHoleStudyLayer);
    breadboardHoleStudyComponentId=componentId;
    breadboardHoleStudyLayoutRef=activeLabLayout;
    canvas.dataset.labBreadboardHoleStudyMode="conceptual-strip-study";
    canvas.dataset.labBreadboardHoleStudyProfile=breadboardHoleStudy.profileId;
    canvas.dataset.labBreadboardHoleCount=String(BREADBOARD_STUDY_HOLE_COUNT);
    canvas.dataset.labBreadboardHolePhysicalVerified="false";
    refreshBreadboardHoleStudySelection();
    refreshCanvasAccessibility();
    invalidate();
    return true;
  }
  function syncBreadboardHoleStudy(redraw=false){
    const eligible=breadboardHoleStudy.enabled===true&&labEdit.enabled===true&&
      !contextLost&&!disposed&&activeBreadboardStudyEntry()!==null;
    if(!eligible){
      clearBreadboardHoleStudyVisual(redraw);
      return false;
    }
    const found=activeBreadboardStudyEntry();
    const current=breadboardHoleStudyLayer&&
      breadboardHoleStudyLayoutRef===activeLabLayout&&
      breadboardHoleStudyComponentId===found.componentId&&
      breadboardHoleStudyLayer.parent===found.entry.root&&
      breadboardHoleStudyMesh?.userData?.profileId===breadboardHoleStudy.profileId;
    if(!current){
      clearBreadboardHoleStudyVisual(false);
      if(!mountBreadboardHoleStudyVisual())return false;
    }else{
      refreshBreadboardHoleStudySelection();
      refreshCanvasAccessibility();
      if(redraw)invalidate();
    }
    return true;
  }
  function normalizeBreadboardHoleStudyProfileId(profileId){
    if(typeof profileId!=="string"||!profileId||profileId.trim()!==profileId){
      throw new TypeError("profileId breadboard hole study phải là chuỗi exact không rỗng");
    }
    if(profileId.length>BREADBOARD_STUDY_PROFILE_ID_MAX){
      throw new RangeError("profileId breadboard hole study vượt giới hạn");
    }
    if(["__proto__","prototype","constructor"].includes(profileId)){
      throw new RangeError("profileId breadboard hole study không hợp lệ");
    }
    return profileId;
  }
  function normalizeBreadboardHoleStudySelection(holeId){
    if(holeId===null)return null;
    if(breadboardStudyHoleIndex(holeId)<0){
      throw new RangeError("selectedHoleId breadboard hole study phải là canonical A1..J63 hoặc null");
    }
    return holeId;
  }
  function setBreadboardHoleStudy(options={}){
    if(disposed)return breadboardHoleStudyStatus(false);
    if(!options||typeof options!=="object"||Array.isArray(options)){
      throw new TypeError("Breadboard hole study options phải là object");
    }
    if(options.enabled!==true){
      return resetBreadboardHoleStudy(true);
    }
    const nextProfile=normalizeBreadboardHoleStudyProfileId(
      options.profileId===undefined?breadboardHoleStudy.profileId:options.profileId
    );
    const profileChanged=nextProfile!==breadboardHoleStudy.profileId;
    const nextSelected=options.selectedHoleId===undefined
      ? (profileChanged?null:breadboardHoleStudy.selectedHoleId)
      : normalizeBreadboardHoleStudySelection(options.selectedHoleId);
    const nextCallback=options.onHoleSelect===undefined
      ? breadboardHoleStudy.onHoleSelect : options.onHoleSelect;
    if(nextCallback!==null&&typeof nextCallback!=="function"){
      throw new TypeError("onHoleSelect breadboard hole study phải là function hoặc null");
    }
    cancelBreadboardHoleStudyPointer(false);
    if(profileChanged)clearBreadboardHoleStudyVisual(false);
    breadboardHoleStudy={
      enabled:true,profileId:nextProfile,selectedHoleId:nextSelected,onHoleSelect:nextCallback
    };
    const active=syncBreadboardHoleStudy(true);
    return breadboardHoleStudyStatus(active);
  }
  function breadboardHoleLinkStatus(ok=true){
    return Object.freeze({
      ok:Boolean(ok),
      mode:breadboardHoleLinkIntent.mode,
      active:breadboardHoleLinkIntent.mode!=="off"&&breadboardHoleStudyActive(),
      profileId:breadboardHoleLinkIntent.profileId,
      firstHoleId:breadboardHoleLinkIntent.firstHoleId,
      secondHoleId:breadboardHoleLinkIntent.secondHoleId,
      hoverHoleId:breadboardHoleLinkHoverId,
      preview:breadboardHoleLinkPreview,
      physicalVerified:false,
      electricalAuthority:false,
    });
  }
  function syncBreadboardHoleLinkDatasets(){
    canvas.dataset.labHoleLinkMode=breadboardHoleLinkIntent.mode;
    canvas.dataset.labHoleLinkFirst=breadboardHoleLinkIntent.firstHoleId||"";
    canvas.dataset.labHoleLinkSecond=breadboardHoleLinkIntent.secondHoleId||"";
    canvas.dataset.labHoleLinkHover=breadboardHoleLinkHoverId||"";
    canvas.dataset.labHoleLinkPreview=breadboardHoleLinkPreview;
    canvas.dataset.labHoleLinkElectricalAuthority="false";
  }
  function clearBreadboardHoleLinkLine(){
    if(!breadboardHoleLinkLine)return false;
    breadboardHoleLinkLine.parent?.remove(breadboardHoleLinkLine);
    disposeTree(breadboardHoleLinkLine,sharedMaterialSet);
    breadboardHoleLinkLine=null;
    return true;
  }
  function clearBreadboardHoleLinkHover(redraw=false){
    const changed=breadboardHoleLinkHoverId!==null||
      breadboardHoleLinkPreview==="valid"||breadboardHoleLinkPreview==="invalid";
    breadboardHoleLinkHoverId=null;
    if(breadboardHoleLinkIntent.mode==="await-end"){
      clearBreadboardHoleLinkLine();
      breadboardHoleLinkPreview="none";
    }
    syncBreadboardHoleLinkDatasets();
    if(redraw&&changed)invalidate();
    return changed;
  }
  function resetBreadboardHoleLinkIntent(redraw=false){
    cancelBreadboardHoleLinkPointer(false);
    const changed=breadboardHoleLinkIntent.mode!=="off"||breadboardHoleLinkLine!==null||
      breadboardHoleLinkHoverId!==null||breadboardHoleLinkPreview!=="none";
    clearBreadboardHoleLinkLine();
    breadboardHoleLinkHoverId=null;
    breadboardHoleLinkPreview="none";
    breadboardHoleLinkIntent={
      mode:"off",profileId:null,firstHoleId:null,secondHoleId:null,onHoleLinkDrop:null
    };
    syncBreadboardHoleLinkDatasets();
    if(changed)refreshCanvasAccessibility();
    if(redraw&&changed)invalidate();
    return breadboardHoleLinkStatus(true);
  }
  function normalizeBreadboardHoleLinkMode(value){
    if(typeof value!=="string"||!BREADBOARD_HOLE_LINK_MODES.has(value)){
      throw new RangeError("mode breadboard hole link phải là off, await-start, await-end hoặc ready");
    }
    return value;
  }
  function normalizeBreadboardHoleLinkHole(holeId,label,{nullable=false}={}){
    if(holeId==null&&nullable)return null;
    if(typeof holeId!=="string"||breadboardStudyHoleIndex(holeId)<0){
      throw new RangeError(label+" phải là canonical A1..J63"+(nullable?" hoặc null":""));
    }
    return holeId;
  }
  function breadboardHoleStudyInstanceLocalPosition(holeId,target=new T.Vector3()){
    if(!breadboardHoleStudyMesh)return null;
    const instanceId=breadboardStudyHoleIndex(holeId);
    if(instanceId<0||instanceId>=breadboardHoleStudyMesh.count)return null;
    breadboardHoleStudyMesh.getMatrixAt(instanceId,breadboardHoleLinkMatrix);
    return target.setFromMatrixPosition(breadboardHoleLinkMatrix);
  }
  function ensureBreadboardHoleLinkLine(){
    if(breadboardHoleLinkLine||!breadboardHoleStudyLayer)return breadboardHoleLinkLine;
    const geometry=new T.BufferGeometry();
    geometry.setAttribute(
      "position",new T.Float32BufferAttribute(BREADBOARD_HOLE_LINK_ROUTE_POINTS*3,3)
    );
    breadboardHoleLinkLine=new T.Line(geometry,sharedMaterials.breadboardHoleLinkValidMat);
    breadboardHoleLinkLine.visible=false;
    breadboardHoleLinkLine.renderOrder=13;
    breadboardHoleLinkLine.userData={
      kind:"lab-breadboard-hole-link-ghost",visualOnly:true,committed:false,
      conceptualStudy:true,breadboardHoleMapping:false,electricalAuthority:false,
      physicalLocation:false,physicalVerified:false,
    };
    breadboardHoleStudyLayer.add(breadboardHoleLinkLine);
    return breadboardHoleLinkLine;
  }
  function updateBreadboardHoleLinkGeometry(targetHoleId,preview){
    const sourceId=breadboardHoleLinkIntent.firstHoleId;
    if(!sourceId||!targetHoleId||!breadboardHoleStudyActive()||
      breadboardHoleLinkIntent.profileId!==breadboardHoleStudy.profileId)return false;
    const start=breadboardHoleStudyInstanceLocalPosition(sourceId,breadboardHoleLinkStart);
    const end=breadboardHoleStudyInstanceLocalPosition(targetHoleId,breadboardHoleLinkEnd);
    const line=ensureBreadboardHoleLinkLine();
    if(!start||!end||!line)return false;
    const mid=start.clone().lerp(end,.5);
    mid.y=Math.max(start.y,end.y)+.075;
    const position=line.geometry.getAttribute("position");
    position.setXYZ(0,start.x,start.y+.018,start.z);
    position.setXYZ(1,mid.x,mid.y,mid.z);
    position.setXYZ(2,end.x,end.y+.018,end.z);
    position.needsUpdate=true;
    line.geometry.computeBoundingSphere();
    line.material=preview==="ready"
      ? sharedMaterials.breadboardHoleLinkReadyMat
      : preview==="valid"
        ? sharedMaterials.breadboardHoleLinkValidMat
        : sharedMaterials.breadboardHoleLinkInvalidMat;
    line.userData={
      ...line.userData,from:sourceId,to:targetHoleId,preview,
    };
    line.visible=true;
    if(preview==="ready")line.computeLineDistances();
    breadboardHoleLinkPreview=preview;
    return true;
  }
  function renderBreadboardHoleLinkReady(){
    if(breadboardHoleLinkIntent.mode!=="ready"||
      !breadboardHoleLinkIntent.firstHoleId||!breadboardHoleLinkIntent.secondHoleId)return false;
    const rendered=updateBreadboardHoleLinkGeometry(
      breadboardHoleLinkIntent.secondHoleId,"ready"
    );
    if(!rendered){
      clearBreadboardHoleLinkLine();
      breadboardHoleLinkPreview="none";
    }
    syncBreadboardHoleLinkDatasets();
    return rendered;
  }
  function sameBreadboardHoleLinkSemantic(left,right){
    return left.mode===right.mode&&left.profileId===right.profileId&&
      left.firstHoleId===right.firstHoleId&&left.secondHoleId===right.secondHoleId;
  }
  function setBreadboardHoleLinkIntent(options={mode:"off"}){
    if(disposed)return breadboardHoleLinkStatus(false);
    if(!options||typeof options!=="object"||Array.isArray(options)){
      throw new TypeError("Breadboard hole link intent phải là object");
    }
    if(Object.getPrototypeOf(options)!==Object.prototype&&Object.getPrototypeOf(options)!==null){
      throw new TypeError("Breadboard hole link intent phải dùng own properties");
    }
    const ownValue=(key,fallback=undefined)=>{
      if(!Object.prototype.hasOwnProperty.call(options,key))return fallback;
      const descriptor=Object.getOwnPropertyDescriptor(options,key);
      if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,"value")){
        throw new TypeError("Breadboard hole link intent không nhận getter/setter: "+key);
      }
      return descriptor.value;
    };
    const mode=normalizeBreadboardHoleLinkMode(ownValue("mode","off"));
    if(mode==="off")return resetBreadboardHoleLinkIntent(true);
    if(!breadboardHoleStudyActive()){
      throw new RangeError("Breadboard hole link intent cần 630-hole study active hiện tại");
    }
    const profileId=normalizeBreadboardHoleStudyProfileId(ownValue("profileId"));
    if(profileId!==breadboardHoleStudy.profileId){
      throw new RangeError("Breadboard hole link intent không khớp profile study hiện tại");
    }
    let firstHoleId=null,secondHoleId=null;
    if(mode==="await-start"){
      if(ownValue("firstHoleId",null)!=null||ownValue("secondHoleId",null)!=null){
        throw new RangeError("await-start chưa được mang endpoint hole");
      }
    }else if(mode==="await-end"){
      firstHoleId=normalizeBreadboardHoleLinkHole(ownValue("firstHoleId"),"firstHoleId");
      if(ownValue("secondHoleId",null)!=null){
        throw new RangeError("await-end chỉ có firstHoleId; secondHoleId phải null");
      }
    }else{
      firstHoleId=normalizeBreadboardHoleLinkHole(ownValue("firstHoleId"),"firstHoleId");
      secondHoleId=normalizeBreadboardHoleLinkHole(ownValue("secondHoleId"),"secondHoleId");
      if(firstHoleId===secondHoleId){
        throw new RangeError("ready cần hai hole ID canonical khác nhau");
      }
    }
    const callback=ownValue("onHoleLinkDrop",breadboardHoleLinkIntent.onHoleLinkDrop);
    if(callback!==null&&typeof callback!=="function"){
      throw new TypeError("onHoleLinkDrop phải là function hoặc null");
    }
    const next={mode,profileId,firstHoleId,secondHoleId,onHoleLinkDrop:callback};
    const semanticSame=sameBreadboardHoleLinkSemantic(breadboardHoleLinkIntent,next);
    if(semanticSame){
      breadboardHoleLinkIntent={...breadboardHoleLinkIntent,onHoleLinkDrop:callback};
      if(mode==="ready"&&!breadboardHoleLinkLine)renderBreadboardHoleLinkReady();
      syncBreadboardHoleLinkDatasets();
      return breadboardHoleLinkStatus(true);
    }
    cancelBreadboardHoleLinkPointer(false);
    clearBreadboardHoleLinkLine();
    breadboardHoleLinkHoverId=null;
    breadboardHoleLinkPreview="none";
    breadboardHoleLinkIntent=next;
    if(mode==="ready"&&!renderBreadboardHoleLinkReady()){
      resetBreadboardHoleLinkIntent(false);
      throw new RangeError("Không thể dựng ready hole-link trên study hiện tại");
    }
    syncBreadboardHoleLinkDatasets();
    refreshCanvasAccessibility();
    invalidate();
    return breadboardHoleLinkStatus(true);
  }
  function refreshLabInteractionFeedback(){
    let highlightedTerminals=0;
    let committedEndpointFeedback=0;
    let hasHoverFeedback=false,hasPendingFeedback=false,hasInspectionFeedback=false,hasCommittedFeedback=false;
    const highlightedWire=highlightedLabWireId
      ? lastWiringModel?.wires?.find(wire=>wire.id===highlightedLabWireId)||null
      : null;
    const committedEndpoints=new Set(highlightedWire?[highlightedWire.from,highlightedWire.to]:[]);
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
    if(hoveredLabTerminalId!==null&&!labTerminals.has(hoveredLabTerminalId))hoveredLabTerminalId=null;
    let labelFeedback="none";
    for(const [terminalId,item] of labTerminals){
      const highlighted=labEdit.enabled&&item.componentId===selectedLabComponentId;
      const inspected=haloInspection&&terminalId===inspectedLabTerminalId;
      const pending=labEdit.enabled&&terminalId===pendingWireTerminalId;
      const hovered=labEdit.enabled&&terminalId===hoveredLabTerminalId;
      const dragSource=labEdit.enabled&&terminalId===terminalLinkDragSourceId;
      const dragTarget=labEdit.enabled&&terminalId===terminalLinkDragTargetId;
      const committed=committedEndpoints.has(terminalId);
      if(item.halo)item.halo.visible=highlighted;
      if(item.inspectionHalo)item.inspectionHalo.visible=inspected;
      if(item.pendingHalo)item.pendingHalo.visible=pending||dragSource;
      if(item.hoverHalo)item.hoverHalo.visible=(hovered||dragTarget)&&!pending&&!inspected&&!dragSource;
      if(item.contrastHalo)item.contrastHalo.visible=
        pending||inspected||hovered||dragSource||dragTarget||committed;
      if(item.committedHalo)item.committedHalo.visible=committed;
      if(item.feedbackLabel)item.feedbackLabel.visible=pending||inspected||hovered||dragSource||dragTarget;
      item.marker.scale.setScalar(
        pending||dragSource?1.42:inspected?1.32:hovered||dragTarget?1.24:committed?1.22:highlighted?1.18:1
      );
      if(dragSource)labelFeedback="drag-source";
      else if(dragTarget&&labelFeedback!=="drag-source")labelFeedback="drag-target";
      else if(pending)labelFeedback="pending";
      else if(inspected&&labelFeedback!=="pending")labelFeedback="inspection";
      else if(hovered&&labelFeedback==="none")labelFeedback="hover";
      if(highlighted)highlightedTerminals+=1;
      if(committed)committedEndpointFeedback+=1;
      hasPendingFeedback||=pending;
      hasInspectionFeedback||=inspected;
      hasHoverFeedback||=hovered;
      hasCommittedFeedback||=committed;
    }
    canvas.dataset.labSelectionFeedback=selectedLabComponentId?"outline":"none";
    canvas.dataset.labFocusFeedback=focusedLabComponentId?"outline":"none";
    canvas.dataset.labTerminalFeedback=highlightedTerminals?"selected-component":"base";
    canvas.dataset.labTerminalHighlightCount=String(highlightedTerminals);
    canvas.dataset.labInspectedTerminal=inspectedLabTerminalId||"";
    canvas.dataset.labInspectionFeedback=inspectedLabTerminalMode==="lab-halo"
      ? "highlight" : inspectedLabTerminalMode==="read-only-label" ? "label" : "none";
    canvas.dataset.labPendingWireTerminal=pendingWireTerminalId||"";
    canvas.dataset.labHoveredTerminal=hoveredLabTerminalId||"";
    canvas.dataset.labTerminalLabelFeedback=labelFeedback;
    canvas.dataset.labCommittedWireEndpointFeedbackCount=String(committedEndpointFeedback);
    canvas.dataset.labTerminalContrastFeedback=[
      hasPendingFeedback?"pending":"",
      hasInspectionFeedback?"inspection":"",
      hasHoverFeedback?"hover":"",
      hasCommittedFeedback?"committed":"",
    ].filter(Boolean).join("+")||"none";
    updateInspectionBadge();
  }
  function setLabVisualTransform(entry,x,z,quarterTurns){
    entry.x=x;entry.z=z;entry.quarterTurns=((quarterTurns%4)+4)%4;
    entry.root.position.set(x*LAB_WORLD_SCALE,0,z*LAB_WORLD_SCALE);
    entry.root.rotation.y=-entry.quarterTurns*Math.PI/2;
    updateLabWireGeometry();
    updatePendingWirePreviewGeometry();
    updateAuthoredPairGuideGeometry();
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
  function clearLabLayout(redraw=true,preserveWireHighlight=false,preserveWireRevision=false){
    const hadFocus=focusedLabComponentId!==null;
    cancelTerminalLinkPointer(false);
    cancelCommittedWireInspectPointer(false);
    resetCommittedWireRepairIntent(false);
    resetBreadboardHoleStudy(false);
    clearAuthoredPairGuide(false);
    clearLabWireLayer(!preserveWireHighlight,preserveWireRevision);
    if(activeLabLayer){
      scene.remove(activeLabLayer);
      disposeTree(activeLabLayer,sharedMaterialSet);
      activeLabLayer=null;
    }
    activeLabLayout=null;
    labComponents.clear();labTerminals.clear();labPickables.length=0;selectedLabComponentId=null;focusedLabComponentId=null;
    hoveredLabTerminalId=null;
    inspectedLabTerminalId=null;inspectedLabTerminalMode="none";
    clearPendingWireState(false);pendingWirePreviewLine=null;
    if(hadFocus)zoom=1;
    if(board?.board)board.board.visible=true;
    if(breadboard)breadboard.visible=true;
    if(activeModule?.module)activeModule.module.visible=true;
    if(activeWiringLayer)activeWiringLayer.visible=true;
    resetLabMetadata();
    if(preserveWireRevision){
      canvas.dataset.labWireGeometryRevision=String(labWireGeometryRevision);
    }
    refreshCanvasAccessibility();
    if(redraw&&!contextLost){
      applySceneLod(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),true);
    }
    refreshSceneVisualDiagnostics();
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
  function committedWireRepairMovedEndpoint(intent=committedWireRepairIntent){
    if(!intent?.enabled)return null;
    return intent.anchorTerminalId===intent.from?intent.to:
      intent.anchorTerminalId===intent.to?intent.from:null;
  }
  function syncCommittedWireRepairDatasets(){
    const moved=committedWireRepairMovedEndpoint();
    canvas.dataset.labCommittedWireRepairMode=committedWireRepairIntent.enabled
      ? "endpoint-reroute-preview" : "off";
    canvas.dataset.labCommittedWireRepairWire=committedWireRepairIntent.wireId||"";
    canvas.dataset.labCommittedWireRepairAnchor=committedWireRepairIntent.anchorTerminalId||"";
    canvas.dataset.labCommittedWireRepairMovedEndpoint=moved||"";
    canvas.dataset.labCommittedWireRepairTarget=committedWireRepairTargetId||"";
    canvas.dataset.labCommittedWireRepairPreview=committedWireRepairPreview;
    canvas.dataset.labCommittedWireRepairElectricalAuthority="false";
    canvas.dataset.labCommittedWireRepairPhysicalVerified="false";
  }
  function clearCommittedWireRepairTransient(redraw=false){
    const previousTarget=committedWireRepairTargetId;
    const changed=previousTarget!==null||committedWireRepairPreview!=="none"||
      committedWireRepairLine?.visible===true;
    committedWireRepairTargetId=null;
    committedWireRepairPreview="none";
    if(committedWireRepairLine)committedWireRepairLine.visible=false;
    if(previousTarget!==null&&hoveredLabTerminalId===previousTarget)hoveredLabTerminalId=null;
    syncCommittedWireRepairDatasets();
    if(changed)refreshLabInteractionFeedback();
    if(redraw&&changed)invalidate();
    return changed;
  }
  function disposeCommittedWireRepairLine(){
    if(!committedWireRepairLine)return false;
    committedWireRepairLine.parent?.remove(committedWireRepairLine);
    disposeTree(committedWireRepairLine,sharedMaterialSet);
    committedWireRepairLine=null;
    return true;
  }
  function committedWireRepairStatus(ok){
    const current=currentCommittedWireRepairRecord();
    return Object.freeze({
      ok:Boolean(ok),
      enabled:committedWireRepairIntent.enabled===true,
      active:current!==null,
      mode:current?"endpoint-reroute-preview":"off",
      wireId:current?.canonical?.id??null,
      from:current?.canonical?.from??null,
      to:current?.canonical?.to??null,
      anchorTerminalId:current?.anchorTerminalId??null,
      movedTerminalId:current?.movedTerminalId??null,
      targetTerminalId:committedWireRepairTargetId,
      preview:committedWireRepairPreview,
      physicalVerified:false,
      electricalAuthority:false,
    });
  }
  function resetCommittedWireRepairIntent(redraw=false){
    const activePointer=drag?.kind==="committed-wire-repair"?drag:null;
    if(activePointer){
      drag=null;
      moved=false;
      try{canvas.releasePointerCapture?.(activePointer.pointerId);}catch{}
    }
    const changed=committedWireRepairIntent.enabled||committedWireRepairLine!==null||
      committedWireRepairTargetId!==null||committedWireRepairPreview!=="none";
    clearCommittedWireRepairTransient(false);
    disposeCommittedWireRepairLine();
    committedWireRepairIntent={
      enabled:false,wireId:null,from:null,to:null,anchorTerminalId:null,onRerouteTarget:null
    };
    committedWireRepairLayoutRef=null;
    committedWireRepairLessonId=null;
    syncCommittedWireRepairDatasets();
    if(changed){
      refreshLabInteractionFeedback();
      refreshCanvasAccessibility();
      if(redraw)invalidate();
    }
    return committedWireRepairStatus(true);
  }
  function normalizeCommittedWireRepairTerminalId(value,label){
    if(typeof value!=="string"||!value||value.trim()!==value){
      throw new TypeError(label+" phải là terminal ID canonical exact không rỗng");
    }
    if(value.length>80||["__proto__","prototype","constructor"].includes(value)){
      throw new RangeError(label+" không hợp lệ");
    }
    return value;
  }
  function setCommittedWireRepairIntent(options={enabled:false}){
    if(disposed)return committedWireRepairStatus(false);
    if(!options||typeof options!=="object"||Array.isArray(options)){
      throw new TypeError("Committed wire repair options phải là object");
    }
    if(options.enabled!==true)return resetCommittedWireRepairIntent(true);
    const requiredKeys=["enabled","wireId","from","to","anchorTerminalId","onRerouteTarget"];
    const ownKeys=Reflect.ownKeys(options);
    if(ownKeys.length!==requiredKeys.length||ownKeys.some(key=>typeof key!=="string")||
      requiredKeys.some(key=>!Object.prototype.hasOwnProperty.call(options,key))){
      throw new TypeError("Committed wire repair enabled cần đúng 6 own fields");
    }
    if(!inspectableCommittedWireId(options.wireId)){
      throw new RangeError("wireId committed wire repair không hợp lệ");
    }
    const from=normalizeCommittedWireRepairTerminalId(options.from,"from");
    const to=normalizeCommittedWireRepairTerminalId(options.to,"to");
    const anchorTerminalId=normalizeCommittedWireRepairTerminalId(options.anchorTerminalId,"anchorTerminalId");
    if(from===to)throw new RangeError("Committed wire repair cần hai endpoint cũ khác nhau");
    if(anchorTerminalId!==from&&anchorTerminalId!==to){
      throw new RangeError("anchorTerminalId phải là một endpoint cũ của committed wire");
    }
    if(typeof options.onRerouteTarget!=="function"){
      throw new TypeError("onRerouteTarget phải là function");
    }
    if(!labEdit.enabled||!activeLabLayout||!lastWiringModel||contextLost||
      !Number.isFinite(currentLessonId)||activeLabLayout.lessonId!==currentLessonId){
      throw new RangeError("Committed wire repair chỉ khả dụng trong lab edit/layout/lesson hiện tại");
    }
    const canonical=lastWiringModel.wires.find(wire=>wire.id===options.wireId)||null;
    if(!canonical||!sameCommittedWireIdentity({id:options.wireId,from,to},canonical)){
      throw new RangeError("Committed wire repair không khớp wire ID và unordered endpoint pair canonical hiện tại");
    }
    for(const terminalId of [canonical.from,canonical.to]){
      if(!isActiveTerminalDragId(terminalId,activeLabLayout)){
        throw new RangeError("Committed wire repair có endpoint ngoài lab layout hiện tại: "+terminalId);
      }
    }
    const rendered=labWireObjects.find(item=>
      item.wireId===canonical.id&&sameRenderedCommittedWireIdentity(item,canonical)
    )||null;
    if(!rendered)throw new RangeError("Committed wire repair không có rendered committed route hiện tại");
    const sameSemantic=committedWireRepairIntent.enabled===true&&
      committedWireRepairLayoutRef===activeLabLayout&&
      committedWireRepairLessonId===currentLessonId&&
      committedWireRepairIntent.anchorTerminalId===anchorTerminalId&&
      sameCommittedWireRepairIdentity(committedWireRepairIntent,canonical);
    if(!sameSemantic){
      const activePointer=drag?.kind==="committed-wire-repair"?drag:null;
      if(activePointer){
        drag=null;moved=false;
        try{canvas.releasePointerCapture?.(activePointer.pointerId);}catch{}
      }
      clearCommittedWireRepairTransient(false);
      disposeCommittedWireRepairLine();
    }
    committedWireRepairIntent={
      enabled:true,wireId:canonical.id,from:canonical.from,to:canonical.to,
      anchorTerminalId,onRerouteTarget:options.onRerouteTarget
    };
    committedWireRepairLayoutRef=activeLabLayout;
    committedWireRepairLessonId=currentLessonId;
    syncCommittedWireRepairDatasets();
    refreshCanvasAccessibility();
    invalidate();
    return committedWireRepairStatus(true);
  }
  function setHighlightedLabWire(wireId){
    if(disposed)return Object.freeze({wireId:null,active:false,mode:"none",physicalVerified:false});
    if(wireId===null){
      if(committedWireRepairIntent.enabled)resetCommittedWireRepairIntent(false);
      highlightedLabWireId=null;
      refreshLabWireHighlight();
      refreshCanvasAccessibility();
      invalidate();
      return Object.freeze({wireId:null,active:false,mode:"none",physicalVerified:false});
    }
    if(typeof wireId!=="string"||!wireId||wireId.trim()!==wireId){
      throw new TypeError("wireId highlight phải là ID canonical không rỗng hoặc null");
    }
    if(wireId.length>LAB_WIRE_ID_MAX){
      throw new RangeError("wireId highlight vượt giới hạn "+LAB_WIRE_ID_MAX+" ký tự");
    }
    if(!activeLabLayout||!lastWiringModel){
      throw new RangeError("Wire highlight chỉ khả dụng khi conceptual lab và wiring canonical đang mount");
    }
    if(!lastWiringModel.wires.some(wire=>wire.id===wireId)){
      throw new RangeError("Wire highlight không thuộc canonical wiring model hiện tại: "+wireId);
    }
    if(!labWireObjects.some(item=>item.wireId===wireId)){
      throw new RangeError("Wire highlight không có committed route trong lab layout hiện tại: "+wireId);
    }
    if(committedWireRepairIntent.enabled&&committedWireRepairIntent.wireId!==wireId){
      resetCommittedWireRepairIntent(false);
    }
    highlightedLabWireId=wireId;
    refreshLabWireHighlight();
    refreshCanvasAccessibility();
    invalidate();
    return Object.freeze({
      wireId:highlightedLabWireId,
      active:true,
      mode:"committed-wire-highlight",
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
    resetLessonButtonActuation(false);
    const previousSelection=selectedLabComponentId;
    const previousFocus=focusedLabComponentId;
    const previousZoom=zoom;
    const previousAuthoredGuide=authoredPairGuide
      ? Object.freeze({from:authoredPairGuide.from,to:authoredPairGuide.to}) : null;
    const previousAuthoredGuideLesson=activeLabLayout?.lessonId??null;
    // A same-lesson logical placement rebuild must not revoke inspection of an
    // unchanged committed canonical edge. The route will be rebuilt from the
    // new terminal marker world positions below; stage/lesson/null clears still
    // use clearLabLayout() with the default fail-closed highlight reset.
    clearLabLayout(false,true,true);
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
        const collar=new T.Mesh(
          new T.CylinderGeometry(.11,.11,.024,14),
          sharedMaterials.collarMat,
        );
        collar.position.set(marker.position.x,marker.position.y-.070,marker.position.z);
        collar.userData={
          kind:"lab-terminal-collar-visual",terminalId,componentId:component.id,
          physicalLocation:false,physicalVerified:false,
        };
        root.add(collar);
        const contrastHalo=new T.Mesh(
          new T.RingGeometry(.14,.31,26),
          sharedMaterials.terminalContrastMat,
        );
        contrastHalo.rotation.x=-Math.PI/2;
        contrastHalo.position.set(marker.position.x,marker.position.y+.078,marker.position.z);
        contrastHalo.visible=false;
        contrastHalo.renderOrder=7;
        contrastHalo.userData={
          kind:"lab-terminal-contrast-backdrop",terminalId,componentId:component.id,
          visualOnly:true,physicalLocation:false,physicalVerified:false,electricalAuthority:false,
        };
        root.add(contrastHalo);
        const halo=new T.Mesh(
          new T.RingGeometry(.10,.17,20),
          sharedMaterials.terminalHaloMat,
        );
        halo.rotation.x=-Math.PI/2;
        halo.position.set(marker.position.x,marker.position.y+.075,marker.position.z);
        halo.visible=false;
        halo.renderOrder=8;
        halo.userData={
          kind:"lab-terminal-affordance",terminalId,componentId:component.id,
          visualOnly:true,physicalLocation:false,physicalVerified:false,electricalAuthority:false,
        };
        root.add(halo);
        const inspectionHalo=new T.Mesh(
          new T.RingGeometry(.19,.28,24),
          sharedMaterials.inspectionTerminalHaloMat,
        );
        inspectionHalo.rotation.x=-Math.PI/2;
        inspectionHalo.position.set(marker.position.x,marker.position.y+.082,marker.position.z);
        inspectionHalo.visible=false;
        inspectionHalo.renderOrder=9;
        inspectionHalo.userData={
          kind:"lab-terminal-inspection-affordance",terminalId,componentId:component.id,
          visualOnly:true,physicalLocation:false,physicalVerified:false,electricalAuthority:false,readOnly:true,
        };
        root.add(inspectionHalo);
        const hoverHalo=new T.Mesh(
          new T.RingGeometry(.12,.20,22),
          sharedMaterials.hoverTerminalHaloMat,
        );
        hoverHalo.rotation.x=-Math.PI/2;
        hoverHalo.position.set(marker.position.x,marker.position.y+.084,marker.position.z);
        hoverHalo.visible=false;
        hoverHalo.renderOrder=9;
        hoverHalo.userData={
          kind:"lab-terminal-hover-affordance",terminalId,componentId:component.id,
          visualOnly:true,physicalLocation:false,physicalVerified:false,electricalAuthority:false,
        };
        root.add(hoverHalo);
        const pendingHalo=new T.Mesh(
          new T.RingGeometry(.13,.22,24),
          sharedMaterials.pendingTerminalHaloMat,
        );
        pendingHalo.rotation.x=-Math.PI/2;
        pendingHalo.position.set(marker.position.x,marker.position.y+.088,marker.position.z);
        pendingHalo.visible=false;
        pendingHalo.renderOrder=10;
        pendingHalo.userData={
          kind:"lab-terminal-pending-wire-affordance",terminalId,componentId:component.id,
          committed:false,visualOnly:true,physicalLocation:false,physicalVerified:false,
          electricalState:false,electricalAuthority:false,
        };
        root.add(pendingHalo);
        const committedHalo=new T.Mesh(
          new T.RingGeometry(.27,.35,28),
          sharedMaterials.committedTerminalHaloMat,
        );
        committedHalo.rotation.x=-Math.PI/2;
        committedHalo.position.set(marker.position.x,marker.position.y+.086,marker.position.z);
        committedHalo.visible=false;
        committedHalo.renderOrder=9;
        committedHalo.userData={
          kind:"lab-terminal-committed-wire-affordance",terminalId,componentId:component.id,
          committed:true,visualOnly:true,physicalLocation:false,physicalVerified:false,electricalAuthority:false,
        };
        root.add(committedHalo);
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
        const feedbackLabel=canvasTag(
          root,terminalId.slice(0,22),
          marker.position.x,visual.height+.20,marker.position.z+.13,.82
        );
        if(feedbackLabel)feedbackLabel.userData={
          ...feedbackLabel.userData,terminalId,componentId:component.id,
        };
        labTerminals.set(terminalId,{
          marker,collar,contrastHalo,halo,inspectionHalo,hoverHalo,pendingHalo,committedHalo,feedbackLabel,
          hit:terminalHit,componentId:component.id,anchor
        });
      }
      setLabVisualTransform(entry,component.x,component.z,component.quarterTurns);
    }
    if(board?.board)board.board.visible=false;
    if(breadboard)breadboard.visible=false;
    if(activeModule?.module)activeModule.module.visible=false;
    if(activeWiringLayer)activeWiringLayer.visible=false;
    refreshLabWireLayer(true);
    if(previousAuthoredGuide&&previousAuthoredGuideLesson===layout.lessonId&&
      !labEdit.enabled&&!drag?.kind&&
      isCanonicalAuthoredGuideTerminal(previousAuthoredGuide.from)&&
      isCanonicalAuthoredGuideTerminal(previousAuthoredGuide.to)){
      mountAuthoredPairGuide(previousAuthoredGuide);
    }
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
    refreshSceneVisualDiagnostics();
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
  function lessonButtonActuatorIdForLesson(lessonId){
    if(lessonId===3)return "lesson-3-button";
    if(lessonId===16)return "lesson-16-button";
    return null;
  }
  function lessonButtonPointerType(value){
    return value==="mouse"||value==="touch"||value==="pen"?value:null;
  }
  function syncLessonButtonActuationDatasets(){
    canvas.dataset.lessonButtonActuation=lessonButtonActuation.enabled?"enabled":"off";
    canvas.dataset.lessonButtonActuationMode=lessonButtonActuation.enabled?"pointer-hold":"off";
    canvas.dataset.lessonButtonActuationLesson=lessonButtonActuation.enabled
      ? String(lessonButtonActuation.lessonId) : "";
    canvas.dataset.lessonButtonPressed=lessonButtonActuationPressed?"true":"false";
    canvas.dataset.lessonButtonPhysicalVerified="false";
    canvas.dataset.lessonButtonElectricalAuthority="false";
  }
  function syncLessonButtonCapVisualDataset(){
    canvas.dataset.lessonButtonCapY=activeModule?.pointer?.userData?.kind==="button-cap"
      ? String(activeModule.pointer.position.y) : "";
  }
  function lessonButtonActuationStatus(ok=true){
    return Object.freeze({
      ok,
      enabled:lessonButtonActuation.enabled,
      active:lessonButtonActuation.enabled&&currentLessonButtonActuator()!==null,
      lessonId:lessonButtonActuation.lessonId,
      pressed:lessonButtonActuationPressed,
      mode:lessonButtonActuation.enabled?"pointer-hold":"off",
      physicalVerified:false,
      electricalAuthority:false,
    });
  }
  function emitLessonButtonPressChange(pressed,pointerType){
    const callback=lessonButtonActuation.onPressChange;
    const lessonId=lessonButtonActuation.lessonId;
    if(typeof callback!=="function"||!lessonButtonPointerType(pointerType)||
      (lessonId!==3&&lessonId!==16))return false;
    try{
      callback(Boolean(pressed),Object.freeze({
        lessonId,
        source:"pointer",
        pointerType,
        physicalVerified:false,
      }));
      return true;
    }catch{
      return false;
    }
  }
  function releaseLessonButtonPress(redraw=false){
    const wasPressed=lessonButtonActuationPressed;
    const pointerType=lessonButtonActuationPointerType;
    const pointerId=lessonButtonActuationPointerId;
    lessonButtonActuationPressed=false;
    lessonButtonActuationPointerId=null;
    lessonButtonActuationPointerType=null;
    lessonButtonActuationSourceId=null;
    if(drag?.kind==="lesson-button-actuator"){
      if(pointerId===null||drag.pointerId===pointerId){
        const capturedPointerId=drag.pointerId;
        drag=null;
        moved=false;
        try{canvas.releasePointerCapture?.(capturedPointerId);}catch{}
      }
    }
    syncLessonButtonActuationDatasets();
    if(wasPressed&&lessonButtonPointerType(pointerType)){
      emitLessonButtonPressChange(false,pointerType);
    }
    if(redraw)invalidate();
    return wasPressed;
  }
  function resetLessonButtonActuation(redraw=false){
    releaseLessonButtonPress(false);
    lessonButtonActuation={enabled:false,lessonId:null,onPressChange:null};
    syncLessonButtonActuationDatasets();
    refreshCanvasAccessibility();
    if(redraw)invalidate();
    return lessonButtonActuationStatus(true);
  }
  function currentLessonButtonActuator(){
    if(!lessonButtonActuation.enabled||disposed||contextLost||labEdit.enabled||
      lessonButtonActuation.lessonId!==currentLessonId||
      typeof lessonButtonActuation.onPressChange!=="function")return null;
    const sourceId=lessonButtonActuatorIdForLesson(currentLessonId);
    const pointer=activeModule?.pointer;
    if(!sourceId||activeModule?.module?.visible===false||pointer?.isMesh!==true||pointer.userData?.kind!=="button-cap"||
      pointer.userData.lessonButtonActuatorId!==sourceId)return null;
    return {lessonId:currentLessonId,sourceId,pointer};
  }
  function setLessonButtonActuation(options={enabled:false}){
    if(disposed)return Object.freeze({
      ok:false,enabled:false,active:false,lessonId:null,pressed:false,mode:"off",
      physicalVerified:false,electricalAuthority:false,
    });
    if(!options||typeof options!=="object"||Array.isArray(options)){
      throw new TypeError("Lesson button actuation options phải là object");
    }
    if(options.enabled!==true)return resetLessonButtonActuation(true);
    const requiredKeys=["enabled","lessonId","onPressChange"];
    const ownKeys=Reflect.ownKeys(options);
    if(ownKeys.length!==requiredKeys.length||
      requiredKeys.some(key=>!Object.prototype.hasOwnProperty.call(options,key))||
      ownKeys.some(key=>typeof key!=="string"||!requiredKeys.includes(key))){
      throw new RangeError("Lesson button actuation enabled phải có đúng enabled/lessonId/onPressChange");
    }
    const lessonId=options.lessonId;
    if(lessonId!==3&&lessonId!==16){
      throw new RangeError("Lesson button actuation chỉ hỗ trợ chính xác bài 3 hoặc 16");
    }
    if(typeof options.onPressChange!=="function"){
      throw new TypeError("onPressChange phải là function");
    }
    if(contextLost)throw new RangeError("Lesson button actuation không khả dụng khi WebGL context bị mất");
    if(labEdit.enabled)throw new RangeError("Lesson button actuation bị tắt khi Lab Edit đang bật");
    if(currentLessonId!==lessonId){
      throw new RangeError("Lesson button actuation không thuộc bài học hiện tại");
    }
    const expectedSourceId=lessonButtonActuatorIdForLesson(lessonId);
    const pointer=activeModule?.pointer;
    if(activeModule?.module?.visible===false||pointer?.isMesh!==true||pointer.userData?.kind!=="button-cap"||
      pointer.userData.lessonButtonActuatorId!==expectedSourceId){
      throw new RangeError("Không có button cap actuator đúng bài hiện tại");
    }
    const sameSemantic=lessonButtonActuation.enabled&&lessonButtonActuation.lessonId===lessonId;
    if(!sameSemantic){
      resetLessonButtonActuation(false);
      lessonButtonActuation={enabled:true,lessonId,onPressChange:options.onPressChange};
    }else if(!lessonButtonActuationPressed){
      lessonButtonActuation={...lessonButtonActuation,onPressChange:options.onPressChange};
    }
    syncLessonButtonActuationDatasets();
    refreshCanvasAccessibility();
    invalidate();
    return lessonButtonActuationStatus(true);
  }
  function lessonButtonActuationHit(event){
    const current=currentLessonButtonActuator();
    const pointerType=lessonButtonPointerType(event?.pointerType);
    if(!current||!pointerType||!pointerRay(event))return null;
    scene.updateMatrixWorld(true);
    const hit=raycaster.intersectObject(current.pointer,false)[0]||null;
    return hit?.object===current.pointer?{...current,pointerType,hit}:null;
  }
  function setLabEdit(options={}){
    if(disposed)return Object.freeze({enabled:false,selectedComponentId:null});
    if(!options||typeof options!=="object"||Array.isArray(options)){
      throw new TypeError("Lab edit options phải là object");
    }
    validateLabEditCallback(options.onSelectComponent,"onSelectComponent");
    validateLabEditCallback(options.onMoveComponent,"onMoveComponent");
    validateLabEditCallback(options.onTerminalSelect,"onTerminalSelect");
    validateLabEditCallback(options.onTerminalDragStart,"onTerminalDragStart");
    validateLabEditCallback(options.onTerminalLink,"onTerminalLink");
    validateLabEditCallback(options.onCommittedWireInspect,"onCommittedWireInspect");
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
      onTerminalDragStart:options.onTerminalDragStart===undefined
        ? labEdit.onTerminalDragStart : options.onTerminalDragStart,
      onTerminalLink:options.onTerminalLink===undefined
        ? labEdit.onTerminalLink : options.onTerminalLink,
      onCommittedWireInspect:options.onCommittedWireInspect===undefined
        ? labEdit.onCommittedWireInspect : options.onCommittedWireInspect,
    };
    if(nextEditEnabled)resetLessonButtonActuation(false);
    if(editTransition){
      inspectedLabTerminalId=null;inspectedLabTerminalMode="none";
      hoveredLabTerminalId=null;
      clearPendingWireState(false);
      cancelTerminalLinkPointer(false);
      cancelCommittedWireInspectPointer(false);
      resetCommittedWireRepairIntent(false);
      cancelBreadboardHoleStudyPointer(false);
      if(nextEditEnabled)clearAuthoredPairGuide(false);
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
    syncBreadboardHoleStudy(false);
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
  function inspectableCommittedWireId(wireId){
    return typeof wireId==="string"&&wireId.length>0&&wireId.length<=LAB_WIRE_ID_MAX&&
      wireId.trim()===wireId&&
      !["__proto__","prototype","constructor"].includes(wireId);
  }
  function sameRenderedCommittedWireIdentity(rendered,canonical){
    if(!rendered)return false;
    return sameCommittedWireIdentity({
      id:rendered.wireId,
      from:rendered.from,
      to:rendered.to,
    },canonical);
  }
  function canonicalCommittedWireForRendered(rendered,layoutRef=activeLabLayout){
    if(!labEdit.enabled||typeof labEdit.onCommittedWireInspect!=="function"||
      !layoutRef||layoutRef!==activeLabLayout||!rendered||!inspectableCommittedWireId(rendered.wireId)){
      return null;
    }
    const canonical=lastWiringModel?.wires?.find(wire=>wire.id===rendered.wireId)||null;
    if(!sameRenderedCommittedWireIdentity(rendered,canonical))return null;
    const terminalMap=layoutRef.terminalMap;
    for(const terminalId of [canonical.from,canonical.to]){
      const terminal=terminalMap&&Object.prototype.hasOwnProperty.call(terminalMap,terminalId)
        ? terminalMap[terminalId] : null;
      if(terminal?.terminalId!==terminalId||!labTerminals.has(terminalId))return null;
    }
    const currentRendered=labWireObjects.find(item=>
      item.line===rendered.line&&sameRenderedCommittedWireIdentity(item,canonical)
    )||null;
    return currentRendered?canonical:null;
  }
  function committedWireHit(event,layoutRef=activeLabLayout){
    if(!labEdit.enabled||typeof labEdit.onCommittedWireInspect!=="function"||
      !layoutRef||layoutRef!==activeLabLayout||!labWireObjects.length){
      return null;
    }
    if(!pointerRay(event))return null;
    committedWireRaycaster.setFromCamera(pointerNdc,camera);
    scene.updateMatrixWorld(true);
    const committedLines=labWireObjects.map(item=>item.line).filter(line=>line?.isLine===true);
    if(!committedLines.length)return null;
    const hits=committedWireRaycaster.intersectObjects(committedLines,false);
    for(const hit of hits){
      const rendered=labWireObjects.find(item=>item.line===hit.object)||null;
      const canonical=canonicalCommittedWireForRendered(rendered,layoutRef);
      if(canonical)return {rendered,canonical,hit};
    }
    return null;
  }
  function currentCommittedWireRepairRecord(layoutRef=activeLabLayout){
    if(!committedWireRepairIntent.enabled||!labEdit.enabled||contextLost||disposed||
      !layoutRef||layoutRef!==activeLabLayout||layoutRef!==committedWireRepairLayoutRef||
      !Number.isFinite(currentLessonId)||currentLessonId!==committedWireRepairLessonId||
      layoutRef.lessonId!==currentLessonId||typeof committedWireRepairIntent.onRerouteTarget!=="function"){
      return null;
    }
    const canonical=lastWiringModel?.wires?.find(
      wire=>wire.id===committedWireRepairIntent.wireId
    )||null;
    if(!canonical||!sameCommittedWireRepairIdentity(committedWireRepairIntent,canonical))return null;
    const anchorTerminalId=committedWireRepairIntent.anchorTerminalId;
    if(anchorTerminalId!==canonical.from&&anchorTerminalId!==canonical.to)return null;
    const movedTerminalId=anchorTerminalId===canonical.from?canonical.to:canonical.from;
    if(!isActiveTerminalDragId(anchorTerminalId,layoutRef)||
      !isActiveTerminalDragId(movedTerminalId,layoutRef))return null;
    const rendered=labWireObjects.find(item=>
      item.wireId===canonical.id&&sameRenderedCommittedWireIdentity(item,canonical)
    )||null;
    if(!rendered?.line?.isLine)return null;
    return {canonical,rendered,anchorTerminalId,movedTerminalId};
  }
  function committedWireRepairHit(event,layoutRef=activeLabLayout){
    const current=currentCommittedWireRepairRecord(layoutRef);
    if(!current||!pointerRay(event))return null;
    committedWireRaycaster.setFromCamera(pointerNdc,camera);
    scene.updateMatrixWorld(true);
    const hit=committedWireRaycaster.intersectObject(current.rendered.line,false)[0]||null;
    return hit?{...current,hit}:null;
  }
  function committedWireRepairPointerActive(pointerState){
    if(!pointerState||pointerState.kind!=="committed-wire-repair"||
      pointerState.layoutRef!==activeLabLayout||pointerState.layoutRef!==committedWireRepairLayoutRef||
      pointerState.lessonId!==Number(currentLessonId)||
      pointerState.anchorTerminalId!==committedWireRepairIntent.anchorTerminalId||
      pointerState.movedTerminalId!==committedWireRepairMovedEndpoint())return false;
    const current=currentCommittedWireRepairRecord(pointerState.layoutRef);
    return current!==null&&sameCommittedWireIdentity(pointerState.wireIdentity,current.canonical)&&
      current.anchorTerminalId===pointerState.anchorTerminalId&&
      current.movedTerminalId===pointerState.movedTerminalId;
  }
  function committedWireRepairTerminalTarget(event,pointerState){
    if(!committedWireRepairPointerActive(pointerState))return {terminalId:null,valid:false,marker:null};
    const hit=labHit(event);
    const terminalId=hit?.object?.userData?.kind==="lab-terminal"
      ? hit.object.userData.terminalId : null;
    if(!terminalId)return {terminalId:null,valid:false,marker:null};
    const marker=labTerminals.get(terminalId)?.marker||null;
    const valid=terminalId!==pointerState.anchorTerminalId&&
      terminalId!==pointerState.movedTerminalId&&
      isActiveTerminalDragId(terminalId,pointerState.layoutRef);
    return {terminalId,valid,marker};
  }
  function committedWireRepairDropTarget(event,pointerState){
    const target=committedWireRepairTerminalTarget(event,pointerState);
    return target.valid?target.terminalId:null;
  }
  function ensureCommittedWireRepairLine(){
    if(committedWireRepairLine||!activeLabLayer)return committedWireRepairLine;
    const geometry=new T.BufferGeometry();
    geometry.setAttribute("position",new T.Float32BufferAttribute(LAB_COMMITTED_WIRE_REPAIR_POINTS*3,3));
    committedWireRepairLine=new T.Line(geometry,sharedMaterials.committedWireRepairInvalidMat);
    committedWireRepairLine.visible=false;
    committedWireRepairLine.renderOrder=9;
    committedWireRepairLine.userData={
      kind:"lab-committed-wire-repair-ghost",visualOnly:true,committed:false,
      electricalAuthority:false,physicalLocation:false,physicalVerified:false,
      routeModel:"bounded-endpoint-reroute-preview",routePointCount:LAB_COMMITTED_WIRE_REPAIR_POINTS,
    };
    activeLabLayer.add(committedWireRepairLine);
    return committedWireRepairLine;
  }
  function boundedCommittedWireRepairPoint(event,layoutRef){
    const point=labGroundPoint(event);
    if(!point||!layoutRef)return null;
    point.x=Math.max(layoutRef.bounds.minX*LAB_WORLD_SCALE,
      Math.min(layoutRef.bounds.maxX*LAB_WORLD_SCALE,point.x));
    point.z=Math.max(layoutRef.bounds.minZ*LAB_WORLD_SCALE,
      Math.min(layoutRef.bounds.maxZ*LAB_WORLD_SCALE,point.z));
    point.y=.12;
    return point;
  }
  function updateCommittedWireRepairDrag(event){
    if(!drag||drag.kind!=="committed-wire-repair"||!moved||
      !committedWireRepairPointerActive(drag)){
      clearCommittedWireRepairTransient(true);
      return false;
    }
    const current=currentCommittedWireRepairRecord(drag.layoutRef);
    const anchorMarker=labTerminals.get(drag.anchorTerminalId)?.marker||null;
    if(!current||!anchorMarker){
      clearCommittedWireRepairTransient(true);
      return false;
    }
    const target=committedWireRepairTerminalTarget(event,drag);
    scene.updateMatrixWorld(true);
    const start=new T.Vector3(),end=new T.Vector3();
    anchorMarker.getWorldPosition(start);
    if(target.marker)target.marker.getWorldPosition(end);
    else{
      const bounded=boundedCommittedWireRepairPoint(event,drag.layoutRef);
      if(!bounded){
        clearCommittedWireRepairTransient(true);
        return false;
      }
      end.copy(bounded);
    }
    const line=ensureCommittedWireRepairLine();
    if(!line)return false;
    const laneY=Math.max(start.y,end.y)+.24;
    const position=line.geometry.getAttribute("position");
    position.setXYZ(0,start.x,start.y,start.z);
    position.setXYZ(1,start.x,laneY,start.z);
    position.setXYZ(2,end.x,laneY,end.z);
    position.setXYZ(3,end.x,end.y,end.z);
    position.needsUpdate=true;
    line.geometry.computeBoundingSphere();
    line.material=target.valid
      ? sharedMaterials.committedWireRepairValidMat
      : sharedMaterials.committedWireRepairInvalidMat;
    line.visible=true;
    const previousTarget=committedWireRepairTargetId;
    if(previousTarget!==null&&previousTarget!==target.terminalId&&hoveredLabTerminalId===previousTarget){
      hoveredLabTerminalId=null;
    }
    committedWireRepairTargetId=target.terminalId;
    committedWireRepairPreview=target.valid?"valid":"invalid";
    if(target.terminalId)hoveredLabTerminalId=target.terminalId;
    syncCommittedWireRepairDatasets();
    refreshLabInteractionFeedback();
    invalidate();
    return true;
  }
  function cancelCommittedWireInspectPointer(redraw=false){
    if(drag?.kind!=="committed-wire")return;
    const pointerId=drag.pointerId;
    drag=null;
    moved=false;
    try{canvas.releasePointerCapture?.(pointerId);}catch{}
    if(redraw)invalidate();
  }
  function breadboardHoleStudyActive(layoutRef=activeLabLayout,profileId=breadboardHoleStudy.profileId){
    if(!breadboardHoleStudy.enabled||!labEdit.enabled||contextLost||disposed||
      !layoutRef||layoutRef!==activeLabLayout||profileId!==breadboardHoleStudy.profileId||
      breadboardHoleStudyLayoutRef!==activeLabLayout||
      !breadboardHoleStudyLayer||!breadboardHoleStudyMesh||
      canvas.dataset.labBreadboardHoleStudyMode!=="conceptual-strip-study"){
      return false;
    }
    const entry=labComponents.get(breadboardHoleStudyComponentId);
    return entry?.component?.visualKind==="breadboard"&&entry.root?.visible!==false&&
      breadboardHoleStudyLayer.parent===entry.root&&
      breadboardHoleStudyMesh.count===BREADBOARD_STUDY_HOLE_COUNT;
  }
  function breadboardHoleStudyHit(event,layoutRef=activeLabLayout,profileId=breadboardHoleStudy.profileId){
    if(!breadboardHoleStudyActive(layoutRef,profileId)||
      typeof breadboardHoleStudy.onHoleSelect!=="function")return null;
    return breadboardHoleStudyRawHit(event,layoutRef,profileId);
  }
  function breadboardHoleStudyRawHit(event,layoutRef=activeLabLayout,profileId=breadboardHoleStudy.profileId){
    if(!breadboardHoleStudyActive(layoutRef,profileId))return null;
    if(!pointerRay(event))return null;
    scene.updateMatrixWorld(true);
    const hits=raycaster.intersectObject(breadboardHoleStudyMesh,false);
    for(const hit of hits){
      const instanceId=hit.instanceId;
      const holeId=breadboardStudyHoleId(instanceId);
      if(!holeId||breadboardStudyHoleIndex(holeId)!==instanceId)continue;
      return {
        holeId,instanceId,
        componentId:breadboardHoleStudyComponentId,
        layoutRef,
        profileId,
        hit,
      };
    }
    return null;
  }
  function breadboardHoleLinkIntentActive(layoutRef=activeLabLayout,profileId=breadboardHoleLinkIntent.profileId){
    if(breadboardHoleLinkIntent.mode!=="await-end"||
      profileId!==breadboardHoleLinkIntent.profileId||
      profileId!==breadboardHoleStudy.profileId||
      !breadboardHoleStudyActive(layoutRef,profileId))return false;
    const first=breadboardHoleLinkIntent.firstHoleId;
    return typeof first==="string"&&breadboardStudyHoleIndex(first)>=0;
  }
  function breadboardHoleLinkHit(event,layoutRef=activeLabLayout,profileId=breadboardHoleLinkIntent.profileId){
    if(!breadboardHoleLinkIntentActive(layoutRef,profileId))return null;
    const labPriorityHit=labHit(event);
    if(labPriorityHit?.object?.userData?.kind==="lab-terminal")return null;
    if(committedWireHit(event,layoutRef))return null;
    return breadboardHoleStudyRawHit(event,layoutRef,profileId);
  }
  function isCurrentBreadboardHoleLinkSource(hit){
    if(!hit||!breadboardHoleLinkIntentActive(hit.layoutRef,hit.profileId)||
      typeof breadboardHoleLinkIntent.onHoleLinkDrop!=="function")return false;
    const first=breadboardHoleLinkIntent.firstHoleId;
    return hit.holeId===first&&hit.instanceId===breadboardStudyHoleIndex(first)&&
      hit.componentId===breadboardHoleStudyComponentId;
  }
  function breadboardHoleLinkPointerActive(pointerState){
    if(!pointerState||pointerState.kind!=="breadboard-hole-link"||
      pointerState.layoutRef!==activeLabLayout||
      pointerState.lessonId!==Number(currentLessonId)||
      pointerState.profileId!==breadboardHoleStudy.profileId||
      pointerState.profileId!==breadboardHoleLinkIntent.profileId||
      pointerState.firstHoleId!==breadboardHoleLinkIntent.firstHoleId||
      pointerState.firstInstanceId!==breadboardStudyHoleIndex(pointerState.firstHoleId)||
      pointerState.componentId!==breadboardHoleStudyComponentId||
      typeof breadboardHoleLinkIntent.onHoleLinkDrop!=="function")return false;
    return breadboardHoleLinkIntentActive(pointerState.layoutRef,pointerState.profileId);
  }
  function breadboardHoleLinkDropTarget(event,pointerState){
    if(!breadboardHoleLinkPointerActive(pointerState))return null;
    const hit=breadboardHoleLinkHit(event,pointerState.layoutRef,pointerState.profileId);
    if(!hit||hit.holeId===pointerState.firstHoleId||
      hit.instanceId!==breadboardStudyHoleIndex(hit.holeId))return null;
    return hit;
  }
  function updateBreadboardHoleLinkHover(event){
    if(!breadboardHoleLinkIntentActive()){
      clearBreadboardHoleLinkHover(false);
      return false;
    }
    const hit=breadboardHoleLinkHit(event);
    const targetId=hit?.holeId??null;
    if(!targetId){
      clearBreadboardHoleLinkHover(true);
      return false;
    }
    const preview=targetId===breadboardHoleLinkIntent.firstHoleId?"invalid":"valid";
    breadboardHoleLinkHoverId=targetId;
    if(!updateBreadboardHoleLinkGeometry(targetId,preview)){
      clearBreadboardHoleLinkHover(true);
      return false;
    }
    syncBreadboardHoleLinkDatasets();
    invalidate();
    return preview==="valid";
  }
  function updateBreadboardHoleLinkDrag(event){
    if(!drag||drag.kind!=="breadboard-hole-link"||!moved)return false;
    if(!breadboardHoleLinkPointerActive(drag)){
      clearBreadboardHoleLinkHover(true);
      return false;
    }
    return updateBreadboardHoleLinkHover(event);
  }
  function cancelBreadboardHoleLinkPointer(redraw=false){
    const ownsPointer=drag?.kind==="breadboard-hole-link";
    if(ownsPointer){
      const pointerId=drag.pointerId;
      drag=null;
      moved=false;
      try{canvas.releasePointerCapture?.(pointerId);}catch{}
    }
    const changed=clearBreadboardHoleLinkHover(false)||ownsPointer;
    if(redraw&&changed)invalidate();
    return changed;
  }
  function cancelBreadboardHoleStudyPointer(redraw=false){
    if(drag?.kind!=="breadboard-hole-study")return;
    const pointerId=drag.pointerId;
    drag=null;
    moved=false;
    try{canvas.releasePointerCapture?.(pointerId);}catch{}
    if(redraw)invalidate();
  }
  function updatePendingWireHover(event){
    if(!labEdit.enabled||!activeLabLayout){
      clearLabTerminalHover(false);
      clearPendingWireHover(true);
      return;
    }
    const hit=labHit(event);
    const targetId=hit?.object?.userData?.kind==="lab-terminal"
      ? hit.object.userData.terminalId : null;
    if(targetId!==hoveredLabTerminalId){
      hoveredLabTerminalId=targetId&&labTerminals.has(targetId)?targetId:null;
      refreshLabInteractionFeedback();
    }
    if(!pendingWireTerminalId){
      clearPendingWireHover(true);
      invalidate();
      return;
    }
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
  function isActiveTerminalDragId(terminalId,layoutRef=activeLabLayout){
    if(!labEdit.enabled||!layoutRef||layoutRef!==activeLabLayout||typeof terminalId!=="string")return false;
    const terminalMap=layoutRef.terminalMap;
    const canonical=terminalMap&&Object.prototype.hasOwnProperty.call(terminalMap,terminalId)
      ? terminalMap[terminalId] : null;
    return canonical?.terminalId===terminalId&&labTerminals.has(terminalId);
  }
  function isActiveTerminalLinkId(terminalId,layoutRef=activeLabLayout){
    return typeof labEdit.onTerminalLink==="function"&&isActiveTerminalDragId(terminalId,layoutRef);
  }
  function emitTerminalDragStart(pointerState){
    if(!pointerState||pointerState.dragStartEmitted)return;
    pointerState.dragStartEmitted=true;
    if(typeof labEdit.onTerminalDragStart!=="function"||
      !isActiveTerminalDragId(pointerState.terminalId,pointerState.layoutRef))return;
    labEdit.onTerminalDragStart(
      pointerState.terminalId,
      Object.freeze({source:"pointer-drag",physicalVerified:false})
    );
  }
  function terminalLinkTargetFromEvent(event,sourceId,layoutRef){
    if(!isActiveTerminalLinkId(sourceId,layoutRef))return null;
    const hit=labHit(event);
    const targetId=hit?.object?.userData?.kind==="lab-terminal"
      ? hit.object.userData.terminalId : null;
    if(!targetId||targetId===sourceId||!isActiveTerminalLinkId(targetId,layoutRef))return null;
    return targetId;
  }
  function clearTerminalLinkDragState(redraw=false){
    const previousTarget=terminalLinkDragTargetId;
    const changed=terminalLinkDragSourceId!==null||terminalLinkDragTargetId!==null||
      canvas.dataset.labTerminalDragPreview==="ghost";
    terminalLinkDragSourceId=null;
    terminalLinkDragTargetId=null;
    if(previousTarget!==null&&hoveredLabTerminalId===previousTarget)hoveredLabTerminalId=null;
    if(pendingWirePreviewLine)pendingWirePreviewLine.visible=false;
    canvas.dataset.labTerminalDragSource="";
    canvas.dataset.labTerminalDragTarget="";
    canvas.dataset.labTerminalDragPreview="none";
    if(changed)refreshLabInteractionFeedback();
    if(redraw&&changed)invalidate();
  }
  function cancelTerminalLinkPointer(redraw=false){
    if(drag?.kind==="terminal"){
      const pointerId=drag.pointerId;
      drag=null;
      moved=false;
      try{canvas.releasePointerCapture?.(pointerId);}catch{}
    }
    clearTerminalLinkDragState(redraw);
  }
  function updateTerminalLinkDrag(event){
    if(!drag||drag.kind!=="terminal"||!moved)return;
    const sourceId=drag.terminalId;
    if(!isActiveTerminalLinkId(sourceId,drag.layoutRef)){
      clearTerminalLinkDragState(true);
      return;
    }
    const targetId=terminalLinkTargetFromEvent(event,sourceId,drag.layoutRef);
    const sourceChanged=terminalLinkDragSourceId!==sourceId;
    const targetChanged=terminalLinkDragTargetId!==targetId;
    terminalLinkDragSourceId=sourceId;
    terminalLinkDragTargetId=targetId;
    hoveredLabTerminalId=targetId;
    canvas.dataset.labTerminalDragSource=sourceId;
    canvas.dataset.labTerminalDragTarget=targetId||"";
    if(targetId){
      const line=ensurePendingWirePreviewLine();
      if(line&&updateWirePreviewGeometry(sourceId,targetId)){
        line.visible=true;
        canvas.dataset.labTerminalDragPreview="ghost";
      }else{
        canvas.dataset.labTerminalDragPreview="none";
      }
    }else{
      if(pendingWirePreviewLine)pendingWirePreviewLine.visible=false;
      canvas.dataset.labTerminalDragPreview="none";
    }
    if(sourceChanged||targetChanged||canvas.dataset.labTerminalDragPreview==="ghost"){
      refreshLabInteractionFeedback();
    }
    invalidate();
  }
  function restorePointerSelection(pointerState){
    const previous=pointerState?.previousSelectionId??null;
    if(previous===null||labComponents.has(previous)){
      selectLabComponent(previous,"pointer-cancel",false);
    }
  }
  function clearWiringLayer(redraw=true,clearHighlight=true) {
    resetCommittedWireRepairIntent(false);
    if(activeWiringLayer){scene.remove(activeWiringLayer);disposeTree(activeWiringLayer);activeWiringLayer=null;}
    lastWiringModel=null;
    clearLabWireLayer(clearHighlight);
    resetWiringMetadata();
    if(redraw)invalidate();
    return {mode:"none",shownWires:0,omittedWires:0,netCount:0,status:"none",analysisSupported:false,physicalMapping:"none"};
  }
  function down(event){
    if(event.button!==0||drag)return;
    clearLabTerminalHover(true);
    clearPendingWireHover(false);
    clearTerminalLinkDragState(false);
    clearBreadboardHoleLinkHover(false);
    moved=false;
    const actuatorHit=lessonButtonActuationHit(event);
    if(actuatorHit){
      drag=pointerDragBase(event,{
        kind:"lesson-button-actuator",
        lessonId:actuatorHit.lessonId,
        sourceId:actuatorHit.sourceId,
        sourceObject:actuatorHit.pointer,
      });
      lessonButtonActuationPressed=true;
      lessonButtonActuationPointerId=event.pointerId;
      lessonButtonActuationPointerType=actuatorHit.pointerType;
      lessonButtonActuationSourceId=actuatorHit.sourceId;
      syncLessonButtonActuationDatasets();
      try{canvas.setPointerCapture?.(event.pointerId);}catch{}
      event.preventDefault();
      emitLessonButtonPressChange(true,actuatorHit.pointerType);
      invalidate();
      return;
    }
    if(labEdit.enabled&&activeLabLayout){
      const hit=labHit(event);
      if(hit?.object?.userData?.kind==="lab-terminal"){
        const terminalId=hit.object.userData.terminalId;
        const componentId=hit.object.userData.componentId;
        const previousSelectionId=selectedLabComponentId;
        selectLabComponent(componentId,"pointer-preview",false);
        drag=pointerDragBase(event,{
          kind:"terminal",terminalId,componentId,previousSelectionId,layoutRef:activeLabLayout,
          dragStartEmitted:false
        });
        try{canvas.setPointerCapture?.(event.pointerId);}catch{}
        return;
      }
      const repairHit=committedWireRepairHit(event,activeLabLayout);
      if(repairHit){
        drag=pointerDragBase(event,{
          kind:"committed-wire-repair",
          layoutRef:activeLabLayout,
          lessonId:Number(currentLessonId),
          wireIdentity:Object.freeze({
            id:repairHit.canonical.id,
            from:repairHit.canonical.from,
            to:repairHit.canonical.to,
          }),
          anchorTerminalId:repairHit.anchorTerminalId,
          movedTerminalId:repairHit.movedTerminalId,
        });
        try{canvas.setPointerCapture?.(event.pointerId);}catch{}
        return;
      }
      let wireHit=null;
      if(breadboardHoleStudyActive()){
        wireHit=committedWireHit(event,activeLabLayout);
        if(wireHit){
          drag=pointerDragBase(event,{
            kind:"committed-wire",
            layoutRef:activeLabLayout,
            wireIdentity:Object.freeze({
              id:wireHit.canonical.id,
              from:wireHit.canonical.from,
              to:wireHit.canonical.to,
            }),
          });
          try{canvas.setPointerCapture?.(event.pointerId);}catch{}
          return;
        }
        const linkSourceHit=breadboardHoleLinkHit(
          event,activeLabLayout,breadboardHoleStudy.profileId
        );
        if(linkSourceHit&&isCurrentBreadboardHoleLinkSource(linkSourceHit)){
          drag=pointerDragBase(event,{
            kind:"breadboard-hole-link",
            layoutRef:activeLabLayout,
            lessonId:Number(currentLessonId),
            profileId:breadboardHoleStudy.profileId,
            firstHoleId:linkSourceHit.holeId,
            firstInstanceId:linkSourceHit.instanceId,
            componentId:linkSourceHit.componentId,
          });
          try{canvas.setPointerCapture?.(event.pointerId);}catch{}
          return;
        }
        const holeHit=breadboardHoleStudyHit(
          event,activeLabLayout,breadboardHoleStudy.profileId
        );
        if(holeHit){
          drag=pointerDragBase(event,{
            kind:"breadboard-hole-study",
            layoutRef:activeLabLayout,
            lessonId:Number(currentLessonId),
            profileId:breadboardHoleStudy.profileId,
            holeId:holeHit.holeId,
            instanceId:holeHit.instanceId,
            componentId:holeHit.componentId,
          });
          try{canvas.setPointerCapture?.(event.pointerId);}catch{}
          return;
        }
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
      wireHit=wireHit||committedWireHit(event,activeLabLayout);
      if(wireHit){
        drag=pointerDragBase(event,{
          kind:"committed-wire",
          layoutRef:activeLabLayout,
          wireIdentity:Object.freeze({
            id:wireHit.canonical.id,
            from:wireHit.canonical.from,
            to:wireHit.canonical.to,
          }),
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
      updateBreadboardHoleLinkHover(event);
      return;
    }
    if(event.pointerId!==drag.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    const totalDx=event.clientX-drag.startClientX;
    const totalDy=event.clientY-drag.startClientY;
    const crossedTapThreshold=!moved&&Math.hypot(totalDx,totalDy)>drag.tapThreshold;
    if(crossedTapThreshold)moved=true;
    if(drag.kind==="lesson-button-actuator"){
      event.preventDefault();
    }else if(drag.kind==="lab-component"){
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
    }else if(drag.kind==="committed-wire-repair"&&moved){
      event.preventDefault();
      updateCommittedWireRepairDrag(event);
    }else if(drag.kind==="terminal"&&moved){
      event.preventDefault();
      if(crossedTapThreshold)emitTerminalDragStart(drag);
      updateTerminalLinkDrag(event);
    }else if(drag.kind==="breadboard-hole-link"&&moved){
      event.preventDefault();
      updateBreadboardHoleLinkDrag(event);
    }else if((drag.kind==="camera"||drag.kind==="committed-wire"||
      drag.kind==="breadboard-hole-study")&&moved){
      theta-=dx*.008;
      phi=Math.max(.27,Math.min(1.45,phi+dy*.008));
      invalidate();
    }
    drag.x=event.clientX;drag.y=event.clientY;invalidate();
  }
  function finishBreadboardHoleStudyTap(finished,event){
    if(!finished||finished.layoutRef!==activeLabLayout||
      finished.lessonId!==Number(currentLessonId)||
      finished.profileId!==breadboardHoleStudy.profileId||
      !breadboardHoleStudy.enabled||!labEdit.enabled||
      typeof breadboardHoleStudy.onHoleSelect!=="function")return false;
    const releaseHit=breadboardHoleStudyHit(
      event,finished.layoutRef,finished.profileId
    );
    if(!releaseHit||releaseHit.holeId!==finished.holeId||
      releaseHit.instanceId!==finished.instanceId||
      releaseHit.componentId!==finished.componentId)return false;
    const accepted=breadboardHoleStudy.onHoleSelect(
      finished.holeId,
      Object.freeze({source:"pointer",physicalVerified:false})
    );
    const selection=accepted?.accepted===true?accepted.selection:null;
    if(selection&&
      Number(selection.lessonId)===finished.lessonId&&
      selection.profileId===finished.profileId&&
      selection.holeId===finished.holeId&&
      finished.layoutRef===activeLabLayout&&
      finished.profileId===breadboardHoleStudy.profileId&&
      breadboardHoleStudyActive(finished.layoutRef,finished.profileId)){
      breadboardHoleStudy={
        ...breadboardHoleStudy,
        selectedHoleId:finished.holeId,
      };
      refreshBreadboardHoleStudySelection();
      refreshCanvasAccessibility();
      invalidate();
    }
    return true;
  }
  function finishPointer(event, select) {
    if(!drag||event.pointerId!==drag.pointerId)return;
    const directTerminalTarget=drag.kind==="terminal"&&select&&moved
      ? terminalLinkTargetFromEvent(event,drag.terminalId,drag.layoutRef)
      : null;
    const directHoleLinkTarget=drag.kind==="breadboard-hole-link"&&select&&moved
      ? breadboardHoleLinkDropTarget(event,drag)
      : null;
    const directCommittedWireRepairTarget=drag.kind==="committed-wire-repair"&&select&&moved
      ? committedWireRepairDropTarget(event,drag)
      : null;
    clearPendingWireHover(false);
    const finished=drag;
    drag=null;
    try{canvas.releasePointerCapture?.(event.pointerId);}catch{}
    clearTerminalLinkDragState(false);
    clearBreadboardHoleLinkHover(false);
    clearCommittedWireRepairTransient(false);
    if(finished.kind==="lesson-button-actuator"){
      const current=currentLessonButtonActuator();
      const sourceStillCurrent=Boolean(
        current&&current.lessonId===finished.lessonId&&
        current.sourceId===finished.sourceId&&
        current.pointer===finished.sourceObject&&
        lessonButtonActuationSourceId===finished.sourceId&&
        lessonButtonActuationPointerId===finished.pointerId
      );
      // Release is mandatory even when the source became stale after pointerdown;
      // sourceStillCurrent deliberately prevents that stale gesture from gaining
      // any new authority while the false transition only clears the held input.
      releaseLessonButtonPress(sourceStillCurrent);
      return;
    }
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
        if(select&&moved&&directTerminalTarget&&
          isActiveTerminalLinkId(finished.terminalId,finished.layoutRef)&&
          isActiveTerminalLinkId(directTerminalTarget,finished.layoutRef)){
          labEdit.onTerminalLink?.(
            finished.terminalId,directTerminalTarget,
            Object.freeze({source:"pointer-drag",physicalVerified:false})
          );
        }
      }
      return;
    }
    if(finished.kind==="committed-wire"){
      if(select&&!moved){
        const releaseHit=committedWireHit(event,finished.layoutRef);
        if(releaseHit&&sameCommittedWireIdentity(finished.wireIdentity,releaseHit.canonical)){
          setHighlightedLabWire(releaseHit.canonical.id);
          labEdit.onCommittedWireInspect?.(
            releaseHit.canonical.id,
            Object.freeze({source:"pointer",physicalVerified:false})
          );
        }
      }
      return;
    }
    if(finished.kind==="committed-wire-repair"){
      if(select&&!moved){
        const releaseHit=committedWireHit(event,finished.layoutRef);
        if(releaseHit&&sameCommittedWireIdentity(finished.wireIdentity,releaseHit.canonical)){
          setHighlightedLabWire(releaseHit.canonical.id);
          labEdit.onCommittedWireInspect?.(
            releaseHit.canonical.id,
            Object.freeze({source:"pointer",physicalVerified:false})
          );
        }
      }else if(select&&moved&&directCommittedWireRepairTarget&&
        committedWireRepairPointerActive(finished)){
        const current=currentCommittedWireRepairRecord(finished.layoutRef);
        const callback=committedWireRepairIntent.onRerouteTarget;
        if(current&&typeof callback==="function"&&
          sameCommittedWireIdentity(finished.wireIdentity,current.canonical)){
          callback(
            current.canonical.id,current.canonical.from,current.canonical.to,
            current.anchorTerminalId,directCommittedWireRepairTarget,
            Object.freeze({source:"pointer-drag",physicalVerified:false})
          );
        }
      }
      return;
    }
    if(finished.kind==="breadboard-hole-link"){
      if(select&&!moved){
        finishBreadboardHoleStudyTap({
          ...finished,
          holeId:finished.firstHoleId,
          instanceId:finished.firstInstanceId,
        },event);
      }else if(select&&moved&&directHoleLinkTarget&&
        breadboardHoleLinkPointerActive(finished)){
        const callback=breadboardHoleLinkIntent.onHoleLinkDrop;
        callback?.(
          directHoleLinkTarget.holeId,
          Object.freeze({source:"pointer-drag",physicalVerified:false})
        );
      }
      return;
    }
    if(finished.kind==="breadboard-hole-study"){
      if(select&&!moved)finishBreadboardHoleStudyTap(finished,event);
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
  const cancel=event=>{clearLabTerminalHover(true);clearPendingWireHover(true);finishPointer(event,false);};
  const leave=()=>{if(!drag){clearLabTerminalHover(true);clearPendingWireHover(true);clearBreadboardHoleLinkHover(true);}};
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
    resetLessonButtonActuation(false);
    if(drag){try{canvas.releasePointerCapture?.(drag.pointerId);}catch{}}
    drag=null;
    resetCommittedWireRepairIntent(false);
    resetBreadboardHoleStudy(false);
    clearTerminalLinkDragState(false);
    clearLabTerminalHover(false);
    clearPendingWireState(false);
    const guideBeforeContextLoss=authoredPairGuide
      ? Object.freeze({from:authoredPairGuide.from,to:authoredPairGuide.to}) : null;
    clearAuthoredPairGuide(false);
    authoredPairGuideRestorePair=guideBeforeContextLoss;
    highlightedLabWireId=null;
    labWireGeometryRevision=0;
    canvas.dataset.labWireGeometryRevision="0";
    refreshLabWireHighlight();
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
    const guideToRestore=authoredPairGuideRestorePair;
    authoredPairGuideRestorePair=null;
    if(guideToRestore&&!labEdit.enabled&&!drag?.kind&&activeLabLayout&&
      isCanonicalAuthoredGuideTerminal(guideToRestore.from)&&
      isCanonicalAuthoredGuideTerminal(guideToRestore.to)){
      mountAuthoredPairGuide(guideToRestore);
    }
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
    resetLessonButtonActuation(false);
    clearLabLayout(false);
    currentLessonId=Number(lesson?.id);
    clearWiringLayer(false);
    if(activeModule){scene.remove(activeModule.module);disposeTree(activeModule.module,sharedMaterialSet);}
    activeModule=createModule(scene, lesson.id===1?"board":
      ({2:"led",3:"button",4:"potentiometer",5:"rgb",6:"ldr",7:"ultrasonic",8:"buzzer",9:"piano",10:"motor",11:"temperature",12:"servo",13:"stepper",14:"plant",15:"force",16:"project"})[lesson.id] || "led",sharedMaterials);
    syncLessonButtonCapVisualDataset();
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
    const previousHighlightedWire=highlightedLabWireId===null
      ? null
      : lastWiringModel?.wires?.find(wire=>wire.id===highlightedLabWireId)??null;
    clearWiringLayer(false,false);
    const model=normalizeWiringModel(circuit,terminals,analysis);
    lastWiringModel=model;
    if(highlightedLabWireId!==null){
      const replacement=model.wires.find(wire=>wire.id===highlightedLabWireId)??null;
      if(!sameCommittedWireIdentity(previousHighlightedWire,replacement))highlightedLabWireId=null;
    }
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
    syncLessonButtonCapVisualDataset();
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
  return {setLesson,setWiring,setLabLayout,setLabEdit,setLessonButtonActuation,focusLabComponent,setInspectedTerminal,setPendingWireTerminal,setHighlightedLabWire,setCommittedWireRepairIntent,setAuthoredPairGuide,setBreadboardHoleStudy,setBreadboardHoleLinkIntent,getLabViewState,update,control,resize,dispose() {
    if(disposed)return;
    const wasContextLost=contextLost;
    disposed=true;
    if(raf){cancelAnimationFrame(raf);raf=0;}
    resetLessonButtonActuation(false);
    if(drag){try{canvas.releasePointerCapture?.(drag.pointerId);}catch{}drag=null;}
    resetCommittedWireRepairIntent(false);
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
    resetBreadboardHoleStudy(false);
    clearAuthoredPairGuide(false);
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
    hoveredLabTerminalId=null;
    inspectedLabTerminalId=null;
    inspectedLabTerminalMode="none";
    pendingWireTerminalId=null;
    pendingWireHoverTerminalId=null;
    pendingWirePreviewLine=null;
    terminalLinkDragSourceId=null;
    terminalLinkDragTargetId=null;
    authoredPairGuide=null;
    authoredPairGuideRestorePair=null;
    authoredPairGuideLayer=null;
    authoredPairGuideBackdropLine=null;
    authoredPairGuideDashLine=null;
    highlightedLabWireId=null;
    labWireGeometryRevision=0;
    canvas.dataset.labInspectedTerminal="";
    canvas.dataset.labInspectionFeedback="none";
    canvas.dataset.labPendingWireTerminal="";
    canvas.dataset.labPendingWireHoverTerminal="";
    canvas.dataset.labPendingWirePreview="none";
    canvas.dataset.labTerminalDragSource="";
    canvas.dataset.labTerminalDragTarget="";
    canvas.dataset.labTerminalDragPreview="none";
    canvas.dataset.labAuthoredGuideMode="none";
    canvas.dataset.labAuthoredGuideFrom="";
    canvas.dataset.labAuthoredGuideTo="";
    canvas.dataset.labHighlightedWire="";
    canvas.dataset.labWireRouteMode="none";
    canvas.dataset.labWireRoutePointCount="0";
    canvas.dataset.labWireGeometryRevision="0";
    canvas.dataset.labHoveredTerminal="";
    canvas.dataset.labTerminalLabelFeedback="none";
    canvas.dataset.labTerminalContrastFeedback="none";
    canvas.dataset.labCommittedWireEndpointFeedbackCount="0";
    canvas.dataset.labWireHighlightFeedback="none";
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
