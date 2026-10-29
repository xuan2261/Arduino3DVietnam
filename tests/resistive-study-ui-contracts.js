import { solveResistiveDC } from "../src/dc-resistor-network.js";
import {
  mountResistiveStudy,
  renderResistiveStudyDetails,
} from "../src/resistive-study-ui.js";

function assert(condition,message) {
  if(!condition)throw new Error("resistive-study-ui contract: "+message);
}

function expectThrow(run,pattern,label) {
  let error=null;
  try{run();}catch(caught){error=caught;}
  assert(error&&pattern.test(String(error.message||error)),label);
}

function attrSelector(selector) {
  const match=/^\[([^=\]]+)(?:=["']([^"']*)["'])?\]$/.exec(selector);
  return match?{name:match[1],value:match[2]}:null;
}

class FakeNode {
  constructor(tagName,namespaceURI=null) {
    this.tagName=String(tagName).toUpperCase();
    this.namespaceURI=namespaceURI;
    this.children=[];
    this.parentNode=null;
    this.attributes=new Map();
    this.listeners=new Map();
    this.className="";
    this.dataset={};
    this.style={};
    this.value="";
    this._text="";
  }

  set textContent(value) {
    this._text=String(value??"");
    this.children=[];
  }

  get textContent() {
    return this._text+this.children.map(child=>child.textContent).join("");
  }

  set innerHTML(_) {
    throw new Error("resistive renderer must not use innerHTML");
  }

