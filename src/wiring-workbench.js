/**
 * Accessible 2D wiring workbench for the bounded circuit-graph lesson engine.
 * Clicking or dragging one terminal to another creates a wire; undo operates
 * on the graph model, not on the SVG. Visual wires are not a SPICE simulation.
 */
import {
  createCircuit, connectCircuit, disconnectCircuit,
  analyzeCircuit, listTerminals,
  supportedWiringLessons as availableLessons,
  createSampleCircuit
} from "./circuit-router.js";
const create = (tag,cls,text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
};
const name = terminal => typeof terminal==="string" ? terminal : terminal.id;
const title = terminal => typeof terminal==="string" ? terminal : terminal.label || terminal.name || terminal.id;
const issueText = issue => typeof issue==="string"
  ? issue : issue?.message || issue?.description || issue?.code || "Lỗi kết nối chưa xác định";

function normalizeHistoryState(value,lessonId) {
  if(value==null)return Object.freeze({lessonId,revision:0,canUndo:false,canRedo:false});
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype){
    throw new TypeError("historyState phải là inspect snapshot object chuẩn.");
  }
  for(const key of ["lessonId","revision","canUndo","canRedo"]){
    if(!Object.hasOwn(value,key))throw new TypeError("historyState thiếu field "+key+".");
  }
  if(value.lessonId!==lessonId)throw new RangeError("historyState thuộc bài học khác.");
  if(!Number.isSafeInteger(value.revision)||value.revision<0){
    throw new RangeError("historyState.revision phải là số nguyên an toàn không âm.");
  }
  if(typeof value.canUndo!=="boolean"||typeof value.canRedo!=="boolean"){
    throw new TypeError("historyState canUndo/canRedo phải là boolean.");
  }
  return Object.freeze({
    lessonId,
    revision:value.revision,
    canUndo:value.canUndo,
    canRedo:value.canRedo,
  });
}

export function supportedWiringLessons() { return availableLessons(); }
export function sampleCircuit(lessonId) {
  return createSampleCircuit(lessonId);
}

/**
 * @param {HTMLElement} host - an attached element inside the wiring stage.
 * @param {number} lessonId
 * @param {{initial?: object, active?: boolean, onChange?:(s:object,a:object)=>void,
 * onActivate?:(s:object,a:object)=>void, onDeactivate?:()=>void,
 * historyState?:object, onUndo?:(request:object)=>void, onRedo?:(request:object)=>void}} options
 */
