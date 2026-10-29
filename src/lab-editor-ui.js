/**
 * Accessible controller for the conceptual Three.js lab layout.
 * 3D positions are illustrative; electrical topology stays in circuit-router.
 * No current, voltage, breadboard-hole or physical safety claim is made here.
 */
import {
  createLabLayout, moveLabComponent, rotateLabComponent,
  validateLabLayout,
} from "./lab-layout.js";
import {
  createCircuit, createSampleCircuit, connectCircuit, disconnectCircuit,
  analyzeCircuit, listTerminals, supportedWiringLessons,
} from "./circuit-router.js";

const $ = id => document.getElementById(id);
const supported = new Set(supportedWiringLessons());
const create = (tag, text = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

/** Mount once, then call setScene/setLesson/setStage as the application changes. */
export function mountLabEditor({
  getCircuit, onCircuitChange, onEditModeChange = () => {},
  onSelectionChange = () => {}, onLayoutChange = () => {},
}) {
  if (typeof getCircuit !== "function" || typeof onCircuitChange !== "function") {
    throw new TypeError("Lab editor requires real circuit read/write callbacks.");
  }
  if ([onEditModeChange,onSelectionChange,onLayoutChange].some(callback=>typeof callback!=="function")) {
    throw new TypeError("Lab editor change observers must be functions.");
  }
  const entry = $("labEditEntry"), panel = $("labEditor"), toggle = $("labEditToggle");
  const componentSelect = $("labComponent"), posX = $("labPositionX"), posZ = $("labPositionZ");
  const fromSelect = $("labFromPin"), toSelect = $("labToPin");
  const message = $("labStatus"), terminalNote = $("labSelectedTerminal"), avrNote = $("labAvrStatus");
  const cancelPending = $("labCancelPendingWire");
  if ([entry,panel,toggle,componentSelect,posX,posZ,fromSelect,toSelect,message,terminalNote,avrNote,cancelPending].some(node=>!node)) {
    throw new Error("Missing 3D lab editor DOM controls.");
  }

  const layouts = new Map();
  let lessonId = 1, scene = null, stage = "3d", editing = false, selectedId = null;
  let readOnlyGuideMode = false;
  let explicitlyDeselected = false;
  let firstTerminal = null, disposed = false, avrEvidence = null;
  let lastMessage = "", lastKind = "";
  // Scene owns disposable WebGL objects. Avoid rebuilding meshes/textures on
  // every status or wiring update when the immutable layout has not changed.
  let renderedScene = null, renderedLayout = null;

  const wireFieldset = fromSelect.closest("fieldset") || panel;
  const precisionWireList = create("div");
  precisionWireList.className = "lab-precision-wire-list";
  precisionWireList.dataset.labPrecisionWireList = "";
  precisionWireList.setAttribute("role", "group");
  precisionWireList.setAttribute("aria-label", "Dây learner graph hiện tại và thao tác gỡ chính xác");
  precisionWireList.setAttribute("tabindex", "-1");
  const precisionWireHeading = create("h4", "Dây learner graph hiện tại");
  const precisionWireProvenance = create("p", "Nguồn: learner graph only · chỉ phản ánh netlist học viên trong ứng dụng.");
  precisionWireProvenance.dataset.labWireProvenance = "learner graph only";
  const precisionWireRows = create("ul");
  precisionWireRows.className = "lab-precision-wire-rows";
  precisionWireRows.dataset.labPrecisionWireRows = "";
  precisionWireList.append(precisionWireHeading, precisionWireProvenance, precisionWireRows);
  wireFieldset.append(precisionWireList);

  const lessonSupported = () => supported.has(lessonId);
  const guideActive = () => !disposed && readOnlyGuideMode && lessonSupported() &&
    stage === "3d" && !!scene && !editing;
  // Pending two-terminal wiring intent belongs to this controller only.
  // The Three.js overlay mirrors it for feedback; it cannot create a wire.
  const syncPendingScenePreview = () => {
    const current = lessonSupported() && editing && stage === "3d"
      ? firstTerminal : null;
    // This visible/native keyboard control mirrors the exact same first
    // terminal that drives the scene preview. It never owns a second graph.
    cancelPending.disabled = current === null;
    panel.dataset.labPendingTerminal = current ?? "";
    cancelPending.setAttribute("aria-label",current === null
      ? "Chưa có chân đầu tiên đang chờ nối"
      : "Hủy chọn chân đầu tiên " + current + "; không tạo dây mới");
    scene?.setPendingWireTerminal?.(current);
  };
  const layoutFor = () => {
    if (!lessonSupported()) return null;
    let layout = layouts.get(lessonId);
    if (!layout) {
      const terminals = listTerminals(lessonId);
      layout = createLabLayout(lessonId, terminals);
      const result = validateLabLayout(layout, terminals);
      if (!result.ok) throw new Error("Bố trí 3D không hợp lệ: " + result.errors.join("; "));
      layouts.set(lessonId, layout);
    }
    return layout;
  };
  const announce = (text, kind = "") => {
    lastMessage = String(text || "");
    lastKind = kind;
    message.dataset.kind = kind;
    message.textContent = lastMessage;
  };
  function showAvrEvidence() {
    if (!avrEvidence || avrEvidence.mode !== "peripheral") {
      avrNote.textContent = "AVR là thí nghiệm độc lập với mô phỏng JavaScript/đường dây 3D. Bật chế độ ngoại vi trong bảng AVR, nạp HEX đã kiểm SHA để xem trạng thái thanh ghi.";
      return;
    }
    const d13 = avrEvidence.d13;
    const state = d13?.level === null ? "chưa xác định" : d13?.level ? "HIGH" : "LOW";
    avrNote.textContent = `AVR từ HEX đã kiểm SHA · ${avrEvidence.cycles.toLocaleString("vi-VN")} chu kỳ CPU · D13/PB5 ${d13?.mode || "unknown"} ${state} (trạng thái thanh ghi ảo) · USART TX ${avrEvidence.txCount} byte. Không suy ra LED, dây 3D hay linh kiện vật lý đã hoạt động.`;
  }

  const selectComponent = (id, explanation = "") => {
    const layout = layoutFor();
    if (!layout) return false;
    if (id === null || id === "") {
      selectedId = null;
      explicitlyDeselected = true;
      announce(explanation || "Đã bỏ chọn linh kiện trên 3D; không có đối tượng nào được di chuyển.");
      render();
      onSelectionChange(null, lessonId);
      return true;
    }
    const component = layout.components.find(item => item.id === id);
    if (!component) return false;
    selectedId = id;
    explicitlyDeselected = false;
    if (component.fixed) announce("Đã chọn Arduino Uno cố định; không thể di chuyển hoặc xoay bo.");
    else if (explanation) announce(explanation);
    render();
    onSelectionChange(selectedId, lessonId);
    return true;
  };
  const moveComponent = (id, x, z) => {
    const layout = layoutFor();
    if (!layout || !editing) return false;
    if (!id || layout.components.find(item=>item.id===id)?.fixed) {
      announce("Chọn một linh kiện có thể di chuyển; Arduino Uno là bo cố định.", "warning");
      return false;
    }
    try {
      const next = moveLabComponent(layout,id,x,z);
      const check = validateLabLayout(next,listTerminals(lessonId));
      if (!check.ok) throw new Error(check.errors.join("; "));
      layouts.set(lessonId,next);
      selectedId = id;
      explicitlyDeselected = false;
      announce("Đã cập nhật vị trí minh họa của " + id + ". Netlist điện không thay đổi.");
      render();
      onLayoutChange(next,lessonId);
      return true;
    } catch (error) {
      announce("Không thể đặt linh kiện: " + (error?.message || "tọa độ không hợp lệ"),"error");
      scene?.setLabLayout?.(layout);
      return false;
    }
  };
  const rotateComponent = turns => {
    const layout = layoutFor();
    if (!editing || !layout || !selectedId) return false;
    if (layout.components.find(item=>item.id===selectedId)?.fixed) {
      announce("Arduino Uno là bo cố định; không thể xoay.", "warning");
      return false;
    }
    try {
      const next = rotateLabComponent(layout, selectedId, turns);
      const check = validateLabLayout(next, listTerminals(lessonId));
      if (!check.ok) throw new Error(check.errors.join("; "));
      layouts.set(lessonId,next);
      announce("Đã xoay " + selectedId + " theo ô 90° của mô hình khái niệm.");
      render();
      onLayoutChange(next,lessonId);
      return true;
    } catch(error) {
      announce("Không thể xoay: " + (error?.message || "không hỗ trợ"),"error");
      return false;
    }
  };
  const applyCircuit = (next, detail) => {
    if (!lessonSupported()) return;
    const analysis = analyzeCircuit(lessonId,next);
    onCircuitChange(lessonId,next,analysis);
    const issue = analysis.issues?.find(item=>item.severity==="error") ||
      analysis.issues?.find(item=>item.severity==="warning");
    const summary = analysis.scope==="signal-only"
      ? "Bài này chỉ kiểm tra dây tín hiệu; nguồn/tải chưa có mô hình."
      : analysis.ok && analysis.functional
        ? "Topology đáp ứng đường chức năng đã định nghĩa của bài."
        : (issue?.message || "Mạch chưa đạt topology bài học.");
    announce(detail + " " + summary, analysis.ok ? "" : "warning");
    render();
  };
  const terminalLinkResult = ({
    accepted = false, committed = false, reason = "rejected",
    fromId = null, toId = null, wireId = null,
  } = {}) => Object.freeze({
    accepted:Boolean(accepted), committed:Boolean(committed), reason:String(reason),
    lessonId, fromId, toId, wireId,
    learnerGraphOnly:true, physicalVerified:false,
  });
  const currentLearnerCircuit = ({ requireExisting = false } = {}) => {
    if (!lessonSupported()) return null;
    const current = getCircuit(lessonId);
    if (current == null) return requireExisting ? null : createCircuit(lessonId);
    if (!current || typeof current !== "object" || current.lessonId !== lessonId || !Array.isArray(current.wires)) {
      throw new RangeError("Learner graph không thuộc bài học canonical đang mở.");
    }
    analyzeCircuit(lessonId,current);
    return current;
  };
  const connectTerminals = (from,to) => {
    if (!editing || stage!=="3d" || !scene || !lessonSupported()) {
      return terminalLinkResult({reason:"editor-not-active",fromId:from??null,toId:to??null});
    }
    const names = new Set(listTerminals(lessonId).map(item=>item.id));
    if (typeof from!=="string" || typeof to!=="string" || !names.has(from) || !names.has(to) || from === to) {
      announce("Cần chọn hai chân canonical khác nhau trong đúng bài học.","error");
      return terminalLinkResult({reason:from===to?"same-terminal":"invalid-terminal",fromId:from??null,toId:to??null});
    }
    try {
      const base = currentLearnerCircuit() ?? createCircuit(lessonId);
      const next = connectCircuit(base,from,to);
      const newWire = next.wires.find(wire=>!base.wires.some(previous=>previous.id===wire.id)) ?? next.wires.at(-1) ?? null;
      firstTerminal = null;
      syncPendingScenePreview();
      applyCircuit(next, "Đã nối " + from + " → " + to + " trên netlist.");
      return terminalLinkResult({
        accepted:true,committed:true,reason:"connected",fromId:from,toId:to,wireId:newWire?.id??null,
      });
    } catch (error) {
      announce("Không thể nối: " + (error?.message || "đường nối không hợp lệ"),"error");
      return terminalLinkResult({reason:"router-rejected",fromId:from,toId:to});
    }
  };
  const onTerminalSelect = terminalId => {
    if (!editing || stage!=="3d" || !scene || !lessonSupported()) return false;
    const names = new Set(listTerminals(lessonId).map(item=>item.id));
    if (!names.has(terminalId)) { announce("Chân không thuộc bài học này.","error"); return false; }
    if (firstTerminal === null) {
      firstTerminal = terminalId;
      fromSelect.value = terminalId;
      terminalNote.textContent = "Đã chọn " + terminalId + ". Chọn chân thứ hai trên 3D để nối cùng netlist 2D.";
      announce("Chờ chân thứ hai; chưa thay đổi mạch.");
      syncPendingScenePreview();
      return true;
    } else if (firstTerminal === terminalId) {
      firstTerminal = null;
      terminalNote.textContent = "Đã hủy chọn chân; không có dây mới.";
      announce("Hủy chọn chân.");
      syncPendingScenePreview();
      return true;
    } else {
      const from=firstTerminal;
      toSelect.value = terminalId;
      terminalNote.textContent = "Nối " + from + " → " + terminalId + "; kết quả kiểm tra ở trạng thái bên dưới.";
      return connectTerminals(from,terminalId).committed;
    }
  };
  const validPointerDragMeta = meta => !!meta && typeof meta === "object" &&
    Object.getPrototypeOf(meta) === Object.prototype && Object.isFrozen(meta) &&
    Object.hasOwn(meta,"source") && Object.hasOwn(meta,"physicalVerified") &&
    meta.source === "pointer-drag" && meta.physicalVerified === false &&
    Object.keys(meta).length === 2 && Object.getOwnPropertySymbols(meta).length === 0;
  const onTerminalDragStart = (sourceId,meta,callbackLessonId) => {
    if(callbackLessonId!==lessonId)return false;
    if(!editing||stage!=="3d"||!scene||!lessonSupported())return false;
    if(!validPointerDragMeta(meta))return false;
    const names=new Set(listTerminals(lessonId).map(item=>item.id));
    if(typeof sourceId!=="string"||!names.has(sourceId))return false;
    if(firstTerminal!==null){
      firstTerminal=null;
      terminalNote.textContent="Đã hủy chân đầu tiên đang chờ khi bắt đầu kéo dây 3D; chưa tạo dây mới.";
      announce("Đã chuyển sang thao tác kéo dây 3D; netlist học viên chưa thay đổi.");
      syncPendingScenePreview();
    }
    return true;
  };
  const onTerminalLink = (fromId,toId,meta,callbackLessonId) => {
    if(callbackLessonId!==lessonId){
      return terminalLinkResult({reason:"stale-lesson",fromId:fromId??null,toId:toId??null});
    }
    if(!editing||stage!=="3d"||!scene||!lessonSupported()){
      return terminalLinkResult({reason:"editor-not-active",fromId:fromId??null,toId:toId??null});
    }
    if(!meta||typeof meta!=="object"||meta.source!=="pointer-drag"||meta.physicalVerified!==false||meta.canceled===true){
      return terminalLinkResult({reason:meta?.canceled===true?"canceled":"invalid-meta",fromId:fromId??null,toId:toId??null});
    }
    const names=new Set(listTerminals(lessonId).map(item=>item.id));
    if(typeof fromId!=="string"||typeof toId!=="string"||fromId===toId||!names.has(fromId)||!names.has(toId)){
      return terminalLinkResult({reason:fromId===toId?"same-terminal":"invalid-terminal",fromId:fromId??null,toId:toId??null});
    }
    try{
      const current=currentLearnerCircuit();
      if(!current||current.lessonId!==lessonId){
        return terminalLinkResult({reason:"foreign-learner-graph",fromId:fromId,toId:toId});
      }
    }catch{
      return terminalLinkResult({reason:"foreign-learner-graph",fromId:fromId,toId:toId});
    }
    // Only a fully validated current drag completion may revoke an older
    // two-tap pending terminal. Forged/stale/foreign callbacks above are UI
    // side-effect free as well as graph side-effect free.
    if(firstTerminal!==null){
      firstTerminal=null;
      terminalNote.textContent="Đã hủy chân đầu tiên đang chờ trước thao tác kéo nối 3D.";
      syncPendingScenePreview();
    }
    return connectTerminals(fromId,toId);
  };
  const sceneCallbacks = {
    enabled:false,
    onSelectComponent: componentId => {
      if(!editing||stage!=="3d"||!scene||!lessonSupported())return false;
      return selectComponent(componentId, componentId === null
        ? "Đã bỏ chọn linh kiện từ 3D."
        : "Đã chọn linh kiện " + componentId + " từ 3D.");
    },
    onMoveComponent: (componentId,x,z,meta) => {
      if(!editing||stage!=="3d"||!scene||!lessonSupported())return false;
      if (meta?.kind === "rotate") {
        if(!selectComponent(componentId))return false;
        return rotateComponent(meta.deltaQuarterTurns);
      }
      return moveComponent(componentId,x,z);
    },
    onTerminalSelect,
  };
  function fillSelect(node, items, value) {
    const values = items.map(item=>item.value).join("\u001f");
    if (node.dataset.entries !== values) {
      node.replaceChildren(...items.map(item=>{
        const option=create("option",item.label);option.value=item.value;return option;
      }));
      node.dataset.entries=values;
    }
    if (items.some(item=>item.value===value)) node.value=value;
  }

  function render() {
    if (disposed) return;
    const available = lessonSupported();
    const sceneVisible = stage==="3d" && !!scene;
    entry.hidden = !available || !sceneVisible;
    if (!available) { editing=false; readOnlyGuideMode=false; }
    panel.hidden = !available || !sceneVisible || !editing;
    toggle.setAttribute("aria-expanded",String(!panel.hidden));
    toggle.setAttribute("aria-pressed",String(editing));
    toggle.textContent = editing ? "✓ Đóng bàn bố trí 3D" : "✣ Bố trí và nối dây 3D";
    if (!available) {
      scene?.setLabEdit?.({ ...sceneCallbacks, enabled:false });
      if (scene !== renderedScene || renderedLayout !== null) {
        scene?.setLabLayout?.(null);
        renderedScene = scene;
        renderedLayout = null;
      }
      return;
    }
    const layout=layoutFor();
    const movable=layout.components.filter(item=>!item.fixed);
    if (selectedId !== null && !layout.components.some(item=>item.id===selectedId)) {
      selectedId = null;
      explicitlyDeselected = false;
    }
    if (selectedId === null && !explicitlyDeselected) selectedId=movable[0]?.id ?? null;
    const selected=layout.components.find(item=>item.id===selectedId);
    const canMove = !!selected && !selected.fixed && editing && sceneVisible;
    fillSelect(componentSelect,[
      {value:"",label:"— Chưa chọn linh kiện —"},
      ...layout.components.map(item=>({
        value:item.id,label:item.label+" · "+item.id+(item.fixed?" (cố định)":""),
      })),
    ],selectedId ?? "");
    if (selected) {
      posX.value=String(selected.x);
      posZ.value=String(selected.z);
      posX.min=String(layout.bounds.minX);posX.max=String(layout.bounds.maxX);
      posZ.min=String(layout.bounds.minZ);posZ.max=String(layout.bounds.maxZ);
    } else { posX.value=""; posZ.value=""; }
    posX.disabled=!canMove;posZ.disabled=!canMove;
    $("labPlace").disabled=!canMove;
    $("labRotateLeft").disabled=!canMove;
    $("labRotateRight").disabled=!canMove;
    for(const button of panel.querySelectorAll("[data-lab-nudge]"))button.disabled=!canMove;
    const terminals=listTerminals(lessonId).map(item=>({value:item.id,label:item.label+" ("+item.id+")"}));
    fillSelect(fromSelect,terminals,firstTerminal ?? fromSelect.value ?? terminals[0]?.value);
    fillSelect(toSelect,terminals,toSelect.value ?? terminals[1]?.value);
    const circuit=currentLearnerCircuit() ?? createCircuit(lessonId);
    const analysis=analyzeCircuit(lessonId,circuit);
    renderPrecisionWireList(circuit);
    message.dataset.valid=String(analysis.ok && analysis.functional);
    if (!lastMessage) {
      const issue=analysis.issues?.find(item=>item.severity==="error") || analysis.issues?.[0];
      announce(`Bài ${String(lessonId).padStart(2,"0")}: ${circuit.wires.length} dây; ${analysis.scope==="signal-only" ? "chỉ mô hình tín hiệu, không kích hoạt motor/bơm" : analysis.ok ? "topology bài học đạt" : issue?.message || "chưa đủ dây"}. Không phải chứng nhận điện thực.`,analysis.ok ? "" : "warning");
    }
    // The original Three.js educational scene remains the default. Creating
    // the conceptual placement overlay is explicit opt-in, never a silent
    // replacement of the existing lesson model and checked netlist drawing.
    const desiredLayout = (editing || guideActive()) && sceneVisible ? layout : null;
    if (scene !== renderedScene || renderedLayout !== desiredLayout) {
      scene?.setLabLayout?.(desiredLayout);
      renderedScene = scene;
      renderedLayout = desiredLayout;
    }
    const callbackLessonId=lessonId;
    scene?.setLabEdit?.({
      ...sceneCallbacks,
      onTerminalDragStart:(sourceId,meta)=>onTerminalDragStart(sourceId,meta,callbackLessonId),
      onTerminalLink:(fromId,toId,meta)=>onTerminalLink(fromId,toId,meta,callbackLessonId),
      enabled:editing && sceneVisible,
      selectedComponentId:editing && sceneVisible ? selectedId : null,
    });
    syncPendingScenePreview();
    showAvrEvidence();
  }
  const onToggle=()=>{
    if(!editing)readOnlyGuideMode=false;
    editing=!editing;firstTerminal=null;lastMessage="";render();
    // Reference wires are appropriate for view-only teaching; during editing,
    // the 3D canvas must show the same learner draft as the 2D workbench.
    onEditModeChange();
  };
  const onCancelPending=()=>{
    if(!editing||stage!=="3d"||firstTerminal===null)return false;
    firstTerminal=null;
    terminalNote.textContent="Đã hủy chọn chân đầu tiên; không tạo dây mới. Chọn chân khác để bắt đầu lại.";
    announce("Đã hủy xem trước nối dây; netlist học viên được giữ nguyên.");
    syncPendingScenePreview();
    onSelectionChange(selectedId,lessonId);
    fromSelect.focus({preventScroll:true});
    return true;
  };
  const onPendingKeydown=event=>{
    if(event.key!=="Escape"||!editing||stage!=="3d"||firstTerminal===null)return;
    event.preventDefault();
    event.stopPropagation();
    onCancelPending();
  };
  const onComponent=()=>selectComponent(componentSelect.value);
  const onPlace=()=>moveComponent(selectedId,Number(posX.value),Number(posZ.value));
  const onNudge=event=>{
    const button=event.target.closest("[data-lab-nudge]");
    if (!button || !selectedId || !editing) return;
    const [dx,dz]=button.dataset.labNudge.split(",").map(Number);
    const selected=layoutFor()?.components.find(item=>item.id===selectedId);
    if (selected) moveComponent(selectedId,selected.x+dx,selected.z+dz);
  };
  const onWire=()=>connectTerminals(fromSelect.value,toSelect.value);
  const onSample=()=>{ if(editing) applyCircuit(createSampleCircuit(lessonId),"Đã dùng mẫu của bài."); };
  const onClear=()=>{ if(editing) applyCircuit(createCircuit(lessonId),"Đã xóa các dây trong bản tự đấu."); };
  const onRemove=()=>{
    let circuit=null;
    try{circuit=currentLearnerCircuit({requireExisting:true});}
    catch(error){announce("Không thể đọc learner graph: "+(error?.message||"không hợp lệ"),"error");return false;}
    const last=circuit?.wires?.at(-1);
    if(!last){announce("Chưa có dây learner graph để gỡ.");return false;}
    return removeWireById(last.id,lessonId);
  };
  const removeWireById=(wireId,expectedLessonId=lessonId)=>{
    if(!editing||stage!=="3d"||!scene||!lessonSupported()){
      announce("Chỉ gỡ dây khi bàn chỉnh 3D của bài hiện tại đang mở.","error");
      return false;
    }
    if(expectedLessonId!==lessonId){
      announce("Yêu cầu gỡ dây đã cũ vì bài học đã thay đổi.","error");
      return false;
    }
    if(typeof wireId!=="string"||!/^w\d+$/.test(wireId)){
      announce("ID dây không phải ID canonical của circuit-router.","error");
      return false;
    }
    try{
      const circuit=currentLearnerCircuit({requireExisting:true});
      if(!circuit){announce("Learner graph hiện tại chưa có dây để gỡ.","warning");return false;}
      const wire=circuit.wires.find(item=>item.id===wireId);
      if(!wire){announce("Dây cần gỡ không còn trong learner graph hiện tại.","error");return false;}
      const next=disconnectCircuit(circuit,wire.id);
      applyCircuit(next,"Đã gỡ dây "+wire.id+" · "+wire.from+" → "+wire.to+" khỏi learner graph.");
      return true;
    }catch(error){
      announce("Không thể gỡ dây: "+(error?.message||"learner graph không hợp lệ"),"error");
      return false;
    }
  };
  const renderPrecisionWireList=(circuit)=>{
    precisionWireRows.replaceChildren();
    if(!circuit?.wires?.length){
      const empty=create("li","Learner graph hiện tại chưa có dây.");
      empty.dataset.labPrecisionWireEmpty="";
      precisionWireRows.append(empty);
      return;
    }
    for(const wire of circuit.wires){
      const row=create("li");
      row.className="lab-precision-wire-row";
      row.dataset.labWireRow=wire.id;
      const endpoints=create("span",wire.id+" · "+wire.from+" → "+wire.to+" · learner graph only");
      endpoints.dataset.labWireEndpoints=wire.id;
      const remove=create("button","Gỡ dây");
      remove.type="button";
      remove.className="lab-precision-wire-remove";
      remove.dataset.labRemoveWireId=wire.id;
      remove.dataset.labWireLesson=String(lessonId);
      remove.style.minHeight="44px";
      remove.style.minWidth="44px";
      remove.disabled=!editing||stage!=="3d";
      remove.setAttribute("aria-label","Gỡ dây "+wire.id+" từ "+wire.from+" đến "+wire.to+" khỏi learner graph trong ứng dụng");
      row.append(endpoints,remove);
      precisionWireRows.append(row);
    }
  };
  const onPrecisionWireRemove=event=>{
    const button=event.target.closest("[data-lab-remove-wire-id]");
    if(!button)return false;
    const buttons=[...precisionWireRows.querySelectorAll("[data-lab-remove-wire-id]")];
    const removedIndex=buttons.indexOf(button);
    const expectedLessonId=Number(button.dataset.labWireLesson);
    const removed=removeWireById(button.dataset.labRemoveWireId,expectedLessonId);
    if(!removed)return false;
    const surviving=[...precisionWireRows.querySelectorAll("[data-lab-remove-wire-id]")];
    const focusTarget=surviving.length
      ? surviving[Math.min(Math.max(removedIndex,0),surviving.length-1)]
      : precisionWireList;
    focusTarget.focus({preventScroll:true});
    return true;
  };
  const onReset=()=>{
    if (!editing||stage!=="3d"||!scene||!lessonSupported()) return false;
    layouts.delete(lessonId);
    selectedId=null;
    explicitlyDeselected=false;
    firstTerminal=null;
    lastMessage="";
    render();
    announce("Đã khôi phục bố trí minh họa mặc định; các dây netlist được giữ nguyên.");
    onLayoutChange(layoutFor(),lessonId);
    return true;
  };

  const listeners=[
    [toggle,"click",onToggle],
    [cancelPending,"click",onCancelPending],
    [panel,"keydown",onPendingKeydown],
    [componentSelect,"change",onComponent],
    [$("labPlace"),"click",onPlace],
    [$("labRotateLeft"),"click",()=>rotateComponent(-1)],
    [$("labRotateRight"),"click",()=>rotateComponent(1)],
    [$("labResetPositions"),"click",onReset],
    [panel,"click",onNudge],
    [$("labConnect"),"click",onWire],
    [$("labSampleWires"),"click",onSample],
    [$("labClearWires"),"click",onClear],
    [$("labRemoveLastWire"),"click",onRemove],
    [precisionWireList,"click",onPrecisionWireRemove],
  ];
  for(const [node,event,fn] of listeners) node.addEventListener(event,fn);
  render();
  return Object.freeze({
    setScene(next){
      const nextScene=next||null;
      if(nextScene!==scene&&readOnlyGuideMode){
        scene?.setLabLayout?.(null);
        readOnlyGuideMode=false;
      }
      scene=nextScene;renderedScene=null;renderedLayout=null;lastMessage="";render();
    },
    setLesson(id){
      if(!Number.isInteger(id)||id<1||id>16)throw new RangeError("Invalid lab lesson ID.");
      if(readOnlyGuideMode)scene?.setLabLayout?.(null);
      readOnlyGuideMode=false;
      lessonId=id;editing=false;selectedId=null;explicitlyDeselected=false;firstTerminal=null;lastMessage="";
      renderedLayout=null;
      render();
    },
    setStage(value){
      // Prime may render the already-active 3D stage again while an authored
      // read-only guide overlay is visible. Treat that idle refresh as a true
      // no-op so the mounted canonical layout/scene-owned overlay cannot be
      // disturbed by redundant stage synchronization.
      if(value===stage&&guideActive())return;
      // A half-completed 3D terminal gesture cannot survive a switch to 2D
      // or another view. Keep the edit mode/layout, but revoke its transient
      // first-terminal intent before any later 3D terminal click.
      const stageChanged=value!==stage;
      const revokeFirstTerminal=stage==="3d" && value!=="3d" && firstTerminal!==null;
      if(stageChanged)readOnlyGuideMode=false;
      stage=value;
      if(revokeFirstTerminal){
        firstTerminal=null;
        terminalNote.textContent="Đã hủy chọn chân đầu tiên khi rời không gian 3D; không tạo dây mới.";
      }
      render();
      if(revokeFirstTerminal)onSelectionChange(selectedId,lessonId);
    },
    update(){lastMessage="";render();},
    setReadOnlyGuideMode(enabled){
      if(typeof enabled!=="boolean")throw new TypeError("Read-only guide mode expects a boolean.");
      if(!enabled){
        readOnlyGuideMode=false;
        render();
        return false;
      }
      if(disposed||editing||stage!=="3d"||!scene||!lessonSupported()){
        readOnlyGuideMode=false;
        render();
        return false;
      }
      readOnlyGuideMode=true;
      firstTerminal=null;
      syncPendingScenePreview();
      render();
      return true;
    },
    isReadOnlyGuideIn3D(){return guideActive();},
    openEditor(){
      if(!lessonSupported()||stage!=="3d"||!scene)return false;
      if(!editing){
        readOnlyGuideMode=false;
        editing=true;firstTerminal=null;lastMessage="";render();onEditModeChange();
      }
      return true;
    },
    closeEditor(){
      // Read-only learning actions may intentionally leave the editor without
      // discarding the canonical learner graph or any committed layout.
      if(!editing)return false;
      editing=false;
      firstTerminal=null;
      terminalNote.textContent="Đã hủy thao tác nối dây đang chờ; bản mạch học viên được giữ nguyên.";
      lastMessage="";
      render();
      onEditModeChange();
      return true;
    },
    selectComponent(id){selectComponent(id);return selectedId;},
    selectTerminal(id){onTerminalSelect(id);return firstTerminal;},
    connectTerminals(from,to){return connectTerminals(from,to);},
    removeWire(wireId,expectedLessonId=lessonId){return removeWireById(wireId,expectedLessonId);},
    clearTerminalSelection(){
      if(firstTerminal===null)return false;
      firstTerminal=null;
      syncPendingScenePreview();
      terminalNote.textContent="Đã hủy chọn chân đầu tiên sau khi netlist thay đổi.";
      return true;
    },
    isEditingIn3D(){return lessonSupported() && editing && stage==="3d";},
    setAvrEvidence(evidence){avrEvidence=evidence;showAvrEvidence();},
    snapshot(){
      return Object.freeze({
        lessonId,stage,editing,readOnlyGuideIn3D:guideActive(),selectedId,firstTerminal,layout:layoutFor(),
        circuit:lessonSupported()?getCircuit(lessonId):null,
      });
    },
    dispose(){
      if(disposed)return;
      if(readOnlyGuideMode)scene?.setLabLayout?.(null);
      readOnlyGuideMode=false;
      disposed=true;
      scene?.setPendingWireTerminal?.(null);
      for(const [node,event,fn] of listeners) node.removeEventListener(event,fn);
      scene?.setLabEdit?.({...sceneCallbacks,enabled:false});
      layouts.clear();
      precisionWireList.remove();
    },
  });
}