  append(...nodes) {
    for(const node of nodes){
      assert(node instanceof FakeNode,"append expects FakeNode");
      node.parentNode=this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children=[];
    this._text="";
    this.append(...nodes);
  }

  setAttribute(name,value) {
    this.attributes.set(String(name),String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name)?this.attributes.get(name):null;
  }

  addEventListener(type,callback) {
    const listeners=this.listeners.get(type)??[];
    listeners.push(callback);
    this.listeners.set(type,listeners);
  }

  removeEventListener(type,callback) {
    const listeners=this.listeners.get(type)??[];
    this.listeners.set(type,listeners.filter(item=>item!==callback));
  }

  click() {
    for(const callback of this.listeners.get("click")??[])callback({target:this});
  }

  matches(selector) {
    const attr=attrSelector(selector);
    if(attr){
      if(!this.attributes.has(attr.name))return false;
      return attr.value===undefined||this.attributes.get(attr.name)===attr.value;
    }
    if(selector.startsWith(".")){
      return this.className.split(/\s+/).filter(Boolean).includes(selector.slice(1));
    }
    return this.tagName===selector.toUpperCase();
  }

  querySelectorAll(selector) {
    const found=[];
    const visit=node=>{
      for(const child of node.children){
        if(child.matches(selector))found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0]??null;
  }
}

class FakeDocument {
  constructor() {
    this.byId=new Map();
  }

  createElement(tagName) {
    return new FakeNode(tagName);
  }

  createElementNS(namespaceURI,tagName) {
    return new FakeNode(tagName,namespaceURI);
  }

  getElementById(id) {
    return this.byId.get(id)??null;
  }

  register(id,node) {
    this.byId.set(id,node);
    return node;
  }
}

function divider(v=5,r1=1000,r2=1000) {
  return solveResistiveDC({
    ground:"GND",
    voltageNodes:[{node:"VCC",voltageVolts:v}],
    resistors:[
      {id:"R1",a:"VCC",b:"MID",ohms:r1},
      {id:"R2",a:"MID",b:"GND",ohms:r2},
    ],
  });
}

function declared(v=5,r1=1000,r2=1000) {
  return {voltageVolts:v,r1Ohms:r1,r2Ohms:r2};
}

function forgeBranch(analysis,id,patch) {
  return {
    ...analysis,
    resistorResults:analysis.resistorResults.map(branch=>
      branch.id===id?{...branch,...patch}:branch),
  };
}

function fakeStudyDocument() {
  const doc=new FakeDocument();
  const supply=doc.register("resistiveV",new FakeNode("input"));
  const r1=doc.register("resistiveR1",new FakeNode("input"));
  const r2=doc.register("resistiveR2",new FakeNode("input"));
  const solve=doc.register("resistiveSolve",new FakeNode("button"));
  const result=doc.register("resistiveResult",new FakeNode("p"));
  const details=doc.register("resistiveDetails",new FakeNode("div"));
  supply.value="5";
  r1.value="1000";
  r2.value="1000";
  return {doc,supply,r1,r2,solve,result,details};
}

export function runResistiveStudyUiContracts() {
  const checks=[];
  const check=(name,run)=>{run();checks.push(name);};

  check("verified-divider-renders-responsive-accessible-svg",()=>{
    const doc=new FakeDocument();
    const root=renderResistiveStudyDetails(doc,divider(),declared());
    assert(root.getAttribute("data-resistive-presentation")==="verified","verified root");
    assert(root.getAttribute("data-resistive-origin")==="ideal-dc-resistor-model","origin attr");
    const svg=root.querySelector("svg");
    assert(svg?.namespaceURI==="http://www.w3.org/2000/svg","SVG namespace");
    assert(svg?.getAttribute("role")==="img","SVG role");
    assert(/VCC.*R1.*MID.*R2.*GND/i.test(svg?.getAttribute("aria-label")||""),"SVG topology label");
    assert(/2[,.]5 V/.test(svg?.getAttribute("aria-label")||""),"SVG midpoint value");
    assert(svg?.getAttribute("width")==="100%","responsive SVG width");
    assert(svg?.getAttribute("viewBox")==="0 0 760 220","responsive viewBox");
    assert(svg?.style.maxWidth==="100%"&&svg?.style.height==="auto","SVG nonoverflow style");
  });

  check("table-equivalent-preserves-two-resistor-body-rows",()=>{
    const doc=new FakeDocument();
    const root=renderResistiveStudyDetails(doc,divider(),declared());
    const table=root.querySelector("[data-resistive-divider-table]");
    const caption=table?.querySelector("caption");
    const rows=table?.querySelector("tbody")?.querySelectorAll("tr")??[];
    assert(table?.className==="resistive-study-table","existing table class preserved");
    assert(rows.length===2,"existing E2E expects exactly two tbody resistor rows");
    assert(/VCC.*MID.*GND/i.test(caption?.textContent||""),"caption node equivalent");
    assert(/2[,.]5.*mA/i.test(caption?.textContent||""),"caption computed current");
    assert(rows.every(row=>/2[,.]5/.test(row.textContent)&&/6[,.]25/.test(row.textContent)),
      "rows keep ideal current/power values");
  });

  check("declared-values-and-solver-values-are-labelled-separately",()=>{
    const doc=new FakeDocument();
    const root=renderResistiveStudyDetails(doc,divider(5,1000,2000),declared(5,1000,2000));
    const caption=root.querySelector("caption")?.textContent||"";
    const assumptions=root.querySelector("[data-resistive-assumptions]")?.textContent||"";
    assert(/VCC 5 V \(khai báo\)/i.test(caption),"declared VCC label");
    assert(/MID .* V \(solver\)/i.test(caption),"solver MID label");
    assert(/nguồn DC lý tưởng do người học khai báo/i.test(assumptions),"source assumption");
    assert(/kết quả toán học của solver/i.test(assumptions),"computed provenance");
    assert(/không phải phần cứng Arduino hoặc phép đo/i.test(assumptions),"physical/measurement boundary");
  });

  check("true-solver-output-passes-equation-hardening-including-zero-volts",()=>{
    const doc=new FakeDocument();
    const unequal=renderResistiveStudyDetails(doc,divider(5,1000,2000),declared(5,1000,2000));
    assert(unequal.getAttribute("data-resistive-presentation")==="verified",
      "real unequal divider must pass equation checks");
    const zero=renderResistiveStudyDetails(doc,divider(0,1000,2000),declared(0,1000,2000));
    assert(/MID 0 V/.test(zero.textContent)&&/0 mA/.test(zero.textContent),
      "zero-V solver result must pass with exact zero midpoint/current");
  });

  check("forged-origin-or-physical-proof-fails-closed",()=>{
    const doc=new FakeDocument();
    const valid=divider();
    expectThrow(
      ()=>renderResistiveStudyDetails(doc,{...valid,boundaries:{...valid.boundaries,origin:"firmware"}},declared()),
      /boundary|mô hình/i,
      "forged model origin",
    );
    const forgedBranches=valid.resistorResults.map((branch,index)=>
      index===0?{...branch,physicalVerified:true}:branch);
    expectThrow(
      ()=>renderResistiveStudyDetails(doc,{...valid,resistorResults:forgedBranches},declared()),
      /provenance/i,
      "forged physical branch",
    );
  });

  check("nonnumeric-result-or-declaration-fails-before-render",()=>{
    const doc=new FakeDocument();
    const valid=divider();
    expectThrow(
      ()=>renderResistiveStudyDetails(doc,{...valid,nodeVoltages:{...valid.nodeVoltages,MID:Infinity}},declared()),
      /số hữu hạn/i,
      "nonfinite midpoint",
    );
    expectThrow(
      ()=>renderResistiveStudyDetails(doc,valid,{...declared(),r1Ohms:NaN}),
      /số hữu hạn/i,
      "nonfinite declared resistance",
    );
  });

  check("forged-finite-midpoint-fails-divider-equation",()=>{
    const doc=new FakeDocument();
    const valid=divider(5,1000,2000);
    expectThrow(
      ()=>renderResistiveStudyDetails(
        doc,
        {...valid,nodeVoltages:{...valid.nodeVoltages,MID:3.25}},
        declared(5,1000,2000),
      ),
      /V\(MID\).*phương trình divider\/Ohm/i,
      "forged finite midpoint",
    );
  });

  check("forged-finite-voltage-drop-fails-ohm-equation",()=>{
    const doc=new FakeDocument();
    const valid=divider();
    expectThrow(
      ()=>renderResistiveStudyDetails(
        doc,
        forgeBranch(valid,"R1",{voltageDropVolts:2.4}),
        declared(),
      ),
      /R1\.voltageDropVolts.*phương trình divider\/Ohm/i,
      "forged finite voltage drop",
    );
  });

  check("forged-finite-current-fails-ohm-equation",()=>{
    const doc=new FakeDocument();
    const valid=divider();
    expectThrow(
      ()=>renderResistiveStudyDetails(
        doc,
        forgeBranch(valid,"R1",{currentMilliAmps:2.4}),
        declared(),
      ),
      /R1\.currentMilliAmps.*phương trình divider\/Ohm/i,
      "forged finite signed current",
    );
  });

  check("forged-finite-absolute-current-fails-ohm-equation",()=>{
    const doc=new FakeDocument();
    const valid=divider();
    expectThrow(
      ()=>renderResistiveStudyDetails(
        doc,
        forgeBranch(valid,"R1",{absoluteCurrentMilliAmps:2.4}),
        declared(),
      ),
      /R1\.absoluteCurrentMilliAmps.*phương trình divider\/Ohm/i,
      "forged finite absolute current",
    );
  });

  check("forged-finite-power-fails-ohm-equation",()=>{
    const doc=new FakeDocument();
    const valid=divider();
    expectThrow(
      ()=>renderResistiveStudyDetails(
        doc,
        forgeBranch(valid,"R1",{powerMilliWatts:6.0}),
        declared(),
      ),
      /R1\.powerMilliWatts.*phương trình divider\/Ohm/i,
      "forged finite power",
    );
  });

  check("floating-solver-result-produces-no-presentation",()=>{
    const doc=new FakeDocument();
    const floating=solveResistiveDC({
      ground:"GND",
      voltageNodes:[],
      resistors:[{id:"R1",a:"A",b:"B",ohms:1000}],
    });
    assert(floating.calculated===false&&floating.issues.some(issue=>issue.code==="FLOATING_COMPONENT"),
      "fixture must be real floating solver result");
    expectThrow(
      ()=>renderResistiveStudyDetails(doc,floating,declared()),
      /chưa trả kết quả calculated/i,
      "floating result rejected",
    );
  });

  check("singular-or-ill-conditioned-solver-result-produces-no-presentation",()=>{
    const doc=new FakeDocument();
    const singular=solveResistiveDC({
      ground:"GND",
      voltageNodes:[],
      resistors:[
        {id:"R_WEAK",a:"GND",b:"N1",ohms:1e13},
        {id:"R_STRONG",a:"N1",b:"N2",ohms:1},
      ],
    });
    assert(singular.calculated===false&&singular.issues.some(issue=>issue.code==="SINGULAR_OR_ILL_CONDITIONED"),
      "fixture must be real singular solver result");
    expectThrow(
      ()=>renderResistiveStudyDetails(doc,singular,declared()),
      /chưa trả kết quả calculated/i,
      "singular result rejected",
    );
  });

  check("render-does-not-mutate-solver-or-declared-input",()=>{
    const doc=new FakeDocument();
    const analysis=divider();
    const input=declared();
    const beforeAnalysis=JSON.stringify(analysis);
    const beforeDeclared=JSON.stringify(input);
    renderResistiveStudyDetails(doc,analysis,input);
    assert(JSON.stringify(analysis)===beforeAnalysis,"solver result unchanged");
    assert(JSON.stringify(input)===beforeDeclared,"declared values unchanged");
  });

  check("mount-api-remains-calculate-snapshot-dispose",()=>{
    const fixture=fakeStudyDocument();
    {
      const mounted=mountResistiveStudy(fixture.doc);
      assert(typeof mounted.calculate==="function","calculate API");
      assert(typeof mounted.snapshot==="function","snapshot API");
      assert(typeof mounted.dispose==="function","dispose API");
      assert(Object.isFrozen(mounted),"mount API frozen");
      mounted.dispose();
    }
  });

  check("mount-default-calculation-renders-verified-solver-output",()=>{
    const fixture=fakeStudyDocument();
    {
      const mounted=mountResistiveStudy(fixture.doc);
      const analysis=mounted.calculate();
      assert(analysis?.calculated===true&&mounted.snapshot()===analysis,"snapshot keeps actual solver result");
      assert(fixture.result.dataset.result==="calculated","calculated status");
      assert(/V\(MID\).*2[,.]5 V.*I = 2[,.]5 mA/i.test(fixture.result.textContent),
        "status reports verified V/I");
      assert(fixture.details.querySelector("[data-resistive-presentation='verified']"),
        "verified presentation mounted");
      assert(fixture.details.querySelector("tbody")?.querySelectorAll("tr").length===2,
        "two branch rows mounted");
      mounted.dispose();
    }
  });

  check("mount-nonnumeric-input-clears-stale-numeric-output",()=>{
    const fixture=fakeStudyDocument();
    {
      const mounted=mountResistiveStudy(fixture.doc);
      mounted.calculate();
      assert(fixture.details.children.length===1,"valid presentation exists first");
      fixture.r1.value="not-a-number";
      const rejected=mounted.calculate();
      assert(rejected===null&&mounted.snapshot()===null,"invalid input has no analysis snapshot");
      assert(fixture.result.dataset.result==="error"&&/bị từ chối/i.test(fixture.result.textContent),
        "invalid status");
      assert(fixture.details.children.length===0,"stale SVG/table must be cleared");
      assert(!/2[,.]5 V|6[,.]25/.test(fixture.result.textContent),"no stale numeric result in status");
      mounted.dispose();
    }
  });

  check("button-listener-is-removed-on-dispose",()=>{
    const fixture=fakeStudyDocument();
    {
      const mounted=mountResistiveStudy(fixture.doc);
      assert((fixture.solve.listeners.get("click")??[]).length===1,"click handler mounted");
      mounted.dispose();
      assert((fixture.solve.listeners.get("click")??[]).length===0,"click handler removed");
      const before=fixture.result.textContent;
      fixture.solve.click();
      assert(fixture.result.textContent===before,"disposed UI ignores button");
      assert(mounted.calculate()===null,"disposed calculate returns null");
    }
  });

  return Object.freeze({
    total:checks.length,
    passed:checks.length,
    checks:Object.freeze(checks),
  });
}
