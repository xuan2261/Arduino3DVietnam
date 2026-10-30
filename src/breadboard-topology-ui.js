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
const SCENE_HOLE_META_SOURCE="pointer";
const SCENE_HOLE_META_FIELDS=Object.freeze(["source","physicalVerified"]);
const TERMINAL_STRIP_HOLE=/^[A-J](?:[1-9]|[1-5][0-9]|6[0-3])$/;
const svgElement = (doc,name,attrs={}) => {
  const element=doc.createElementNS(SVG_NS,name);
  for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));
  return element;
};

export function mountBreadboardStudy({
  getLayout = () => null,
  getLessonTerminals = () => ({ lessonId: 1, terminals: [] }),
  getSceneEditActive = () => false,
  onHoleSelectionChange = () => undefined,
  onConnectTerminalPair = () => Object.freeze({accepted:false,committed:false,wireId:null}),
  onHoleLinkChange = () => undefined,
  doc = document,
} = {}) {
  if (typeof getLayout !== "function") throw new TypeError("getLayout phải là function.");
  if (typeof getLessonTerminals !== "function") {
    throw new TypeError("getLessonTerminals phải là function.");
  }
  if(typeof getSceneEditActive!=="function")throw new TypeError("getSceneEditActive phải là function.");
  if(typeof onHoleSelectionChange!=="function")throw new TypeError("onHoleSelectionChange phải là function.");
  if(typeof onConnectTerminalPair!=="function")throw new TypeError("onConnectTerminalPair phải là function.");
  if(typeof onHoleLinkChange!=="function")throw new TypeError("onHoleLinkChange phải là function.");
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
  const holeLinkEnable=$("bbHoleLinkEnable");
  const holeLinkConfirm=$("bbHoleLinkConfirm");
  const holeLinkCancel=$("bbHoleLinkCancel");
  const holeLinkStatus=$("bbHoleLinkStatus");
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
  const holeLinkNodes=[holeLinkEnable,holeLinkConfirm,holeLinkCancel,holeLinkStatus];
  const holeLinkPresent=holeLinkNodes.filter(Boolean).length;
  if(holeLinkPresent>0&&holeLinkPresent!==holeLinkNodes.length){
    throw new Error("Breadboard authored-hole link thiếu các điều khiển HTML.");
  }
  const hasHoleLinkControls=holeLinkPresent===holeLinkNodes.length;
  if(hasHolePicker){
    gridStatus.setAttribute("role","status");
    gridStatus.setAttribute("aria-live","polite");
    gridPage.setAttribute("aria-live","polite");
    gridRail.setAttribute("aria-describedby","bbGridStatus");
    gridRailHole.setAttribute("aria-describedby","bbGridStatus");
    pickRail.setAttribute("aria-describedby","bbGridStatus");
  }
  if(hasHoleLinkControls){
    for(const control of [holeLinkEnable,holeLinkConfirm,holeLinkCancel]){
      control.type="button";
      control.style.minWidth="44px";
      control.style.minHeight="44px";
    }
    holeLinkStatus.setAttribute("role","status");
    holeLinkStatus.setAttribute("aria-live","polite");
    holeLinkStatus.setAttribute("aria-atomic","true");
  }
  const placementSession = createBreadboardPlacementSession();
  let disposed = false;
  let comparison = null;
  let authoredInitialized = false;
  let holeGridPage=1;
  let holePickerInitialized=false;
  let renderedGridButtons=[];
  let contactInspection=null;
  let holeSelection=null;
  let holeLinkObserverReady=false;
  let holeLinkSnapshot=Object.freeze({
    mode:"off",lessonId:1,profileId:"generic-63x10-terminal-strips",
    firstHoleId:null,secondHoleId:null,firstTerminalId:null,secondTerminalId:null,
    revision:0,physicalVerified:false,claim:"visual-only-before-confirm",
  });

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
  const notifyHoleSelection=selection=>{
    try{onHoleSelectionChange(selection);}catch{/* Observer cannot gain placement authority. */}
  };
  const clearHoleSelection=({notify=true}={})=>{
    if(holeSelection===null)return false;
    holeSelection=null;
    if(hasHolePicker){
      delete gridStatus.dataset.selectionSource;
      delete gridStatus.dataset.selectionKind;
      delete gridStatus.dataset.selectionLabel;
    }
    if(notify)notifyHoleSelection(null);
    return true;
  };
  const safeSceneEditActive=()=>{
    try{return getSceneEditActive()===true;}catch{return false;}
  };
  const readCurrentLessonForLink=()=>{
    const context=getLessonTerminals();
    if(!context || typeof context!=="object" || Array.isArray(context) ||
        Object.getPrototypeOf(context)!==Object.prototype){
      throw new TypeError("Current lesson context cho hole-link không hợp lệ.");
    }
    const lessonDescriptor=Object.getOwnPropertyDescriptor(context,"lessonId");
    const terminalsDescriptor=Object.getOwnPropertyDescriptor(context,"terminals");
    if(!lessonDescriptor || !("value" in lessonDescriptor) || lessonDescriptor.get || lessonDescriptor.set ||
        !terminalsDescriptor || !("value" in terminalsDescriptor) || terminalsDescriptor.get || terminalsDescriptor.set ||
        !Number.isInteger(lessonDescriptor.value) || !Array.isArray(terminalsDescriptor.value) ||
        Object.getPrototypeOf(terminalsDescriptor.value)!==Array.prototype){
      throw new TypeError("Current lesson context hole-link phải có own data lessonId/terminals.");
    }
    const terminals=[];
    for(let index=0;index<terminalsDescriptor.value.length;index+=1){
      const element=Object.getOwnPropertyDescriptor(terminalsDescriptor.value,String(index));
      if(!element || !("value" in element) || element.get || element.set ||
          !element.value || typeof element.value!=="object" || Array.isArray(element.value) ||
          Object.getPrototypeOf(element.value)!==Object.prototype){
        throw new TypeError("Current lesson terminal hole-link phải là own plain data record.");
      }
      const id=Object.getOwnPropertyDescriptor(element.value,"id");
      const component=Object.getOwnPropertyDescriptor(element.value,"component");
      if(!id || !("value" in id) || id.get || id.set || typeof id.value!=="string" || !id.value ||
          !component || !("value" in component) || component.get || component.set ||
          typeof component.value!=="string" || !component.value){
        throw new TypeError("Current lesson terminal hole-link thiếu own data id/component.");
      }
      terminals.push({id:id.value,component:component.value});
    }
    return {lessonId:lessonDescriptor.value,terminals};
  };
  const terminalSignature=terminals=>JSON.stringify(terminals.map(terminal=>[terminal.id,terminal.component]));
  const explicitTerminalStripPlacements=state=>{
    const placement=placementSession.getPlacement();
    if(!placement)return [];
    const validation=validateBreadboardPlacement(placement,state.terminals);
    if(!validation.ok){
      throw new RangeError("Authored placement hiện tại không còn hợp lệ: "+validation.errors.join("; "));
    }
    if(placement.profileId!==state.profileId || !Array.isArray(placement.placements)){
      throw new RangeError("Authored placement/profile hiện tại không nhất quán.");
    }
    return placement.placements.filter(record=>
      record && typeof record.terminalId==="string" && TERMINAL_STRIP_HOLE.test(record.holeId)
    );
  };
  const exactPlacementOwner=(holeId,state)=>{
    if(typeof holeId!=="string" || !TERMINAL_STRIP_HOLE.test(holeId))return null;
    const matches=explicitTerminalStripPlacements(state).filter(record=>record.holeId===holeId);
    if(matches.length>1)throw new RangeError("Một hole không được có nhiều authored terminal owners.");
    return matches[0]??null;
  };
  const linkSnapshotFor=(mode,state,fields={})=>Object.freeze({
    mode,
    lessonId:state.lessonId,
    profileId:state.profileId,
    firstHoleId:fields.firstHoleId??null,
    secondHoleId:fields.secondHoleId??null,
    firstTerminalId:fields.firstTerminalId??null,
    secondTerminalId:fields.secondTerminalId??null,
    revision:state.revision,
    physicalVerified:false,
    claim:"visual-only-before-confirm",
  });
  const sameHoleLinkSnapshot=(left,right)=>
    left.mode===right.mode&&left.lessonId===right.lessonId&&left.profileId===right.profileId&&
    left.firstHoleId===right.firstHoleId&&left.secondHoleId===right.secondHoleId&&
    left.firstTerminalId===right.firstTerminalId&&left.secondTerminalId===right.secondTerminalId&&
    left.revision===right.revision&&left.physicalVerified===right.physicalVerified&&left.claim===right.claim;
  const notifyHoleLink=snapshot=>{
    if(!holeLinkObserverReady)return;
    try{onHoleLinkChange(snapshot);}catch{/* Observer has no graph authority. */}
  };
  const currentHoleLinkContext=({
    expectedLessonId=null,expectedProfileId=null,expectedRevision=null,
    requireEdit=true,minimumPlacements=0,
  }={})=>{
    if(!hasHolePicker)throw new RangeError("Hole-link cần native breadboard hole picker đầy đủ.");
    const current=readCurrentLessonForLink();
    const state=placementSession.snapshot();
    if(current.lessonId!==state.lessonId || terminalSignature(current.terminals)!==terminalSignature(state.terminals)){
      throw new RangeError("Hole-link stale: current lesson terminal context đã thay đổi.");
    }
    if(profile.value!==state.profileId){
      throw new RangeError("Hole-link stale: current profile không khớp authored placement session.");
    }
    if(expectedLessonId!==null && state.lessonId!==expectedLessonId){
      throw new RangeError("Hole-link stale: lesson không khớp expectedLessonId.");
    }
    if(expectedProfileId!==null && state.profileId!==expectedProfileId){
      throw new RangeError("Hole-link stale: profile không khớp expectedProfileId.");
    }
    if(expectedRevision!==null && state.revision!==expectedRevision){
      throw new RangeError("Hole-link stale: authored placement revision đã thay đổi.");
    }
    if(!state.enabled || !state.terminals.length){
      throw new RangeError("Hole-link bị khóa vì lesson hiện tại không hỗ trợ authored breadboard terminals.");
    }
    if(requireEdit && !safeSceneEditActive()){
      throw new RangeError("Hole-link chỉ hoạt động khi 3D edit + hole-pick mode đang bật.");
    }
    const placements=explicitTerminalStripPlacements(state);
    if(placements.length<minimumPlacements){
      throw new RangeError(`Hole-link cần ít nhất ${minimumPlacements} authored terminal-strip placements.`);
    }
    return {state,current,placements};
  };
  const holeLinkAvailability=()=>{
    try{return {ok:true,...currentHoleLinkContext({minimumPlacements:2})};}
    catch(error){return {ok:false,error};}
  };
  const holeLinkStatusText=availability=>{
    if(holeLinkSnapshot.mode==="await-start"){
      return "Chế độ nối bằng lỗ đã bật. Chọn lỗ A1..J63 đã được Gán cho đúng một terminal để arm đầu thứ nhất. Chưa có dây nào được tạo.";
    }
    if(holeLinkSnapshot.mode==="await-end"){
      return `Đầu 1: ${holeLinkSnapshot.firstHoleId} → ${holeLinkSnapshot.firstTerminalId}. Chọn một lỗ Gán khác để tạo preview cặp; chưa nối graph.`;
    }
    if(holeLinkSnapshot.mode==="ready"){
      return `Preview sẵn sàng: ${holeLinkSnapshot.firstHoleId} → ${holeLinkSnapshot.firstTerminalId} và ${holeLinkSnapshot.secondHoleId} → ${holeLinkSnapshot.secondTerminalId}. Bấm Xác nhận để yêu cầu Lab Editor nối hai terminal; preview chưa phải wire.`;
    }
    return availability?.ok
      ? "Có ít nhất hai Gán lỗ tường minh. Bấm Bắt đầu chọn hai lỗ để tạo preview; chỉ Xác nhận mới được gọi controller nối terminal."
      : "Hole-link bị khóa: cần 3D edit + chế độ chọn lỗ 3D và ít nhất hai Gán terminal→lỗ A1..J63 hiện tại.";
  };
  const renderHoleLinkControls=(message=null,kind=null)=>{
    if(!hasHoleLinkControls)return;
    const availability=holeLinkAvailability();
    const active=holeLinkSnapshot.mode!=="off";
    holeLinkEnable.disabled=!active&&!availability.ok;
    holeLinkEnable.setAttribute("aria-pressed",String(active));
    holeLinkConfirm.disabled=holeLinkSnapshot.mode!=="ready";
    holeLinkCancel.disabled=!active;
    holeLinkStatus.dataset.mode=holeLinkSnapshot.mode;
    holeLinkStatus.dataset.lesson=String(holeLinkSnapshot.lessonId);
    holeLinkStatus.dataset.profile=holeLinkSnapshot.profileId;
    holeLinkStatus.dataset.revision=String(holeLinkSnapshot.revision);
    holeLinkStatus.dataset.result=kind??(active?"preview":"idle");
    holeLinkStatus.textContent=message??holeLinkStatusText(availability);
  };
  const canRestoreHoleLinkEnableFocus=()=>{
    if(!hasHoleLinkControls||holeLinkEnable.disabled||holeLinkEnable.hidden===true||
       holeLinkEnable.getAttribute("aria-hidden")==="true"||typeof holeLinkEnable.focus!=="function"){
      return false;
    }
    if(typeof holeLinkEnable.isConnected==="boolean" && !holeLinkEnable.isConnected)return false;
    if(typeof holeLinkEnable.getClientRects==="function" && holeLinkEnable.getClientRects().length===0)return false;
    return true;
  };
  const setHoleLinkSnapshot=(next,{notify=true,message=null,kind=null}={})=>{
    const changed=!sameHoleLinkSnapshot(holeLinkSnapshot,next);
    const focusedBeforeRender=doc.activeElement;
    const restoreEnableFocus=next.mode==="off" &&
      (focusedBeforeRender===holeLinkConfirm||focusedBeforeRender===holeLinkCancel);
    holeLinkSnapshot=next;
    renderHoleLinkControls(message,kind);
    if(restoreEnableFocus&&canRestoreHoleLinkEnableFocus()){
      holeLinkEnable.focus({preventScroll:true});
    }
    if(changed&&notify)notifyHoleLink(holeLinkSnapshot);
    return holeLinkSnapshot;
  };
  const cancelHoleLink=(reason="cancelled",{notify=true,announce=true}={})=>{
    const state=placementSession.snapshot();
    const next=linkSnapshotFor("off",state);
    const message=announce
      ? reason==="committed"
        ? "Đã xác nhận cặp terminal qua controller canonical; preview hole-link đã đóng."
        : "Đã hủy preview hole-link; không có graph edge nào được tạo bởi thao tác chọn lỗ."
      : null;
    return setHoleLinkSnapshot(next,{notify,message,kind:reason});
  };
  const revokeHoleLinkForContext=(reason,{notify=true}={})=>{
    if(holeLinkSnapshot.mode==="off"){
      const state=placementSession.snapshot();
      return setHoleLinkSnapshot(linkSnapshotFor("off",state),{notify});
    }
    return cancelHoleLink(reason,{notify,announce:true});
  };
  const advanceHoleLinkIntent=(holeId,{source="native-grid"}={})=>{
    if(holeLinkSnapshot.mode==="off")return Object.freeze({accepted:false,reason:"hole-link-off",snapshot:holeLinkSnapshot});
    try{
      const context=currentHoleLinkContext({
        expectedLessonId:holeLinkSnapshot.lessonId,
        expectedProfileId:holeLinkSnapshot.profileId,
        expectedRevision:holeLinkSnapshot.revision,
        minimumPlacements:2,
      });
      const owner=exactPlacementOwner(holeId,context.state);
      if(!owner){
        renderHoleLinkControls(`Lỗ ${holeId} chưa thuộc một Gán terminal→lỗ tường minh hiện tại; hole-link intent không thay đổi.`,"unassigned-hole");
        return Object.freeze({accepted:false,reason:"hole-not-explicitly-assigned",snapshot:holeLinkSnapshot});
      }
      if(holeLinkSnapshot.mode==="await-start"){
        const next=linkSnapshotFor("await-end",context.state,{
          firstHoleId:holeId,firstTerminalId:owner.terminalId,
        });
        setHoleLinkSnapshot(next,{message:`Đã arm đầu 1: ${holeId} → ${owner.terminalId}. Chọn lỗ Gán khác; chưa tạo wire.`,kind:"await-end"});
        return Object.freeze({accepted:true,reason:"first-armed",snapshot:holeLinkSnapshot,source});
      }
      if(holeId===holeLinkSnapshot.firstHoleId || owner.terminalId===holeLinkSnapshot.firstTerminalId){
        renderHoleLinkControls("Đầu 2 phải là một lỗ Gán khác thuộc terminal khác; preview hiện tại được giữ nguyên.","same-endpoint-rejected");
        return Object.freeze({accepted:false,reason:"same-hole-or-terminal",snapshot:holeLinkSnapshot});
      }
      const firstOwner=exactPlacementOwner(holeLinkSnapshot.firstHoleId,context.state);
      if(!firstOwner || firstOwner.terminalId!==holeLinkSnapshot.firstTerminalId){
        revokeHoleLinkForContext("stale-first-owner");
        return Object.freeze({accepted:false,reason:"stale-first-owner",snapshot:holeLinkSnapshot});
      }
      const next=linkSnapshotFor("ready",context.state,{
        firstHoleId:holeLinkSnapshot.firstHoleId,
        firstTerminalId:holeLinkSnapshot.firstTerminalId,
        secondHoleId:holeId,
        secondTerminalId:owner.terminalId,
      });
      setHoleLinkSnapshot(next,{message:`Preview: ${next.firstHoleId} → ${next.firstTerminalId}; ${next.secondHoleId} → ${next.secondTerminalId}. Bấm Xác nhận để yêu cầu controller canonical nối hai terminal.`,kind:"ready"});
      return Object.freeze({accepted:true,reason:"ready-before-confirm",snapshot:holeLinkSnapshot,source});
    }catch(error){
      revokeHoleLinkForContext("stale-or-inactive");
      return Object.freeze({accepted:false,reason:error?.message||"hole-link-rejected",snapshot:holeLinkSnapshot});
    }
  };
  const freezeSelectionProjection=(selection,origin,lessonId)=>Object.freeze({
    origin,
    lessonId,
    profileId:selection.profileId,
    holeId:selection.holeId,
    page:Number.isInteger(selection.page)?selection.page:null,
    row:typeof selection.row==="string"?selection.row:null,
    column:Number.isInteger(selection.column)?selection.column:null,
    railId:typeof selection.railId==="string"?selection.railId:null,
    index:Number.isInteger(selection.index)?selection.index:null,
    nodeId:typeof selection.nodeId==="string"?selection.nodeId:null,
    selectionKind:selection.selectionKind,
    claims:Object.freeze({
      inputValueOnly:selection.claims?.inputValueOnly===true,
      placementCreated:false,
      circuitRouterMutated:false,
      physicalContactSimulated:false,
    }),
  });
  const recordHoleSelection=(selection,origin)=>{
    const state=placementSession.snapshot();
    holeSelection=freezeSelectionProjection(selection,origin,state.lessonId);
    notifyHoleSelection(holeSelection);
    return holeSelection;
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
  const selectHoleInput=(selection,label,origin="native-grid")=>{
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
    gridStatus.dataset.selectionSource=origin;
    if(TERMINAL_STRIP_HOLE.test(selection.holeId) && holeLinkSnapshot.mode!=="off"){
      advanceHoleLinkIntent(selection.holeId,{source:origin});
    }
    recordHoleSelection(selection,origin);
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
            selectHoleInput(selection,"Lỗ strip","native-grid");
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
    clearHoleSelection();
    placementSession.sync({
      lessonId:1,
      terminals:[],
      profileId:"generic-63x10-terminal-strips",
    });
    const state=placementSession.snapshot();
    revokeHoleLinkForContext("context-error");
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
      if(syncResult.reset)clearHoleSelection();
      if(syncResult.reset){
        revokeHoleLinkForContext(syncResult.reason||"context-reset");
      }else if(holeLinkSnapshot.mode!=="off"&&!safeSceneEditActive()){
        revokeHoleLinkForContext("edit-off");
      }else{
        renderHoleLinkControls();
      }
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
      const revisionBefore=placementSession.snapshot().revision;
      const placement=placementSession.assign(terminalSelect.value,placeHole.value);
      if(placementSession.snapshot().revision!==revisionBefore){
        revokeHoleLinkForContext("placement-mutation");
      }
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
      renderHoleLinkControls();
      return placement;
    }catch(error){
      placeHole.setAttribute("aria-invalid","true");
      announcePlacement(
        "Không thể gán lỗ: "+(error?.message||"Dữ liệu terminal/lỗ không hợp lệ"),
        "error",
      );
      renderAuthoredList();
      refreshMappingBoundary();
      renderHoleLinkControls();
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
      if(outcome.removed)revokeHoleLinkForContext("placement-mutation");
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
      renderHoleLinkControls();
      return outcome;
    }catch(error){
      terminalSelect.setAttribute("aria-invalid","true");
      announcePlacement(
        "Không thể bỏ gán: "+(error?.message||"Terminal không hợp lệ"),
        "error",
      );
      renderHoleLinkControls();
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
      return selectHoleInput(selection,"Lỗ rail BB830","native-rail");
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
    clearHoleSelection();
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
    revokeHoleLinkForContext("terminal-change");
    clearHoleSelection();
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
    if(holeLinkSnapshot.mode!=="off"&&!safeSceneEditActive()){
      revokeHoleLinkForContext("edit-off");
    }else{
      renderHoleLinkControls();
    }
  };

  const enableHoleLink=()=>{
    if(disposed)return holeLinkSnapshot;
    try{
      const context=currentHoleLinkContext({minimumPlacements:2});
      return setHoleLinkSnapshot(
        linkSnapshotFor("await-start",context.state),
        {
          message:"Hole-link preview đã bật. Chọn lỗ A1..J63 đã được Gán cho đúng một terminal để arm đầu thứ nhất; chưa có wire nào được tạo.",
          kind:"await-start",
        },
      );
    }catch(error){
      renderHoleLinkControls("Không thể bật hole-link: "+(error?.message||"ngữ cảnh không hợp lệ"),"rejected");
      return holeLinkSnapshot;
    }
  };
  const readConnectReceipt=receipt=>{
    if(!receipt || typeof receipt!=="object" || Array.isArray(receipt)){
      return {accepted:false,committed:false,wireId:null};
    }
    const accepted=Object.getOwnPropertyDescriptor(receipt,"accepted");
    const committed=Object.getOwnPropertyDescriptor(receipt,"committed");
    const wire=Object.getOwnPropertyDescriptor(receipt,"wireId");
    if(!accepted || !("value" in accepted) || accepted.get || accepted.set ||
        !committed || !("value" in committed) || committed.get || committed.set ||
        !wire || !("value" in wire) || wire.get || wire.set ||
        typeof accepted.value!=="boolean" || typeof committed.value!=="boolean" ||
        !(wire.value===null || typeof wire.value==="string")){
      return {accepted:false,committed:false,wireId:null};
    }
    const wireId=typeof wire.value==="string"&&/^w[1-9]\d*$/.test(wire.value)?wire.value:null;
    if(committed.value && (!accepted.value || wireId===null)){
      return {accepted:false,committed:false,wireId:null};
    }
    return {accepted:accepted.value,committed:committed.value,wireId};
  };
  const confirmHoleLink=()=>{
    if(disposed || holeLinkSnapshot.mode!=="ready"){
      renderHoleLinkControls("Hole-link chưa có đủ hai đầu tường minh để xác nhận.","not-ready");
      return Object.freeze({accepted:false,committed:false,wireId:null,snapshot:holeLinkSnapshot});
    }
    try{
      const context=currentHoleLinkContext({
        expectedLessonId:holeLinkSnapshot.lessonId,
        expectedProfileId:holeLinkSnapshot.profileId,
        expectedRevision:holeLinkSnapshot.revision,
        minimumPlacements:2,
      });
      const first=exactPlacementOwner(holeLinkSnapshot.firstHoleId,context.state);
      const second=exactPlacementOwner(holeLinkSnapshot.secondHoleId,context.state);
      if(!first || !second || first.terminalId!==holeLinkSnapshot.firstTerminalId ||
          second.terminalId!==holeLinkSnapshot.secondTerminalId ||
          first.holeId===second.holeId || first.terminalId===second.terminalId){
        throw new RangeError("Hole-link stale: exact authored hole ownership đã thay đổi.");
      }
      const meta=Object.freeze({
        source:"authored-hole-confirm",
        physicalVerified:false,
        profileId:context.state.profileId,
        fromHoleId:first.holeId,
        toHoleId:second.holeId,
        placementRevision:context.state.revision,
      });
      let rawReceipt=null;
      try{
        rawReceipt=onConnectTerminalPair(
          first.terminalId,second.terminalId,meta,context.state.lessonId,
        );
      }catch{
        rawReceipt=null;
      }
      const receipt=readConnectReceipt(rawReceipt);
      if(receipt.accepted && receipt.committed && receipt.wireId){
        const next=setHoleLinkSnapshot(
          linkSnapshotFor("off",placementSession.snapshot()),
          {
            message:`Controller canonical đã commit ${receipt.wireId}: ${first.terminalId} (${first.holeId}) ↔ ${second.terminalId} (${second.holeId}). Preview đã đóng; kết quả chỉ là learner graph canonical, không xác nhận continuity hay lắp ráp vật lý.`,
            kind:"committed",
          },
        );
        return Object.freeze({...receipt,snapshot:next});
      }
      renderHoleLinkControls(
        "Controller chưa commit cặp terminal. Preview ready được giữ nguyên để người học xem lại hoặc hủy; không có wire tự sinh từ selection.",
        "commit-denied",
      );
      return Object.freeze({...receipt,snapshot:holeLinkSnapshot});
    }catch(error){
      revokeHoleLinkForContext("stale-confirm");
      return Object.freeze({
        accepted:false,committed:false,wireId:null,
        reason:error?.message||"stale-confirm",snapshot:holeLinkSnapshot,
      });
    }
  };
  const readFrozenHoleLinkDragMeta=meta=>{
    if(!meta || typeof meta!=="object" || Array.isArray(meta) || !Object.isFrozen(meta) ||
        Object.getPrototypeOf(meta)!==Object.prototype){
      throw new TypeError("Hole-link drag meta phải là frozen plain object.");
    }
    const keys=Reflect.ownKeys(meta);
    if(keys.length!==2 || keys.some(key=>typeof key!=="string") ||
        !keys.includes("source") || !keys.includes("physicalVerified")){
      throw new TypeError("Hole-link drag meta phải có đúng source/physicalVerified.");
    }
    const source=Object.getOwnPropertyDescriptor(meta,"source");
    const physical=Object.getOwnPropertyDescriptor(meta,"physicalVerified");
    if(!source || !("value" in source) || source.get || source.set ||
        !physical || !("value" in physical) || physical.get || physical.set ||
        source.value!=="pointer-drag" || physical.value!==false){
      throw new RangeError("Hole-link drag meta không khớp pointer-drag/read-only contract.");
    }
  };
  const pickHoleLinkTargetFromDrag=(holeId,meta,expectedLessonId,expectedProfileId)=>{
    if(disposed)return Object.freeze({accepted:false,reason:"disposed",snapshot:holeLinkSnapshot});
    try{
      if(holeLinkSnapshot.mode!=="await-end"){
        throw new RangeError("Hole-link drag cần đầu thứ nhất đã được arm và chưa có đầu thứ hai.");
      }
      if(typeof holeId!=="string" || !TERMINAL_STRIP_HOLE.test(holeId)){
        throw new RangeError("Hole-link drag chỉ nhận exact terminal-strip hole A1..J63.");
      }
      if(!Number.isInteger(expectedLessonId) || expectedLessonId!==holeLinkSnapshot.lessonId){
        throw new RangeError("Hole-link drag stale lesson.");
      }
      if(typeof expectedProfileId!=="string" || expectedProfileId!==holeLinkSnapshot.profileId){
        throw new RangeError("Hole-link drag stale profile.");
      }
      readFrozenHoleLinkDragMeta(meta);
      const result=advanceHoleLinkIntent(holeId,{source:"scene-drag"});
      if(!result.accepted || holeLinkSnapshot.mode!=="ready"){
        return Object.freeze({accepted:false,reason:result.reason,snapshot:holeLinkSnapshot});
      }
      return Object.freeze({accepted:true,reason:"ready-before-confirm",snapshot:holeLinkSnapshot});
    }catch(error){
      return Object.freeze({accepted:false,reason:error?.message||"drag-target-rejected",snapshot:holeLinkSnapshot});
    }
  };
  const getHoleLinkSnapshot=()=>{
    if(holeLinkSnapshot.mode!=="off"){
      try{
        currentHoleLinkContext({
          expectedLessonId:holeLinkSnapshot.lessonId,
          expectedProfileId:holeLinkSnapshot.profileId,
          expectedRevision:holeLinkSnapshot.revision,
          minimumPlacements:2,
        });
      }catch{
        revokeHoleLinkForContext("stale-or-edit-off");
      }
    }
    return holeLinkSnapshot;
  };
  const onHoleLinkEnable=()=>{
    if(!hasHoleLinkControls||holeLinkEnable.disabled)return;
    if(holeLinkSnapshot.mode!=="off")cancelHoleLink("toggle-off");
    else enableHoleLink();
  };
  const onHoleLinkConfirm=()=>{if(hasHoleLinkControls&&!holeLinkConfirm.disabled)confirmHoleLink();};
  const onHoleLinkCancel=()=>{if(hasHoleLinkControls&&!holeLinkCancel.disabled)cancelHoleLink("cancelled");};
  const onHoleLinkEscape=event=>{
    if(event?.key!=="Escape" || holeLinkSnapshot.mode==="off")return;
    event.preventDefault?.();
    cancelHoleLink("escape");
  };

  const rejectScenePick=reason=>Object.freeze({accepted:false,reason:String(reason),selection:null});
  const readFrozenSceneMeta=meta=>{
    if(!meta || typeof meta!=="object" || Array.isArray(meta) || !Object.isFrozen(meta) ||
        Object.getPrototypeOf(meta)!==Object.prototype){
      throw new TypeError("Scene hole meta phải là frozen plain object.");
    }
    const keys=Reflect.ownKeys(meta);
    if(keys.length!==SCENE_HOLE_META_FIELDS.length ||
        keys.some(key=>typeof key!=="string" || !SCENE_HOLE_META_FIELDS.includes(key))){
      throw new TypeError("Scene hole meta có field/symbol không được hỗ trợ.");
    }
    const values=Object.create(null);
    for(const key of SCENE_HOLE_META_FIELDS){
      const descriptor=Object.getOwnPropertyDescriptor(meta,key);
      if(!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set){
        throw new TypeError("Scene hole meta phải dùng own data fields.");
      }
      values[key]=descriptor.value;
    }
    if(values.source!==SCENE_HOLE_META_SOURCE || values.physicalVerified!==false){
      throw new RangeError("Scene hole meta không khớp pointer/read-only contract.");
    }
    return values;
  };
  const pickHoleFromScene=(holeId,frozenMeta,expectedLessonId,expectedProfileId)=>{
    if(disposed)return rejectScenePick("disposed");
    try{
      if(typeof holeId!=="string" || !TERMINAL_STRIP_HOLE.test(holeId)){
        throw new RangeError("Scene pick chỉ nhận exact terminal-strip hole A1..J63.");
      }
      if(!Number.isInteger(expectedLessonId) || expectedLessonId<1 || expectedLessonId>16){
        throw new RangeError("expectedLessonId scene pick phải nằm trong 1..16.");
      }
      if(typeof expectedProfileId!=="string" || !PROFILES.includes(expectedProfileId)){
        throw new RangeError("expectedProfileId scene pick không hợp lệ.");
      }
      readFrozenSceneMeta(frozenMeta);
      if(!hasHolePicker)throw new RangeError("Breadboard hole picker không được mount.");
      const current=readCurrentLessonForLink();
      const state=placementSession.snapshot();
      if(current.lessonId!==expectedLessonId || state.lessonId!==expectedLessonId){
        throw new RangeError("Scene pick stale: lesson hiện tại không khớp expectedLessonId.");
      }
      if(!state.enabled || !state.terminals.length || current.terminals.length!==state.terminals.length){
        throw new RangeError("Scene pick bị khóa vì lesson không có canonical breadboard terminal context.");
      }
      const currentSignature=current.terminals.map(terminal=>[terminal?.id,terminal?.component]);
      const stateSignature=state.terminals.map(terminal=>[terminal.id,terminal.component]);
      if(JSON.stringify(currentSignature)!==JSON.stringify(stateSignature)){
        throw new RangeError("Scene pick stale: canonical terminal context đã thay đổi.");
      }
      if(profile.value!==expectedProfileId || state.profileId!==expectedProfileId){
        throw new RangeError("Scene pick stale: profile hiện tại không khớp expectedProfileId.");
      }
      if(!safeSceneEditActive()){
        throw new RangeError("Scene pick chỉ khả dụng khi stage 3D edit đang bật.");
      }
      const column=Number(/^([A-J])(\d+)$/.exec(holeId)[2]);
      let model=createBreadboardHoleGridPage({profileId:expectedProfileId,page:1});
      for(let page=1;page<=model.pageCount;page+=1){
        const candidate=createBreadboardHoleGridPage({profileId:expectedProfileId,page});
        if(column>=candidate.columnStart && column<=candidate.columnEnd){
          model=candidate;
          break;
        }
      }
      if(column<model.columnStart || column>model.columnEnd){
        throw new RangeError("Không xác định được trang chứa scene hole.");
      }
      const selection=pickBreadboardGridHole({profileId:expectedProfileId,page:model.page,holeId});
      holeGridPage=model.page;
      renderHoleGrid(state);
      selectHoleInput(selection,"Lỗ strip từ 3D","scene");
      announceGrid(
        `Đã chọn ${selection.holeId} từ 3D và chuyển picker tới cột ${selection.column}. Đây chỉ là lựa chọn input read-only; chưa tạo placement, dây hay cạnh graph. Dùng nút Gán lỗ riêng để ghi placement.`,
        "scene-selected",
      );
      return Object.freeze({accepted:true,reason:"selected-input-only",selection:holeSelection});
    }catch(error){
      return rejectScenePick(error?.message||"scene-pick-rejected");
    }
  };
  if(hasHoleLinkControls){
    holeLinkEnable.addEventListener("click",onHoleLinkEnable);
    holeLinkConfirm.addEventListener("click",onHoleLinkConfirm);
    holeLinkCancel.addEventListener("click",onHoleLinkCancel);
    for(const node of [holeLinkEnable,holeLinkConfirm,holeLinkCancel,holeLinkStatus,placeHole,terminalSelect,profile]){
      node.addEventListener("keydown",onHoleLinkEscape);
    }
    if(hasHolePicker)holeGrid.addEventListener("keydown",onHoleLinkEscape);
  }
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
  holeLinkObserverReady=true;
  renderHoleLinkControls();
  refreshMappingBoundary();
  renderDiagram();

  return Object.freeze({
    update:updateStudy,
    compare:compareHoles,
    snapshot:()=>comparison,
    pickHoleFromScene,
    getHoleSelection:()=>holeSelection,
    getHoleLinkSnapshot,
    cancelHoleLink:()=>disposed?holeLinkSnapshot:cancelHoleLink("api-cancel"),
    pickHoleLinkTargetFromDrag,
    getAuthoredPlacement:()=>placementSession.getPlacement(),
    getAuthoredGroups:()=>placementSession.getAuthoredGroups(),
    getContactInspection:()=>contactInspection,
    dispose(){
      if(disposed)return;
      disposed=true;
      holeLinkObserverReady=false;
      clearHoleSelection({notify:false});
      if(hasHoleLinkControls){
        holeLinkEnable.removeEventListener("click",onHoleLinkEnable);
        holeLinkConfirm.removeEventListener("click",onHoleLinkConfirm);
        holeLinkCancel.removeEventListener("click",onHoleLinkCancel);
        for(const node of [holeLinkEnable,holeLinkConfirm,holeLinkCancel,holeLinkStatus,placeHole,terminalSelect,profile]){
          node.removeEventListener("keydown",onHoleLinkEscape);
        }
        if(hasHolePicker)holeGrid.removeEventListener("keydown",onHoleLinkEscape);
      }
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
