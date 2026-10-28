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
export function mountLabEditor({ getCircuit, onCircuitChange, onEditModeChange = () => {} }) {
  if (typeof getCircuit !== "function" || typeof onCircuitChange !== "function") {
    throw new TypeError("Lab editor requires real circuit read/write callbacks.");
  }
  if (typeof onEditModeChange !== "function") {
    throw new TypeError("Lab editor view mode callback must be a function.");
  }
  const entry = $("labEditEntry"), panel = $("labEditor"), toggle = $("labEditToggle");
  const componentSelect = $("labComponent"), posX = $("labPositionX"), posZ = $("labPositionZ");
  const fromSelect = $("labFromPin"), toSelect = $("labToPin");
  const message = $("labStatus"), terminalNote = $("labSelectedTerminal"), avrNote = $("labAvrStatus");
  if ([entry,panel,toggle,componentSelect,posX,posZ,fromSelect,toSelect,message,terminalNote,avrNote].some(node=>!node)) {
    throw new Error("Missing 3D lab editor DOM controls.");
  }

  const layouts = new Map();
  let lessonId = 1, scene = null, stage = "3d", editing = false, selectedId = null;
  let explicitlyDeselected = false;
  let firstTerminal = null, disposed = false, avrEvidence = null;
  let lastMessage = "", lastKind = "";
  // Scene owns disposable WebGL objects. Avoid rebuilding meshes/textures on
  // every status or wiring update when the immutable layout has not changed.
  let renderedScene = null, renderedLayout = null;

  const lessonSupported = () => supported.has(lessonId);
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
    if (!layout) return;
    if (id === null || id === "") {
      selectedId = null;
      explicitlyDeselected = true;
      announce(explanation || "Đã bỏ chọn linh kiện trên 3D; không có đối tượng nào được di chuyển.");
      render();
      return;
    }
    const component = layout.components.find(item => item.id === id);
    if (!component) return;
    selectedId = id;
    explicitlyDeselected = false;
    if (component.fixed) announce("Đã chọn Arduino Uno cố định; không thể di chuyển hoặc xoay bo.");
    else if (explanation) announce(explanation);
    render();
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
      return true;
    } catch (error) {
      announce("Không thể đặt linh kiện: " + (error?.message || "tọa độ không hợp lệ"),"error");
      scene?.setLabLayout?.(layout);
      return false;
    }
  };
  const rotateComponent = turns => {
    const layout = layoutFor();
    if (!editing || !layout || !selectedId) return;
    if (layout.components.find(item=>item.id===selectedId)?.fixed) {
      announce("Arduino Uno là bo cố định; không thể xoay.", "warning");
      return;
    }
    try {
      const next = rotateLabComponent(layout, selectedId, turns);
      const check = validateLabLayout(next, listTerminals(lessonId));
      if (!check.ok) throw new Error(check.errors.join("; "));
      layouts.set(lessonId,next);
      announce("Đã xoay " + selectedId + " theo ô 90° của mô hình khái niệm.");
      render();
    } catch(error) {
      announce("Không thể xoay: " + (error?.message || "không hỗ trợ"),"error");
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
  const connectTerminals = (from,to) => {
    if (!editing || !lessonSupported()) return;
    if (!from || !to || from === to) { announce("Cần chọn hai chân khác nhau trong đúng bài học.","error"); return; }
    try {
      const base = getCircuit(lessonId) ?? createCircuit(lessonId);
      const next = connectCircuit(base,from,to);
      firstTerminal = null;
      applyCircuit(next, "Đã nối " + from + " → " + to + " trên netlist.");
    } catch (error) {
      announce("Không thể nối: " + (error?.message || "đường nối không hợp lệ"),"error");
    }
  };
  const onTerminalSelect = terminalId => {
    if (!editing) return;
    const names = new Set(listTerminals(lessonId).map(item=>item.id));
    if (!names.has(terminalId)) { announce("Chân không thuộc bài học này.","error"); return; }
    if (firstTerminal === null) {
      firstTerminal = terminalId;
      fromSelect.value = terminalId;
      terminalNote.textContent = "Đã chọn " + terminalId + ". Chọn chân thứ hai trên 3D để nối cùng netlist 2D.";
      announce("Chờ chân thứ hai; chưa thay đổi mạch.");
    } else if (firstTerminal === terminalId) {
      firstTerminal = null;
      terminalNote.textContent = "Đã hủy chọn chân; không có dây mới.";
      announce("Hủy chọn chân.");
    } else {
      const from=firstTerminal;
      toSelect.value = terminalId;
      terminalNote.textContent = "Nối " + from + " → " + terminalId + "; kết quả kiểm tra ở trạng thái bên dưới.";
      connectTerminals(from,terminalId);
    }
  };
  const sceneCallbacks = {
    enabled:false,
    onSelectComponent: componentId => selectComponent(componentId, componentId === null
      ? "Đã bỏ chọn linh kiện từ 3D."
      : "Đã chọn linh kiện " + componentId + " từ 3D."),
    onMoveComponent: (componentId,x,z,meta) => {
      if (meta?.kind === "rotate") {
        selectComponent(componentId);
        rotateComponent(meta.deltaQuarterTurns);
        return true;
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
    if (!available) editing=false;
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
    const circuit=getCircuit(lessonId) ?? createCircuit(lessonId);
    const analysis=analyzeCircuit(lessonId,circuit);
    message.dataset.valid=String(analysis.ok && analysis.functional);
    if (!lastMessage) {
      const issue=analysis.issues?.find(item=>item.severity==="error") || analysis.issues?.[0];
      announce(`Bài ${String(lessonId).padStart(2,"0")}: ${circuit.wires.length} dây; ${analysis.scope==="signal-only" ? "chỉ mô hình tín hiệu, không kích hoạt motor/bơm" : analysis.ok ? "topology bài học đạt" : issue?.message || "chưa đủ dây"}. Không phải chứng nhận điện thực.`,analysis.ok ? "" : "warning");
    }
    // The original Three.js educational scene remains the default. Creating
    // the conceptual placement overlay is explicit opt-in, never a silent
    // replacement of the existing lesson model and checked netlist drawing.
    const desiredLayout = editing && sceneVisible ? layout : null;
    if (scene !== renderedScene || renderedLayout !== desiredLayout) {
      scene?.setLabLayout?.(desiredLayout);
      renderedScene = scene;
      renderedLayout = desiredLayout;
    }
    scene?.setLabEdit?.({
      ...sceneCallbacks,
      enabled:editing && sceneVisible,
      selectedComponentId:editing && sceneVisible ? selectedId : null,
    });
    showAvrEvidence();
  }
  const onToggle=()=>{
    editing=!editing;firstTerminal=null;lastMessage="";render();
    // Reference wires are appropriate for view-only teaching; during editing,
    // the 3D canvas must show the same learner draft as the 2D workbench.
    onEditModeChange();
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
    const circuit=getCircuit(lessonId);
    const last=circuit?.wires?.at(-1);
    if (!editing || !last) { announce("Chưa có dây để gỡ.");return; }
    try {applyCircuit(disconnectCircuit(circuit,last.id),"Đã gỡ dây cuối " + last.from + " → " + last.to + ".");}
    catch(error){announce("Không thể gỡ: " + (error?.message||"không rõ"),"error");}
  };
  const onReset=()=>{
    if (!lessonSupported()) return;
    layouts.delete(lessonId);
    selectedId=null;
    explicitlyDeselected=false;
    firstTerminal=null;
    lastMessage="";
    render();
    announce("Đã khôi phục bố trí minh họa mặc định; các dây netlist được giữ nguyên.");
  };

  const listeners=[
    [toggle,"click",onToggle],
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
  ];
  for(const [node,event,fn] of listeners) node.addEventListener(event,fn);
  render();
  return Object.freeze({
    setScene(next){scene=next||null;renderedScene=null;renderedLayout=null;lastMessage="";render();},
    setLesson(id){
      if(!Number.isInteger(id)||id<1||id>16)throw new RangeError("Invalid lab lesson ID.");
      lessonId=id;editing=false;selectedId=null;explicitlyDeselected=false;firstTerminal=null;lastMessage="";
      renderedLayout=null;
      render();
    },
    setStage(value){stage=value;render();},
    update(){lastMessage="";render();},
    isEditingIn3D(){return lessonSupported() && editing && stage==="3d";},
    setAvrEvidence(evidence){avrEvidence=evidence;showAvrEvidence();},
    snapshot(){
      return Object.freeze({
        lessonId,stage,editing,selectedId,firstTerminal,layout:layoutFor(),
        circuit:lessonSupported()?getCircuit(lessonId):null,
      });
    },
    dispose(){
      if(disposed)return;
      disposed=true;
      for(const [node,event,fn] of listeners) node.removeEventListener(event,fn);
      scene?.setLabEdit?.({...sceneCallbacks,enabled:false});
      layouts.clear();
    },
  });
}
