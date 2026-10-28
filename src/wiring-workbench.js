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

export function supportedWiringLessons() { return availableLessons(); }
export function sampleCircuit(lessonId) {
  return createSampleCircuit(lessonId);
}

/**
 * @param {HTMLElement} host - an attached element inside the wiring stage.
 * @param {number} lessonId
 * @param {{initial?: object, active?: boolean, onChange?:(s:object,a:object)=>void,
 * onActivate?:(s:object,a:object)=>void, onDeactivate?:()=>void}} options
 */
export function mountWiringWorkbench(host,lessonId,options={}) {
  const id=Number(lessonId);
  const terminals=listTerminals(id);
  if(!terminals.length)return null;
  let circuit=options.initial ?? createCircuit(id);
  let analysis=analyzeCircuit(id,circuit);
  let selected=null, active=!!options.active, drag=null,preview=null,raf=0,disposed=false,skipClick=false;

  host.replaceChildren();
  host.classList.add("wiring-workbench");
  const titleRow=create("div","wire-work-header");
  const introduction=create("div","wire-intro");
    introduction.append(create("span","wire-work-eyebrow","BÀN ĐẤU DÂY TƯƠNG TÁC"),create("h3","",`Bài ${String(id).padStart(2,"0")} · Tự nối mạch`),
    create("p","","Chọn hai chân liên tiếp hoặc kéo để nối. Chỉ kiểm tra topology bài học, không đo dòng/áp hoặc xác nhận an toàn toàn bộ phần cứng."));
  const toolbar=create("div","wire-actions");
  const sampleBtn=create("button","wire-action","⌁ Mạch mẫu");sampleBtn.type="button";sampleBtn.title="Nối dây đúng theo sơ đồ mẫu để đối chiếu";
  const clearBtn=create("button","wire-action","↺ Xóa dây");clearBtn.type="button";
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
  const issues=create("ul","wire-issues");
  const activateBtn=create("button","wire-activate","Chọn mạch tự đấu");activateBtn.type="button";
  const lessonOnly=create("button","wire-action wire-inactive","Dùng mô phỏng mẫu");lessonOnly.type="button";
  const statusRow=create("div","wire-feedback-row");
  statusRow.append(status,activateBtn,lessonOnly);
  feedback.append(statusRow,issues);
  const connections=create("div","wire-connection-list");
  const connectionsTitle=create("h4","","DANH SÁCH DÂY ĐANG NỐI");
  const connectionsList=create("div","wire-connections");
  connections.append(connectionsTitle,connectionsList);
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
        svg.append(createSvg("path",{d:curved(start,end),fill:"none",stroke:"#ffffff","stroke-width":7,"stroke-linecap":"round"}));
        svg.append(createSvg("path",{d:curved(start,end),fill:"none",stroke:color,"stroke-width":4,"stroke-linecap":"round"}));
      });
      if(selected&&preview){
        const start=terminalPoint(selected);
        if(start)svg.append(createSvg("path",{d:curved(start,preview),fill:"none",stroke:"#0b7e75","stroke-width":2,"stroke-dasharray":"5 6","stroke-linecap":"round"}));
      }
    });
  }
  function notify() {
    analysis=analyzeCircuit(id,circuit);
    options.onChange?.(circuit,analysis);
  }
  function render(message="") {
    analysis=analyzeCircuit(id,circuit);
    workspace.querySelectorAll("[data-terminal]").forEach(button=>{
      const chosen=selected===button.dataset.terminal;
      button.classList.toggle("is-selected",chosen);
      button.setAttribute("aria-pressed",String(chosen));
    });
    const count=circuit.wires?.length||0;
    const functional=analysis.functional===true&&analysis.ok===true;
    status.dataset.valid=String(functional);
    if(message)status.textContent=message;
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
    connectionsList.replaceChildren();
    if(!count)connectionsList.append(create("p","wire-empty","Chưa nối dây nào."));
    for(const wire of circuit.wires) {
      const row=create("div","wire-connected");
      row.append(create("span","",`${wire.from}  →  ${wire.to}`));
      const remove=create("button","wire-remove","Gỡ");
      remove.type="button";
      remove.dataset.removeWire=wire.id;
      remove.setAttribute("aria-label",`Gỡ dây ${wire.from} nối ${wire.to}`);
      row.append(remove);connectionsList.append(row);
    }
    requestDraw();
  }
  function connect(from,to) {
    if(!from||!to)return;
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
    if(!selected){selected=key;render(`Đã chọn ${key}. Chọn chân thứ hai để nối.`);return;}
    connect(selected,key);
  }
  const click=e=>{
    const button=e.target.closest("[data-terminal]");
    if(!button||skipClick)return;
    selectTerminal(button.dataset.terminal);
  };
  workspace.addEventListener("click",click);
  let pointerStart=null;
  const down=e=>{
    if(e.button!==0)return;
    const button=e.target.closest("[data-terminal]");
    if(!button)return;
    pointerStart={x:e.clientX,y:e.clientY,key:button.dataset.terminal};
  };
  const move=e=>{
    if(!pointerStart)return;
    if(Math.abs(e.clientX-pointerStart.x)+Math.abs(e.clientY-pointerStart.y)<11)return;
    selected=pointerStart.key;
    const rect=workspace.getBoundingClientRect();
    preview={x:e.clientX-rect.left,y:e.clientY-rect.top};
    requestDraw();
  };
  const up=e=>{
    if(!pointerStart)return;
    const from=pointerStart.key;
    const moved=Math.abs(e.clientX-pointerStart.x)+Math.abs(e.clientY-pointerStart.y)>=11;
    pointerStart=null;preview=null;
    if(!moved)return;
    const to=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-terminal]")?.dataset.terminal;
    selected=null;
    if(to&&to!==from)connect(from,to);
    else render("Dây chưa nối. Thả trên một chân khác để hoàn tất.");
    skipClick=true;
    setTimeout(()=>skipClick=false,0);
  };
  workspace.addEventListener("pointerdown",down);
  window.addEventListener("pointermove",move);
  window.addEventListener("pointerup",up);
  window.addEventListener("pointercancel",up);
  const removeClick=e=>{
    const button=e.target.closest("[data-remove-wire]");
    if(!button)return;
    try{
      circuit=disconnectCircuit(circuit,button.dataset.removeWire);
      notify();render("Đã tháo dây.");
    }catch(error){render(error?.message||"Không thể tháo dây.");}
  };
  connectionsList.addEventListener("click",removeClick);
  const sample=()=>{
    try{
      circuit=sampleCircuit(id);
      selected=null;
      notify();render("Đã nối mạch mẫu để đối chiếu với bài học.");
    }catch(error){render("Không thể tạo mạch mẫu: "+(error?.message||"Không rõ lỗi"));}
  };
  const clear=()=>{
    circuit=createCircuit(id);selected=null;
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
    dispose(){
      if(disposed)return;disposed=true;
      observer.disconnect();if(raf)cancelAnimationFrame(raf);
      workspace.removeEventListener("click",click);
      workspace.removeEventListener("pointerdown",down);
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",up);
      window.removeEventListener("pointercancel",up);
      connectionsList.removeEventListener("click",removeClick);
      sampleBtn.removeEventListener("click",sample);
      clearBtn.removeEventListener("click",clear);
      activateBtn.removeEventListener("click",activate);
      lessonOnly.removeEventListener("click",deactivate);
      host.removeEventListener("scroll",redrawOnScroll);
      host.replaceChildren();
    }
  };
}
