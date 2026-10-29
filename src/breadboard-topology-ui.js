/**
 * Deliberately separate educational breadboard contact explorer.
 *
 * This never produces circuit-router wires and never maps a conceptual
 * Three.js terminal onto a physical breadboard hole by proximity.
 */
import {
  createBreadboardTopology,
  breadboardNode,
  diagnoseBreadboardHolePair,
  mapCircuitTerminalToHole,
} from "./breadboard-topology.js";
import {
  BREADBOARD_PLACEMENT_MODEL,
  validateBreadboardPlacement,
} from "./breadboard-placement.js";
import { createBreadboardPlacementSession } from "./breadboard-placement-session.js";

const PROFILES = Object.freeze([
  "generic-63x10-terminal-strips",
  "busboard-bb830-rev7",
]);
const SVG_NS = "http://www.w3.org/2000/svg";
const HOLE_COLUMNS = Object.freeze(["A","B","C","D","E","F","G","H","I","J"]);
const svgElement = (doc,name,attrs={}) => {
  const element=doc.createElementNS(SVG_NS,name);
  for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));
  return element;
};

export function mountBreadboardStudy({
  getLayout = () => null,
  getLessonTerminals = () => ({ lessonId: 1, terminals: [] }),
  doc = document,
} = {}) {
  if (typeof getLayout !== "function") throw new TypeError("getLayout phải là function.");
  if (typeof getLessonTerminals !== "function") {
    throw new TypeError("getLessonTerminals phải là function.");
  }
  if(!doc || typeof doc.getElementById!=="function" ||
      typeof doc.createElement!=="function" || typeof doc.createElementNS!=="function"){
    throw new TypeError("Breadboard study cần document DOM hợp lệ.");
  }
  const $ = id => doc.getElementById(id);
  const profile = $("bbProfile");
  const from = $("bbHoleA");
  const to = $("bbHoleB");
  const compare = $("bbCompare");
  const result = $("bbResult");
  const warning = $("bbMappingWarning");
  const diagram = $("bbTopologyDiagram");
  const terminalSelect = $("bbTerminal");
  const placeHole = $("bbPlaceHole");
  const assignHole = $("bbAssignHole");
  const removeHole = $("bbRemoveHole");
  const placedList = $("bbPlacedList");
  const placementStatus = $("bbPlacementStatus");
  const authoredBoundary = $("bbAuthoredBoundary");
  if ([
    profile,from,to,compare,result,warning,diagram,
    terminalSelect,placeHole,assignHole,removeHole,placedList,placementStatus,authoredBoundary,
  ].some(node=>!node)) {
    throw new Error("Breadboard study thiếu các điều khiển HTML.");
  }
  const placementSession = createBreadboardPlacementSession();
  let disposed = false;
  let comparison = null;
  let authoredInitialized = false;

  const announce = (message,kind) => {
    result.textContent = message;
    result.dataset.result = kind;
  };
  const announcePlacement = (message,kind) => {
    placementStatus.textContent=message;
    placementStatus.dataset.result=kind;
  };
  const renderAuthoredList = () => {
    if(disposed)return;
    const doc=placedList.ownerDocument;
    const placement=placementSession.getPlacement();
    placedList.replaceChildren();
    if(!placement){
      const empty=doc.createElement("p");
      empty.setAttribute("data-bb-placement-empty","");
      empty.textContent="Chưa có terminal nào được gán lỗ trong bản nháp của phiên này.";
      placedList.append(empty);
      return;
    }
    for(const record of placement.placements){
      const item=doc.createElement("p");
      item.setAttribute("data-bb-placement-item",record.terminalId);
      item.textContent=`${record.terminalId} → ${record.holeId} · nhóm profile ${record.nodeId}`;
      placedList.append(item);
    }
  };
  const renderTerminalOptions = state => {
    const doc=terminalSelect.ownerDocument;
    const previous=terminalSelect.value;
    terminalSelect.replaceChildren();
    if(!state.enabled){
      const option=doc.createElement("option");
      option.value="";
      option.textContent="Bài 01 · LED tích hợp, không gán breadboard ngoài bo";
      terminalSelect.append(option);
      terminalSelect.value="";
      return;
    }
    if(!state.terminals.length){
      const option=doc.createElement("option");
      option.value="";
      option.textContent="Không có terminal canonical cho bài hiện tại";
      terminalSelect.append(option);
      terminalSelect.value="";
      return;
    }
    for(const terminal of state.terminals){
      const option=doc.createElement("option");
      option.value=terminal.id;
      option.textContent=`${terminal.id} · ${terminal.component}`;
      terminalSelect.append(option);
    }
    terminalSelect.value=state.terminals.some(terminal=>terminal.id===previous)
      ? previous
      : state.terminals[0].id;
  };
  const setAuthoredEnabled = state => {
    const enabled=Boolean(state?.enabled && state.terminals.length);
    terminalSelect.disabled=!enabled;
    placeHole.disabled=!enabled;
    assignHole.disabled=!enabled;
    removeHole.disabled=!enabled;
  };
  const failClosedAuthoredContext = error => {
    placementSession.sync({
      lessonId:1,
      terminals:[],
      profileId:"generic-63x10-terminal-strips",
    });
    const state=placementSession.snapshot();
    renderTerminalOptions(state);
    setAuthoredEnabled(state);
    terminalSelect.setAttribute("aria-invalid","true");
    placeHole.setAttribute("aria-invalid","false");
    announcePlacement(
      "Không thể mở bản nháp gán lỗ: "+(error?.message||"Dữ liệu bài học không hợp lệ"),
      "error",
    );
    renderAuthoredList();
    authoredInitialized=true;
    return null;
  };
  const syncAuthoredContext = ({ announceReset = false } = {}) => {
    if(disposed)return null;
    try{
      const lessonContext=getLessonTerminals();
      if(!lessonContext || typeof lessonContext!=="object" || Array.isArray(lessonContext)){
        throw new TypeError("getLessonTerminals phải trả về {lessonId, terminals}.");
      }
      const syncResult=placementSession.sync({
        lessonId:lessonContext.lessonId,
        terminals:lessonContext.terminals,
        profileId:profile.value,
      });
      const state=syncResult.state;
      renderTerminalOptions(state);
      if(syncResult.reset){
        terminalSelect.value=state.terminals[0]?.id??"";
        placeHole.value="A12";
      }
      setAuthoredEnabled(state);
      terminalSelect.setAttribute("aria-invalid","false");
      if(syncResult.reset || placeHole.getAttribute("aria-invalid")===null){
        placeHole.setAttribute("aria-invalid","false");
      }
      renderAuthoredList();
      if(!state.enabled){
        announcePlacement(
          "Bài 01 dùng LED L tích hợp trên bo; không có terminal breadboard ngoài bo để khai báo lỗ.",
          "disabled",
        );
      }else if(!state.terminals.length){
        announcePlacement(
          "Bài hiện tại không cung cấp terminal canonical; bản nháp gán lỗ được khóa để tránh suy diễn vị trí.",
          "disabled",
        );
      }else if(syncResult.reset && announceReset){
        const reason=syncResult.reason==="profile" ? "profile breadboard" :
          syncResult.reason==="lesson" ? "bài học" : "tập terminal canonical";
        announcePlacement(
          `Đã đổi ${reason}; bản nháp gán lỗ trong phiên đã được đặt lại.`,
          "reset",
        );
      }else if(!authoredInitialized){
        announcePlacement(
          "Chưa có ánh xạ lỗ do người dùng khai báo trong phiên.",
          "empty",
        );
      }
      authoredInitialized=true;
      return state;
    }catch(error){
      return failClosedAuthoredContext(error);
    }
  };
  const renderDiagram = () => {
    if(disposed)return;
    const doc=diagram.ownerDocument;
    const cols=[from.value,to.value]
      .map(hole=>/^([A-J])([1-9]|[1-5][0-9]|6[0-3])$/i.exec(hole.trim()))
      .filter(Boolean).map(match=>Number(match[2]));
    const columns=[...new Set(cols)].slice(0,2);
    if(!columns.length)columns.push(1);
    const canvas=svgElement(doc,"svg",{
      viewBox:"0 0 640 240",width:"100%",height:"240",
      preserveAspectRatio:"xMidYMid meet",
      "aria-hidden":"true","data-bb-diagram":"conceptual-strips",
    });
    canvas.style.maxWidth="640px";
    canvas.append(svgElement(doc,"rect",{x:1,y:1,width:638,height:238,rx:10,fill:"#f8fbf8",stroke:"#c7d9ce"}));
    const title=svgElement(doc,"text",{x:22,y:24,fill:"#245747","font-size":14,"font-weight":700});
    title.textContent="Nhóm 5 lỗ / cột và khe cách điện — hình minh họa";
    canvas.append(title);
    columns.forEach((column,ci)=>{
      const x0=ci*310+30;
      const label=svgElement(doc,"text",{x:x0,y:47,fill:"#315f54","font-size":12});
      label.textContent="Cột "+column;
      canvas.append(label);
      for(let side=0;side<2;side++){
        const letters=HOLE_COLUMNS.slice(side*5,side*5+5);
        const y=side===0?84:142;
        const bg=svgElement(doc,"rect",{
          x:x0-11,y:y-21,width:276,height:42,rx:8,
          fill:side===0?"#e5f1fa":"#e6f4ec",
          stroke:side===0?"#9fc1d7":"#9ac9ac",
          "data-bb-strip-node":`strip:${column}:${side===0?"left":"right"}`,
        });
        canvas.append(bg);
        for(let i=0;i<5;i++){
          const hole=letters[i]+column;
          const selected=hole===from.value.trim().toUpperCase() && hole===to.value.trim().toUpperCase()
            ?"both":hole===from.value.trim().toUpperCase()?"first":hole===to.value.trim().toUpperCase()?"second":null;
          const circle=svgElement(doc,"circle",{
            cx:x0+i*53,cy:y,r:11,
            fill:selected?"#e4bd72":"#fff",stroke:selected?"#986315":"#4b786c",
            "stroke-width":selected?3:1.5,
            "data-bb-hole":hole,
          });
          if(selected)circle.setAttribute("data-bb-selected",selected);
          canvas.append(circle);
          const text=svgElement(doc,"text",{
            x:x0+i*53,y:y+4,"text-anchor":"middle",fill:"#214e43","font-size":11,"font-weight":800,
          });
          text.textContent=letters[i];
          canvas.append(text);
        }
      }
      const gap=svgElement(doc,"line",{
        x1:x0-11,y1:113,x2:x0+265,y2:113,
        stroke:"#ad604e","stroke-width":2,"stroke-dasharray":"6 5",
      });
      canvas.append(gap);
    });
    const note=svgElement(doc,"text",{x:22,y:200,fill:"#3e6255","font-size":11});
    note.textContent=profile.value==="busboard-bb830-rev7"
      ?"BB830: 4 rail riêng biệt; mỗi rail là một dải liên tục 50 lỗ theo profile đã xác minh."
      :"Loại phổ thông: nhóm rail chưa được mô hình hóa; không suy chúng liên thông.";
    canvas.append(note);
    const caveat=svgElement(doc,"text",{x:22,y:221,fill:"#694e25","font-size":10});
    caveat.textContent="Không thể hiện kích thước/lỗ cắm của scene 3D hoặc trạng thái điện thật.";
    canvas.append(caveat);
    diagram.replaceChildren(canvas);
    diagram.dataset.profile=profile.value;
    diagram.dataset.columns=columns.join(",");
  };

  function refreshMappingBoundary() {
    if(disposed)return;
    const authored=placementSession.getPlacement();
    if(authored){
      const validation=validateBreadboardPlacement(authored,placementSession.snapshot().terminals);
      warning.dataset.mapped=validation.ok && validation.stats.mapped ? "session-authored" : "false";
      warning.textContent=validation.ok
        ? "Có "+validation.stats.mapped+" gán lỗ do người dùng khai báo trong phiên và đã qua profile validator. Bản nháp này không suy từ tọa độ 3D, không chứng minh độ vừa cơ khí và không tự tạo dây trong circuit-router."
        : "Từ chối bản nháp gán lỗ không hợp lệ; scene 3D và netlist vẫn không nhận ánh xạ lỗ.";
      return;
    }
    const layout = getLayout();
    if(layout?.breadboardPlacement?.model===BREADBOARD_PLACEMENT_MODEL){
      const validation=validateBreadboardPlacement(layout.breadboardPlacement,layout.terminals);
      warning.dataset.mapped=validation.ok && validation.stats.mapped ? "authored" : "false";
      warning.textContent=validation.ok
        ? "Có "+validation.stats.mapped+" ánh xạ lỗ do tác giả khai báo và đã qua profile validator. Chúng không suy từ tọa độ 3D, không chứng minh độ vừa cơ khí và không tự tạo dây trong circuit-router."
        : "Từ chối authored breadboard placement không hợp lệ; scene 3D và netlist vẫn không nhận ánh xạ lỗ.";
      return;
    }
    if(!layout || layout?.claims?.breadboardHoleMapping === false) {
      warning.textContent = "Bố trí hiện tại là conceptual: chưa có ánh xạ lỗ breadboard/chân linh kiện đã kiểm chứng. So sánh lỗ độc lập bên trên không thay đổi dây 2D/3D và không chứng minh điện áp hoặc an toàn phần cứng.";
      warning.dataset.mapped = "false";
      return;
    }
    // Even a future explicit placement schema must be checked terminal by
    // terminal through the proof-gated topology module, never by the scene.
    try {
      const mapped = (layout.terminals || []).filter(
        terminal => mapCircuitTerminalToHole(layout,terminal.id) !== null,
      );
      warning.dataset.mapped = mapped.length ? "partial" : "false";
      warning.textContent = mapped.length
        ? `Chỉ có ${mapped.length} chân có placement tường minh đã qua bộ kiểm tra profile; các chân còn lại chưa chứng minh. Mô hình không đo hay cấp nguồn điện.`
        : "Chưa có placement chân sang lỗ breadboard được kiểm chứng; vị trí 3D không có nghĩa là lỗ đã cắm thật.";
    }catch{
      warning.dataset.mapped = "false";
      warning.textContent = "Từ chối placement chưa được chứng minh hoặc không hợp lệ. Các chân trên 3D vẫn là điểm khái niệm.";
    }
  }

  function assignAuthoredHole(){
    if(disposed)return null;
    const state=syncAuthoredContext({announceReset:true});
    if(!state?.enabled || !state.terminals.length)return null;
    try{
      const placement=placementSession.assign(terminalSelect.value,placeHole.value);
      const canonicalHole=placement.terminalToHole[terminalSelect.value];
      placeHole.value=canonicalHole;
      placeHole.setAttribute("aria-invalid","false");
      terminalSelect.setAttribute("aria-invalid","false");
      announcePlacement(
        `Đã ghi ${terminalSelect.value} → ${canonicalHole} trong bản nháp phiên. Đây là gán do người dùng khai báo; không tạo dây circuit-router và không xác nhận vị trí 3D hay độ vừa cơ khí.`,
        "assigned",
      );
      renderAuthoredList();
      refreshMappingBoundary();
      return placement;
    }catch(error){
      placeHole.setAttribute("aria-invalid","true");
      announcePlacement(
        "Không thể gán lỗ: "+(error?.message||"Dữ liệu terminal/lỗ không hợp lệ"),
        "error",
      );
      renderAuthoredList();
      refreshMappingBoundary();
      return null;
    }
  }

  function removeAuthoredHole(){
    if(disposed)return null;
    const state=syncAuthoredContext({announceReset:true});
    if(!state?.enabled || !state.terminals.length)return null;
    try{
      const terminalId=terminalSelect.value;
      const outcome=placementSession.remove(terminalId);
      placeHole.setAttribute("aria-invalid","false");
      terminalSelect.setAttribute("aria-invalid","false");
      announcePlacement(
        outcome.removed
          ? `Đã bỏ gán lỗ của ${terminalId} khỏi bản nháp phiên; circuit-router không thay đổi.`
          : `${terminalId} chưa có gán lỗ trong bản nháp phiên.`,
        outcome.removed ? "removed" : "empty",
      );
      renderAuthoredList();
      refreshMappingBoundary();
      return outcome;
    }catch(error){
      terminalSelect.setAttribute("aria-invalid","true");
      announcePlacement(
        "Không thể bỏ gán: "+(error?.message||"Terminal không hợp lệ"),
        "error",
      );
      return null;
    }
  }

  function compareHoles() {
    if(disposed)return null;
    try {
      if(!PROFILES.includes(profile.value)) throw new RangeError("Profile breadboard chưa được kiểm chứng.");
      const topology = createBreadboardTopology(profile.value);
      const a=from.value.trim().toUpperCase();
      const b=to.value.trim().toUpperCase();
      const aNode=breadboardNode(a,topology);
      const bNode=breadboardNode(b,topology);
      const diagnostic=diagnoseBreadboardHolePair(a,b,topology);
      const evidence = {
        profileId:topology.profileId,a,b,
        known:diagnostic.status!=="unknown",
        connected:diagnostic.connected,
        status:diagnostic.status,
        firstNodeId:aNode?.id??null,
        secondNodeId:bNode?.id??null,
      };
      if(diagnostic.status==="unknown"){
        announce(`Chưa đủ bằng chứng về ít nhất một lỗ (${a}, ${b}) trong profile ${topology.profileId}; không kết luận đã nối hay chưa nối.`,"unknown");
      }else{
        if(diagnostic.connected){
          announce(`Theo profile ${topology.profileId}, ${a} và ${b} nằm trên cùng nhóm tiếp xúc ${aNode.id}. Đây là quan hệ trong mô hình profile, không phải đo mạch thực.`,"connected");
        }else{
          announce(`Theo profile ${topology.profileId}, ${a} và ${b} thuộc hai nhóm tiếp xúc khác nhau (${aNode.id} / ${bNode.id}). Kết quả này chỉ mô tả tiếp điểm nội bộ của breadboard; jumper hoặc netlist bên ngoài không được kiểm tra ở đây.`,"separate");
        }
      }
      from.setAttribute("aria-invalid","false");
      to.setAttribute("aria-invalid","false");
      result.dataset.pairStatus=diagnostic.status;
      result.dataset.profile=topology.profileId;
      comparison=Object.freeze(evidence);
      refreshMappingBoundary();
      renderDiagram();
      return comparison;
    }catch(error){
      comparison=null;
      from.setAttribute("aria-invalid","true");
      to.setAttribute("aria-invalid","true");
      announce("Không thể đối chiếu: "+(error?.message||"Dữ liệu lỗ không hợp lệ"),"error");
      refreshMappingBoundary();
      renderDiagram();
      return null;
    }
  }

  const onCompare=()=>compareHoles();
  const onHoleKeydown=event=>{if(event.key==="Enter"){event.preventDefault();compareHoles();}};
  const onPlaceKeydown=event=>{if(event.key==="Enter"){event.preventDefault();assignAuthoredHole();}};
  const onAssignHole=()=>assignAuthoredHole();
  const onRemoveHole=()=>removeAuthoredHole();
  const onTerminal=()=>{
    const mapped=placementSession.snapshot().terminalToHole[terminalSelect.value];
    placeHole.value=mapped??"";
    placeHole.setAttribute("aria-invalid","false");
    terminalSelect.setAttribute("aria-invalid","false");
  };
  const onProfile=()=>{
    comparison=null;
    announce("Đã chuyển profile; nhập hai lỗ và chọn So sánh để xem nhóm tiếp xúc có bằng chứng.","unknown");
    syncAuthoredContext({announceReset:true});
    refreshMappingBoundary();
    renderDiagram();
  };
  const updateStudy=()=>{
    syncAuthoredContext({announceReset:true});
    refreshMappingBoundary();
  };
  compare.addEventListener("click",onCompare);
  profile.addEventListener("change",onProfile);
  from.addEventListener("keydown",onHoleKeydown);
  to.addEventListener("keydown",onHoleKeydown);
  placeHole.addEventListener("keydown",onPlaceKeydown);
  assignHole.addEventListener("click",onAssignHole);
  removeHole.addEventListener("click",onRemoveHole);
  terminalSelect.addEventListener("change",onTerminal);
  syncAuthoredContext();
  refreshMappingBoundary();
  renderDiagram();

  return Object.freeze({
    update:updateStudy,
    compare:compareHoles,
    snapshot:()=>comparison,
    getAuthoredPlacement:()=>placementSession.getPlacement(),
    dispose(){
      if(disposed)return;
      disposed=true;
      compare.removeEventListener("click",onCompare);
      profile.removeEventListener("change",onProfile);
      from.removeEventListener("keydown",onHoleKeydown);
      to.removeEventListener("keydown",onHoleKeydown);
      placeHole.removeEventListener("keydown",onPlaceKeydown);
      assignHole.removeEventListener("click",onAssignHole);
      removeHole.removeEventListener("click",onRemoveHole);
      terminalSelect.removeEventListener("change",onTerminal);
    },
  });
}