export function mountWiringWorkbench(host,lessonId,options={}) {
  const id=Number(lessonId);
  const terminals=listTerminals(id);
  if(!terminals.length)return null;
  let circuit=options.initial ?? createCircuit(id);
  let analysis=analyzeCircuit(id,circuit);
  let selected=null, active=!!options.active, drag=null,preview=null,raf=0,disposed=false,skipClick=false;
  let historyState=normalizeHistoryState(options.historyState,id);
  // Authored corrective guidance is a *view-only* visual annotation of two
  // canonical terminal IDs, not the user's armed first endpoint or circuit.
  let suggestedPair=null;
  // Cross-surface inspection may point at ONE already-committed learner wire.
  // This is presentation state only; it never creates/changes an edge or history.
  let highlightedWire=null;
  // A committed learner-wire edit is a temporary proposal. Only Confirm
  // replaces the current router-produced edge, with ONE host history event.
  let reroute=null,rerouteHover=null;
  const terminalIds=new Set(terminals.map(item=>item.id));

  host.replaceChildren();
  host.classList.add("wiring-workbench");
  const titleRow=create("div","wire-work-header");
  const introduction=create("div","wire-intro");
    introduction.append(create("span","wire-work-eyebrow","BÀN ĐẤU DÂY TƯƠNG TÁC"),create("h3","",`Bài ${String(id).padStart(2,"0")} · Tự nối mạch`),
    create("p","","Chọn hai chân liên tiếp hoặc kéo để nối. Chỉ kiểm tra topology bài học, không đo dòng/áp hoặc xác nhận an toàn toàn bộ phần cứng."));
  if(id===10||id===14)introduction.append(create("p","wire-scope-note",
    "Bài này chỉ minh họa dây tín hiệu điều khiển, chưa mô hình nguồn và tải motor/bơm. Không thể kích hoạt mạch tự đấu; mô phỏng mẫu JavaScript vẫn chạy độc lập và không chứng minh tải thực hoạt động."));
  const toolbar=create("div","wire-actions");
  const undoBtn=create("button","wire-action","↶ Hoàn tác");undoBtn.type="button";
  const redoBtn=create("button","wire-action","↷ Làm lại");redoBtn.type="button";
  undoBtn.style.minHeight="44px";undoBtn.style.minWidth="44px";
  redoBtn.style.minHeight="44px";redoBtn.style.minWidth="44px";
  undoBtn.setAttribute("aria-label","Hoàn tác trạng thái đấu dây trước đó trong ứng dụng");
  redoBtn.setAttribute("aria-label","Làm lại trạng thái đấu dây tiếp theo trong ứng dụng");
  undoBtn.title="Chỉ đổi learner graph trong ứng dụng; không hoàn tác thao tác phần cứng.";
  redoBtn.title="Chỉ đổi learner graph trong ứng dụng; không lặp lại thao tác phần cứng.";
  const sampleBtn=create("button","wire-action","⌁ Mạch mẫu");sampleBtn.type="button";sampleBtn.title="Nối dây đúng theo sơ đồ mẫu để đối chiếu";
  const clearBtn=create("button","wire-action","↺ Xóa dây");clearBtn.type="button";
  const historyControls=typeof options.onUndo==="function"||typeof options.onRedo==="function";
  if(historyControls)toolbar.append(undoBtn,redoBtn);
  toolbar.append(sampleBtn,clearBtn);titleRow.append(introduction,toolbar);

  const workspace=create("div","wire-space");
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("class","wire-svg");svg.setAttribute("aria-hidden","true");
  const boardGroup=create("div","wire-component wire-board");
  boardGroup.append(create("h4","","ARDUINO UNO R3"),create("p","","Chân trên bo"));
  const componentGroup=create("div","wire-component wire-parts");
  componentGroup.append(create("h4","","LINH KIỆN"),create("p","","Các điểm nối"));
  const boardList=create("div","terminal-list");
  const componentList=create("div","terminal-list");
  for(const item of terminals) {
    const key=name(item),button=create("button","wire-terminal",title(item));
    button.type="button";
    button.dataset.terminal=key;
    button.setAttribute("aria-pressed","false");
    button.setAttribute("aria-label",`Chân ${title(item)}. Chọn để nối dây.`);
    const socket=create("span","wire-socket");socket.setAttribute("aria-hidden","true");
    const label=create("span","wire-terminal-label",title(item));
    button.replaceChildren(socket,label);
    (item.component==="arduino"?boardList:componentList).append(button);
  }
  boardGroup.append(boardList);
  componentGroup.append(componentList);
  workspace.append(boardGroup,svg,componentGroup);

  const feedback=create("div","wire-feedback");
  const status=create("p","wire-status","Chưa có dây nối.");
  status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const suggestionNote=create("p","wire-suggestion-note","");
  suggestionNote.setAttribute("role","status");
  suggestionNote.setAttribute("aria-live","polite");
  suggestionNote.hidden=true;
  const issues=create("ul","wire-issues");
  const activateBtn=create("button","wire-activate","Chọn mạch tự đấu");activateBtn.type="button";
  const lessonOnly=create("button","wire-action wire-inactive","Dùng mô phỏng mẫu");lessonOnly.type="button";
  const statusRow=create("div","wire-feedback-row");
  statusRow.append(status,activateBtn,lessonOnly);
  feedback.append(statusRow,suggestionNote,issues);
  const connections=create("div","wire-connection-list");
  const connectionsTitle=create("h4","","DANH SÁCH DÂY ĐANG NỐI");
  const connectionsList=create("div","wire-connections");
  const rerouteEditor=create("section","wire-reroute-editor");
  rerouteEditor.hidden=true;
  rerouteEditor.setAttribute("role","group");
  rerouteEditor.setAttribute("aria-label","Sửa đầu dây đã nối trên mạch học viên");
  rerouteEditor.append(create("h5","","SỬA MỘT ĐẦU DÂY"));
  const rerouteAnchors=create("div","wire-reroute-anchors");
  const keepFrom=create("button","wire-action wire-reroute-anchor","");keepFrom.type="button";
  keepFrom.dataset.wireRerouteAnchor="from";
  const keepTo=create("button","wire-action wire-reroute-anchor","");keepTo.type="button";
  keepTo.dataset.wireRerouteAnchor="to";
  rerouteAnchors.append(keepFrom,keepTo);
  const targetLabel=create("label","wire-reroute-label","Chân đích mới");
  const targetSelect=create("select","wire-reroute-target");
  targetSelect.dataset.wireRerouteTarget="";
  const emptyTarget=create("option","","— Chọn chân mới —");emptyTarget.value="";
  targetSelect.append(emptyTarget);
  terminals.forEach(item=>{
    const option=create("option","",title(item));option.value=name(item);
    targetSelect.append(option);
  });
  targetLabel.append(targetSelect);
  const rerouteMessage=create("p","wire-reroute-message","");
  rerouteMessage.setAttribute("role","status");
  rerouteMessage.setAttribute("aria-live","polite");
  const rerouteActions=create("div","wire-reroute-actions");
  const rerouteConfirm=create("button","wire-action wire-reroute-confirm","Xác nhận sửa dây");
  rerouteConfirm.type="button";
  rerouteConfirm.dataset.wireRerouteConfirm="";
  const rerouteCancel=create("button","wire-action","Hủy sửa");
  rerouteCancel.type="button";
  rerouteCancel.dataset.wireRerouteCancel="";
  rerouteActions.append(rerouteConfirm,rerouteCancel);
  rerouteEditor.append(rerouteAnchors,targetLabel,rerouteMessage,rerouteActions);
  connections.append(connectionsTitle,connectionsList,rerouteEditor);
  host.append(titleRow,workspace,feedback,connections);

  function terminalButton(key) {
    return [...workspace.querySelectorAll("[data-terminal]")].find(x=>x.dataset.terminal===key) || null;
  }
  function terminalPoint(key) {
    const target=terminalButton(key);
    if(!target)return null;
    const socket=target.querySelector(".wire-socket")||target;
    const r=socket.getBoundingClientRect(),s=workspace.getBoundingClientRect();
    return {x:r.left-s.left+r.width/2,y:r.top-s.top+r.height/2};
  }
  const createSvg = (tag,attrs={})=>{
    const e=document.createElementNS("http://www.w3.org/2000/svg",tag);
    for(const [key,value] of Object.entries(attrs))e.setAttribute(key,String(value));
    return e;
  };
  function curved(start,end) {
    const dx=end.x-start.x,bulge=Math.max(16,Math.abs(dx)*.30);
    return `M ${start.x.toFixed(1)},${start.y.toFixed(1)} C ${(start.x+bulge).toFixed(1)},${start.y.toFixed(1)} ${(end.x-bulge).toFixed(1)},${end.y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
  }
  function primitiveWireId(value) {
    if(typeof value!=="string"||!/^w[1-9][0-9]*$/.test(value)){
      throw new TypeError("wireId phải là canonical learner wire ID dạng wN (N >= 1).");
    }
    const numeric=Number(value.slice(1));
    if(!Number.isSafeInteger(numeric)||numeric<1){
      throw new RangeError("wireId vượt phạm vi số nguyên an toàn.");
    }
    return value;
  }
  function ownData(record,key,label) {
    const descriptor=Object.getOwnPropertyDescriptor(record,key);
    if(!descriptor||!("value" in descriptor)){
      throw new TypeError(label+"."+key+" phải là own data property canonical.");
    }
    return descriptor.value;
  }
  function canonicalCurrentWire(wireId) {
    const key=primitiveWireId(wireId);
    if(!circuit||typeof circuit!=="object"||Array.isArray(circuit)||Object.getPrototypeOf(circuit)!==Object.prototype){
      throw new TypeError("Learner circuit hiện tại phải là plain canonical object.");
    }
    const lesson=ownData(circuit,"lessonId","circuit");
    const wires=ownData(circuit,"wires","circuit");
    if(lesson!==id||!Array.isArray(wires)||Object.getPrototypeOf(wires)!==Array.prototype){
      throw new RangeError("Learner circuit hiện tại không thuộc đúng lesson/wires canonical.");
    }
    let exact=null;
    const seen=new Set();
    for(let index=0;index<wires.length;index+=1){
      const wire=wires[index];
      if(!wire||typeof wire!=="object"||Array.isArray(wire)||Object.getPrototypeOf(wire)!==Object.prototype){
        throw new TypeError("circuit.wires["+index+"] phải là plain canonical wire object.");
      }
      const names=Object.getOwnPropertyNames(wire).sort().join("\u0001");
      if(names!=="from\u0001id\u0001to"){
        throw new RangeError("circuit.wires["+index+"] có field ngoài canonical id/from/to.");
      }
      const currentId=primitiveWireId(ownData(wire,"id","circuit.wires["+index+"]"));
      const from=ownData(wire,"from","circuit.wires["+index+"]");
      const to=ownData(wire,"to","circuit.wires["+index+"]");
      if(typeof from!=="string"||!from||typeof to!=="string"||!to||from===to){
        throw new TypeError("circuit.wires["+index+"] có from/to không canonical.");
      }
      if(seen.has(currentId))throw new RangeError("Learner circuit có wire ID trùng.");
      seen.add(currentId);
      if(currentId===key)exact=wire;
    }
    if(!exact)throw new RangeError("wireId không thuộc learner circuit hiện tại.");
    return exact;
  }
  function highlightedMatches(wire) {
    return Boolean(highlightedWire)&&wire.id===highlightedWire.id&&
      wire.from===highlightedWire.from&&wire.to===highlightedWire.to;
  }
  function reconcileCommittedHighlight() {
    if(!highlightedWire)return false;
    try{
      const wire=canonicalCurrentWire(highlightedWire.id);
      if(wire.from===highlightedWire.from&&wire.to===highlightedWire.to)return true;
    }catch{}
    highlightedWire=null;
    return false;
  }
  function wireRowLabel(wire,highlighted=false) {
    return highlighted
      ? `Dây ${wire.id} đang được đánh dấu chỉ đọc: ${wire.from} nối ${wire.to}. Không tạo dây mới và không thay đổi learner graph.`
      : `Dây ${wire.id}: ${wire.from} nối ${wire.to}.`;
  }
  function graphFingerprint(state) {
    if(!state||!Array.isArray(state.wires))return null;
    return state.wires.map(wire=>`${wire.id}\u0000${wire.from}\u0000${wire.to}`).sort().join("\u0001");
  }
  function currentReroute() {
    if(!reroute||disposed||reroute.base!==circuit||
       reroute.lessonId!==id||reroute.revision!==historyState.revision||
       reroute.fingerprint!==graphFingerprint(circuit)||
       reroute.nextWireId!==circuit.nextWireId)return null;
    try{
      const wire=canonicalCurrentWire(reroute.wireId);
      return wire.from===reroute.from&&wire.to===reroute.to&&
        (reroute.anchor===wire.from||reroute.anchor===wire.to)?reroute:null;
    }catch{return null;}
  }
  function rerouteTargetProblem(intent=currentReroute()) {
    if(!intent||!intent.target)return "Chưa chọn chân đích mới.";
    const target=intent.target;
    const originalOther=intent.anchor===intent.from?intent.to:intent.from;
    if(!terminalIds.has(target)||target===intent.anchor)return "Chân đích không hợp lệ.";
    if(target===originalOther)return "Hai đầu dây chưa thay đổi.";
    if(circuit.wires.some(wire=>wire.id!==intent.wireId&&
      ((wire.from===intent.anchor&&wire.to===target)||
       (wire.to===intent.anchor&&wire.from===target))))return "Đường nối này đã tồn tại.";
    return null;
  }
  function renderReroute() {
    if(reroute&&!currentReroute()){reroute=null;rerouteHover=null;}
    const intent=currentReroute();
    rerouteEditor.hidden=!intent;
    host.dataset.wireRerouteMode=intent?"preview":"off";
    if(intent){
      host.dataset.wireRerouteWireId=intent.wireId;
      host.dataset.wireRerouteTarget=intent.target??"";
      keepFrom.textContent="Giữ chân "+intent.from;
      keepTo.textContent="Giữ chân "+intent.to;
      keepFrom.setAttribute("aria-pressed",String(intent.anchor===intent.from));
      keepTo.setAttribute("aria-pressed",String(intent.anchor===intent.to));
      targetSelect.value=intent.target??"";
      const reason=rerouteTargetProblem(intent);
      rerouteConfirm.disabled=Boolean(reason);
      rerouteConfirm.setAttribute("aria-disabled",String(Boolean(reason)));
      rerouteMessage.textContent=reason
        ? `Dây ${intent.wireId}: giữ ${intent.anchor}. ${reason} Chưa thay đổi netlist.`
        : `Đề xuất thay ${intent.wireId}: giữ ${intent.anchor} → ${intent.target}. Chỉ Xác nhận mới sửa learner graph; chưa kiểm tra dây vật lý.`;
    }else{
      delete host.dataset.wireRerouteWireId;
      delete host.dataset.wireRerouteTarget;
      rerouteConfirm.disabled=true;
      rerouteConfirm.setAttribute("aria-disabled","true");
      targetSelect.value="";
    }
  }
  function beginReroute(wireId) {
    if(disposed)return false;
    let wire;
    try{wire=canonicalCurrentWire(wireId);}catch{return false;}
    selected=null;preview=null;pointerStart=null;suggestedPair=null;rerouteHover=null;
    reroute=Object.freeze({
      lessonId:id,wireId:wire.id,from:wire.from,to:wire.to,
      anchor:wire.from,target:null,revision:historyState.revision,base:circuit,
      fingerprint:graphFingerprint(circuit),nextWireId:circuit.nextWireId,
    });
    render("Đang chuẩn bị sửa một đầu dây. Chọn chân giữ lại rồi chọn đích; chưa sửa mạch.");
    keepFrom.focus({preventScroll:true});
    return true;
  }
  function proposeRerouteTarget(target) {
    const intent=currentReroute();
    if(!intent||(target!==""&&!terminalIds.has(target)))return false;
    reroute=Object.freeze({...intent,target:target||null});
    rerouteHover=null;
    render("Đã cập nhật đích xem trước; chưa thay đổi mạch.");
    return rerouteTargetProblem()===null;
  }
  function chooseRerouteAnchor(anchor) {
    const intent=currentReroute();
    if(!intent||![intent.from,intent.to].includes(anchor))return false;
    reroute=Object.freeze({...intent,anchor,target:null});
    rerouteHover=null;preview=null;pointerStart=null;
    render("Đã chọn chân cố định; chưa gỡ hoặc thêm dây.");
    targetSelect.focus({preventScroll:true});
    return true;
  }
  function cancelReroute({restoreFocus=false,message="Đã hủy sửa đầu dây; netlist không đổi."}={}) {
    const wireId=reroute?.wireId??null;
    if(!reroute)return false;
    reroute=null;rerouteHover=null;preview=null;pointerStart=null;selected=null;
    render(message);
    if(restoreFocus&&wireId){
      [...connectionsList.querySelectorAll("[data-wire-reroute-start]")]
        .find(button=>button.dataset.wireRerouteStart===wireId)
        ?.focus({preventScroll:true});
    }
    return true;
  }
  function commitReroute() {
    const intent=currentReroute();
    if(!intent||rerouteTargetProblem(intent))return false;
    let next,newWire;
    try {
      // Router calls operate on NEW candidate graphs. No preview or hover
      // ever calls these methods or changes circuit/history.
      const without=disconnectCircuit(circuit,intent.wireId);
      next=connectCircuit(without,intent.anchor,intent.target);
      newWire=next.wires.find(wire=>!without.wires.some(old=>old.id===wire.id));
      if(!newWire||newWire.id===intent.wireId||
         newWire.from!==intent.anchor||newWire.to!==intent.target||
         next.wires.length!==circuit.wires.length)throw new Error("Router từ chối cạnh mới.");
    }catch(error){
      render("Không thể sửa dây: "+(error?.message||"kết nối không hợp lệ")+". Netlist không đổi.");
      return false;
    }
    circuit=next;
    reroute=null;rerouteHover=null;preview=null;pointerStart=null;selected=null;
    notify(); // Exactly one canonical host mutation and learner-history entry.
    render(`Đã sửa ${intent.wireId} thành ${newWire.id}: ${intent.anchor} → ${intent.target}.`);
    undoBtn.focus({preventScroll:true});
    return true;
  }
  function applyCommittedHighlightRow() {
    connectionsList.querySelectorAll("[data-wiring-wire-id]").forEach(row=>{
      const wireId=row.getAttribute("data-wiring-wire-id");
      const wire=(circuit.wires||[]).find(item=>item.id===wireId);
      const on=Boolean(wire)&&highlightedMatches(wire);
      row.classList.toggle("is-highlighted",on);
      if(on){
        row.setAttribute("data-wiring-highlight-wire",wire.id);
        row.setAttribute("aria-current","true");
      }else{
        if(typeof row.removeAttribute==="function"){
          row.removeAttribute("data-wiring-highlight-wire");
          row.removeAttribute("aria-current");
        }else if(row.attributes&&typeof row.attributes.delete==="function"){
          row.attributes.delete("data-wiring-highlight-wire");
          row.attributes.delete("aria-current");
        }
      }
      if(wire)row.setAttribute("aria-label",wireRowLabel(wire,on));
    });
  }
  function requestDraw(){
    if(raf||disposed)return;
    raf=requestAnimationFrame(()=>{
      raf=0;if(disposed)return;
      const rect=workspace.getBoundingClientRect();
      svg.setAttribute("viewBox",`0 0 ${Math.max(1,rect.width)} ${Math.max(1,rect.height)}`);
      svg.replaceChildren();
      (circuit.wires||[]).forEach((wire,index)=>{
        const start=terminalPoint(wire.from),end=terminalPoint(wire.to);
        if(!start||!end)return;
        const color=["#12988f","#e1a443","#547fc3","#c87961","#8b79bc"][index%5];
        const highlighted=highlightedMatches(wire);
        const halo=createSvg("path",{
          d:curved(start,end),fill:"none",stroke:highlighted?"#17202a":"#ffffff",
          "stroke-width":highlighted?10:7,"stroke-linecap":"round",
          class:highlighted?"wire-committed-path wire-committed-halo is-highlighted":"wire-committed-path wire-committed-halo",
          "data-wiring-wire-id":wire.id,
        });
        const visual=createSvg("path",{
          d:curved(start,end),fill:"none",stroke:highlighted?"#ffe45c":color,
          "stroke-width":highlighted?5.5:4,"stroke-linecap":"round",
          class:highlighted?"wire-committed-path wire-committed-visual is-highlighted":"wire-committed-path wire-committed-visual",
          "data-wiring-wire-id":wire.id,
        });
        if(highlighted){
          halo.setAttribute("data-wiring-highlight-wire",wire.id);
          visual.setAttribute("data-wiring-highlight-wire",wire.id);
        }
        svg.append(halo,visual);
      });
      if(suggestedPair){
        const start=terminalPoint(suggestedPair[0]);
        const end=terminalPoint(suggestedPair[1]);
        if(start&&end){
          const visual=createSvg("path",{
            d:curved(start,end),fill:"none",stroke:"#95610c",
            "stroke-width":3,"stroke-dasharray":"6 7","stroke-linecap":"round",
            "data-wire-suggestion-preview":"true",
          });
          visual.setAttribute("pointer-events","none");
          visual.userData={kind:"authored-pair-suggestion",committed:false};
          svg.append(visual);
        }
      }
      const intent=currentReroute();
      if(intent){
        const start=terminalPoint(intent.anchor);
        const end=rerouteHover??(intent.target?terminalPoint(intent.target):null);
        if(start&&end){
          const ghost=createSvg("path",{
            d:curved(start,end),fill:"none",stroke:"#ab5b1e",
            "stroke-width":3,"stroke-dasharray":"7 6","stroke-linecap":"round",
            "data-wire-reroute-preview":"true",
          });
          ghost.setAttribute("pointer-events","none");
          ghost.userData={kind:"committed-wire-reroute-proposal",committed:false,electricalAuthority:false};
          svg.append(ghost);
        }
      }
      if(selected&&preview){
        const start=terminalPoint(selected);
        if(start)svg.append(createSvg("path",{d:curved(start,preview),fill:"none",stroke:"#0b7e75","stroke-width":2,"stroke-dasharray":"5 6","stroke-linecap":"round"}));
      }
    });
  }
  function notify() {
    // Capture the edited graph before notifying the application. A callback
    // may synchronously redraw/reconcile this workbench, so reading the
    // mutable closure again after a callback can accidentally submit an old
    // valid graph instead of the learner's newly-invalid edit.
    const changedCircuit=circuit;
    // Any learner-graph mutation invalidates a prior cross-surface selection.
    // The app may explicitly reselect after it revalidates the fresh model.
    highlightedWire=null;
    suggestedPair=null;
    reroute=null;rerouteHover=null;
    const changedAnalysis=analyzeCircuit(id,changedCircuit);
    analysis=changedAnalysis;
    const revokeActive=active && (!changedAnalysis.ok || !changedAnalysis.functional);
    if (revokeActive) {
      // A previous activation is permission for that *validated* topology,
      // not a persistent permission to run whatever graph is edited later.
      // Invalidate it immediately, including while the JS simulation is idle.
      active=false;
    }
    // Canonical authority MUST receive the exact edit before any deactivation
    // observer can refresh views from the previously accepted graph.
    options.onChange?.(changedCircuit,changedAnalysis);
    if (revokeActive) options.onDeactivate?.("invalid");
  }
  function refreshHistoryControls() {
    undoBtn.disabled=typeof options.onUndo!=="function"||!historyState.canUndo;
    redoBtn.disabled=typeof options.onRedo!=="function"||!historyState.canRedo;
    undoBtn.setAttribute("aria-disabled",String(undoBtn.disabled));
    redoBtn.setAttribute("aria-disabled",String(redoBtn.disabled));
  }
  function render(message="") {
    analysis=analyzeCircuit(id,circuit);
    reconcileCommittedHighlight();
    if(reroute&&!currentReroute()){reroute=null;rerouteHover=null;}
    workspace.querySelectorAll("[data-terminal]").forEach(button=>{
      const chosen=selected===button.dataset.terminal;
      button.classList.toggle("is-selected",chosen);
      button.setAttribute("aria-pressed",String(chosen));
      const suggested=suggestedPair?.[0]===button.dataset.terminal?"from":
        suggestedPair?.[1]===button.dataset.terminal?"to":null;
      button.classList.toggle("is-suggested",suggested!==null);
      if(suggested)button.dataset.wireSuggested=suggested;
      else delete button.dataset.wireSuggested;
    });
    if(suggestedPair){
      host.dataset.wireSuggestedPair=suggestedPair.join("|");
      suggestionNote.hidden=false;
      suggestionNote.textContent="Gợi ý xem trước " + suggestedPair[0]+" ↔ "+suggestedPair[1]+
        ". Đường nét đứt chỉ minh họa cặp cần kiểm tra; chưa có dây mới. Chọn hai chân bằng thao tác riêng nếu muốn tự nối.";
    }else{
      delete host.dataset.wireSuggestedPair;
      suggestionNote.hidden=true;
      suggestionNote.textContent="";
    }
    const count=circuit.wires?.length||0;
    const functional=analysis.functional===true&&analysis.ok===true;
    const signalReference=analysis.scope==="signal-only"&&analysis.signalPathsComplete===true&&
      !analysis.issues?.some(item=>item.severity==="error");
    status.dataset.valid=String(functional);
    if(signalReference)status.textContent=`⚠ Đủ ${count} dây tín hiệu tham khảo, nhưng thiếu mô hình nguồn/tải motor hoặc bơm; không phải mạch hoàn chỉnh, không thể thử mạch tự đấu.`;
    else if(message)status.textContent=message;
    else if(functional)status.textContent=`✓ Mạch đúng: ${count} dây, có đường tín hiệu cần thiết.`;
    else status.textContent=count
      ? `Đã nối ${count} dây. Mạch chưa đạt yêu cầu; xem gợi ý bên dưới.`
      : "Chưa đấu dây. Hãy chọn hai chân để nối.";
    issues.replaceChildren();
    (analysis.issues||[]).slice(0,6).forEach(issue=>issues.append(create("li","",issueText(issue))));
    activateBtn.disabled=!functional;
    activateBtn.textContent=active ? "✓ Đang dùng mạch tự đấu" : "▶ Thử mạch vừa đấu";
    activateBtn.setAttribute("aria-pressed",String(active));
    lessonOnly.hidden=!active;
    refreshHistoryControls();
    connectionsList.replaceChildren();
    if(!count)connectionsList.append(create("p","wire-empty","Chưa nối dây nào."));
    for(const wire of circuit.wires) {
      const row=create("div","wire-connected");
      row.setAttribute("role","group");
      row.setAttribute("data-wiring-wire-id",wire.id);
      row.setAttribute("aria-label",wireRowLabel(wire,false));
      row.append(create("span","",`${wire.from}  →  ${wire.to}`));
      const start=create("button","wire-action wire-reroute-start","Sửa đầu dây");
      start.type="button";
      start.dataset.wireRerouteStart=wire.id;
      start.setAttribute("aria-label",`Sửa một đầu dây ${wire.id}, từ ${wire.from} tới ${wire.to}`);
      const remove=create("button","wire-remove","Gỡ");
      remove.type="button";
      remove.dataset.removeWire=wire.id;
      remove.setAttribute("aria-label",`Gỡ dây ${wire.from} nối ${wire.to}`);
      row.append(start,remove);connectionsList.append(row);
    }
    applyCommittedHighlightRow();
    renderReroute();
    requestDraw();
  }
  function connect(from,to) {
    if(!from||!to)return;
    if(reroute)cancelReroute();
    if(from===to){selected=null;render("Đã hủy chọn chân.");return;}
    try {
      circuit=connectCircuit(circuit,from,to);
      selected=null;
      notify();
      render(`Đã nối ${from} → ${to}.`);
    } catch(error) {
      selected=null;
      render(error?.message||"Không thể nối hai chân này.");
    }
  }
  function selectTerminal(key) {
    if(!key)return;
    suggestedPair=null;
    if(!selected){selected=key;render(`Đã chọn ${key}. Chọn chân thứ hai để nối.`);return;}
    connect(selected,key);
  }
  const click=e=>{
    const button=e.target.closest("[data-terminal]");
    if(!button||skipClick)return;
    if(currentReroute()){
      proposeRerouteTarget(button.dataset.terminal);
      return;
    }
    selectTerminal(button.dataset.terminal);
  };
  workspace.addEventListener("click",click);
  let pointerStart=null;
  const down=e=>{
    if(e.button!==0)return;
    const button=e.target.closest("[data-terminal]");
    if(!button)return;
    const intent=currentReroute();
    if(intent&&button.dataset.terminal!==intent.anchor)return;
    pointerStart={x:e.clientX,y:e.clientY,key:button.dataset.terminal,pointerId:e.pointerId};
  };
  const move=e=>{
    if(!pointerStart || e.pointerId!==pointerStart.pointerId)return;
    if(Math.abs(e.clientX-pointerStart.x)+Math.abs(e.clientY-pointerStart.y)<11)return;
    const rect=workspace.getBoundingClientRect();
    if(currentReroute()){
      selected=null;preview=null;
      rerouteHover={x:e.clientX-rect.left,y:e.clientY-rect.top};
    }else{
      selected=pointerStart.key;
      preview={x:e.clientX-rect.left,y:e.clientY-rect.top};
    }
    requestDraw();
  };
  const up=e=>{
    if(!pointerStart || e.pointerId!==pointerStart.pointerId)return;
    const from=pointerStart.key;
    const moved=Math.abs(e.clientX-pointerStart.x)+Math.abs(e.clientY-pointerStart.y)>=11;
    pointerStart=null;preview=null;rerouteHover=null;
    if(!moved)return;
    const to=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-terminal]")?.dataset.terminal;
    if(currentReroute()){
      if(to&&to!==from)proposeRerouteTarget(to);
      else render("Chưa chọn đích mới; chỉ là bản xem trước, netlist không đổi.");
      skipClick=true;
      setTimeout(()=>skipClick=false,0);
      return;
    }
    selected=null;
    if(to&&to!==from)connect(from,to);
    else render("Dây chưa nối. Thả trên một chân khác để hoàn tất.");
    skipClick=true;
    setTimeout(()=>skipClick=false,0);
  };
  const cancel=e=>{
    if(!pointerStart || e.pointerId!==pointerStart.pointerId)return;
    // Touch cancellation or lost capture is never a completed wire gesture,
    // even if the last pointer coordinates happen to overlap another terminal.
    pointerStart=null;preview=null;selected=null;rerouteHover=null;
    skipClick=true;
    render(currentReroute()
      ?"Đã hủy thao tác kéo đầu dây; chỉ giữ đề xuất đã chọn, netlist không đổi."
      :"Thao tác kéo dây đã bị hủy; netlist không thay đổi.");
    setTimeout(()=>skipClick=false,0);
  };
  workspace.addEventListener("pointerdown",down);
  window.addEventListener("pointermove",move);
  window.addEventListener("pointerup",up);
  window.addEventListener("pointercancel",cancel);
  workspace.addEventListener("lostpointercapture",cancel);
  const removeClick=e=>{
    const edit=e.target.closest("[data-wire-reroute-start]");
    if(edit){beginReroute(edit.dataset.wireRerouteStart);return;}
    const button=e.target.closest("[data-remove-wire]");
    if(!button)return;
    try{
      circuit=disconnectCircuit(circuit,button.dataset.removeWire);
      reroute=null;rerouteHover=null;
      notify();render("Đã tháo dây.");
    }catch(error){render(error?.message||"Không thể tháo dây.");}
  };
  connectionsList.addEventListener("click",removeClick);
  const selectRerouteAnchor=e=>{
    const button=e.target.closest("[data-wire-reroute-anchor]");
    if(!button)return;
    const intent=currentReroute();
    if(!intent)return;
    chooseRerouteAnchor(button.dataset.wireRerouteAnchor==="from"?intent.from:intent.to);
  };
  const updateRerouteTarget=()=>{if(currentReroute())proposeRerouteTarget(targetSelect.value);};
  const confirmReroute=()=>{commitReroute();};
  const cancelRerouteClick=()=>{cancelReroute({restoreFocus:true});};
  const rerouteKeydown=e=>{
    if(e.key!=="Escape"||!reroute)return;
    e.preventDefault?.();
    cancelReroute({restoreFocus:true});
  };
  const rerouteBlur=()=>{
    if(reroute)cancelReroute({message:"Đã hủy đề xuất sửa đầu dây khi cửa sổ mất focus; netlist không đổi."});
    else if(pointerStart) {
      pointerStart=null;preview=null;selected=null;rerouteHover=null;
      render("Đã hủy thao tác kéo dây khi cửa sổ mất focus; netlist không đổi.");
    }
  };
  const rerouteVisibility=()=>{if(document.hidden)rerouteBlur();};
  rerouteAnchors.addEventListener("click",selectRerouteAnchor);
  targetSelect.addEventListener("change",updateRerouteTarget);
  rerouteConfirm.addEventListener("click",confirmReroute);
  rerouteCancel.addEventListener("click",cancelRerouteClick);
  window.addEventListener("keydown",rerouteKeydown);
  window.addEventListener("blur",rerouteBlur);
  document.addEventListener?.("visibilitychange",rerouteVisibility);
  const sample=()=>{
    try{
      circuit=sampleCircuit(id);
      selected=null;suggestedPair=null;highlightedWire=null;reroute=null;rerouteHover=null;
      notify();render("Đã nối mạch mẫu để đối chiếu với bài học.");
    }catch(error){render("Không thể tạo mạch mẫu: "+(error?.message||"Không rõ lỗi"));}
  };
  const clear=()=>{
    circuit=createCircuit(id);selected=null;suggestedPair=null;highlightedWire=null;reroute=null;rerouteHover=null;
    notify();render("Đã tháo toàn bộ dây.");
  };
  const activate=()=>{
    if(analysis.functional!==true||analysis.ok!==true)return;
    active=true;options.onActivate?.(circuit,analysis);
    render("Đã chuyển sang mạch tự đấu. Hãy bấm Chạy mô phỏng ở dưới để kiểm tra.");
  };
  const deactivate=()=>{
    active=false;options.onDeactivate?.();render("Đã trở lại mô phỏng mẫu của bài học.");
  };
  const undo=()=>{
    if(disposed||undoBtn.disabled||typeof options.onUndo!=="function")return;
    reroute=null;rerouteHover=null;
    options.onUndo(Object.freeze({lessonId:id,expectedRevision:historyState.revision}));
  };
  const redo=()=>{
    if(disposed||redoBtn.disabled||typeof options.onRedo!=="function")return;
    reroute=null;rerouteHover=null;
    options.onRedo(Object.freeze({lessonId:id,expectedRevision:historyState.revision}));
  };
  if(historyControls){
    undoBtn.addEventListener("click",undo);
    redoBtn.addEventListener("click",redo);
  }
  sampleBtn.addEventListener("click",sample);
  clearBtn.addEventListener("click",clear);
  activateBtn.addEventListener("click",activate);
  lessonOnly.addEventListener("click",deactivate);
  const observer=new ResizeObserver(requestDraw);
  observer.observe(workspace);
  const redrawOnScroll=()=>requestDraw();
  host.addEventListener("scroll",redrawOnScroll);
  render();
  return {
    getCircuit:()=>circuit,
    getAnalysis:()=>analysis,
    isActive:()=>active,
    setHistoryState(next) {
      if(disposed)return false;
      const normalized=normalizeHistoryState(next,id);
      if(reroute&&normalized.revision!==historyState.revision){
        reroute=null;rerouteHover=null;pointerStart=null;
        render("Lịch sử mạch đã thay đổi; hủy đề xuất sửa dây cũ.");
      }
      historyState=normalized;
      refreshHistoryControls();
      return true;
    },
    previewSuggestedPair(pair){
      if(disposed)return false;
      if(!Array.isArray(pair)||pair.length!==2||
         pair.some(value=>typeof value!=="string"||!value||value.trim()!==value||value.length>80)){
        throw new TypeError("Gợi ý cặp dây cần hai terminal ID canonical nguyên vẹn.");
      }
      const ids=new Set(terminals.map(item=>item.id));
      if(pair[0]===pair[1]||!ids.has(pair[0])||!ids.has(pair[1])){
        throw new RangeError("Gợi ý cặp dây không thuộc hai chân khác nhau của bài hiện tại.");
      }
      // Clear incomplete gestures before displaying a reference suggestion.
      // No circuit-router call, notify callback, activity or journal event.
      selected=null;preview=null;pointerStart=null;reroute=null;rerouteHover=null;
      suggestedPair=Object.freeze([pair[0],pair[1]]);
      render();
      terminalButton(pair[0])?.focus({preventScroll:true});
      return Object.freeze({
        pair:suggestedPair,mode:"authored-pair-view-only",
        circuitRouterMutated:false,wireCreated:false,physicalVerified:false,
        mastery:false,lessonCompleted:false,
      });
    },
    clearSuggestedPair(){
      if(disposed||!suggestedPair)return false;
      suggestedPair=null;render();
      return true;
    },
    getSuggestedPair:()=>suggestedPair,
    highlightCommittedWire(wireId){
      if(disposed)return false;
      if(wireId===null){
        const changed=highlightedWire!==null;
        highlightedWire=null;
        applyCommittedHighlightRow();
        requestDraw();
        return Object.freeze({
          wireId:null,highlighted:false,changed,mode:"learner-wire-read-only",
          graphMutated:false,historyMutated:false,progressMutated:false,
        });
      }
      let wire;
      try{
        wire=canonicalCurrentWire(wireId);
      }catch(error){
        highlightedWire=null;
        applyCommittedHighlightRow();
        requestDraw();
        throw error;
      }
      highlightedWire=Object.freeze({id:wire.id,from:wire.from,to:wire.to});
      applyCommittedHighlightRow();
      requestDraw();
      return Object.freeze({
        wireId:wire.id,from:wire.from,to:wire.to,highlighted:true,
        mode:"learner-wire-read-only",graphMutated:false,historyMutated:false,progressMutated:false,
      });
    },
    // Reconcile canonical changes made by the separate 3D/schematic editor.
    // Never notify recursively or infer an electrical source from the SVG.
    setCircuit(next, options = {}) {
      if(disposed) return;
      if(!next || Number(next.lessonId)!==id || !Array.isArray(next.wires)){
        throw new TypeError("Workbench nhận netlist của bài khác hoặc thiếu wires.");
      }
      const previousFingerprint=graphFingerprint(circuit);
      const nextAnalysis=analyzeCircuit(id,next);
      const nextFingerprint=graphFingerprint(next);
      circuit=next;
      analysis=nextAnalysis;
      selected=null;preview=null;pointerStart=null;suggestedPair=null;reroute=null;rerouteHover=null;
      if(previousFingerprint!==nextFingerprint)highlightedWire=null;
      else reconcileCommittedHighlight();
      active=Boolean(options.active) && nextAnalysis.ok===true && nextAnalysis.functional===true;
      render("Bàn 2D đã cập nhật theo netlist dùng chung; không xác nhận mạch điện thực.");
    },
    dispose(){
      if(disposed)return;disposed=true;highlightedWire=null;reroute=null;rerouteHover=null;
      observer.disconnect();if(raf)cancelAnimationFrame(raf);
      workspace.removeEventListener("click",click);
      workspace.removeEventListener("pointerdown",down);
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",up);
      window.removeEventListener("pointercancel",cancel);
      workspace.removeEventListener("lostpointercapture",cancel);
      connectionsList.removeEventListener("click",removeClick);
      rerouteAnchors.removeEventListener("click",selectRerouteAnchor);
      targetSelect.removeEventListener("change",updateRerouteTarget);
      rerouteConfirm.removeEventListener("click",confirmReroute);
      rerouteCancel.removeEventListener("click",cancelRerouteClick);
      window.removeEventListener("keydown",rerouteKeydown);
      window.removeEventListener("blur",rerouteBlur);
      document.removeEventListener?.("visibilitychange",rerouteVisibility);
      if(historyControls){
        undoBtn.removeEventListener("click",undo);
        redoBtn.removeEventListener("click",redo);
      }
      sampleBtn.removeEventListener("click",sample);
      clearBtn.removeEventListener("click",clear);
      activateBtn.removeEventListener("click",activate);
      lessonOnly.removeEventListener("click",deactivate);
      host.removeEventListener("scroll",redrawOnScroll);
      host.replaceChildren();
    }
  };
}
