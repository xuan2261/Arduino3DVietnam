// Chạy trong browser: import("/tests/scene-wiring-contracts.js").then(m => m.runSceneWiringContracts())
import {
  analyzeCircuit,
  connectCircuit,
  createCircuit,
  createSampleCircuit,
  listTerminals,
  supportedWiringLessons,
} from "../src/circuit-router.js";
import { mountWiringWorkbench } from "../src/wiring-workbench.js";

const waitTask = () => new Promise(resolve => setTimeout(resolve, 0));
const waitEvent = (target, type, timeoutMs = 1200) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
  target.addEventListener(type, event => {
    clearTimeout(timer);
    resolve(event);
  }, { once: true });
});

const makeHost = () => {
  const host = document.createElement("div");
  host.className = "scene-mount";
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:760px;height:430px";
  document.body.append(host);
  return host;
};

function fakeAttrSelector(selector) {
  const match=/^\[([^=\]]+)(?:=["']([^"']*)["'])?\]$/.exec(selector);
  return match?{name:match[1],value:match[2]}:null;
}

class WorkbenchFakeNode {
  static nextRect=1;
  constructor(tagName) {
    this.tagName=String(tagName).toUpperCase();
    this.children=[];
    this.parentNode=null;
    this.attributes=new Map();
    this.listeners=new Map();
    this.style={};
    this.disabled=false;
    this.hidden=false;
    this.title="";
    this.type="";
    this.focused=false;
    this._text="";
    this._className="";
    this._rectIndex=WorkbenchFakeNode.nextRect++;
    this.dataset=new Proxy({}, {
      get:(_target,key)=>this.getAttribute("data-"+String(key).replace(/[A-Z]/g,ch=>"-"+ch.toLowerCase()))??undefined,
      set:(_target,key,value)=>{
        this.setAttribute("data-"+String(key).replace(/[A-Z]/g,ch=>"-"+ch.toLowerCase()),String(value));
        return true;
      },
      deleteProperty:(_target,key)=>{
        this.removeAttribute("data-"+String(key).replace(/[A-Z]/g,ch=>"-"+ch.toLowerCase()));
        return true;
      },
    });
    this.classList={
      add:(...names)=>{
        const set=new Set(this._className.split(/\s+/).filter(Boolean));
        names.forEach(value=>set.add(value));
        this.className=[...set].join(" ");
      },
      toggle:(name,force)=>{
        const set=new Set(this._className.split(/\s+/).filter(Boolean));
        const should=force===undefined?!set.has(name):Boolean(force);
        if(should)set.add(name);else set.delete(name);
        this.className=[...set].join(" ");
        return should;
      },
      contains:name=>this._className.split(/\s+/).filter(Boolean).includes(name),
    };
  }
  set className(value){this._className=String(value??"");this.attributes.set("class",this._className);}
  get className(){return this._className;}
  set textContent(value){this._text=String(value??"");this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join("");}
  append(...nodes){
    for(const node of nodes){
      if(!(node instanceof WorkbenchFakeNode))throw new Error("workbench fake append expects node");
      node.parentNode=this;this.children.push(node);
    }
  }
  replaceChildren(...nodes){this.children=[];this._text="";this.append(...nodes);}
  setAttribute(name,value){
    const key=String(name),text=String(value);
    this.attributes.set(key,text);
    if(key==="class")this._className=text;
  }
  getAttribute(name){return this.attributes.has(String(name))?this.attributes.get(String(name)):null;}
  removeAttribute(name){
    const key=String(name);this.attributes.delete(key);
    if(key==="class")this._className="";
  }
  addEventListener(type,callback){
    const list=this.listeners.get(type)??[];list.push(callback);this.listeners.set(type,list);
  }
  removeEventListener(type,callback){
    const list=this.listeners.get(type)??[];this.listeners.set(type,list.filter(item=>item!==callback));
  }
  dispatchEvent(event){
    if(!event.target)event.target=this;
    let node=this;
    while(node){
      event.currentTarget=node;
      for(const callback of node.listeners.get(event.type)??[])callback(event);
      node=node.parentNode;
    }
    return true;
  }
  click(){
    if(this.disabled)return;
    this.dispatchEvent({type:"click",target:this,button:0});
  }
  focus(){this.focused=true;}
  matches(selector){
    const attr=fakeAttrSelector(selector);
    if(attr){
      if(!this.attributes.has(attr.name))return false;
      return attr.value===undefined||this.attributes.get(attr.name)===attr.value;
    }
    if(selector.startsWith("."))return this.classList.contains(selector.slice(1));
    return this.tagName===selector.toUpperCase();
  }
  closest(selector){
    let node=this;
    while(node){if(node.matches(selector))return node;node=node.parentNode;}
    return null;
  }
  querySelectorAll(selector){
    const found=[];
    const visit=node=>{
      for(const child of node.children){if(child.matches(selector))found.push(child);visit(child);}
    };
    visit(this);return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  getBoundingClientRect(){
    if(this.classList.contains("wire-space"))return {left:0,top:0,width:720,height:390,right:720,bottom:390};
    const n=this._rectIndex;
    return {left:30+(n%9)*67,top:20+(n%7)*43,width:18,height:18,right:48+(n%9)*67,bottom:38+(n%7)*43};
  }
}

class WorkbenchFakeDocument {
  constructor(){this.pointTarget=null;}
  createElement(tagName){return new WorkbenchFakeNode(tagName);}
  createElementNS(_namespace,tagName){return new WorkbenchFakeNode(tagName);}
  elementFromPoint(){return this.pointTarget;}
}

class WorkbenchFakeWindow {
  constructor(){this.listeners=new Map();}
  addEventListener(type,callback){const list=this.listeners.get(type)??[];list.push(callback);this.listeners.set(type,list);}
  removeEventListener(type,callback){const list=this.listeners.get(type)??[];this.listeners.set(type,list.filter(item=>item!==callback));}
  dispatchEvent(event){for(const callback of this.listeners.get(event.type)??[])callback(event);return true;}
}

export function runWiringWorkbenchHighlightContracts() {
  const realDocument=globalThis.document;
  const realWindow=globalThis.window;
  const realResizeObserver=globalThis.ResizeObserver;
  const realRaf=globalThis.requestAnimationFrame;
  const realCancelRaf=globalThis.cancelAnimationFrame;
  const results=[];
  const check=(name,condition)=>{
    if(!condition)throw new Error("FAIL wiring highlight: "+name);
    results.push({name,status:"PASS"});
  };
  const expectThrow=(name,run,ErrorType)=>{
    let error=null;try{run();}catch(caught){error=caught;}
    check(name,error instanceof ErrorType);
  };
  const frames=new Map();let frameId=1;
  const flush=()=>{
    const queued=[...frames.values()];frames.clear();queued.forEach(callback=>callback(0));
  };
  const fakeDocument=new WorkbenchFakeDocument();
  globalThis.document=fakeDocument;
  globalThis.window=new WorkbenchFakeWindow();
  globalThis.requestAnimationFrame=callback=>{const id=frameId++;frames.set(id,callback);return id;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  globalThis.ResizeObserver=class { constructor(callback){this.callback=callback;} observe(){} disconnect(){} };
  const highlightedRow=root=>root.querySelectorAll(".wire-connected")
    .find(row=>row.getAttribute("data-wiring-highlight-wire")!==null)??null;

  const mounts=[];
  try{
    let onChangeCount=0,undoCount=0,redoCount=0;
    let learner=connectCircuit(createCircuit(2),"D13","R1:A");
    const host=new WorkbenchFakeNode("div");
    const mounted=mountWiringWorkbench(host,2,{
      initial:learner,
      historyState:{lessonId:2,revision:7,canUndo:true,canRedo:true},
      onChange(){onChangeCount+=1;},onUndo(){undoCount+=1;},onRedo(){redoCount+=1;},
    });
    mounts.push(mounted);flush();
    check("public-highlight-api",typeof mounted.highlightCommittedWire==="function");

    const emptyHost=new WorkbenchFakeNode("div");
    const emptyMounted=mountWiringWorkbench(emptyHost,2,{initial:createCircuit(2)});mounts.push(emptyMounted);flush();
    expectThrow("reference-sample-is-never-highlight-fallback",()=>emptyMounted.highlightCommittedWire("w1"),RangeError);
    check("reference-fallback-rejection-keeps-empty-learner-graph",emptyMounted.getCircuit().wires.length===0&&
      highlightedRow(emptyHost)===null&&emptyHost.querySelector(".wire-svg").querySelectorAll("[data-wiring-highlight-wire]").length===0);

    const before=JSON.stringify(mounted.getCircuit());
    const highlight=mounted.highlightCommittedWire("w1");flush();
    check("highlight-result-frozen-readonly",Object.isFrozen(highlight)&&highlight.highlighted===true&&
      highlight.wireId==="w1"&&highlight.from==="D13"&&highlight.to==="R1:A"&&
      highlight.graphMutated===false&&highlight.historyMutated===false&&highlight.progressMutated===false);
    check("highlight-does-not-mutate-graph-history-or-callbacks",JSON.stringify(mounted.getCircuit())===before&&
      onChangeCount===0&&undoCount===0&&redoCount===0);
    const row=highlightedRow(host);
    check("matching-native-row-highlighted",row?.getAttribute("data-wiring-highlight-wire")==="w1"&&
      row.getAttribute("data-wiring-wire-id")==="w1"&&row.getAttribute("role")==="group"&&
      /đánh dấu chỉ đọc.*không tạo dây mới.*không thay đổi learner graph/i.test(row.getAttribute("aria-label")||""));
    const svg=host.querySelector(".wire-svg");
    const highlightedPaths=svg.querySelectorAll("[data-wiring-highlight-wire]");
    check("exact-existing-svg-wire-highlighted",highlightedPaths.length===2&&
      highlightedPaths.every(path=>path.getAttribute("data-wiring-highlight-wire")==="w1"&&
        path.getAttribute("data-wiring-wire-id")==="w1"));

    const suggestionBefore=JSON.stringify(mounted.getCircuit());
    const suggestion=mounted.previewSuggestedPair(["R1:B","LED:A"]);flush();
    mounted.highlightCommittedWire("w1");flush();
    check("suggestion-coexists-with-highlight",suggestion.wireCreated===false&&
      host.dataset.wireSuggestedPair==="R1:B|LED:A"&&svg.querySelectorAll("[data-wire-suggestion-preview]").length===1&&
      svg.querySelectorAll("[data-wiring-highlight-wire]").length===2&&JSON.stringify(mounted.getCircuit())===suggestionBefore);

    const identical={...mounted.getCircuit(),wires:mounted.getCircuit().wires.map(wire=>({...wire}))};
    mounted.setCircuit(identical);flush();
    check("fresh-identical-model-preserves-exact-highlight",highlightedRow(host)?.getAttribute("data-wiring-wire-id")==="w1");

    const reused=connectCircuit(createCircuit(2),"D13","GND");
    mounted.setCircuit(reused);flush();
    check("id-reuse-with-different-edge-clears-stale-highlight",highlightedRow(host)===null&&
      svg.querySelectorAll("[data-wiring-highlight-wire]").length===0&&mounted.getCircuit().wires[0].id==="w1");
    const reusedResult=mounted.highlightCommittedWire("w1");flush();
    check("fresh-explicit-reused-id-resolves-current-edge-precisely",reusedResult.from==="D13"&&reusedResult.to==="GND"&&
      /D13 nối GND/.test(highlightedRow(host)?.getAttribute("aria-label")||""));

    expectThrow("foreign-wire-id-rejected",()=>mounted.highlightCommittedWire("w999"),RangeError);flush();
    check("foreign-id-fails-closed-clearing-stale-visual",highlightedRow(host)===null&&
      svg.querySelectorAll("[data-wiring-highlight-wire]").length===0);
    expectThrow("prototype-string-id-rejected",()=>mounted.highlightCommittedWire(new String("w1")),TypeError);
    expectThrow("noncanonical-id-rejected",()=>mounted.highlightCommittedWire("w01"),TypeError);

    const prototypeWire=Object.create({id:"w1",from:"D13",to:"R1:A"});
    const prototypeCircuit={...createCircuit(2),wires:[prototypeWire],nextWireId:2};
    mounted.setCircuit(prototypeCircuit);flush();
    expectThrow("prototype-wire-object-rejected-by-highlight",()=>mounted.highlightCommittedWire("w1"),TypeError);

    learner=connectCircuit(createCircuit(2),"D13","R1:A");
    mounted.setCircuit(learner);mounted.highlightCommittedWire("w1");flush();
    const remove=host.querySelector("[data-remove-wire]");
    remove.click();flush();
    check("wire-removal-clears-highlight-and-removes-edge",mounted.getCircuit().wires.length===0&&
      highlightedRow(host)===null&&svg.querySelectorAll("[data-wiring-highlight-wire]").length===0&&onChangeCount===1);

    const learner2=connectCircuit(createCircuit(2),"D13","R1:A");
    mounted.setCircuit(learner2);mounted.highlightCommittedWire("w1");flush();
    const explicitClear=mounted.highlightCommittedWire(null);flush();
    check("explicit-null-clear-readonly",Object.isFrozen(explicitClear)&&explicitClear.highlighted===false&&
      explicitClear.wireId===null&&highlightedRow(host)===null&&JSON.stringify(mounted.getCircuit())===JSON.stringify(learner2));

    const pointerHost=new WorkbenchFakeNode("div");
    const pointerMounted=mountWiringWorkbench(pointerHost,2,{initial:connectCircuit(createCircuit(2),"D13","R1:A")});
    mounts.push(pointerMounted);flush();
    pointerMounted.highlightCommittedWire("w1");flush();
    const pointerFrom=pointerHost.querySelectorAll("[data-terminal]").find(node=>node.dataset.terminal==="R1:B");
    const pointerTo=pointerHost.querySelectorAll("[data-terminal]").find(node=>node.dataset.terminal==="LED:A");
    pointerFrom.dispatchEvent({type:"pointerdown",target:pointerFrom,button:0,clientX:10,clientY:10,pointerId:77});
    globalThis.window.dispatchEvent({type:"pointermove",button:0,clientX:40,clientY:30,pointerId:77});
    fakeDocument.pointTarget=pointerTo;
    globalThis.window.dispatchEvent({type:"pointerup",button:0,clientX:40,clientY:30,pointerId:77});
    fakeDocument.pointTarget=null;flush();
    check("pointer-wiring-remains-functional-after-highlight-feature",pointerMounted.getCircuit().wires.length===2&&
      pointerMounted.getCircuit().wires.some(wire=>wire.from==="R1:B"&&wire.to==="LED:A"));
    check("pointer-graph-mutation-clears-cross-surface-highlight",highlightedRow(pointerHost)===null&&
      pointerHost.querySelector(".wire-svg").querySelectorAll("[data-wiring-highlight-wire]").length===0);

    // Committed-wire endpoint reroute is a proposal until explicit Confirm.
    // The 2D controller must keep the router-produced learner graph immutable
    // through preview/cancel and publish exactly one final graph on success.
    const rerouteHost=new WorkbenchFakeNode("div");
    let rerouteInitial=createCircuit(2);
    rerouteInitial=connectCircuit(rerouteInitial,"D13","R1:A");
    rerouteInitial=connectCircuit(rerouteInitial,"R1:B","LED:A");
    const rerouteBaseJson=JSON.stringify(rerouteInitial);
    const rerouteChanges=[];
    const rerouteMounted=mountWiringWorkbench(rerouteHost,2,{
      initial:rerouteInitial,
      historyState:{lessonId:2,revision:11,canUndo:true,canRedo:false},
      onChange(model,analysis){rerouteChanges.push({model,analysis});},
    });
    mounts.push(rerouteMounted);flush();
    const rerouteSvg=rerouteHost.querySelector(".wire-svg");
    const startW1=rerouteHost.querySelector('[data-wire-reroute-start="w1"]');
    const rerouteEditor=rerouteHost.querySelector(".wire-reroute-editor");
    const keepFrom=rerouteHost.querySelector('[data-wire-reroute-anchor="from"]');
    const keepTo=rerouteHost.querySelector('[data-wire-reroute-anchor="to"]');
    const targetSelect=rerouteHost.querySelector("[data-wire-reroute-target]");
    const confirm=rerouteHost.querySelector("[data-wire-reroute-confirm]");
    const cancelRerouteButton=rerouteHost.querySelector("[data-wire-reroute-cancel]");
    check("reroute-native-controls-and-aria-contract",startW1?.type==="button"&&
      /Sửa một đầu dây w1/i.test(startW1.getAttribute("aria-label")||"")&&
      rerouteEditor?.getAttribute("role")==="group"&&
      /Sửa đầu dây đã nối/.test(rerouteEditor.getAttribute("aria-label")||"")&&
      keepFrom?.type==="button"&&keepTo?.type==="button"&&confirm?.type==="button"&&
      cancelRerouteButton?.type==="button"&&
      rerouteEditor.querySelector(".wire-reroute-message")?.getAttribute("role")==="status"&&
      rerouteEditor.querySelector(".wire-reroute-message")?.getAttribute("aria-live")==="polite");

    startW1.click();flush();
    check("reroute-start-is-preview-only-and-focuses-anchor",rerouteHost.dataset.wireRerouteMode==="preview"&&
      rerouteHost.dataset.wireRerouteWireId==="w1"&&rerouteHost.dataset.wireRerouteTarget===""&&
      keepFrom.focused===true&&keepFrom.getAttribute("aria-pressed")==="true"&&
      keepTo.getAttribute("aria-pressed")==="false"&&JSON.stringify(rerouteMounted.getCircuit())===rerouteBaseJson&&
      rerouteChanges.length===0);
    targetSelect.value="GND";
    targetSelect.dispatchEvent({type:"change",target:targetSelect});flush();
    check("reroute-target-preview-does-not-mutate-graph",rerouteHost.dataset.wireRerouteTarget==="GND"&&
      confirm.disabled===false&&confirm.getAttribute("aria-disabled")==="false"&&
      rerouteSvg.querySelectorAll("[data-wire-reroute-preview]").length===1&&
      JSON.stringify(rerouteMounted.getCircuit())===rerouteBaseJson&&rerouteChanges.length===0);
    const previewGhost=rerouteSvg.querySelector("[data-wire-reroute-preview]");
    check("reroute-svg-preview-is-explicitly-noncanonical",previewGhost?.userData?.kind==="committed-wire-reroute-proposal"&&
      previewGhost.userData.committed===false&&previewGhost.userData.electricalAuthority===false);

    cancelRerouteButton.click();flush();
    const restoredStart=rerouteHost.querySelector('[data-wire-reroute-start="w1"]');
    check("reroute-cancel-keeps-graph-and-restores-action-focus",rerouteHost.dataset.wireRerouteMode==="off"&&
      rerouteHost.getAttribute("data-wire-reroute-wire-id")===null&&
      rerouteSvg.querySelectorAll("[data-wire-reroute-preview]").length===0&&
      JSON.stringify(rerouteMounted.getCircuit())===rerouteBaseJson&&rerouteChanges.length===0&&
      restoredStart?.focused===true);

    restoredStart.click();flush();
    targetSelect.value="GND";
    targetSelect.dispatchEvent({type:"change",target:targetSelect});flush();
    confirm.click();flush();
    const rerouted=rerouteMounted.getCircuit();
    const replacement=rerouted.wires.find(wire=>wire.id==="w3");
    check("reroute-confirm-publishes-one-router-generated-replacement",rerouteChanges.length===1&&
      rerouteChanges[0].model===rerouted&&
      JSON.stringify(rerouteChanges[0].analysis)===JSON.stringify(rerouteMounted.getAnalysis())&&
      rerouted!==rerouteInitial&&JSON.stringify(rerouteInitial)===rerouteBaseJson&&
      !rerouted.wires.some(wire=>wire.id==="w1")&&replacement?.from==="D13"&&replacement?.to==="GND"&&
      rerouted.wires.length===rerouteInitial.wires.length&&rerouted.nextWireId===4&&
      rerouteHost.dataset.wireRerouteMode==="off"&&rerouteSvg.querySelectorAll("[data-wire-reroute-preview]").length===0);

    // Invalid proposals are fully local: no router publication, no host write.
    const invalidHost=new WorkbenchFakeNode("div");
    let invalidGraph=createCircuit(2);
    invalidGraph=connectCircuit(invalidGraph,"D13","R1:A");
    invalidGraph=connectCircuit(invalidGraph,"D13","GND");
    const invalidBefore=JSON.stringify(invalidGraph);
    let invalidChanges=0;
    const invalidMounted=mountWiringWorkbench(invalidHost,2,{
      initial:invalidGraph,
      historyState:{lessonId:2,revision:3,canUndo:false,canRedo:false},
      onChange(){invalidChanges+=1;},
    });
    mounts.push(invalidMounted);flush();
    invalidHost.querySelector('[data-wire-reroute-start="w1"]').click();flush();
    const invalidTarget=invalidHost.querySelector("[data-wire-reroute-target]");
    const invalidConfirm=invalidHost.querySelector("[data-wire-reroute-confirm]");
    invalidTarget.value="D13";
    invalidTarget.dispatchEvent({type:"change",target:invalidTarget});flush();
    check("reroute-self-target-is-disabled-and-nonmutating",invalidConfirm.disabled===true&&
      invalidConfirm.getAttribute("aria-disabled")==="true"&&JSON.stringify(invalidMounted.getCircuit())===invalidBefore&&invalidChanges===0);
    invalidTarget.value="GND";
    invalidTarget.dispatchEvent({type:"change",target:invalidTarget});flush();
    check("reroute-duplicate-target-is-disabled-and-nonmutating",invalidConfirm.disabled===true&&
      /Đường nối này đã tồn tại/.test(invalidHost.querySelector(".wire-reroute-message")?.textContent||"")&&
      JSON.stringify(invalidMounted.getCircuit())===invalidBefore&&invalidChanges===0);
    invalidHost.querySelector("[data-wire-reroute-cancel]").click();flush();
    const staleStart=invalidHost.querySelector('[data-wire-reroute-start="w1"]');
    invalidMounted.setCircuit(createCircuit(2));flush();
    staleStart.click();flush();
    check("stale-detached-wire-id-cannot-reopen-reroute",invalidHost.dataset.wireRerouteMode==="off"&&
      invalidMounted.getCircuit().wires.length===0&&invalidChanges===0);

    // A pending proposal is bound to both the exact host history revision and
    // exact same-lesson canonical graph object.
    const revisionHost=new WorkbenchFakeNode("div");
    const revisionGraph=connectCircuit(createCircuit(2),"D13","R1:A");
    let revisionChanges=0;
    const revisionMounted=mountWiringWorkbench(revisionHost,2,{
      initial:revisionGraph,
      historyState:{lessonId:2,revision:21,canUndo:true,canRedo:false},
      onChange(){revisionChanges+=1;},
    });
    mounts.push(revisionMounted);flush();
    revisionHost.querySelector('[data-wire-reroute-start="w1"]').click();flush();
    const revisionTarget=revisionHost.querySelector("[data-wire-reroute-target]");
    revisionTarget.value="GND";
    revisionTarget.dispatchEvent({type:"change",target:revisionTarget});flush();
    revisionMounted.setHistoryState({lessonId:2,revision:22,canUndo:true,canRedo:false});flush();
    check("history-revision-change-invalidates-reroute-transactionally",revisionHost.dataset.wireRerouteMode==="off"&&
      revisionHost.getAttribute("data-wire-reroute-wire-id")===null&&
      revisionHost.querySelector(".wire-svg").querySelectorAll("[data-wire-reroute-preview]").length===0&&
      JSON.stringify(revisionMounted.getCircuit())===JSON.stringify(revisionGraph)&&revisionChanges===0);
    revisionHost.querySelector('[data-wire-reroute-start="w1"]').click();flush();
    const revisionBeforeForeign=JSON.stringify(revisionMounted.getCircuit());
    expectThrow("cross-lesson-setCircuit-rejected-during-reroute",()=>revisionMounted.setCircuit(createCircuit(3)),TypeError);
    check("cross-lesson-rejection-preserves-current-reroute-and-graph",revisionHost.dataset.wireRerouteMode==="preview"&&
      revisionHost.dataset.wireRerouteWireId==="w1"&&JSON.stringify(revisionMounted.getCircuit())===revisionBeforeForeign&&
      revisionChanges===0);
    revisionHost.querySelector("[data-wire-reroute-cancel]").click();flush();
    revisionHost.querySelector('[data-wire-reroute-start="w1"]').click();flush();
    const freshSameLesson=connectCircuit(createCircuit(2),"D13","GND");
    revisionMounted.setCircuit(freshSameLesson);flush();
    check("same-lesson-setCircuit-reconciliation-invalidates-old-reroute",revisionHost.dataset.wireRerouteMode==="off"&&
      revisionHost.querySelector(".wire-svg").querySelectorAll("[data-wire-reroute-preview]").length===0&&
      revisionMounted.getCircuit()===freshSameLesson&&revisionChanges===0);

    // Pointer cancellation may clear a transient ghost, but must preserve the
    // explicit reroute proposal and canonical graph until Cancel/Confirm.
    const cancelHost=new WorkbenchFakeNode("div");
    const cancelGraph=connectCircuit(createCircuit(2),"D13","R1:A");
    let pointerCancelChanges=0;
    const cancelMounted=mountWiringWorkbench(cancelHost,2,{
      initial:cancelGraph,
      historyState:{lessonId:2,revision:5,canUndo:false,canRedo:false},
      onChange(){pointerCancelChanges+=1;},
    });
    mounts.push(cancelMounted);flush();
    cancelHost.querySelector('[data-wire-reroute-start="w1"]').click();flush();
    const cancelAnchor=cancelHost.querySelectorAll("[data-terminal]").find(node=>node.dataset.terminal==="D13");
    cancelAnchor.dispatchEvent({type:"pointerdown",target:cancelAnchor,button:0,clientX:12,clientY:12,pointerId:91});
    globalThis.window.dispatchEvent({type:"pointermove",button:0,clientX:55,clientY:42,pointerId:91});flush();
    check("reroute-pointer-drag-renders-only-transient-ghost",cancelHost.querySelector(".wire-svg").querySelectorAll("[data-wire-reroute-preview]").length===1&&
      JSON.stringify(cancelMounted.getCircuit())===JSON.stringify(cancelGraph)&&pointerCancelChanges===0);
    globalThis.window.dispatchEvent({type:"pointercancel",pointerId:91});flush();
    check("reroute-pointercancel-clears-ghost-without-canceling-proposal-or-graph",cancelHost.dataset.wireRerouteMode==="preview"&&
      cancelHost.querySelector(".wire-svg").querySelectorAll("[data-wire-reroute-preview]").length===0&&
      JSON.stringify(cancelMounted.getCircuit())===JSON.stringify(cancelGraph)&&pointerCancelChanges===0);

    // Precision: reroute actions use exact canonical wire IDs, never prefix
    // matching w1 to w10 when both exist in the same learner graph.
    const reroute16Host=new WorkbenchFakeNode("div");
    const reroute16=mountWiringWorkbench(reroute16Host,16,{initial:createSampleCircuit(16)});
    mounts.push(reroute16);flush();
    const rerouteStarts16=reroute16Host.querySelectorAll("[data-wire-reroute-start]");
    const rerouteW1=rerouteStarts16.find(button=>button.dataset.wireRerouteStart==="w1");
    const rerouteW10=rerouteStarts16.find(button=>button.dataset.wireRerouteStart==="w10");
    rerouteW1.click();flush();
    check("reroute-wire-id-precision-w1-not-w10",Boolean(rerouteW10)&&
      reroute16Host.dataset.wireRerouteWireId==="w1"&&
      rerouteStarts16.filter(button=>button.dataset.wireRerouteStart==="w1").length===1&&
      reroute16Host.dataset.wireRerouteMode==="preview");
    reroute16Host.querySelector("[data-wire-reroute-cancel]").click();flush();

    const disposeHost=new WorkbenchFakeNode("div");
    const disposeGraph=connectCircuit(createCircuit(2),"D13","R1:A");
    let disposeChanges=0;
    const disposeMounted=mountWiringWorkbench(disposeHost,2,{
      initial:disposeGraph,
      historyState:{lessonId:2,revision:1,canUndo:false,canRedo:false},
      onChange(){disposeChanges+=1;},
    });
    mounts.push(disposeMounted);flush();
    disposeHost.querySelector('[data-wire-reroute-start="w1"]').click();flush();
    const detachedConfirm=disposeHost.querySelector("[data-wire-reroute-confirm]");
    const detachedCancel=disposeHost.querySelector("[data-wire-reroute-cancel]");
    disposeMounted.dispose();
    mounts.splice(mounts.indexOf(disposeMounted),1);
    detachedConfirm.click();detachedCancel.click();flush();
    check("reroute-dispose-removes-ui-and-detaches-mutation-listeners",disposeHost.children.length===0&&
      disposeChanges===0&&JSON.stringify(disposeMounted.getCircuit())===JSON.stringify(disposeGraph));

    // Precision: w1 must never prefix-match w10 in the same current learner graph.
    const host16=new WorkbenchFakeNode("div");
    const sample16=createSampleCircuit(16);
    const mounted16=mountWiringWorkbench(host16,16,{initial:sample16});mounts.push(mounted16);flush();
    mounted16.highlightCommittedWire("w1");flush();
    const rows16=host16.querySelectorAll(".wire-connected");
    check("wire-id-precision-w1-not-w10",rows16.some(item=>item.getAttribute("data-wiring-wire-id")==="w10")&&
      rows16.filter(item=>item.getAttribute("data-wiring-highlight-wire")!==null).length===1&&
      highlightedRow(host16)?.getAttribute("data-wiring-wire-id")==="w1");
    check("svg-wire-id-precision-w1-not-w10",host16.querySelector(".wire-svg").querySelectorAll("[data-wiring-highlight-wire]").length===2&&
      host16.querySelector(".wire-svg").querySelectorAll("[data-wiring-highlight-wire]").every(path=>path.getAttribute("data-wiring-wire-id")==="w1"));

    mounted.dispose();
    check("dispose-makes-highlight-api-inert",mounted.highlightCommittedWire("w1")===false&&host.children.length===0);
    mounts.splice(mounts.indexOf(mounted),1);
  } finally {
    for(const mounted of mounts){try{mounted?.dispose();}catch{}}
    globalThis.document=realDocument;
    globalThis.window=realWindow;
    globalThis.ResizeObserver=realResizeObserver;
    globalThis.requestAnimationFrame=realRaf;
    globalThis.cancelAnimationFrame=realCancelRaf;
  }
  return Object.freeze({total:results.length,passed:results.length,failed:0,results:Object.freeze(results)});
}

export function runWiringWorkbenchHighlightStaticContracts(sourceText,cssText) {
  if(typeof sourceText!=="string"||typeof cssText!=="string")throw new TypeError("sourceText/cssText phải là chuỗi.");
  const results=[];
  const check=(name,condition)=>{
    if(!condition)throw new Error("FAIL wiring highlight static: "+name);
    results.push({name,status:"PASS"});
  };
  check("public-api-spelled-exactly",/highlightCommittedWire\(wireId\)\s*\{/.test(sourceText));
  const apiBody=/highlightCommittedWire\(wireId\)\s*\{([\s\S]*?)\n\s*\},\n\s*\/\/ Reconcile canonical changes/.exec(sourceText)?.[1]??"";
  check("public-api-never-uses-reference-sample-fallback",apiBody.length>0&&
    !/sampleCircuit|createSampleCircuit|createCircuit\(/.test(apiBody));
  check("public-api-has-no-connect-disconnect-notify-authority",apiBody.length>0&&
    !/connectCircuit|disconnectCircuit|notify\s*\(/.test(apiBody));
  check("native-row-selector-and-accessible-label-present",/data-wiring-highlight-wire/.test(sourceText)&&
    /aria-label/.test(sourceText)&&/đánh dấu chỉ đọc/.test(sourceText));
  check("existing-svg-paths-own-highlight-attribute",/wire-committed-path/.test(sourceText)&&
    /data-wiring-wire-id/.test(sourceText)&&/data-wiring-highlight-wire/.test(sourceText));
  check("suggestion-preview-contract-preserved",/data-wire-suggestion-preview/.test(sourceText)&&/stroke-dasharray/.test(sourceText));
  const rerouteCommit=/function commitReroute\(\)\s*\{([\s\S]*?)\n\s*\}\n\s*function applyCommittedHighlightRow/.exec(sourceText)?.[1]??"";
  const reroutePropose=/function proposeRerouteTarget\(target\)\s*\{([\s\S]*?)\n\s*\}\n\s*function chooseRerouteAnchor/.exec(sourceText)?.[1]??"";
  check("reroute-stable-selector-and-diagnostic-contract",[
    "wireRerouteStart","wireRerouteAnchor","wireRerouteTarget","wireRerouteConfirm","wireRerouteCancel",
    "wireRerouteMode","wireRerouteWireId","data-wire-reroute-preview",
  ].every(token=>sourceText.includes(token)));
  check("reroute-preview-path-has-no-electrical-authority",/data-wire-reroute-preview/.test(sourceText)&&
    /committed-wire-reroute-proposal/.test(sourceText)&&/electricalAuthority:false/.test(sourceText)&&
    reroutePropose.length>0&&!/connectCircuit|disconnectCircuit|notify\s*\(/.test(reroutePropose));
  check("reroute-confirm-is-one-atomic-router-publication",rerouteCommit.length>0&&
    rerouteCommit.indexOf("disconnectCircuit")>=0&&
    rerouteCommit.indexOf("connectCircuit")>rerouteCommit.indexOf("disconnectCircuit")&&
    rerouteCommit.indexOf("notify()")>rerouteCommit.indexOf("connectCircuit")&&
    (rerouteCommit.match(/\bnotify\(\)/g)??[]).length===1);
  check("reroute-stale-revision-and-canonical-refresh-fail-closed",
    /setHistoryState\(next\)[\s\S]*?normalized\.revision!==historyState\.revision[\s\S]*?reroute=null/.test(sourceText)&&
    /setCircuit\(next, options = \{\}\)[\s\S]*?reroute=null;rerouteHover=null/.test(sourceText)&&
    /dispose\(\)[\s\S]*?disposed=true;highlightedWire=null;reroute=null;rerouteHover=null/.test(sourceText));
  check("highlight-row-css-is-high-contrast",/\.wire-connected\[data-wiring-highlight-wire\][^{]*\{[^}]*border\s*:\s*2px[^}]*background\s*:\s*#fff7bf/is.test(cssText));
  check("375-compatible-controls-retain-44px-minimum",/@media\s*\(max-width:\s*800px\)[\s\S]*?\.wire-activate,\.wire-action\s*\{[^}]*min-height\s*:\s*44px/i.test(cssText)&&
    /\.wire-action\s*\{[^}]*min-width\s*:\s*44px[^}]*min-height\s*:\s*44px/i.test(cssText)&&
    /\.wire-activate\s*\{[^}]*min-width\s*:\s*44px[^}]*min-height\s*:\s*44px/i.test(cssText)&&
    /\.wire-remove\s*\{[^}]*min-width\s*:\s*44px[^}]*min-height\s*:\s*44px/i.test(cssText)&&
    /\.wire-terminal\s*\{[^}]*min-height\s*:\s*44px/i.test(cssText));
  check("reroute-target-and-mobile-actions-retain-accessible-sizing",
    /\.wire-reroute-target\s*\{[^}]*min-height\s*:\s*44px/i.test(cssText)&&
    /@media\s*\(max-width:\s*800px\)[\s\S]*?\.wire-reroute-anchors \.wire-action,\.wire-reroute-actions \.wire-action\s*\{[^}]*flex\s*:\s*1 1 130px/i.test(cssText));
  return Object.freeze({total:results.length,passed:results.length,failed:0,results:Object.freeze(results)});
}

export async function runSceneWiringContracts() {
  const { mountScene } = await import(`../src/scene3d.js?scene-wiring-contracts=${Date.now()}`);
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };

  const realRaf = window.requestAnimationFrame;
  const realCancelRaf = window.cancelAnimationFrame;
  let nextFrameId = 1;
  const queuedFrames = new Map();
  window.requestAnimationFrame = callback => {
    const id = nextFrameId++;
    queuedFrames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = id => queuedFrames.delete(id);
  const flushFrames = () => {
    const frames = [...queuedFrames.values()];
    queuedFrames.clear();
    frames.forEach(callback => callback(performance.now()));
  };

  const host = makeHost();
  let mounted;
  try {
    mounted = mountScene(host);
    mounted.setLesson({ id: 2, wiring: ["D13 → R → LED → GND"] });
    flushFrames();
    const canvas = host.querySelector("canvas");

    check("optional-setWiring-api", typeof mounted.setWiring === "function");
    check("lesson-starts-without-invented-net-layer",
      canvas.dataset.wiringMode === "none" && canvas.dataset.wiringWireCount === "0");

    const sample = createSampleCircuit(2);
    const terminals = listTerminals(2);
    const analysis = analyzeCircuit(2, sample);
    const summary = mounted.setWiring(sample, terminals, analysis);
    check("sample-wire-count", summary.shownWires === sample.wires.length && summary.omittedWires === 0);
    check("sample-net-count", summary.netCount === analysis.nets.length);
    check("sample-topology-checked", summary.status === "checked" && summary.analysisSupported === true);
    check("no-physical-hole-claim", summary.physicalMapping === "none" && canvas.dataset.wiringPhysicalMap === "none");
    check("conceptual-mode-exposed", canvas.dataset.wiringMode === "conceptual-netlist");
    check("conceptual-disclaimer-accessible",
      /khái niệm/i.test(canvas.getAttribute("aria-label") || "") &&
      /không phải vị trí lỗ/i.test(canvas.getAttribute("aria-label") || ""));
    check("wiring-invalidation-on-demand", queuedFrames.size === 1);
    flushFrames();
    check("wiring-no-animation-loop", queuedFrames.size === 0);

    const bad = connectCircuit(createCircuit(2), "D13", "GND");
    const badAnalysis = analyzeCircuit(2, bad);
    const badSummary = mounted.setWiring(bad, terminals, badAnalysis);
    check("error-net-highlight-state", badSummary.status === "error" && canvas.dataset.wiringStatus === "error");
    check("error-wire-still-shown-conceptually", badSummary.shownWires === 1 && badSummary.netCount === 1);
    flushFrames();

    const incompleteTerminals = terminals.filter(item => item.id !== "GND");
    const incomplete = mounted.setWiring(bad, incompleteTerminals, badAnalysis);
    check("unmapped-terminal-omitted", incomplete.shownWires === 0 && incomplete.omittedWires === 1);
    check("unmapped-does-not-invent-physical-location", incomplete.physicalMapping === "none");
    flushFrames();

    const unverified = mounted.setWiring(sample, terminals, null);
    check("missing-analysis-is-unverified", unverified.status === "unverified" && unverified.netCount === 0);
    check("raw-wires-remain-explicitly-conceptual", unverified.shownWires === sample.wires.length);
    flushFrames();

    const gl = canvas.getContext("webgl2");
    const loseContext = gl?.getExtension("WEBGL_lose_context");
    const lostPromise = waitEvent(canvas, "webglcontextlost");
    if (loseContext) loseContext.loseContext();
    else canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await lostPromise;
    check("context-loss-pauses-wiring-render", queuedFrames.size === 0);
    await waitTask();
    const restoredPromise = waitEvent(canvas, "webglcontextrestored");
    if (loseContext) loseContext.restoreContext();
    else canvas.dispatchEvent(new Event("webglcontextrestored"));
    await restoredPromise;
    check("context-restore-invalidates-wiring", queuedFrames.size === 1);
    flushFrames();
    const afterRestore = mounted.setWiring(sample, terminals, analysis);
    check("wiring-replace-after-restore", afterRestore.status === "checked" && afterRestore.shownWires === sample.wires.length);
    flushFrames();

    for (const lessonId of supportedWiringLessons()) {
      mounted.setLesson({ id: lessonId, wiring: [] });
      const state = createSampleCircuit(lessonId);
      const lessonTerminals = listTerminals(lessonId);
      const lessonAnalysis = analyzeCircuit(lessonId, state);
      const lessonSummary = mounted.setWiring(state, lessonTerminals, lessonAnalysis);
      const signalReference = lessonId === 10 || lessonId === 14;
      check(`lesson-${lessonId}-sample-wiring`,
        lessonSummary.status === (signalReference ? "warning" : "checked") &&
        (signalReference
          ? lessonAnalysis.scope === "signal-only" && !lessonAnalysis.ok && !lessonAnalysis.functional
          : lessonAnalysis.ok && lessonAnalysis.functional) &&
        lessonSummary.shownWires === state.wires.length &&
        lessonSummary.omittedWires === 0 &&
        lessonSummary.physicalMapping === "none");
      flushFrames();
    }

    mounted.setLesson({ id: 3, wiring: ["5V → nút → D2"] });
    check("lesson-change-clears-old-net-layer", canvas.dataset.wiringMode === "none" && canvas.dataset.wiringWireCount === "0");
    let mismatchRejected = false;
    try { mounted.setWiring(sample, terminals, analysis); }
    catch (error) { mismatchRejected = error instanceof RangeError; }
    check("cross-lesson-netlist-rejected", mismatchRejected && canvas.dataset.wiringMode === "none");

    const cleared = mounted.setWiring(null);
    check("explicit-clear", cleared.mode === "none" && canvas.dataset.wiringMode === "none");
    check("clear-restores-base-accessible-label", !/khái niệm/i.test(canvas.getAttribute("aria-label") || ""));

    mounted.dispose();
    mounted = null;
    check("dispose-removes-wiring-canvas", !canvas.isConnected && queuedFrames.size === 0);
  } finally {
    try { mounted?.dispose(); } catch {}
    host.remove();
    queuedFrames.clear();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
  }

  return { total: results.length, passed: results.length, failed: 0, results };
}
