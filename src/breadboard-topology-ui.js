/**
 * Deliberately separate educational breadboard contact explorer.
 *
 * This never produces circuit-router wires and never maps a conceptual
 * Three.js terminal onto a physical breadboard hole by proximity.
 */
import {
  createBreadboardTopology,
  breadboardNode,
  areBreadboardHolesConnected,
  mapCircuitTerminalToHole,
} from "./breadboard-topology.js";

const $ = id => document.getElementById(id);
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

export function mountBreadboardStudy({ getLayout = () => null } = {}) {
  if (typeof getLayout !== "function") throw new TypeError("getLayout phải là function.");
  const profile = $("bbProfile");
  const from = $("bbHoleA");
  const to = $("bbHoleB");
  const compare = $("bbCompare");
  const result = $("bbResult");
  const warning = $("bbMappingWarning");
  const diagram = $("bbTopologyDiagram");
  if ([profile,from,to,compare,result,warning,diagram].some(node=>!node)) {
    throw new Error("Breadboard study thiếu các điều khiển HTML.");
  }
  let disposed = false;
  let comparison = null;

  const announce = (message,kind) => {
    result.textContent = message;
    result.dataset.result = kind;
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
      viewBox:"0 0 640 240",width:"640",height:"240",
      "aria-hidden":"true","data-bb-diagram":"conceptual-strips",
    });
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
      ?"BB830: rail chỉ được xét theo profile riêng (4 nhóm độc lập, 50 lỗ/nhóm)."
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
    const layout = getLayout();
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

  function compareHoles() {
    if(disposed)return null;
    try {
      if(!PROFILES.includes(profile.value)) throw new RangeError("Profile breadboard chưa được kiểm chứng.");
      const topology = createBreadboardTopology(profile.value);
      const a=from.value.trim().toUpperCase();
      const b=to.value.trim().toUpperCase();
      const aNode=breadboardNode(a,topology);
      const bNode=breadboardNode(b,topology);
      const evidence = {profileId:topology.profileId,a,b,known:Boolean(aNode && bNode),connected:null};
      if(!aNode || !bNode){
        announce(`Chưa đủ bằng chứng về ít nhất một lỗ (${a}, ${b}) trong profile ${topology.profileId}; không kết luận đã nối hay chưa nối.`,"unknown");
      }else{
        evidence.connected=areBreadboardHolesConnected(a,b,topology);
        if(evidence.connected){
          announce(`Theo profile ${topology.profileId}, ${a} và ${b} nằm trên cùng nhóm tiếp xúc ${aNode.id}. Đây là quan hệ trong mô hình profile, không phải đo mạch thực.`,"connected");
        }else{
          announce(`Theo profile ${topology.profileId}, ${a} và ${b} thuộc hai nhóm khác nhau (${aNode.id} / ${bNode.id}); chưa có jumper nối chúng trong mô hình profile.`,"separate");
        }
      }
      comparison=Object.freeze(evidence);
      refreshMappingBoundary();
      renderDiagram();
      return comparison;
    }catch(error){
      comparison=null;
      announce("Không thể đối chiếu: "+(error?.message||"Dữ liệu lỗ không hợp lệ"),"error");
      refreshMappingBoundary();
      renderDiagram();
      return null;
    }
  }

  const onCompare=()=>compareHoles();
  const onProfile=()=>{
    comparison=null;
    announce("Đã chuyển profile; nhập hai lỗ và chọn So sánh để xem nhóm tiếp xúc có bằng chứng.","unknown");
    refreshMappingBoundary();
    renderDiagram();
  };
  compare.addEventListener("click",onCompare);
  profile.addEventListener("change",onProfile);
  refreshMappingBoundary();
  renderDiagram();

  return Object.freeze({
    update:refreshMappingBoundary,
    compare:compareHoles,
    snapshot:()=>comparison,
    dispose(){
      if(disposed)return;
      disposed=true;
      compare.removeEventListener("click",onCompare);
      profile.removeEventListener("change",onProfile);
    },
  });
}
