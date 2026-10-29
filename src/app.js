import { lessons, lessonById, defaultControls, validateLessons, NOTES } from "./lessons.js";
import { simulate, advanceToggleState } from "./simulator.js";
import { readProgress, saveProgress, normalizeProgress, exportProgress } from "./storage.js";
import { createCircuit, createSampleCircuit, disconnectCircuit, analyzeCircuit, listTerminals } from "./circuit-router.js";
import {
  createLearnerCircuitHistory, recordLearnerCircuitHistory,
  undoLearnerCircuitHistory, redoLearnerCircuitHistory,
  inspectLearnerCircuitHistory,
} from "./learner-circuit-history.js";
import { mountWiringWorkbench, supportedWiringLessons } from "./wiring-workbench.js";
import { analyzeElectrical, SUPPORTED_ELECTRICAL_LESSONS } from "./electrical-solver.js";
import { mountAvrPanel } from "./avr-panel.js";
import { mountLabEditor } from "./lab-editor-ui.js";
import { mountLabExplorer } from "./lab-explorer-ui.js";
import { getLessonGuidance } from "./learning-coach.js";
import { mountBreadboardStudy } from "./breadboard-topology-ui.js";
import { mountResistiveStudy } from "./resistive-study-ui.js";
import { inspectPracticeEvidence } from "./practice-evidence.js";
import { renderPracticeEvidence } from "./practice-evidence-ui.js";
import { getPracticeCheckpoint } from "./practice-checkpoints.js";
import { listUnoPinReferences, UNO_REFERENCE_CLAIMS } from "./uno-reference.js";
import { getUnoMechanicalOutline } from "./uno-mechanical-reference.js";
import { getUnoMountingEvidence } from "./uno-mounting-evidence.js";
import { inspectSketchDraft } from "./sketch-review.js";
import { inspectSketchPinEvidence } from "./sketch-pin-evidence.js";
import { renderSketchReview } from "./sketch-review-ui.js";
import {
  createPracticeObservationJournal,
  recordPracticeObservation,
  inspectPracticeObservation,
} from "./practice-observation.js";
import { renderPracticeObservation } from "./practice-observation-ui.js";

const $ = id => document.getElementById(id);
const safe = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
})[c]);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const pad = n => String(n).padStart(2, "0");
const state = {
  lessonId: 1, controls: {}, memory: {}, running: false,
  elapsedMs: 0, previousTime: 0, frame: 0, lastLogTime: 0,
  previousSignature: "", progress: readProgress(), quizSolved: false,
  infoTab: "overview", stageTab: "3d", scene: null, code: "",
  serial: [], audio: null, audioTone: null,
  codeDrafts: new Map(), editingCode: false,
  circuitModels: new Map(), activeCircuits: new Set(),
  circuitHistories: new Map(),
  invalidatedCircuitLessons: new Set(), wiringUI: null,
  avrPanel: null, labEditorUI: null, labExplorerUI: null,
  // Read-only terminal inspection is UI state, NOT a pending wiring gesture.
  inspectedTerminalId: null,
  breadboardUI: null, resistiveUI: null, avrEvidence: null,
  learningSteps: new Map(), learningHints: new Set(),
  practiceObservations: createPracticeObservationJournal(),
};

