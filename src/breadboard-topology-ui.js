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
import {
  compareBreadboardContactHoles,
  createBreadboardHoleGridPage,
  inspectBreadboardContactGroup,
  listBreadboardRailChoices,
  pickBreadboardGridHole,
  pickBreadboardRailHole,
} from "./breadboard-hole-grid.js";

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
  const holeGrid = $("bbHoleGrid");
  const gridPrev = $("bbGridPrev");
  const gridNext = $("bbGridNext");
  const gridPage = $("bbGridPage");
  const gridRail = $("bbGridRail");
  const gridRailHole = $("bbGridRailHole");
  const pickRail = $("bbPickRail");
  const gridStatus = $("bbGridStatus");
  if ([
    profile,from,to,compare,result,warning,diagram,
    terminalSelect,placeHole,assignHole,removeHole,placedList,placementStatus,authoredBoundary,
  ].some(node=>!node)) {
    throw new Error("Breadboard study thiếu các điều khiển HTML.");
  }
  const pickerNodes=[
    holeGrid,gridPrev,gridNext,gridPage,gridRail,gridRailHole,pickRail,gridStatus,
  ];
  const pickerPresent=pickerNodes.filter(Boolean).length;
  if(pickerPresent>0 && pickerPresent!==pickerNodes.length){
    throw new Error("Breadboard hole picker thiếu các điều khiển HTML.");
  }
  const hasHolePicker=pickerPresent===pickerNodes.length;
  if(hasHolePicker){
    gridStatus.setAttribute("role","status");
    gridStatus.setAttribute("aria-live","polite");
    gridPage.setAttribute("aria-live","polite");
    gridRail.setAttribute("aria-describedby","bbGridStatus");
    gridRailHole.setAttribute("aria-describedby","bbGridStatus");
    pickRail.setAttribute("aria-describedby","bbGridStatus");
  }
  const placementSession = createBreadboardPlacementSession();
  let disposed = false;
  let comparison = null;
  let authoredInitialized = false;
  let holeGridPage=1;
  let holePickerInitialized=false;
  let renderedGridButtons=[];
  let contactInspection=null;

  const announce = (message,kind) => {
    result.textContent = message;
    result.dataset.result = kind;
  };
  const announcePlacement = (message,kind) => {
    placementStatus.textContent=message;
    placementStatus.dataset.result=kind;
  };
  const announceGrid = (message,kind) => {
    if(!hasHolePicker)return;
    gridStatus.textContent=message;
    gridStatus.dataset.result=kind;
  };
  const clearRenderedGridButtons=()=>{
    for(const entry of renderedGridButtons){
      entry.button.removeEventListener("click",entry.listener);
    }
    renderedGridButtons=[];
  };
  const clearContactVisualState=()=>{
    if(!hasHolePicker)return;
    for(const key of ["bbContactState","bbContactProfile","bbContactHole","bbContactNode","bbContactKind"]){
      delete holeGrid.dataset[key];
    }
    for(const key of ["bbContactCompareA","bbContactCompareB"]){
      delete gridStatus.dataset[key];
    }
    for(const {button} of renderedGridButtons){
      delete button.dataset.bbContactMember;
      delete button.dataset.bbContactSelected;
      button.style.borderWidth="";
      button.style.textDecoration="";
      button.style.textUnderlineOffset="";
      button.setAttribute("aria-label",`Chọn lỗ ${button.dataset.bbGridHole} để điền ô gán; chưa tạo placement`);
    }
  };
  const clearContactInspection=()=>{
    contactInspection=null;
    clearContactVisualState();
  };
  const safeContactComparison=(otherHoleId)=>{
    if(!contactInspection)return {status:"none",holeId:String(otherHoleId??"")};
    try{
      const compared=compareBreadboardContactHoles({
        profileId:profile.value,
        firstHoleId:contactInspection.holeId,
        secondHoleId:otherHoleId,
      });
      return {status:compared.status,holeId:compared.second.holeId};
    }catch{
      return {status:"invalid-input",holeId:String(otherHoleId??"")};
    }
  };
  const contactComparisonLabel=status=>{
    if(status==="same-node")return "cùng node profile";
    if(status==="different-node")return "khác node profile";
    if(status==="unknown")return "chưa đủ bằng chứng profile";
    if(status==="invalid-input")return "input chưa hợp lệ";
    return "chưa đối chiếu";
  };
  const renderContactInspection=()=>{
    if(!hasHolePicker)return null;
    clearContactVisualState();
    if(!contactInspection)return null;
    if(contactInspection.profileId!==profile.value){
      clearContactInspection();
      return null;
    }
    holeGrid.dataset.bbContactState=contactInspection.status;
    holeGrid.dataset.bbContactProfile=contactInspection.profileId;
    holeGrid.dataset.bbContactHole=contactInspection.holeId;
    holeGrid.dataset.bbContactNode=contactInspection.nodeId??"";
    holeGrid.dataset.bbContactKind=contactInspection.nodeKind??"unknown";
    if(contactInspection.status==="known"){
      for(const {button} of renderedGridButtons){
        if(button.dataset.bbGridNode===contactInspection.nodeId){
          button.dataset.bbContactMember="true";
          button.style.borderWidth="3px";
          button.setAttribute(
            "aria-label",
            `Lỗ ${button.dataset.bbGridHole}; cùng nhóm tiếp xúc ${contactInspection.nodeId} với lỗ đang chọn ${contactInspection.holeId}; chọn để điền ô gán, chưa tạo placement`,
          );
        }
        if(button.dataset.bbGridHole===contactInspection.holeId){
          button.dataset.bbContactSelected="true";
          button.style.textDecoration="underline";
          button.style.textUnderlineOffset="3px";
        }
      }
    }
    const againstA=safeContactComparison(from.value);
    const againstB=safeContactComparison(to.value);
    gridStatus.dataset.bbContactCompareA=againstA.status;
    gridStatus.dataset.bbContactCompareB=againstB.status;
    const authorities=[...new Set(contactInspection.provenance.sources.map(source=>source.authority))].join(", ");
    const provenance=`provenance ${contactInspection.provenance.scope}; nguồn ${authorities}`;
    if(contactInspection.status!=="known"){
      announceGrid(
        `Lỗ ${contactInspection.holeId}: chưa có node tiếp xúc được xác minh trong profile ${contactInspection.profileId}; ${provenance}. `+
        `Đối chiếu A (${againstA.holeId}): ${contactComparisonLabel(againstA.status)}; B (${againstB.holeId}): ${contactComparisonLabel(againstB.status)}. `+
        "Không suy nối vật lý, dây ngoài breadboard hoặc circuit-router.",
        "contact-unknown",
      );
      return contactInspection;
    }
    const neighborSummary=contactInspection.nodeKind==="power-rail"
      ? `${contactInspection.neighbors.length} lỗ còn lại cùng rail; phạm vi ${contactInspection.members[0]}…${contactInspection.members.at(-1)}`
      : `các lỗ cùng node: ${contactInspection.members.join(", ")}; hàng xóm của lỗ chọn: ${contactInspection.neighbors.join(", ")}`;
    const railBoundary=contactInspection.nodeKind==="power-rail"
      ? " Rail này là một node 50 lỗ độc lập theo profile; không suy nối với ba rail ký hiệu còn lại."
      : "";
    announceGrid(
      `Lỗ ${contactInspection.holeId} thuộc node ${contactInspection.nodeId} (${contactInspection.contactRegion}) của profile ${contactInspection.profileId}; ${neighborSummary}. `+
      `${provenance}.${railBoundary} Đối chiếu A (${againstA.holeId}): ${contactComparisonLabel(againstA.status)}; `+
      `B (${againstB.holeId}): ${contactComparisonLabel(againstB.status)}. `+
      "Đây chỉ là nhóm tiếp xúc nội bộ theo profile; lựa chọn vẫn chỉ điền #bbPlaceHole, chưa tạo placement, dây hay tiếp xúc vật lý.",
      "contact",
    );
    return contactInspection;
  };
  const updateGridButtonSelection=()=>{
    if(!hasHolePicker)return;
    const selected=String(placeHole.value||"").trim().toUpperCase();
    for(const {button} of renderedGridButtons){
      button.setAttribute("aria-pressed",String(button.dataset.bbGridHole===selected));
    }
  };
  const failClosedHolePicker=error=>{
    if(!hasHolePicker)return;
    contactInspection=null;
    clearRenderedGridButtons();
    holeGrid.replaceChildren();
    holeGrid.dataset.state="error";
    holeGridPage=1;
    gridPrev.disabled=true;
    gridNext.disabled=true;
    gridPage.textContent="Picker không khả dụng";
    gridRail.replaceChildren();
    gridRail.disabled=true;
    gridRailHole.disabled=true;
    pickRail.disabled=true;
    gridRailHole.setAttribute("aria-invalid","true");
    announceGrid(
      "Không thể mở bộ chọn lỗ: "+(error?.message||"Profile hoặc trang không hợp lệ")+" Không có placement nào được tạo.",
      "error",
    );
    holePickerInitialized=true;
  };
  const selectHoleInput=(selection,label)=>{
    placeHole.value=selection.holeId;
    placeHole.setAttribute("aria-invalid","false");
    updateGridButtonSelection();
    contactInspection=inspectBreadboardContactGroup({
      profileId:selection.profileId,
      holeId:selection.holeId,
    });
    renderContactInspection();
    gridStatus.dataset.result="selected";
    gridStatus.dataset.selectionKind=selection.selectionKind;
    gridStatus.dataset.selectionLabel=label;
    return selection;
  };
  const renderRailPicker=(state,{reset=false}={})=>{
    if(!hasHolePicker)return;
    const authoredEnabled=Boolean(state?.enabled&&state.terminals.length);
    const rails=listBreadboardRailChoices(profile.value);
    const previousRail=gridRail.value;
    gridRail.replaceChildren();
    if(!rails.enabled){
      const option=doc.createElement("option");
      option.value="";
      option.textContent="Rail chưa được xác minh cho profile này";
      gridRail.append(option);
      gridRail.value="";
      gridRail.disabled=true;
      gridRailHole.disabled=true;
      pickRail.disabled=true;
      gridRailHole.setAttribute("aria-invalid","false");
      return rails;
    }
    for(const rail of rails.rails){
      const option=doc.createElement("option");
      option.value=rail.id;
      option.textContent=`${rail.signedLabel} · 50 lỗ liên tục trong profile`;
      gridRail.append(option);
    }
    const keepPrevious=!reset&&rails.rails.some(rail=>rail.id===previousRail);
    gridRail.value=keepPrevious?previousRail:rails.rails[0].id;
    if(reset || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(String(gridRailHole.value||"").trim())){
      gridRailHole.value="1";
    }
    gridRailHole.setAttribute("min","1");
    gridRailHole.setAttribute("max","50");
    gridRailHole.setAttribute("step","1");
    gridRailHole.setAttribute("inputmode","numeric");
    gridRailHole.setAttribute("aria-invalid","false");
    gridRail.disabled=!authoredEnabled;
    gridRailHole.disabled=!authoredEnabled;
    pickRail.disabled=!authoredEnabled;
    return rails;
  };
  const renderHoleGrid=(state,{reset=false}={})=>{
    if(!hasHolePicker)return null;
    const authoredEnabled=Boolean(state?.enabled&&state.terminals.length);
    if(reset){
      holeGridPage=1;
      contactInspection=null;
    }
    const model=createBreadboardHoleGridPage({profileId:profile.value,page:holeGridPage});
    clearRenderedGridButtons();
    holeGrid.replaceChildren();
    holeGrid.dataset.state=authoredEnabled?"ready":"disabled";
    holeGrid.dataset.profile=model.profileId;
    holeGrid.dataset.page=String(model.page);
    holeGrid.style.maxWidth="100%";
    holeGrid.style.boxSizing="border-box";
    holeGrid.setAttribute("role","group");
    holeGrid.setAttribute("aria-label",`Chọn lỗ breadboard A-J, cột ${model.columnStart} đến ${model.columnEnd}`);
    holeGrid.setAttribute("aria-describedby","bbGridStatus");
    for(const column of model.columns){
      const heading=doc.createElement("span");
      heading.className="breadboard-hole-grid-column-label";
      heading.dataset.bbGridColumn=String(column);
      heading.textContent=String(column);
      holeGrid.append(heading);
    }
    for(let empty=model.columns.length;empty<model.pageSize;empty+=1){
      const placeholder=doc.createElement("span");
      placeholder.className="breadboard-hole-grid-column-label";
      placeholder.dataset.bbGridColumnEmpty="";
      placeholder.setAttribute("aria-hidden","true");
      holeGrid.append(placeholder);
    }
    for(const row of model.rows){
      const holes=model.columns.map(column=>
        model.holes.find(hole=>hole.row===row&&hole.column===column),
      );
      for(const hole of holes){
        if(!hole)continue;
        const button=doc.createElement("button");
        button.type="button";
        button.className="breadboard-hole-grid-button";
        button.dataset.bbPickHole=hole.id;
        button.dataset.bbGridHole=hole.id;
        button.dataset.bbGridNode=hole.nodeId;
        button.dataset.bbContactSide=/[A-E]/.test(hole.row)?"left":"right";
        button.textContent=hole.id;
        button.disabled=!authoredEnabled;
        button.style.minWidth="44px";
        button.style.minHeight="44px";
        button.setAttribute("aria-label",`Chọn lỗ ${hole.id} để điền ô gán; chưa tạo placement`);
        button.setAttribute("aria-pressed",String(String(placeHole.value||"").trim().toUpperCase()===hole.id));
        const listener=()=>{
          if(disposed||button.disabled)return;
          try{
            const selection=pickBreadboardGridHole({
              profileId:profile.value,page:holeGridPage,holeId:hole.id,
            });
            selectHoleInput(selection,"Lỗ strip");
          }catch(error){
            failClosedHolePicker(error);
          }
        };
        button.addEventListener("click",listener);
        renderedGridButtons.push({button,listener});
        holeGrid.append(button);
      }
      for(let empty=model.columns.length;empty<model.pageSize;empty+=1){
        const placeholder=doc.createElement("span");
        placeholder.dataset.bbGridEmpty="";
        placeholder.setAttribute("aria-hidden","true");
        holeGrid.append(placeholder);
      }
      if(row==="E"){
        const trench=doc.createElement("div");
        trench.dataset.bbGridTrench="";
        trench.dataset.bbContactBoundary="center-gap";
        trench.setAttribute("role","separator");
        trench.setAttribute("aria-label","Khe giữa E và F; hai phía không cùng nhóm tiếp xúc");
        trench.textContent="Khe giữa E ↕ F";
        holeGrid.append(trench);
      }
    }
    gridPrev.disabled=!authoredEnabled||model.previousPage===null;
    gridNext.disabled=!authoredEnabled||model.nextPage===null;
    gridPage.textContent=`Cột ${model.columnStart}–${model.columnEnd} / 1–${model.terminalColumns} · trang ${model.page}/${model.pageCount}`;
    gridPage.dataset.page=String(model.page);
    gridPage.dataset.pageCount=String(model.pageCount);
    renderRailPicker(state,{reset});
    renderContactInspection();
    return model;
  };
  function syncHolePicker(state,{reset=false,reason=null}={}){
    if(!hasHolePicker)return null;
    try{
      const model=renderHoleGrid(state,{reset});
      if(!state?.enabled){
        announceGrid("Bài 01 không có external breadboard placement; bộ chọn lỗ bị khóa.","disabled");
      }else if(!state.terminals.length){
        announceGrid("Bài hiện tại không có terminal canonical; bộ chọn lỗ bị khóa.","disabled");
      }else if(reset){
        const changed=reason==="profile"?"profile":reason==="lesson"?"bài học":"ngữ cảnh terminal";
        announceGrid(`Đã đổi ${changed}; picker trở về trang 1. Chọn lỗ chỉ điền ô, vẫn cần nút Gán lỗ để tạo bản nháp.`,"reset");
      }else if(!holePickerInitialized){
        announceGrid("Chọn một lỗ A–J trên trang hiện tại. Thao tác này chỉ điền ô lỗ; nút Gán lỗ mới tạo placement.","ready");
      }
      holePickerInitialized=true;
      return model;
    }catch(error){
      failClosedHolePicker(error);
      return null;
    }
  }
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
    try{
      const grouped=placementSession.getAuthoredGroups();
      if(!grouped)return;
      const section=doc.createElement("section");
      section.setAttribute("data-bb-authored-groups","");
      section.setAttribute("role","region");
      section.setAttribute("aria-label","Nhóm tiếp xúc từ các gán lỗ do người dùng khai báo trong phiên");
      section.dataset.profile=grouped.profileId;
      section.dataset.groupCount=String(grouped.groupCount);
      const heading=doc.createElement("h4");
      heading.textContent="Nhóm tiếp xúc của bản nháp phiên";
      const boundary=doc.createElement("p");
      boundary.setAttribute("data-bb-authored-groups-boundary","");
      boundary.textContent=
        "Các nhóm dưới đây chỉ gom những terminal đã được người dùng gán lỗ tường minh theo internal contact node của profile. " +
        "Chúng không tự tạo dây, không tự ánh xạ lỗ, không suy điện áp/dòng và không xác nhận tiếp xúc hay lắp ráp vật lý.";
      section.append(heading,boundary);
      const list=doc.createElement("ul");
      list.setAttribute("data-bb-authored-groups-list","");
      for(const group of grouped.groups){
        const item=doc.createElement("li");
        item.setAttribute("data-bb-authored-group",String(group.order));
        item.setAttribute("data-bb-authored-group-status",group.status);
        item.setAttribute("data-bb-authored-group-node",group.nodeId??"");
        item.setAttribute("data-bb-authored-group-kind",group.nodeKind??"unknown");
        item.setAttribute("data-bb-authored-group-region",group.region);
        item.setAttribute("data-bb-authored-group-terminal-count",String(group.terminalIds.length));
        item.setAttribute("tabindex","0");
        item.setAttribute(
          "aria-label",
          `${group.label}. ${group.status==="known"?"Nhóm đã biết theo profile":"Nhóm chưa xác minh theo profile"}. `+
          `Terminal được gán: ${group.terminalIds.join(", ")}. Chỉ là nhóm tiếp xúc nội bộ read-only.`,
        );
        const label=doc.createElement("strong");
        label.setAttribute("data-bb-authored-group-label","");
        label.textContent=group.label;
        const status=doc.createElement("span");
        status.setAttribute("data-bb-authored-group-status-label","");
        status.textContent=group.status==="known"
          ? " · đã biết theo profile"
          : " · chưa xác minh theo profile";
        const mappings=doc.createElement("p");
        mappings.setAttribute("data-bb-authored-group-mappings","");
        mappings.textContent="Gán tường minh: "+group.placements
          .map(record=>`${record.terminalId} → ${record.holeId}`)
          .join("; ");
        const members=doc.createElement("p");
        members.setAttribute("data-bb-authored-group-members","");
        members.textContent=group.status!=="known"
          ? "Profile hiện tại chưa chứng minh contact members cho nhóm này."
          : group.nodeKind==="power-rail"
            ? `Contact node profile: ${group.members[0]}…${group.members.at(-1)} · ${group.members.length} lỗ trên rail này.`
            : `Contact node profile: ${group.members.join(", ")}.`;
        const provenance=doc.createElement("p");
        provenance.setAttribute("data-bb-authored-group-provenance","");
        provenance.textContent="Profile provenance: "+(group.provenance?.scope??"unknown")+".";
        item.append(label,status,mappings,members,provenance);
        list.append(item);
      }
      section.append(list);
      placedList.append(section);
    }catch(error){
      const rejected=doc.createElement("p");
      rejected.setAttribute("data-bb-authored-groups-error","");
      rejected.setAttribute("role","note");
      rejected.textContent="Không thể nhóm bản nháp không hợp lệ: "+
        (error?.message||"mapping/profile không nhất quán")+
        ". Không có wire hay trạng thái điện nào được tạo.";
      placedList.append(rejected);
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
    failClosedHolePicker(error);
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
      syncHolePicker(state,{reset:syncResult.reset,reason:syncResult.reason});
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

  function setHoleGridPage(nextPage){
    if(disposed||!hasHolePicker)return null;
    try{
      const state=placementSession.snapshot();
      const model=createBreadboardHoleGridPage({profileId:profile.value,page:nextPage});
      holeGridPage=model.page;
      contactInspection=null;
      renderHoleGrid(state);
      announceGrid(
        `Đang xem cột ${model.columnStart}–${model.columnEnd}. Chọn lỗ chỉ điền ô; chưa tạo placement.`,
        "page",
      );
      return model;
    }catch(error){
      failClosedHolePicker(error);
      return null;
    }
  }

  function pickRailHole(){
    if(disposed||!hasHolePicker||pickRail.disabled)return null;
    try{
      const selection=pickBreadboardRailHole({
        profileId:profile.value,
        railId:gridRail.value,
        index:gridRailHole.value,
      });
      gridRailHole.value=String(selection.index);
      gridRailHole.setAttribute("aria-invalid","false");
      return selectHoleInput(selection,"Lỗ rail BB830");
    }catch(error){
      gridRailHole.setAttribute("aria-invalid","true");
      announceGrid("Không thể chọn rail: "+(error?.message||"Rail hoặc chỉ số không hợp lệ"),"error");
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
  const onGridPrev=()=>{if(hasHolePicker&&!gridPrev.disabled)setHoleGridPage(holeGridPage-1);};
  const onGridNext=()=>{if(hasHolePicker&&!gridNext.disabled)setHoleGridPage(holeGridPage+1);};
  const onPickRail=()=>pickRailHole();
  const onGridRailHoleInput=()=>{
    if(hasHolePicker)gridRailHole.setAttribute("aria-invalid","false");
  };
  const onPlaceInput=()=>{
    updateGridButtonSelection();
    if(contactInspection){
      clearContactInspection();
      announceGrid(
        "Ô lỗ đã được sửa thủ công; highlight nhóm tiếp xúc được xóa cho đến khi chọn lại một lỗ canonical trong picker.",
        "ready",
      );
    }
  };
  const onCompareInput=()=>{
    if(contactInspection)renderContactInspection();
  };
  const onTerminal=()=>{
    const mapped=placementSession.snapshot().terminalToHole[terminalSelect.value];
    placeHole.value=mapped??"";
    placeHole.setAttribute("aria-invalid","false");
    terminalSelect.setAttribute("aria-invalid","false");
    clearContactInspection();
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
  from.addEventListener("input",onCompareInput);
  to.addEventListener("input",onCompareInput);
  placeHole.addEventListener("keydown",onPlaceKeydown);
  assignHole.addEventListener("click",onAssignHole);
  removeHole.addEventListener("click",onRemoveHole);
  terminalSelect.addEventListener("change",onTerminal);
  if(hasHolePicker){
    gridPrev.addEventListener("click",onGridPrev);
    gridNext.addEventListener("click",onGridNext);
    pickRail.addEventListener("click",onPickRail);
    gridRailHole.addEventListener("input",onGridRailHoleInput);
    placeHole.addEventListener("input",onPlaceInput);
  }
  syncAuthoredContext();
  refreshMappingBoundary();
  renderDiagram();

  return Object.freeze({
    update:updateStudy,
    compare:compareHoles,
    snapshot:()=>comparison,
    getAuthoredPlacement:()=>placementSession.getPlacement(),
    getAuthoredGroups:()=>placementSession.getAuthoredGroups(),
    getContactInspection:()=>contactInspection,
    dispose(){
      if(disposed)return;
      disposed=true;
      compare.removeEventListener("click",onCompare);
      profile.removeEventListener("change",onProfile);
      from.removeEventListener("keydown",onHoleKeydown);
      to.removeEventListener("keydown",onHoleKeydown);
      from.removeEventListener("input",onCompareInput);
      to.removeEventListener("input",onCompareInput);
      placeHole.removeEventListener("keydown",onPlaceKeydown);
      assignHole.removeEventListener("click",onAssignHole);
      removeHole.removeEventListener("click",onRemoveHole);
      terminalSelect.removeEventListener("change",onTerminal);
      if(hasHolePicker){
        gridPrev.removeEventListener("click",onGridPrev);
        gridNext.removeEventListener("click",onGridNext);
        pickRail.removeEventListener("click",onPickRail);
        gridRailHole.removeEventListener("input",onGridRailHoleInput);
        placeHole.removeEventListener("input",onPlaceInput);
        clearRenderedGridButtons();
      }
    },
  });
}