function currentLesson() { return lessonById(state.lessonId); }
function refreshSceneInspectionNote(){
  const note=$("sceneInspectionStatus");
  if(!note)return;
  const id=state.stageTab==="3d" && !state.labEditorUI?.snapshot?.()?.editing
    ? state.inspectedTerminalId
    : null;
  note.hidden=id===null;
  note.textContent=id
    ? "Đang xem " + id + " · chân trong sơ đồ khái niệm; không xác nhận lỗ cắm vật lý."
    : "";
}
function currentPracticeObservation(){
  const lesson=currentLesson();
  const selected=state.learningSteps.get(lesson.id)??0;
  return inspectPracticeObservation({
    lesson,
    stepIndex:Math.max(0,Math.min(lesson.steps.length-1,selected)),
    journal:state.practiceObservations,
  });
}
function recordPracticeAction(eventType){
  // One category occurrence per lesson is sufficient: no timestamps, step
  // attribution, user telemetry or implied mastery. Repeated slider input
  // cannot exhaust the journal's bounded 128-record budget.
  if (state.practiceObservations.entries.some(
    entry=>entry.lessonId===state.lessonId && entry.eventType===eventType
  )) return;
  state.practiceObservations=recordPracticeObservation(
    state.practiceObservations,{lessonId:state.lessonId,eventType}
  );
  if(state.infoTab==="practice"){
    const existing=$("infoContent")?.querySelector("[data-practice-observation]");
    if(existing)existing.replaceWith(
      renderPracticeObservation(document,currentPracticeObservation())
    );
  }
}
function learnerCircuit(lessonId = state.lessonId) {
  if (!supportedWiringLessons().includes(lessonId)) return null;
  // The learner's canonical 2D/3D draft is empty until they connect a wire
  // or explicitly load the reference sample into the editable workbench.
  return state.circuitModels.get(lessonId) ?? createCircuit(lessonId);
}
function learnerHistory(lessonId=state.lessonId){
  if(!supportedWiringLessons().includes(lessonId))return null;
  let session=state.circuitHistories.get(lessonId);
  if(!session){
    session=createLearnerCircuitHistory({lessonId,circuit:learnerCircuit(lessonId)});
    state.circuitHistories.set(lessonId,session);
  }
  return session;
}
function learnerHistorySnapshot(lessonId=state.lessonId){
  const session=learnerHistory(lessonId);
  return session?inspectLearnerCircuitHistory(session):null;
}
function refreshLearnerHistoryControls(){
  const snapshot=learnerHistorySnapshot();
  state.wiringUI?.setHistoryState?.(snapshot);
  const editing=state.labEditorUI?.isEditingIn3D?.()===true;
  const undo=$("labUndoWire"),redo=$("labRedoWire");
  if(undo){
    undo.disabled=!editing||snapshot?.canUndo!==true;
    undo.setAttribute("aria-disabled",String(undo.disabled));
  }
  if(redo){
    redo.disabled=!editing||snapshot?.canRedo!==true;
    redo.setAttribute("aria-disabled",String(redo.disabled));
  }
}
function displayedCircuit(lessonId = state.lessonId) {
  if (!supportedWiringLessons().includes(lessonId)) return null;
  // Legacy lesson/reference displays retain the sample before a draft exists.
  // NEVER feed this fallback to learner progress or editable wire operations.
  return state.circuitModels.get(lessonId) ?? createSampleCircuit(lessonId);
}
function explorerSnapshot() {
  const lessonId=state.lessonId;
  const supported=supportedWiringLessons().includes(lessonId);
  const lab=state.labEditorUI?.snapshot();
  const circuit=supported?learnerCircuit(lessonId):null;
  // Reference topology is immutable teaching data even AFTER learner edits.
  // Do not reuse displayedCircuit(), which legitimately prefers the draft.
  const referenceCircuit=supported?createSampleCircuit(lessonId):null;
  const hasLearnerDraft=state.circuitModels.has(lessonId);
  return Object.freeze({
    lessonId,lesson:currentLesson(),stage:state.stageTab,
    editing:lab?.editing===true,selectedComponentId:lab?.selectedId??null,
    selectedTerminalId:lab?.editing===true
      ? (lab?.firstTerminal??null) : state.inspectedTerminalId,
    layout:lab?.layout??null,
    circuit,referenceCircuit,
    hasLearnerDraft,
    analysis:supported?analyzeCircuit(lessonId,circuit):null,
    referenceAnalysis:supported?analyzeCircuit(lessonId,referenceCircuit):null,
    source:hasLearnerDraft?"learner-draft":"learner-empty",
    evidence:Object.freeze({
      origin:hasLearnerDraft?"learner-draft":"learner-empty",
      reference:"reference-sample",verifiedFirmware:false,
      physicalVerified:false,measuredCurrent:false,measuredVoltage:false,
    }),
    sceneView:state.scene?.getLabViewState?.()??null,
    claims:Object.freeze({
      electricalAuthority:"circuit-router",physicalVerified:false,
      breadboardHoleMapping:false,measuredVoltage:false,measuredCurrent:false
    }),
  });
}
function refreshLabExplorer(){
  state.labExplorerUI?.update?.();
  state.breadboardUI?.update?.();
}
function applyCanonicalCircuit(lessonId,model,analysis=analyzeCircuit(lessonId,model),historyTransition=null) {
  if(lessonId!==state.lessonId || !supportedWiringLessons().includes(lessonId)){
    throw new RangeError("Chỉ thay đổi netlist của bài học đang mở có hỗ trợ đấu dây.");
  }
  if(!model || model.lessonId!==lessonId || !Array.isArray(model.wires)){
    throw new TypeError("Netlist cần được tạo từ circuit-router của bài hiện tại.");
  }
  // The history is an immutable observation of router-produced learner graphs,
  // never a reference-circuit fallback or separate authority. Rewind/redo is
  // permitted only with a matching module-branded history transition.
  const oldHistory=learnerHistory(lessonId);
  let updatedHistory;
  if(historyTransition!==null){
    const verified=inspectLearnerCircuitHistory(historyTransition);
    if(verified.lessonId!==lessonId||verified.circuit!==model){
      throw new TypeError("Hoàn tác phải áp dụng đúng graph đã xác thực của phiên này.");
    }
    updatedHistory=historyTransition;
  }else{
    updatedHistory=recordLearnerCircuitHistory(oldHistory,{
      lessonId,currentCircuit:learnerCircuit(lessonId),nextCircuit:model,
      expectedRevision:inspectLearnerCircuitHistory(oldHistory).revision,
    });
  }
  // A new canonical graph may reuse a wire ID for different endpoints (w1,
  // w2...). Never carry an earlier 3D inspection to a different learner edge.
  // Merely inspecting or refreshing the layout does not call this mutator.
  state.scene?.setHighlightedLabWire?.(null);
  state.circuitHistories.set(lessonId,updatedHistory);
  state.circuitModels.set(lessonId,model);
  // Canonical mutations from 2D/schematic must not leave a half-completed
  // two-terminal gesture armed in the separate Three.js editor.
  state.labEditorUI?.clearTerminalSelection?.();
  if(state.activeCircuits.has(lessonId)&&(!analysis.ok||!analysis.functional)){
    state.activeCircuits.delete(lessonId);
    state.invalidatedCircuitLessons.add(lessonId);
    if(state.running)stopClock();
    log("Đã thu hồi kích hoạt mạch tự đấu: topology không còn đạt yêu cầu; cần kích hoạt lại sau khi sửa.");
  }
  if(analysis.ok&&analysis.functional)state.invalidatedCircuitLessons.delete(lessonId);
  refreshCircuitViews();
  updateSnapshot(true);
  return analysis;
}
function moveLearnerHistory(direction,request){
  if(!supportedWiringLessons().includes(state.lessonId) ||
     !request||request.lessonId!==state.lessonId){
    throw new RangeError("Hoàn tác/làm lại chỉ cho bài học hiện tại.");
  }
  const session=learnerHistory();
  const invoke=direction==="undo"?undoLearnerCircuitHistory:redoLearnerCircuitHistory;
  const result=invoke(session,{
    lessonId:state.lessonId,
    currentCircuit:learnerCircuit(),
    expectedRevision:request.expectedRevision,
  });
  const nextAnalysis=analyzeCircuit(state.lessonId,result.circuit);
  if(state.activeCircuits.delete(state.lessonId)){
    state.invalidatedCircuitLessons.add(state.lessonId);
    if(state.running)stopClock();
    log("Đã thu hồi kích hoạt mạch khi hoàn tác/làm lại; cần tự chọn kích hoạt lại trước khi thử.");
  }
  applyCanonicalCircuit(state.lessonId,result.circuit,nextAnalysis,result.session);
  const label=direction==="undo"?"Đã hoàn tác":"Đã làm lại";
  log(label+" graph học viên trong ứng dụng; không thay đổi dây vật lý hoặc hoàn thành bài học.");
  return Object.freeze({lessonId:state.lessonId,mode:direction,
    circuitRouterMutated:true,physicalVerified:false,lessonCompleted:false});
}
function requestLearnerUndo(request){return moveLearnerHistory("undo",request);}
function requestLearnerRedo(request){return moveLearnerHistory("redo",request);}
function explorerSelectComponent(id) {
  if(!supportedWiringLessons().includes(state.lessonId)||!state.labEditorUI)return false;
  // Inspector selection never switches stage or enables editing.
  state.inspectedTerminalId=null;
  state.scene?.setInspectedTerminal?.(null);
  state.labEditorUI.selectComponent(id);
  refreshSceneInspectionNote();
  refreshLabExplorer();
  return true;
}
function explorerSelectTerminal(id) {
  if(!supportedWiringLessons().includes(state.lessonId)||!state.labEditorUI)return false;
  const terminal=listTerminals(state.lessonId).find(item=>item.id===id);
  if(!terminal)return false;
  if(state.labEditorUI.snapshot().editing){
    // Two-terminal wiring is possible ONLY after explicit edit opt-in.
    state.inspectedTerminalId=null;
    state.scene?.setInspectedTerminal?.(null);
    state.labEditorUI.selectTerminal(id);
  }else{
    // Pure inspection: don't arm firstTerminal, create a wire or open editor.
    state.inspectedTerminalId=id;
    state.labEditorUI.selectComponent(terminal.component);
    // The scene's blue-violet halo is read-only. It does not select a wiring
    // endpoint or infer a physical breadboard hole from the conceptual anchor.
    state.scene?.setInspectedTerminal?.(id,state.labEditorUI.snapshot().layout);
  }
  refreshSceneInspectionNote();
  refreshLabExplorer();
  return true;
}
function inspectTerminalReadOnly(id){
  if(!supportedWiringLessons().includes(state.lessonId) ||
      !listTerminals(state.lessonId).some(terminal=>terminal.id===id))return false;
  // Inspect is not a wiring gesture. Revoke any pending 3D terminal and
  // exit editor explicitly without touching the canonical learner circuit.
  state.labEditorUI?.closeEditor?.();
  state.stageTab="3d";
  renderStage();
  const accepted=explorerSelectTerminal(id);
  if(accepted)$("sceneInspectionStatus")?.scrollIntoView?.({
    block:"nearest",behavior:"auto",
  });
  return accepted;
}
function previewAuthoredMissingPairIn2D(pair, lessonId, stepIndex){
  // Stale rendered buttons may outlive a step/lesson change. Revalidate BOTH
  // editorial provenance and current canonical learner edges before touching
  // navigation; no reference/sample edge is silently copied to the learner.
  if(lessonId!==state.lessonId || !supportedWiringLessons().includes(lessonId) ||
     !Array.isArray(pair)||pair.length!==2 ||
     pair.some(id=>typeof id!=="string" || !id || id.trim()!==id))return false;
  const lesson=currentLesson();
  const current=state.learningSteps.get(lessonId)??0;
  if(current!==stepIndex)return false;
  let checkpoint;
  try{checkpoint=getPracticeCheckpoint(lesson,stepIndex);}catch{return false;}
  if(checkpoint.kind!=="wiring" || checkpoint.provenance?.scheme!=="human-authored-from-lesson-text")return false;
  const required=checkpoint.requiredPairs?.find(expected=>
    Array.isArray(expected)&&expected[0]===pair[0]&&expected[1]===pair[1]);
  if(!required)return false;
  const existing=learnerCircuit(lessonId);
  if(existing?.wires?.some(wire=>
    (wire.from===pair[0]&&wire.to===pair[1])||
    (wire.from===pair[1]&&wire.to===pair[0])))return false;

  // A visual 2D suggestion cannot inherit an armed 3D first-terminal gesture.
  // No connectCircuit, applyCanonicalCircuit, progress or journal callback.
  state.labEditorUI?.closeEditor?.();
  state.stageTab="wiring";
  renderStage();
  const preview=state.wiringUI?.previewSuggestedPair?.([pair[0],pair[1]]);
  if(preview?.mode!=="authored-pair-view-only" || preview.wireCreated!==false)return false;
  refreshLabExplorer();
  return true;
}
function explorerConnect(from,to) {
  if(!supportedWiringLessons().includes(state.lessonId))
    throw new RangeError("Bài này không có netlist đấu dây ngoài.");
  if(!state.labEditorUI?.snapshot?.().editing)
    throw new RangeError("Cần bật chỉnh sửa mạch trước khi nối.");
  // The same 3D controller owns pending terminal gestures; using its command
  // prevents stale 'firstTerminal' after a schematic dropdown connection.
  const previousWireCount=learnerCircuit().wires.length;
  state.labEditorUI.connectTerminals(from,to);
  // Only a real Explorer connect action that actually appended a canonical
  // learner edge is reported. Invalid clicks and sample-preset loading do
  // not masquerade as a user-created wire. This observation is lesson-scoped,
  // not proof of a physical action, mastery or the current checkpoint.
  if(learnerCircuit().wires.length===previousWireCount+1){
    recordPracticeAction("connect-wire");
  }
  refreshLabExplorer();
  return true;
}
function explorerDisconnect(wireId) {
  const circuit=learnerCircuit();
  if(!circuit)throw new RangeError("Bài này không có netlist đấu dây ngoài.");
  const next=disconnectCircuit(circuit,wireId);
  applyCanonicalCircuit(state.lessonId,next);
  return true;
}
function explorerFocus(id) {
  // Focus is deliberately camera-only; no implicit edit-mode switch, no
  // component selection and no electrical/layout mutation.
  if(!state.scene?.focusLabComponent || !state.labEditorUI?.isEditingIn3D?.())
    return false;
  const view=state.scene?.focusLabComponent?.(id);
  refreshLabExplorer();
  return view??false;
}
function explorerHighlightWire(wireId){
  // Inspector-to-3D projection of ONE already-existing learner edge.
  // The scene may mark its committed render visually; it must never create
  // an electrical authority or reuse the immutable reference sample here.
  if(!state.labEditorUI?.isEditingIn3D?.())return false;
  const learner=learnerCircuit();
  if(typeof wireId!=="string"||!learner?.wires?.some(wire=>wire.id===wireId))return false;
  return state.scene?.setHighlightedLabWire?.(wireId)??false;
}
function refresh3DWiring() {
  if (!state.scene?.setWiring) return;
  // When the conceptual 3D editor is active, show the EXACT learner draft
  // used by the 2D workbench. Outside edit mode, retain the teaching sample.
  const circuit = state.labEditorUI?.isEditingIn3D?.()
    ? learnerCircuit() : displayedCircuit();
  if (!circuit) { state.scene.setWiring(null); return; }
  const analysis = analyzeCircuit(state.lessonId, circuit);
  state.scene.setWiring(circuit, listTerminals(state.lessonId), analysis);
}
function renderElectricalPanel() {
  const section = $("electricalSection"), host = $("electricalResult");
  if (!section || !host) return;
  const lessonId = state.lessonId;
  section.hidden = !SUPPORTED_ELECTRICAL_LESSONS.includes(lessonId);
  if (section.hidden) { host.replaceChildren(); return; }
  const circuit = displayedCircuit(lessonId);
  const result = analyzeElectrical(lessonId, circuit);
  const draft = state.circuitModels.has(lessonId);
  const source = draft
    ? (state.activeCircuits.has(lessonId) ? "Mạch tự đấu đã kích hoạt" : "Bản đấu dây đang chỉnh sửa · chưa kích hoạt")
    : "Mạch mẫu tham khảo";
  const summary = el("p", "electrical-source", source);
  const explanation = el("p", "electrical-disclaimer",
    "Giả định chân HIGH lý tưởng 5 V, điện trở và Vf cố định; I = (5 V − Vf) / R. " +
    "Chỉ tính dòng tức thời của LED sau khi topology đạt kiểm tra; không phải số đo thực tế, SPICE hay xác nhận an toàn phần cứng.");
  host.replaceChildren(summary);
  if (!result.calculated) {
    const reason = result.issues?.find(issue => issue.severity === "error")?.message
      ?? result.issues?.[0]?.message ?? "Mạch chưa có đủ thông tin để tính.";
    host.append(el("p", "electrical-blocked", "Chưa thể tính dòng: " + reason), explanation);
    return;
  }
  const channels = el("div", "electrical-channels");
  for (const channel of result.channels) {
    const item = el("div", "electrical-channel");
    item.append(el("strong", "", channel.label),
      el("span", "electrical-value", channel.currentMilliAmps.toLocaleString("vi-VN") + " mA"),
      el("small", "", "R = " + channel.resistorOhms + " Ω · Vf = " + channel.forwardVoltageVolts + " V"));
    channels.append(item);
  }
  host.append(channels, explanation);
}
function refreshCircuitViews() {
  renderElectricalPanel();
  refresh3DWiring();
  state.labEditorUI?.update();
  const canonical=state.circuitModels.get(state.lessonId);
  if(canonical && state.wiringUI?.getCircuit?.()!==canonical){
    state.wiringUI?.setCircuit?.(canonical,{active:state.activeCircuits.has(state.lessonId)});
  }
  refreshLearnerHistoryControls();
  if (state.infoTab === "practice") renderInfo();
  refreshLabExplorer();
}
function updateCounter() {
  const count=state.progress.completed.length;
  $("sidebarCounter").textContent=`${count}/16`;
  $("sidebarProgress").style.width=`${count/16*100}%`;
  $("progressText").textContent=`${count}/16 bài đã hoàn thành`;
}
function renderLessonList() {
  const query=$("lessonSearch").value.trim().toLocaleLowerCase("vi");
  const found=lessons.filter(x=>`${x.title} ${x.category} ${x.description}`.toLocaleLowerCase("vi").includes(query));
  const container=$("lessonList");container.replaceChildren();
  if(!found.length){container.append(el("p","no-results","Không tìm thấy bài phù hợp. Hãy thử một từ khóa khác."));return;}
  for(const lesson of found) {
    const entry=el("button","lesson-link");
    entry.type="button";entry.dataset.lesson=String(lesson.id);
    entry.setAttribute("aria-current",lesson.id===state.lessonId?"page":"false");
    const no=el("span","lesson-num",pad(lesson.id));
    const copy=el("span","lesson-link-copy");
    copy.append(el("strong","",lesson.title),el("small","",`${lesson.minutes} phút · ${lesson.level}`));
    entry.append(no,copy);
    if(state.progress.completed.includes(lesson.id))entry.append(el("span","done-mark","✓"));
    container.append(entry);
  }
  updateCounter();
}
function renderHeading(lesson) {
  $("lessonCategory").textContent=lesson.category;
  $("lessonTitle").textContent=lesson.title;
  $("lessonDescription").textContent=lesson.description;
  $("lessonDuration").textContent=`◷ ${lesson.minutes} phút`;
  $("lessonDifficulty").textContent=lesson.level;
  $("breadcrumb").textContent=`Bài ${pad(lesson.id)}`;
  $("previousLesson").disabled=lesson.id===1;
  $("nextLesson").disabled=lesson.id===16;
  document.title=`${lesson.title} — Arduino 3D Việt Nam`;
  $("sceneLabel").textContent=lesson.category.split("·").at(-1).trim();
}
function renderUnoMechanicalOutline(){
  // Only the manufacturer's outer bounding dimensions are known here.
  // The rectangle is an original aspect-ratio diagram, not copied CAD,
  // an exact board silhouette, socket anchor or real breadboard transform.
  const spec=getUnoMechanicalOutline();
  const section=el("section","uno-mechanical-reference");
  section.dataset.unoMechanicalReference="outline-only";
  section.dataset.unoSceneSnap="unverified";
  section.setAttribute("role","group");
  section.setAttribute("aria-label","Đường bao kích thước Arduino Uno R3 theo tài liệu hãng");
  const heading=el("h5","","Kích thước bo Arduino Uno R3 · theo thông số hãng");
  const message=el("p","uno-mechanical-summary",
    `Kích thước bao ngoài theo Arduino: ${spec.widthMm.toLocaleString("vi-VN")} × ${spec.heightMm.toLocaleString("vi-VN")} mm; ${spec.mountingHoleCount} lỗ bắt vít đường kính Ø${spec.mountingHoleDiameterMm.toLocaleString("vi-VN")} mm (A000066, mục 5.4).`);
  const diagram=document.createElementNS("http://www.w3.org/2000/svg","svg");
  diagram.setAttribute("viewBox","0 0 620 465");
  diagram.setAttribute("role","img");
  diagram.setAttribute("aria-label",`Khung đường bao tỉ lệ ${spec.widthMm} trên ${spec.heightMm}, không thể hiện tọa độ lỗ bắt vít hay chân header.`);
  const svg=(name,attrs,text)=>{
    const node=document.createElementNS("http://www.w3.org/2000/svg",name);
    for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
    if(text!==undefined)node.textContent=String(text);
    return node;
  };
  const scale=6;
  const width=spec.widthMm*scale,height=spec.heightMm*scale;
  const x=95,y=62;
  diagram.append(
    svg("rect",{x,y,width,height,rx:3,fill:"#e2f3e9",stroke:"#25695a","stroke-width":3}),
    svg("text",{x:x+width/2,y:y+height/2,"text-anchor":"middle",fill:"#235b4c","font-size":19},"UNO R3 · đường bao"),
    svg("line",{x1:x,y1:y+height+26,x2:x+width,y2:y+height+26,stroke:"#316a5a","stroke-width":2}),
    svg("text",{x:x+width/2,y:y+height+49,"text-anchor":"middle",fill:"#315d52","font-size":16},`${spec.widthMm.toLocaleString("vi-VN")} mm`),
    svg("text",{x:x+width+22,y:y+height/2,"text-anchor":"middle",fill:"#315d52","font-size":14},`${spec.heightMm.toLocaleString("vi-VN")} mm`),
  );
  // Partial mechanically dimensioned evidence is shown as a separate table,
  // not rendered as positioned CAD circles on the simplified rectangle.
  const holeEvidence=getUnoMountingEvidence();
  const holeRegion=el("section","uno-mounting-reference");
  holeRegion.dataset.unoMountingEvidence="partial-dimensioned";
  holeRegion.dataset.unoHoleSnap="unsupported";
  holeRegion.setAttribute("role","group");
  holeRegion.setAttribute("aria-label","Khoảng kích thước đến tâm lỗ bắt vít Uno R3 từ bản vẽ hãng");
  holeRegion.append(el("h6","",`${holeEvidence.completeXYCount}/4 tâm lỗ có đủ hai trục kích thước`));
  const tableWrap=el("div","uno-mounting-table-wrap");
  tableWrap.tabIndex=0;
  tableWrap.setAttribute("aria-label","Bảng kích thước lỗ bắt vít, cuộn ngang khi màn hình hẹp");
  const table=el("table","uno-mounting-table");
  table.dataset.unoMountingTable="source-annotated-only";
  table.append(el("caption","","X tính từ mép trái, Y từ mép trên của bản vẽ nhìn từ phía trên; đơn vị mm."));
  const head=el("thead",""),headingRow=el("tr","");
  for(const title of ["Lỗ bắt vít","X từ trái (mm)","Y từ trên (mm)"]){
    const cell=el("th","",title);
    cell.scope="col";
    headingRow.append(cell);
  }
  head.append(headingRow);
  const body=el("tbody","");
  for(const hole of holeEvidence.holes){
    const row=el("tr","");
    row.dataset.unoMountingHole=hole.id;
    row.dataset.unoMountingKnownAxes=hole.knownAxes.join(",");
    const label={"upper-left":"Trên trái","upper-right":"Trên phải",
      "lower-right":"Dưới phải","lower-left":"Dưới trái"}[hole.id];
    row.append(
      el("td","",label),
      el("td","",hole.xMm===null?"Chưa có kích thước":hole.xMm.toLocaleString("vi-VN")),
      el("td","",hole.yMm.toLocaleString("vi-VN")),
    );
    body.append(row);
  }
  table.append(head,body);
  tableWrap.append(table);
  const mountingBoundary=el("p","uno-mounting-boundary",
    "Chỉ ba tâm có đủ tọa độ X/Y từ các mũi tên kích thước; X của tâm dưới trái chưa được nhà sản xuất định lượng tại mục 5.4. Bảng không phải bản vẽ CAD hoàn chỉnh, không định vị chân header và không cho phép snap lỗ hoặc xác nhận lắp ráp vật lý.");
  mountingBoundary.setAttribute("role","note");
  holeRegion.append(tableWrap,mountingBoundary);
  const note=el("p","uno-mechanical-boundary",
    "Kích thước 66,04 × 50,80 mm trên bản vẽ mục 5.4 là các khoảng tham chiếu, không phải chiều bao ngoài của bo. Sơ đồ không đặt bốn lỗ vít hay hàng chân vào tọa độ CAD; không thể dùng để snap dây/lỗ breadboard hoặc chứng minh vị trí 3D đã khớp phần cứng.");
  note.setAttribute("role","note");
  const overallSource=el("a","uno-mechanical-link","Nguồn kích thước bao ngoài: Arduino UNO Rev3 · Tech Specs");
  overallSource.href=spec.overallDimensionsSourceUrl;
  overallSource.target="_blank";
  overallSource.rel="noopener noreferrer";
  const source=el("a","uno-mechanical-link","Nguồn đường kính lỗ: Arduino A000066 · bản vẽ cơ khí, mục 5.4");
  source.href=spec.sourceUrl;
  source.target="_blank";
  source.rel="noopener noreferrer";
  section.append(heading,message,diagram,holeRegion,note,overallSource,source);
  return section;
}
function renderUnoPinReference() {
  // Manufacturer pin-label reference: not an electrical source or CAD mapping.
  const region = el("section", "uno-pin-reference");
  region.setAttribute("data-uno-pin-reference", "");
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Chú giải chức năng chân Arduino Uno R3");
  region.append(
    el("h4", "", "Chức năng chân Arduino Uno R3"),
    el("p", "uno-pin-source",
      "Theo Arduino UNO Rev3 A000066; đây không phải vị trí lỗ breadboard, phép đo hay kết quả firmware."),
  );
  region.append(renderUnoMechanicalOutline());
  const groups = [
    ["digital", "D0–D13 · chân số"],
    ["analog", "A0–A5 · chân analog"],
    ["i2c", "Header I²C · chức năng trùng A4/A5"],
    ["power", "Nguồn, reset và tham chiếu"],
  ];
  // Only canonical endpoints of the *current lesson* can be inspected in
  // the conceptual scene. Official aliases/other physical header pins remain
  // documentation, never guessed to occupy 3D positions.
  const viewable=new Set(supportedWiringLessons().includes(state.lessonId)
    ? listTerminals(state.lessonId).map(item=>item.id)
    : []);
  for (const [group, heading] of groups) {
    const field = el("div", "uno-pin-group");
    field.append(el("h5", "", heading));
    const table = el("table", "uno-pin-table");
    const thead = el("thead");
    const tr = el("tr");
    tr.append(el("th", "", "Chân"), el("th", "", "Chức năng được tài liệu ghi nhận"));
    thead.append(tr);
    const tbody = el("tbody");
    for (const pin of listUnoPinReferences().filter(item => item.group === group)) {
      const row = el("tr");
      row.setAttribute("data-uno-pin-id", pin.id);
      const role=el("td","",pin.functionLabel);
      if(viewable.has(pin.id)){
        const action=el("button","uno-pin-inspect","Xem trong 3D");
        action.type="button";
        action.dataset.unoPinInspect=pin.id;
        action.setAttribute("aria-label",
          "Xem chân "+pin.id+" của bài hiện tại trong 3D / Inspector");
        action.setAttribute("aria-describedby","unoPinReferenceBoundary");
        role.append(action);
      }
      row.append(el("th", "", pin.id),role);
      tbody.append(row);
    }
    table.append(thead, tbody);
    field.append(table);
    region.append(field);
  }
  const note = el("p", "uno-pin-boundary",
    "Nhãn chức năng theo tài liệu hãng không chứng minh bố trí chân/đầu cắm 3D " +
    "hay liên thông lỗ breadboard. Dây trong bài chỉ do circuit-router đánh giá.");
  note.setAttribute("data-uno-physical-boundary", "");
  note.id="unoPinReferenceBoundary";
  region.append(note);
  const link = el("a", "uno-pin-link", "Tài liệu pinout Arduino Uno R3 (PDF chính thức)");
  link.href = "https://content.arduino.cc/assets/A000066-full-pinout.pdf";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("data-uno-pin-provenance", UNO_REFERENCE_CLAIMS.source);
  region.append(link);
  return region;
}
function renderInfo() {
  const lesson=currentLesson();
  for(const tab of document.querySelectorAll("[data-info]")){
    const active=tab.dataset.info===state.infoTab;
    tab.setAttribute("aria-selected",String(active));
    tab.tabIndex=active?0:-1;
    if(active) $("infoContent").setAttribute("aria-labelledby",tab.id);
  }
  const host=$("infoContent");
  if(state.infoTab==="overview"){
    host.innerHTML=`<div class="goal-box"><small>MỤC TIÊU CỦA BÀI</small><strong>${safe(lesson.goal)}</strong></div>
    <h3>Kiến thức cần nắm</h3><p>${safe(lesson.theory)}</p>
    <h3>Điều quan trọng</h3><p>${safe(lesson.insight)}</p>
    <h3>Linh kiện trong bài</h3><div class="part-chip-list">${lesson.components.map(x=>`<span class="part-chip">${safe(x)}</span>`).join("")}</div>`;
  }else if(state.infoTab==="pinout"){
    host.innerHTML=`<h3>Bảng kết nối chân và linh kiện</h3><p>Chọn tab “Sơ đồ kết nối” để xem tổng quan trực quan.</p>
    <table class="wire-table"><thead><tr><th>TỪ</th><th>ĐẾN</th><th>Ý NGHĨA</th></tr></thead><tbody>
    ${lesson.wiring.map(([a,b,c])=>`<tr><td>${safe(a)}</td><td>${safe(b)}</td><td>${safe(c)}</td></tr>`).join("")}
    </tbody></table>`;
    host.append(renderUnoPinReference());
  }else{
    host.innerHTML=`<div class="goal-box"><small>THỰC HÀNH CÓ HƯỚNG DẪN</small><strong>${safe(lesson.goal)}</strong></div>
    <h3>Thực hiện theo thứ tự</h3><ol>${lesson.steps.map(x=>`<li>${safe(x)}</li>`).join("")}</ol>
    <h3>Lưu ý kỹ thuật</h3><p>${safe(lesson.caution)}</p>`;
    const hasLearnerDraft=state.circuitModels.has(lesson.id);
    const analysis=supportedWiringLessons().includes(lesson.id)
      ? analyzeCircuit(lesson.id,learnerCircuit(lesson.id)) : null;
    const guidance=getLessonGuidance(lesson,analysis);
    const microsteps=guidance.microsteps;
    if(microsteps.length){
      const current=Math.max(0,Math.min(microsteps.length-1,state.learningSteps.get(lesson.id)??0));
      state.learningSteps.set(lesson.id,current);
      const step=microsteps[current];
      const wrapper=el("section","learning-coach");
      wrapper.id="learningCoach";
      wrapper.setAttribute("aria-label","Học theo từng bước có kiểm chứng");
      wrapper.append(el("h4","","Từng bước thực hành"),
        el("p","coach-progress",`BƯỚC ${current+1}/${microsteps.length} · Nội dung tham khảo theo bài`),
        el("p","",step.instruction),
        el("p","coach-checkpoint","Cần kiểm tra: "+step.checkpoint));
      const hint=el("p","coach-hint",step.hint);
      hint.id="coachHintText";
      hint.hidden=!state.learningHints.has(`${lesson.id}:${current}`);
      wrapper.append(hint);
      if(guidance.wiring){
        wrapper.dataset.coachTopology=guidance.wiring.status;
        const feedbackKind=guidance.wiring.status==="topology-complete"?"Đã đạt yêu cầu kết nối trong mô hình":
          guidance.wiring.status==="signal-only-complete"?"Chỉ đủ dây tín hiệu, chưa có mô hình tải/nguồn":
          guidance.wiring.status==="unsafe"?"Cần sửa dây có vấn đề":
          "Đang thực hành · còn bước nối cần hoàn thiện";
        wrapper.append(el("p","coach-circuit-source",hasLearnerDraft
          ? "Nguồn kiểm tra: bản đấu dây đang chỉnh sửa (có thể đã nạp mạch mẫu)."
          : "Nguồn kiểm tra: bản tự đấu chưa có dây. Mạch mẫu chỉ để tham khảo."),
          el("p","coach-topology-feedback",feedbackKind),
          el("p","coach-wiring","Bản tự đấu hiện tại: "+guidance.wiring.summary),
          el("p","",guidance.wiring.nextAction));
        if(guidance.wiring.issues?.length){
          const issueList=el("ul","coach-issues");
          for(const issue of guidance.wiring.issues.slice(0,3)){
            const item=el("li","",issue.message);
            if(issue.feedback)item.append(el("span","coach-issue-advice"," Cách đối chiếu: "+issue.feedback));
            issueList.append(item);
          }
          wrapper.append(issueList);
        }
      }else wrapper.append(el("p","","Bài 01 dùng đèn L tích hợp, không yêu cầu dây ngoài."));
      // Per-step evidence observes ONLY the current canonical learner draft.
      // Neither the reference sample nor lesson-JS simulation may be credited
      // as a learner action, firmware execution or physical validation.
      const evidence=inspectPracticeEvidence({
        lesson,
        stepIndex:current,
        circuit:analysis?learnerCircuit(lesson.id):null,
        referenceCircuit:analysis?createSampleCircuit(lesson.id):null,
        analysis,
        hasLearnerDraft,
      });
      wrapper.append(renderPracticeEvidence(document,evidence,{
        onOpenWiring(){
          if(lesson.id!==state.lessonId || !supportedWiringLessons().includes(lesson.id))return;
          state.stageTab="wiring";
          renderStage();
          refreshLabExplorer();
          recordPracticeAction("view-wiring");
          $("stageTabWiring").focus({preventScroll:true});
        },
        onOpen3D(){
          if(lesson.id!==state.lessonId)return;
          state.stageTab="3d";
          renderStage();
          refreshLabExplorer();
          recordPracticeAction("view-3d");
          $("stageTab3d").focus({preventScroll:true});
        },
        onInspectMissingTerminal(terminalId){
          return lesson.id===state.lessonId
            ? inspectTerminalReadOnly(terminalId)
            : false;
        },
        onInspectChecklistTerminal(terminalId){
          // An authored row is a suggestion to inspect only. Even when a
          // reference pair matches, this action cannot grant progress/credit
          // or append a wire to the learner's canonical circuit-router graph.
          return lesson.id===state.lessonId
            ? inspectTerminalReadOnly(terminalId)
            : false;
        },
        onPreviewMissingPairIn2D(pair){
          // Authored edge guidance is a view-only dashed 2D annotation.
          // Revalidate source checkpoint/current learner draft in the host.
          return previewAuthoredMissingPairIn2D(pair,lesson.id,current);
        },
        onRecheck(){
          if(lesson.id!==state.lessonId || state.infoTab!=="practice")return;
          renderInfo();
          $("infoContent").querySelector("[data-practice-recheck]")?.focus({preventScroll:true});
        },
      }));
      wrapper.append(
        renderPracticeObservation(document,inspectPracticeObservation({
          lesson,stepIndex:current,journal:state.practiceObservations,
        }))
      );
      const actions=el("div","coach-actions");
      const previous=el("button","","← Bước trước");
      previous.id="coachPrevious";previous.type="button";previous.dataset.coachAction="previous";
      previous.disabled=current===0;
      const next=el("button","","Bước tiếp →");
      next.id="coachNext";next.type="button";next.dataset.coachAction="next";
      next.disabled=current===microsteps.length-1;
      const showHint=el("button","",hint.hidden?"Gợi ý khi cần":"Ẩn gợi ý");
      showHint.id="coachHint";showHint.type="button";showHint.dataset.coachAction="hint";
      actions.append(previous,showHint,next);
      wrapper.append(actions,
        el("p","coach-boundary","Đây là hướng dẫn học tập theo nội dung bài. Tiến độ từng bước chỉ lưu trong phiên, không đo hay xác nhận phần cứng."));
      host.append(wrapper);
    }
  }
  $("safetyNote").textContent=lesson.caution;
}
function renderStage() {
  if(state.stageTab!=="3d" && state.inspectedTerminalId!==null){
    state.inspectedTerminalId=null;
    state.scene?.setInspectedTerminal?.(null);
  }
  refreshSceneInspectionNote();
  state.wiringUI?.dispose();
  state.wiringUI=null;
  for(const tab of document.querySelectorAll("[data-stage]")){
    const active=tab.dataset.stage===state.stageTab;
    tab.setAttribute("aria-selected",String(active));
    tab.tabIndex=active?0:-1;
    if(active) $("viewport").setAttribute("aria-labelledby",tab.id);
  }
  const viewport=$("viewport");
  viewport.querySelector(".wiring-view")?.remove();
  viewport.querySelector(".parts-view")?.remove();
  const sceneMount=$("sceneMount");
  sceneMount.hidden=state.stageTab!=="3d";
  $("cameraToolbar").hidden=state.stageTab!=="3d";
  viewport.classList.toggle("is-wiring",state.stageTab==="wiring");
  viewport.classList.toggle("is-not-3d",state.stageTab!=="3d");
  const lesson=currentLesson();
  state.labEditorUI?.setStage(state.stageTab);
  if(state.stageTab==="wiring"){
    const panel=el("div","wiring-view");
    viewport.append(panel);
    if(supportedWiringLessons().includes(lesson.id)) {
      panel.classList.add("is-interactive");
      state.wiringUI=mountWiringWorkbench(panel,lesson.id,{
        initial:state.circuitModels.get(lesson.id)??createCircuit(lesson.id),
        active:state.activeCircuits.has(lesson.id),
        historyState:learnerHistorySnapshot(lesson.id),
        onUndo:requestLearnerUndo,
        onRedo:requestLearnerRedo,
        onChange(model,analysis){
          applyCanonicalCircuit(lesson.id,model,analysis);
        },
        onActivate(model,analysis){
          state.circuitModels.set(lesson.id,model);
          if(analysis.ok&&analysis.functional){
            state.activeCircuits.add(lesson.id);
            state.invalidatedCircuitLessons.delete(lesson.id);
            log("Đang dùng mạch tự đấu của bài này (giới hạn kiểm tra topology).");
          }
          refreshCircuitViews();
          updateSnapshot(true);
        },
        onDeactivate(reason){
          const wasActive=state.activeCircuits.delete(lesson.id);
          if(reason==="invalid"){
            if(wasActive)state.invalidatedCircuitLessons.add(lesson.id);
            if(state.running)stopClock();
            if(wasActive) log("Đã thu hồi kích hoạt mạch tự đấu vì kết nối thay đổi; cần kích hoạt lại sau khi sửa.");
          }else{
            state.invalidatedCircuitLessons.delete(lesson.id);
            log("Đã trở lại mô phỏng mẫu của bài học.");
          }
          refreshCircuitViews();
          updateSnapshot(true);
        }
      });
    } else {
      panel.innerHTML=`<div class="wiring-unsupported"><strong>${lesson.id === 1 ? "LED L có sẵn trên Arduino Uno" : "Sơ đồ tham khảo · chưa hỗ trợ đấu dây tự do"}</strong><p>${lesson.id === 1 ? "Bài nhập môn sử dụng LED L trên bo và không cần nối mạch ngoài. Có thể quan sát các chân D13 và GND bên dưới." : "Bài này có bảng chân để học tập."} ${supportedWiringLessons().length} bài khác có bàn đấu dây có giới hạn theo từng sơ đồ; đây không phải bộ giải điện học tổng quát.</p></div>
      <div class="wiring-diagram">${lesson.wiring.map(([from,to])=>
      `<div class="wire-route"><span class="wire-from">${safe(from)}</span><span class="wire-arrow">⟶</span><span class="wire-to">${safe(to)}</span></div>`).join("")}</div>`;
    }
  }else if(state.stageTab==="overview"){
    const panel=el("div","parts-view");
    panel.innerHTML=`<h3>Bộ linh kiện mô phỏng</h3><p>Các linh kiện của bài ${pad(lesson.id)} được dựng như hình minh họa, không thay thế sơ đồ kỹ thuật chi tiết.</p>
    <div class="part-chip-list parts-chips">${lesson.components.map(x=>`<span class="part-chip">${safe(x)}</span>`).join("")}</div>`;
    viewport.append(panel);
  }else state.scene?.resize();
  refresh3DWiring();
  refreshLabExplorer();
}
function renderControls(){
  const lesson=currentLesson(),controls=$("experimentControls");
  controls.replaceChildren();
  for(const config of lesson.controls){
    if(config.type==="slider"){
      const wrap=el("div","control-field");
      const label=el("label","");label.htmlFor=`control-${config.key}`;
      label.append(el("span","",config.label),el("output","",`${state.controls[config.key]} ${config.unit}`.trim()));
      label.querySelector("output").htmlFor=`control-${config.key}`;
      const input=el("input","");
      input.type="range";input.id=`control-${config.key}`;input.dataset.control=config.key;
      Object.assign(input,{min:config.min,max:config.max,step:config.step,value:state.controls[config.key]});
      wrap.append(label,input);controls.append(wrap);
    }else if(config.type==="toggle"){
      const wrap=el("label","quiz-choice");wrap.style.minHeight="43px";
      const input=el("input","");input.type="checkbox";input.dataset.control=config.key;input.checked=!!state.controls[config.key];
      wrap.append(input,el("span","",config.label));controls.append(wrap);
    }else if(config.type==="select"){
      const wrap=el("div","control-field");
      const label=el("label","",config.label);label.htmlFor=`control-${config.key}`;
      const input=el("select","");input.id=label.htmlFor;input.dataset.control=config.key;
      for(const [value,title] of config.options){const option=el("option","",title);option.value=value;input.append(option);}
      input.value=state.controls[config.key];wrap.append(label,input);controls.append(wrap);
    }else if(config.type==="button"){
      const b=el("button","press-control",config.label);b.type="button";
      b.dataset.press=config.key;b.setAttribute("aria-pressed","false");controls.append(b);
    }else if(config.type==="piano"){
      const wrap=el("div","note-buttons");wrap.setAttribute("role","group");wrap.setAttribute("aria-label","Chọn nốt nhạc");
      for(const [title] of NOTES) {
        const b=el("button","note-button",title);b.type="button";b.dataset.note=title;
        b.setAttribute("aria-pressed",String(state.controls.note===title));wrap.append(b);
      }
      controls.append(wrap);
    }
  }
  $("experimentTitle").textContent=lesson.id===1?"Đèn L trên bo":lesson.controls.some(x=>x.type==="button")?"Tương tác trực tiếp":lesson.id===9?"Chọn nốt để thử":"Điều chỉnh thông số";
  $("experimentHint").textContent=lesson.id===3||lesson.id===16?"Nhấn và giữ nút; nếu dùng bàn phím, giữ phím Space.":"Thay đổi tham số trước hoặc trong khi mô phỏng.";
}
function highlightArduino(code) {
  const escaped=safe(code);
  const parts=escaped.split(/(\/\/[^\n]*|\b(?:void|const|int|float|bool|unsigned|long|for|if|else|true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)\b|\b\d+(?:\.\d+)?\b|\b(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|noTone|delay|delayMicroseconds|pulseIn|Serial|begin|println|map|setup|loop|write|attach)\b)/g);
  return parts.map(p=>{
    if(p.startsWith("//")) return `<span class="token-comment">${p}</span>`;
    if(/^(?:void|const|int|float|bool|unsigned|long|for|if|else|true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)$/.test(p))return `<span class="token-key">${p}</span>`;
    if(/^\d+(?:\.\d+)?$/.test(p))return `<span class="token-num">${p}</span>`;
    if(/^(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|noTone|delay|delayMicroseconds|pulseIn|Serial|begin|println|map|setup|loop|write|attach)$/.test(p))return `<span class="token-function">${p}</span>`;
    return p;
  }).join("");
}
function renderSketch(){
  state.code=state.codeDrafts.get(state.lessonId) ?? currentLesson().sketch;
  state.editingCode=false;
  $("codeFilename").textContent=`bai_${pad(state.lessonId)}.ino`;
  $("codeViewer").innerHTML=`<code>${highlightArduino(state.code)}</code>`;
  $("codeViewer").hidden=false;
  $("codeEditor").hidden=true;
  $("codeEditor").value=state.code;
  $("editCode").textContent="✎ Sửa mã";
  updateCodeDraftStatus();
}
function updateSketchReview(){
  const host=$("sketchReviewMount");
  if(!host)return;
  // This is a source-text comparison only, never a C++ compiler or firmware
  // execution result. Keep the reference Sketch separate from edited text.
  try {
    const inspection=inspectSketchDraft({
      lessonId:state.lessonId,
      reference:currentLesson().sketch,
      draft:state.code,
    });
    // Lexical pin evidence uses the CURRENT learner draft, not the reference
    // Sketch, a compiler, firmware, or any imagined electrical connection.
    const pinEvidence=inspectSketchPinEvidence({lessonId:state.lessonId,source:state.code});
    host.replaceChildren(renderSketchReview(document,inspection,{pinEvidence}));
  } catch {
    host.replaceChildren(el("p","sketch-review-boundary",
      "Không thể đối chiếu bản nháp này; ứng dụng không biên dịch hoặc xác nhận mã Arduino C++."));
  }
  host.hidden=false;
}
function updateCodeDraftStatus(){
  const changed=state.codeDrafts.has(state.lessonId);
  state.avrPanel?.setDraftChanged(changed);
  $("restoreCode").hidden=!changed;
  $("codeEditStatus").classList.toggle("is-edited",changed);
  $("codeEditStatus").textContent=changed
    ? "Mã đã sửa · chỉ lưu trong tab này"
    : "Mã tham khảo · không chạy trên mô phỏng";
  updateSketchReview();
}
function toggleCodeEditor(){
  state.editingCode=!state.editingCode;
  $("codeEditor").hidden=!state.editingCode;
  $("codeViewer").hidden=state.editingCode;
  $("editCode").textContent=state.editingCode?"▤ Xem mã":"✎ Sửa mã";
  if(state.editingCode){$("codeEditor").value=state.code;$("codeEditor").focus({preventScroll:true});}
  else $("codeViewer").innerHTML=`<code>${highlightArduino(state.code)}</code>`;
}
function resetCodeDraft(){
  state.codeDrafts.delete(state.lessonId);
  state.code=currentLesson().sketch;
  $("codeEditor").value=state.code;
  $("codeViewer").innerHTML=`<code>${highlightArduino(state.code)}</code>`;
  updateCodeDraftStatus();
}
function downloadSketch(){
  const blob=new Blob([state.code],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;link.download=`bai_${pad(state.lessonId)}.ino`;
  document.body.append(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),500);
}
function renderQuiz(){
  state.quizSolved=false;
  const lesson=currentLesson();
  $("quizQuestion").textContent=lesson.quiz.question;
  const host=$("quizChoices");host.replaceChildren();
  lesson.quiz.choices.forEach((choice,index)=>{
    const label=el("label","quiz-choice");
    const input=el("input","");input.type="radio";input.name="quizAnswer";input.value=String(index);
    label.append(input,el("span","",choice));host.append(label);
  });
  $("quizFeedback").replaceChildren();$("quizFeedback").removeAttribute("data-result");
  $("completeButton").hidden=true;
  $("completeButton").disabled=false;
  $("completeButton").textContent="✓ Xác nhận hoàn thành bài học";
  if(state.progress.completed.includes(lesson.id)) {
    $("completeButton").hidden=false;$("completeButton").disabled=true;
    $("completeButton").textContent="✓ Đã hoàn thành bài học này";
  }
}
function stopClock() {
  state.running=false;
  if(state.frame)cancelAnimationFrame(state.frame);
  state.frame=0;state.previousTime=0;stopAudio();
}
function log(message){
  state.serial.push({time:new Date().toLocaleTimeString("vi-VN",{hour12:false}),message:String(message)});
  if(state.serial.length>24) state.serial.shift();
  const host=$("serialConsole");host.replaceChildren();
  for(const entry of state.serial) host.append(el("p","",`[${entry.time}] ${entry.message}`));
  host.scrollTop=host.scrollHeight;
}
function updateSnapshot(force=false) {
  let snapshot=simulate(state.lessonId,state.controls,state.elapsedMs,state.running,state.memory);
  if(state.activeCircuits.has(state.lessonId)){
    const circuit=state.circuitModels.get(state.lessonId)??createCircuit(state.lessonId);
    const analysis=analyzeCircuit(state.lessonId,circuit);
    if(!analysis.ok||!analysis.functional){
      const reason=analysis.issues?.find(x=>x.severity==="error")?.message
        ?? analysis.issues?.[0]?.message ?? "Thiếu kết nối";
      snapshot={...snapshot,led:false,brightness:0,rgbIntensity:0,toneHz:0,pump:false,motorSpeed:0,
        value:"Mạch tự đấu chưa hợp lệ",status:reason,serial:`MẠCH CHƯA ĐÚNG: ${reason}`,pins:[]};
    } else {
      snapshot={...snapshot,status:snapshot.status+" · mạch tự đấu hợp lệ",
        serial:"MẠCH HỢP LỆ · "+snapshot.serial};
    }
  }
  const signature=JSON.stringify(snapshot);
  if(!force&&state.previousSignature===signature)return;
  state.previousSignature=signature;
  $("simOutput").textContent=`${snapshot.value} · ${snapshot.status}`;
  $("runStatus").classList.toggle("is-running",state.running);
  $("runStatus").innerHTML=`<i aria-hidden="true"></i> ${state.running ? "Đang chạy" : "Đang dừng"}`;
  $("runButton").innerHTML=state.running?'Ⅱ <span>Tạm dừng</span>':'▶ <span>Chạy mô phỏng</span>';
  $("runButton").classList.toggle("is-running",state.running);
  state.scene?.update(snapshot);
  return snapshot;
}
function tick(now) {
  if(!state.running)return;
  const dt=state.previousTime?Math.max(0,Math.min(120,now-state.previousTime)):0;
  state.previousTime=now;
  state.elapsedMs+=dt;
  const snap=updateSnapshot();
  if(state.elapsedMs-state.lastLogTime>=1100) {
    state.lastLogTime=state.elapsedMs;
    log((snap || simulate(state.lessonId,state.controls,state.elapsedMs,state.running,state.memory)).serial);
  }
  state.frame=requestAnimationFrame(tick);
}
function startPause(){
  if(state.running) {
    stopClock();log("Đã tạm dừng mô phỏng.");updateSnapshot(true);
  }else {
    if(state.invalidatedCircuitLessons.has(state.lessonId)){
      const draft=state.circuitModels.get(state.lessonId)??createCircuit(state.lessonId);
      const analysis=analyzeCircuit(state.lessonId,draft);
      if(!analysis.ok||!analysis.functional){
        log("Mạch vừa kích hoạt đã bị thu hồi do kết nối sai; hãy sửa hoặc chọn dùng mô phỏng mẫu trước khi chạy.");
        updateSnapshot(true);
        return;
      }
      state.invalidatedCircuitLessons.delete(state.lessonId);
    }
    if(state.activeCircuits.has(state.lessonId)){
      const analysis=analyzeCircuit(state.lessonId,state.circuitModels.get(state.lessonId)??createCircuit(state.lessonId));
      if(!analysis.ok||!analysis.functional){
        log("Không thể chạy mạch tự đấu: hãy sửa kết nối và kiểm tra lại.");
        updateSnapshot(true);
        return;
      }
    }
    state.running=true;state.previousTime=0;state.lastLogTime=state.elapsedMs;
    log(`Bắt đầu bài ${pad(state.lessonId)}: ${currentLesson().title}`);
    const snap=updateSnapshot(true);log(snap.serial);
    state.frame=requestAnimationFrame(tick);
  }
}
function resetSimulation() {
  stopClock();state.controls=defaultControls(currentLesson());state.memory={};
  state.elapsedMs=0;state.lastLogTime=0;state.previousSignature="";
  renderControls();updateSnapshot(true);log("Đã đưa mô phỏng về trạng thái ban đầu.");
}
function setLesson(id,replaceHash=true){
  const lesson=lessonById(id);
  if(!lesson)return;
  stopClock();
  state.inspectedTerminalId=null;
  refreshSceneInspectionNote();
  state.lessonId=lesson.id;state.elapsedMs=0;state.lastLogTime=0;state.controls=defaultControls(lesson);
  state.memory={};state.serial=[];state.previousSignature="";state.infoTab="overview";state.stageTab="3d";
  // Clear previous-lesson 3D wiring before workbench callbacks can update it.
  state.scene?.setLesson(lesson);
  state.labEditorUI?.setLesson(lesson.id);
  renderHeading(lesson);renderLessonList();renderInfo();renderControls();renderStage();renderSketch();renderQuiz();
  state.avrPanel?.setLesson(lesson.id, state.codeDrafts.has(lesson.id));
  refreshCircuitViews();
  updateSnapshot(true);
  log("Đã tải bài học. Chọn Chạy mô phỏng để bắt đầu.");
  if(replaceHash) history.replaceState(null,"",`#bai-${pad(lesson.id)}`);
  document.querySelector(".lesson-link[aria-current='page']")?.scrollIntoView?.({block:"nearest"});
}
function onControlsInput(event){
  const target=event.target;
  if(!target.dataset.control)return;
  const key=target.dataset.control;
  const config=currentLesson().controls.find(c=>c.key===key);
  if(!config)return;
  const previous=state.controls[key];
  if(config.type==="slider"){
    const value=Math.max(config.min,Math.min(config.max,Number(target.value)));
    state.controls[key]=value;
    target.closest(".control-field")?.querySelector("output")?.replaceChildren(document.createTextNode(`${value} ${config.unit}`.trim()));
  }else if(config.type==="toggle")state.controls[key]=target.checked;
  else if(config.type==="select"){
    state.controls[key]=target.value;
    if(key==="buttonMode")state.memory={};
  }
  const snap=updateSnapshot(true);
  if(state.controls[key]!==previous)recordPracticeAction("change-control");
  if(state.running&&event.type==="change")log(snap.serial);
}
function setButtonPress(pressed){
  if(state.lessonId!==3&&state.lessonId!==16)return;
  if(!!state.controls.pressed===pressed)return;
  state.controls.pressed=pressed;
  if(pressed)recordPracticeAction("change-control");
  if(pressed&&state.lessonId===3&&state.running){
    state.memory=advanceToggleState(state.memory,state.controls.buttonMode,performance.now());
  }
  const button=$("experimentControls").querySelector("[data-press]");
  button?.classList.toggle("is-pressed",pressed);
  button?.setAttribute("aria-pressed",String(pressed));
  const snap=updateSnapshot(true);
  if(state.running)log(snap.serial);
}
function playNote(hz){
  if(!state.running||!hz)return;
  try{
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)return;
    state.audio=state.audio||new Context();
    if(state.audio.state==="suspended")state.audio.resume().catch(()=>{});
    const osc=state.audio.createOscillator(),gain=state.audio.createGain();
    osc.type="sine";osc.frequency.value=hz;gain.gain.setValueAtTime(0.0001,state.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.045,state.audio.currentTime+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,state.audio.currentTime+.25);
    osc.connect(gain);gain.connect(state.audio.destination);
    osc.start();osc.stop(state.audio.currentTime+.27);
  }catch{ /* Audio is optional; visual and serial feedback remain usable. */ }
}
function stopAudio(){
  // Individual piano notes are short-lived; suspend context between runs.
  try{state.audio?.suspend?.();}catch{}
}
function onQuizSubmit(event){
  event.preventDefault();
  const selected=new FormData(event.currentTarget).get("quizAnswer");
  const feedback=$("quizFeedback");
  if(selected===null){feedback.textContent="Hãy chọn một đáp án trước khi kiểm tra.";feedback.dataset.result="retry";return;}
  const correct=Number(selected)===currentLesson().quiz.answer;
  state.quizSolved=correct;
  feedback.dataset.result=correct?"success":"retry";
  feedback.textContent=correct ? `Chính xác! ${currentLesson().quiz.explanation} Hãy xác nhận hoàn thành bài học khi bạn đã thực hành.` :
    "Chưa chính xác. Hãy đọc lại phần Tổng quan và thử một lần nữa.";
  if(correct)$("completeButton").hidden=false;
}
function markCompleted(){
  if(!state.quizSolved||state.progress.completed.includes(state.lessonId))return;
  state.progress.completed.push(state.lessonId);
  state.progress=normalizeProgress(state.progress);
  const saved=saveProgress(state.progress);
  renderLessonList();
  $("completeButton").textContent="✓ Đã hoàn thành bài học này";
  $("completeButton").disabled=true;
  $("quizFeedback").dataset.result="success";
  $("quizFeedback").textContent=saved?
    "Đã ghi nhận hoàn thành. Tiến độ được lưu trên thiết bị này." :
    "Đã ghi nhận trong phiên này; trình duyệt không cho phép lưu tiến độ lâu dài. Hãy xuất bản sao JSON.";
}
const drawerMedia = window.matchMedia("(max-width: 1010px)");
function syncSidebar(open=false, restoreFocus=true) {
  const sidebar=$("sidebar"),wasOpen=sidebar.classList.contains("is-open");
  const mobile=drawerMedia.matches,show=mobile&&open;
  // Do not put aria-hidden/inert on an ancestor while it owns focus.
  if(!show&&wasOpen&&sidebar.contains(document.activeElement)) {
    if(restoreFocus)$("openSidebar").focus({preventScroll:true});
    else $("lessonTitle").focus({preventScroll:true});
  }
  sidebar.classList.toggle("is-open",show);
  sidebar.inert=mobile&&!show;
  if(mobile)sidebar.setAttribute("aria-hidden",String(!show));
  else sidebar.removeAttribute("aria-hidden");
  $("sidebarBackdrop").hidden=!show;
  $("openSidebar").setAttribute("aria-expanded",String(show));
  if(show&&!wasOpen)$("closeSidebar").focus({preventScroll:true});
}
function closeSidebar(restoreFocus=true){ syncSidebar(false,restoreFocus); }
function onHashChange(){
  const match=location.hash.match(/^#bai-(\d{1,2})$/);
  if(match&&Number(match[1])!==state.lessonId) setLesson(Number(match[1]),false);
}
function wireRovingTabs(selector) {
  const group=document.querySelector(selector);
  group.addEventListener("keydown",event=>{
    const current=event.target.closest?.('[role="tab"]');
    if(!current||!group.contains(current))return;
    const tabs=[...group.querySelectorAll('[role="tab"]')].filter(tab=>!tab.disabled);
    const currentIndex=tabs.indexOf(current);
    if(currentIndex<0)return;
    let nextIndex;
    if(event.key==="ArrowRight")nextIndex=(currentIndex+1)%tabs.length;
    else if(event.key==="ArrowLeft")nextIndex=(currentIndex+tabs.length-1)%tabs.length;
    else if(event.key==="Home")nextIndex=0;
    else if(event.key==="End")nextIndex=tabs.length-1;
    else return;
    event.preventDefault();
    const target=tabs[nextIndex];
    target.focus({preventScroll:true});
    target.click();
  });
}
function wireEvents(){
  $("lessonSearch").addEventListener("input",renderLessonList);
  $("lessonList").addEventListener("click",event=>{
    const b=event.target.closest("[data-lesson]");
    if(b){setLesson(Number(b.dataset.lesson));closeSidebar(false);window.scrollTo({top:0,behavior:"auto"});}
  });
  $("previousLesson").addEventListener("click",()=>setLesson(state.lessonId-1));
  $("nextLesson").addEventListener("click",()=>setLesson(state.lessonId+1));
  window.addEventListener("hashchange",onHashChange);
  document.querySelector(".stage-tabs").addEventListener("click",event=>{
    const tab=event.target.closest("[data-stage]");
    if(tab){
      state.stageTab=tab.dataset.stage;renderStage();
      if(state.stageTab==="3d")recordPracticeAction("view-3d");
      else if(state.stageTab==="wiring")recordPracticeAction("view-wiring");
    }
  });
  document.querySelector(".info-tabs").addEventListener("click",event=>{
    const tab=event.target.closest("[data-info]");
    if(tab){
      state.infoTab=tab.dataset.info;renderInfo();
      if(state.infoTab==="pinout")recordPracticeAction("view-pinout");
    }
  });
  $("infoContent").addEventListener("click",event=>{
    const pinButton=event.target.closest("[data-uno-pin-inspect]");
    if(pinButton && state.infoTab==="pinout"){
      inspectTerminalReadOnly(pinButton.dataset.unoPinInspect);
      return;
    }
    const control=event.target.closest("[data-coach-action]");
    if(!control || state.infoTab!=="practice")return;
    const lesson=currentLesson();
    const current=state.learningSteps.get(lesson.id)??0;
    const action=control.dataset.coachAction;
    if(action==="hint"){
      const key=`${lesson.id}:${current}`;
      if(state.learningHints.has(key))state.learningHints.delete(key);
      else state.learningHints.add(key);
    }else if(action==="previous" || action==="next"){
      const guide=getLessonGuidance(lesson);
      const offset=action==="next"?1:-1;
      state.learningSteps.set(lesson.id,Math.max(0,Math.min(guide.microsteps.length-1,current+offset)));
    }else return;
    renderInfo();
    $("coach"+(action==="next"?"Next":action==="previous"?"Previous":"Hint"))?.focus({preventScroll:true});
  });
  wireRovingTabs(".stage-tabs");
  wireRovingTabs(".info-tabs");
  $("experimentControls").addEventListener("input",onControlsInput);
  $("experimentControls").addEventListener("change",onControlsInput);
  const exp=$("experimentControls");
  exp.addEventListener("pointerdown",event=>{if(event.target.closest("[data-press]"))setButtonPress(true);});
  window.addEventListener("pointerup",()=>setButtonPress(false));
  window.addEventListener("pointercancel",()=>setButtonPress(false));
  exp.addEventListener("keydown",event=>{
    if(event.target.closest("[data-press]") && (event.key===" "||event.key==="Enter")){
      event.preventDefault();if(!event.repeat)setButtonPress(true);
    }
  });
  exp.addEventListener("keyup",event=>{
    if(event.target.closest("[data-press]")&&(event.key===" "||event.key==="Enter")){event.preventDefault();setButtonPress(false);}
  });
  exp.addEventListener("click",event=>{
    const note=event.target.closest("[data-note]");
    if(!note)return;
    state.controls.note=note.dataset.note;
    recordPracticeAction("change-control");
    for(const b of exp.querySelectorAll("[data-note]")) b.setAttribute("aria-pressed",String(b.dataset.note===state.controls.note));
    const snap=updateSnapshot(true);
    if(state.running){log(snap.serial);playNote(snap.toneHz);}
  });
  $("runButton").addEventListener("click",()=>{
    const wasRunning=state.running;
    startPause();
    if(!wasRunning&&state.running)recordPracticeAction("start-simulation");
  });
  $("resetButton").addEventListener("click",resetSimulation);
  $("cameraToolbar").addEventListener("click",event=>{
    const b=event.target.closest("[data-camera]");
    if(b){state.scene?.control(b.dataset.camera);refreshLabExplorer();}
  });
  $("sceneMount").addEventListener("keyup",event=>{
    // Scene handles Home/Escape on keydown; refresh the focus/selection
    // projection after that event rather than showing stale minimap state.
    if(event.target.matches?.("canvas")&&["Home","Escape"].includes(event.key))
      refreshLabExplorer();
  });
  $("clearSerial").addEventListener("click",()=>{state.serial=[];$("serialConsole").replaceChildren(el("p","","Đã xóa nhật ký."));});
  $("editCode").addEventListener("click",toggleCodeEditor);
  $("labUndoWire").addEventListener("click",()=>{
    if(!state.labEditorUI?.isEditingIn3D?.())return;
    const history=learnerHistorySnapshot();
    if(history?.canUndo)requestLearnerUndo({lessonId:state.lessonId,expectedRevision:history.revision});
  });
  $("labRedoWire").addEventListener("click",()=>{
    if(!state.labEditorUI?.isEditingIn3D?.())return;
    const history=learnerHistorySnapshot();
    if(history?.canRedo)requestLearnerRedo({lessonId:state.lessonId,expectedRevision:history.revision});
  });
  $("restoreCode").addEventListener("click",resetCodeDraft);
  $("downloadCode").addEventListener("click",downloadSketch);
  $("codeEditor").addEventListener("input",event=>{
    const draft=event.target.value.slice(0,12000);
    state.code=draft;
    if(draft===currentLesson().sketch)state.codeDrafts.delete(state.lessonId);
    else state.codeDrafts.set(state.lessonId,draft);
    recordPracticeAction("edit-sketch");
    updateCodeDraftStatus();
  });
  $("copyCode").addEventListener("click",async()=>{
    const button=$("copyCode"),original=button.textContent;
    try{
      if(!navigator.clipboard?.writeText) throw new Error("No clipboard API");
      await navigator.clipboard.writeText(state.code);
      button.textContent="✓ Đã sao chép";
    }catch{
      // No invented clipboard success on blocked or insecure contexts.
      button.textContent="Không thể sao chép tự động";
    }
    window.setTimeout(()=>button.textContent=original,1800);
  });
  $("quizForm").addEventListener("submit",onQuizSubmit);
  $("completeButton").addEventListener("click",markCompleted);
  $("exportProgress").addEventListener("click",()=>{
    const blob=new Blob([exportProgress(state.progress)],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="arduino-3d-viet-tien-do.json";
    document.body.append(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),500);
  });
  $("importProgress").addEventListener("click",()=>$("progressFile").click());
  $("progressFile").addEventListener("change",async event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try {
      if(file.size>15000) throw new Error("Tệp quá lớn");
      const json=JSON.parse(await file.text());
      state.progress=normalizeProgress(json);
      const saved=saveProgress(state.progress);
      renderLessonList();renderQuiz();
      alert(saved?"Đã nhập và lưu tiến độ thành công.":"Đã nhập tiến độ trong phiên này; lưu lâu dài không khả dụng.");
    }catch(error){alert("Không thể nhập tiến độ: "+(error?.message||"Dữ liệu không hợp lệ"));}
    event.target.value="";
  });
  $("openSidebar").addEventListener("click",()=>{
    syncSidebar(!$("sidebar").classList.contains("is-open"));
  });
  $("closeSidebar").addEventListener("click",closeSidebar);
  $("sidebarBackdrop").addEventListener("click",closeSidebar);
  drawerMedia.addEventListener("change",()=>syncSidebar(false,false));
  $("sidebar").addEventListener("keydown",event=>{
    if(event.key!=="Tab" || !drawerMedia.matches || !$("sidebar").classList.contains("is-open"))return;
    const els=[...$("sidebar").querySelectorAll("button:not(:disabled), input:not(:disabled), a[href]")].filter(x=>x.getClientRects().length>0);
    const first=els[0],last=els[els.length-1];
    if(!first||!last)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  const help=$("helpDialog");
  $("helpButton").addEventListener("click",()=>help.showModal());
  $("closeHelp").addEventListener("click",()=>help.close());
  $("helpGotIt").addEventListener("click",()=>help.close());
  window.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("sidebar").classList.contains("is-open"))closeSidebar();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&state.running)startPause();});
  window.addEventListener("beforeunload",()=>{
    state.labExplorerUI?.dispose();
    state.breadboardUI?.dispose();
    state.resistiveUI?.dispose();
    state.labEditorUI?.dispose();state.scene?.dispose();state.avrPanel?.dispose();
  });
}
async function init(){
  validateLessons();
  wireEvents();
  syncSidebar(false,false);
  state.labEditorUI=mountLabEditor({
    getCircuit: lessonId => learnerCircuit(lessonId),
    onEditModeChange(){
      state.inspectedTerminalId=null;
      state.scene?.setInspectedTerminal?.(null);
      refreshSceneInspectionNote();
      refresh3DWiring();
      refreshLabExplorer();
      refreshLearnerHistoryControls();
    },
    onSelectionChange:refreshLabExplorer,
    onLayoutChange:refreshLabExplorer,
    onCircuitChange(lessonId,model,analysis){
      applyCanonicalCircuit(lessonId,model,analysis);
    },
  });
  state.breadboardUI=mountBreadboardStudy({
    getLayout:()=>state.labEditorUI?.snapshot()?.layout??null,
    getLessonTerminals:()=>({
      lessonId:state.lessonId,
      terminals:supportedWiringLessons().includes(state.lessonId)
        ? listTerminals(state.lessonId)
        : [],
    }),
  });
  state.resistiveUI=mountResistiveStudy();
  state.labExplorerUI=mountLabExplorer($("labExplorer"),{
    getSnapshot:explorerSnapshot,
    onSelectComponent:explorerSelectComponent,
    onSelectTerminal:explorerSelectTerminal,
    onConnect:explorerConnect,
    onDisconnect:explorerDisconnect,
    onFocus:explorerFocus,
    onHighlightWire:explorerHighlightWire,
  });
  state.avrPanel=mountAvrPanel($("avrPanelMount"), {
    onEvidence(evidence){
      state.avrEvidence=evidence;
      state.labEditorUI?.setAvrEvidence(evidence);
    },
  });
  // A new Service Worker can claim a previously uncontrolled page OR replace an
  // existing controller while that page retains an already-evaluated old
  // lessons.js module. Either transition can mix source revisions; block the
  // AVR until reload, including the FIRST null -> controller transition.
  // The explicit reload gives learners a chance to save edited Sketches.
  if ("serviceWorker" in navigator) {
    let lastController = navigator.serviceWorker.controller;
    let refreshNoticeShown = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const replacement = navigator.serviceWorker.controller;
      if (!replacement || replacement === lastController || refreshNoticeShown) return;
      lastController = replacement;
      refreshNoticeShown = true;
      state.avrPanel?.invalidateForAssetUpdate();
      const notice = el("div", "update-notice");
      notice.setAttribute("role", "alert");
      notice.append(el("span", "", "Có phiên bản website mới. Hãy tải Sketch đang chỉnh sửa về máy trước khi làm mới trang để tránh trộn phiên bản firmware và bài học."));
      const reload = el("button", "button button-soft", "Tải lại phiên bản mới");
      reload.type = "button";
      reload.addEventListener("click", () => location.reload());
      notice.append(reload);
      $("content").prepend(notice);
    });
  }
  const hash=location.hash.match(/^#bai-(\d{1,2})$/);
  setLesson(hash && lessonById(Number(hash[1]))?Number(hash[1]):1);
  document.documentElement.dataset.ready="content";
  // Scene WebGL can lose context while a first wiring terminal is armed.
  // The visual ghost then disappears, so revoke the controller gesture too:
  // otherwise the next post-restore click could silently become terminal #2.
  // Capture on the stable host also catches non-bubbling canvas loss events.
  $("sceneMount").addEventListener("webglcontextlost", event=>{
    if(event.target?.tagName==="CANVAS"){
      if(state.labEditorUI?.clearTerminalSelection?.())refreshLabExplorer();
    }
  },true);
  // The app and all controls remain usable when WebGL or the 3D module cannot load.
  try{
    const {mountScene}=await import("./scene3d.js");
    state.scene=mountScene($("sceneMount"),()=>{ $("simOutput").textContent="Arduino Uno R3 · chọn bài học để quan sát chân và linh kiện"; });
    state.scene.setLesson(currentLesson());
    state.labEditorUI?.setScene(state.scene);
    refresh3DWiring();
    refreshLabExplorer();
    updateSnapshot(true);
    document.documentElement.dataset.ready="3d";
  }catch(error){
    state.labEditorUI?.setScene(null);
    refreshLabExplorer();
    $("sceneMount").replaceChildren();
    const div=el("div","scene-fallback");
    div.innerHTML=`<div><strong>Không thể tải mô hình 3D</strong><p>${safe(error?.message||"Trình duyệt không hỗ trợ WebGL.")}</p><p>Bạn vẫn có thể sử dụng sơ đồ kết nối, bài học, điều khiển và bài kiểm tra.</p></div>`;
    $("sceneMount").append(div);
    document.documentElement.dataset.ready="fallback";
  }
}
init().catch(error=>{
  console.error("Không thể khởi tạo Arduino 3D Việt:",error);
  $("lessonList").replaceChildren(el("p","no-results","Không thể tải bài học. Hãy tải lại trang qua máy chủ HTTP."));
});
// Published sites can be revisited offline after their static assets are cached.
// Avoid caching during local development, so edited lessons remain fresh.
if ("serviceWorker" in navigator && location.protocol === "https:" &&
    !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error =>
      console.warn("Không thể bật chế độ offline:", error));
  });
}
