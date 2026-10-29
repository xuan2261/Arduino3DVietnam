/**
 * Declarative two-resistor divider study over the bounded DC nodal solver.
 *
 * The UI renders only solver-originated ideal-model numbers after provenance,
 * topology and finite-number checks. It never reads lesson wiring, circuit-router,
 * 3D state, sensors, AVR execution or physical measurements.
 */
import { solveResistiveDC } from "./dc-resistor-network.js";
import { solveResistiveBranchStudy } from "./resistive-branch-study.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ORIGIN = "ideal-dc-resistor-model";
const EQUATION_ABS_TOLERANCE = 1e-9;
const EQUATION_REL_TOLERANCE = 1e-9;

const text=(doc,tag,message)=>{
  const node=doc.createElement(tag);
  node.textContent=String(message);
  return node;
};

function svgNode(doc,tag,attributes={},message=undefined) {
  const node=doc.createElementNS(SVG_NS,tag);
  for(const [name,value] of Object.entries(attributes))node.setAttribute(name,String(value));
  if(message!==undefined)node.textContent=String(message);
  return node;
}

function finite(value,label) {
  if(typeof value!=="number"||!Number.isFinite(value)) {
    throw new TypeError(label+" phải là số hữu hạn từ dc-resistor-network.");
  }
  return value;
}

function closeTo(left,right,absoluteTolerance=EQUATION_ABS_TOLERANCE,relativeTolerance=EQUATION_REL_TOLERANCE) {
  const scale=Math.max(Math.abs(left),Math.abs(right));
  return Math.abs(left-right)<=Math.max(absoluteTolerance,relativeTolerance*scale);
}

function requireClose(actual,expected,label) {
  if(!closeTo(actual,expected)) {
    throw new TypeError(label+" không nhất quán với phương trình divider/Ohm.");
  }
}

function format(value,maximumFractionDigits=6) {
  return value.toLocaleString("vi-VN",{maximumFractionDigits});
}

function verifyDeclared(declared) {
  if(!declared||typeof declared!=="object"||Array.isArray(declared)) {
    throw new TypeError("declared phải là object giá trị chia áp.");
  }
  const voltageVolts=finite(declared.voltageVolts,"declared.voltageVolts");
  const r1Ohms=finite(declared.r1Ohms,"declared.r1Ohms");
  const r2Ohms=finite(declared.r2Ohms,"declared.r2Ohms");
  if(voltageVolts<0||voltageVolts>5||r1Ohms<1||r1Ohms>1_000_000||r2Ohms<1||r2Ohms>1_000_000) {
    throw new RangeError("declared nằm ngoài giới hạn UI 0..5 V và 1..1.000.000 Ω.");
  }
  return Object.freeze({voltageVolts,r1Ohms,r2Ohms});
}

function verifyBranch(branch,{id,a,b,ohms}) {
  if(!branch||typeof branch!=="object"||branch.id!==id||branch.a!==a||branch.b!==b) {
    throw new TypeError("Kết quả solver thiếu branch "+id+" đúng topology chia áp.");
  }
  if(branch.origin!==ORIGIN||branch.physicalVerified!==false||branch.measured!==false) {
    throw new TypeError("Branch "+id+" thiếu provenance ideal-dc-resistor-model.");
  }
  const resistanceOhms=finite(branch.resistanceOhms,id+".resistanceOhms");
  const voltageDropVolts=finite(branch.voltageDropVolts,id+".voltageDropVolts");
  const currentMilliAmps=finite(branch.currentMilliAmps,id+".currentMilliAmps");
  const absoluteCurrentMilliAmps=finite(branch.absoluteCurrentMilliAmps,id+".absoluteCurrentMilliAmps");
  const powerMilliWatts=finite(branch.powerMilliWatts,id+".powerMilliWatts");
  if(!closeTo(resistanceOhms,ohms)||absoluteCurrentMilliAmps<0||powerMilliWatts<0) {
    throw new TypeError("Branch "+id+" không khớp giá trị khai báo hoặc có kết quả số không hợp lệ.");
  }
  return Object.freeze({
    id,a,b,resistanceOhms,voltageDropVolts,currentMilliAmps,absoluteCurrentMilliAmps,powerMilliWatts,
  });
}

function verifiedDividerSolution(analysis,declaredInput) {
  const declared=verifyDeclared(declaredInput);
  if(!analysis||typeof analysis!=="object"||analysis.supported!==true||analysis.calculated!==true) {
    throw new TypeError("Bộ giải chưa trả kết quả calculated được phép hiển thị.");
  }
  if(!Array.isArray(analysis.issues)||analysis.issues.length!==0) {
    throw new TypeError("Kết quả calculated còn issue nên không được hiển thị số.");
  }
  const boundary=analysis.boundaries;
  if(!boundary||boundary.origin!==ORIGIN||boundary.model!=="linear-ideal-dc-resistor-network"||
      boundary.physicalVerified!==false||boundary.measured!==false||boundary.educationalOnly!==true) {
    throw new TypeError("Kết quả solver thiếu boundary của mô hình điện trở DC lý tưởng.");
  }
  if(!analysis.nodeVoltages||typeof analysis.nodeVoltages!=="object") {
    throw new TypeError("Kết quả solver thiếu nodeVoltages.");
  }
  const vcc=finite(analysis.nodeVoltages.VCC,"nodeVoltages.VCC");
  const mid=finite(analysis.nodeVoltages.MID,"nodeVoltages.MID");
  const gnd=finite(analysis.nodeVoltages.GND,"nodeVoltages.GND");
  if(!closeTo(vcc,declared.voltageVolts)||!closeTo(gnd,0)) {
    throw new TypeError("Node cố định của solver không khớp VCC/GND đã khai báo.");
  }
  if(!Array.isArray(analysis.resistorResults)||analysis.resistorResults.length!==2) {
    throw new TypeError("Kết quả solver phải có đúng hai branch R1/R2 cho study này.");
  }
  const byId=new Map(analysis.resistorResults.map(branch=>[branch?.id,branch]));
  if(byId.size!==2||!byId.has("R1")||!byId.has("R2")) {
    throw new TypeError("Kết quả solver phải có đúng branch R1 và R2.");
  }
  const r1=verifyBranch(byId.get("R1"),{id:"R1",a:"VCC",b:"MID",ohms:declared.r1Ohms});
  const r2=verifyBranch(byId.get("R2"),{id:"R2",a:"MID",b:"GND",ohms:declared.r2Ohms});
  const expectedMid=declared.voltageVolts*declared.r2Ohms/(declared.r1Ohms+declared.r2Ohms);
  const expectedR1Drop=declared.voltageVolts-expectedMid;
  const expectedR2Drop=expectedMid;
  const expectedR1CurrentMilliAmps=1000*expectedR1Drop/declared.r1Ohms;
  const expectedR2CurrentMilliAmps=1000*expectedR2Drop/declared.r2Ohms;
  const expectedR1PowerMilliWatts=
    expectedR1CurrentMilliAmps*expectedR1CurrentMilliAmps*declared.r1Ohms/1000;
  const expectedR2PowerMilliWatts=
    expectedR2CurrentMilliAmps*expectedR2CurrentMilliAmps*declared.r2Ohms/1000;

  requireClose(mid,expectedMid,"V(MID)");
  requireClose(r1.voltageDropVolts,expectedR1Drop,"R1.voltageDropVolts");
  requireClose(r2.voltageDropVolts,expectedR2Drop,"R2.voltageDropVolts");
  requireClose(r1.currentMilliAmps,expectedR1CurrentMilliAmps,"R1.currentMilliAmps");
  requireClose(r2.currentMilliAmps,expectedR2CurrentMilliAmps,"R2.currentMilliAmps");
  requireClose(r1.absoluteCurrentMilliAmps,Math.abs(expectedR1CurrentMilliAmps),"R1.absoluteCurrentMilliAmps");
  requireClose(r2.absoluteCurrentMilliAmps,Math.abs(expectedR2CurrentMilliAmps),"R2.absoluteCurrentMilliAmps");
  requireClose(r1.powerMilliWatts,expectedR1PowerMilliWatts,"R1.powerMilliWatts");
  requireClose(r2.powerMilliWatts,expectedR2PowerMilliWatts,"R2.powerMilliWatts");
  requireClose(r1.currentMilliAmps,r2.currentMilliAmps,"KCL dòng R1/R2");
  return Object.freeze({declared,vcc,mid,gnd,r1,r2,boundary});
}

function resistorPolyline(doc,startX,endX,y) {
  const width=endX-startX;
  const dx=width/8;
  const points=[
    [startX,y],
    [startX+dx,y],
    [startX+2*dx,y-18],
    [startX+3*dx,y+18],
    [startX+4*dx,y-18],
    [startX+5*dx,y+18],
    [startX+6*dx,y-18],
    [startX+7*dx,y],
    [endX,y],
  ].map(([x,py])=>x+","+py).join(" ");
  return svgNode(doc,"polyline",{
    points,
    fill:"none",
    stroke:"currentColor",
    "stroke-width":"3",
    "stroke-linejoin":"round",
    "stroke-linecap":"round",
    "vector-effect":"non-scaling-stroke",
  });
}

function renderVerifiedDivider(doc,verified) {
  if(!doc||typeof doc.createElement!=="function"||typeof doc.createElementNS!=="function") {
    throw new TypeError("renderResistiveStudyDetails cần document DOM hợp lệ.");
  }
  const root=text(doc,"div","");
  root.className="resistive-study-presentation";
  root.setAttribute("data-resistive-presentation","verified");
  root.setAttribute("data-resistive-origin",ORIGIN);

  const figure=text(doc,"figure","");
  figure.className="resistive-study-visual";
  figure.setAttribute("data-resistive-divider-visual","");
  figure.style.margin="12px 0";
  figure.style.maxWidth="100%";
  const svg=svgNode(doc,"svg",{
    viewBox:"0 0 760 220",
    width:"100%",
    role:"img",
    focusable:"false",
    preserveAspectRatio:"xMidYMid meet",
    "aria-label":
      "Sơ đồ khái niệm chia áp: VCC "+format(verified.vcc)+" V qua R1 "+
      format(verified.r1.resistanceOhms)+" Ω đến MID "+format(verified.mid)+
      " V, qua R2 "+format(verified.r2.resistanceOhms)+" Ω đến GND 0 V; dòng lý tưởng "+
      format(verified.r1.currentMilliAmps)+" mA.",
  });
  svg.style.maxWidth="100%";
  svg.style.height="auto";
  svg.style.display="block";
  svg.append(
    svgNode(doc,"line",{x1:55,y1:105,x2:135,y2:105,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    resistorPolyline(doc,135,300,105),
    svgNode(doc,"line",{x1:300,y1:105,x2:380,y2:105,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"circle",{cx:380,cy:105,r:7,fill:"currentColor"}),
    svgNode(doc,"line",{x1:380,y1:105,x2:460,y2:105,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    resistorPolyline(doc,460,625,105),
    svgNode(doc,"line",{x1:625,y1:105,x2:705,y2:105,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"circle",{cx:55,cy:105,r:7,fill:"currentColor"}),
    svgNode(doc,"circle",{cx:705,cy:105,r:7,fill:"currentColor"}),
    svgNode(doc,"text",{x:55,y:62,"text-anchor":"middle","font-size":"18",fill:"currentColor"},"VCC "+format(verified.vcc)+" V"),
    svgNode(doc,"text",{x:218,y:62,"text-anchor":"middle","font-size":"17",fill:"currentColor"},"R1 "+format(verified.r1.resistanceOhms)+" Ω"),
    svgNode(doc,"text",{x:380,y:150,"text-anchor":"middle","font-size":"18",fill:"currentColor"},"MID "+format(verified.mid)+" V"),
    svgNode(doc,"text",{x:542,y:62,"text-anchor":"middle","font-size":"17",fill:"currentColor"},"R2 "+format(verified.r2.resistanceOhms)+" Ω"),
    svgNode(doc,"text",{x:705,y:62,"text-anchor":"middle","font-size":"18",fill:"currentColor"},"GND 0 V"),
    svgNode(doc,"text",{x:380,y:198,"text-anchor":"middle","font-size":"16",fill:"currentColor"},"I lý tưởng = "+format(verified.r1.currentMilliAmps)+" mA"),
  );
  figure.append(
    svg,
    text(doc,"figcaption",
      "Sơ đồ khái niệm của đúng mạng đã khai báo: VCC — R1 — MID — R2 — GND. "+
      "Các số trên hình lấy từ dc-resistor-network, không phải phép đo."),
  );

  const table=text(doc,"table","");
  table.className="resistive-study-table";
  table.setAttribute("data-resistive-divider-table","");
  const caption=text(doc,"caption",
    "Bảng tương đương: VCC "+format(verified.vcc)+" V (khai báo), MID "+
    format(verified.mid)+" V (solver), GND 0 V; dòng lý tưởng qua hai điện trở "+
    format(verified.r1.currentMilliAmps)+" mA.");
  const head=text(doc,"thead","");
  const heading=text(doc,"tr","");
  for(const name of ["Điện trở","Từ / đến","Giá trị khai báo (Ω)","Dòng lý tưởng (mA)","Công suất lý tưởng (mW)"]) {
    heading.append(text(doc,"th",name));
  }
  head.append(heading);
  const body=text(doc,"tbody","");
  for(const branch of [verified.r1,verified.r2]) {
    const tr=text(doc,"tr","");
    for(const entry of [
      branch.id,
      branch.a+" → "+branch.b,
      format(branch.resistanceOhms),
      format(branch.currentMilliAmps),
      format(branch.powerMilliWatts),
    ])tr.append(text(doc,"td",entry));
    body.append(tr);
  }
  table.append(caption,head,body);

  const assumptions=text(doc,"p",
    "Nguồn: ideal-dc-resistor-model · VCC là nguồn DC lý tưởng do người học khai báo; "+
    "GND = 0 V; R1/R2 là điện trở tuyến tính, không phụ thuộc nhiệt độ. "+
    "V(MID), dòng và công suất là kết quả toán học của solver, không phải phần cứng Arduino hoặc phép đo.");
  assumptions.setAttribute("data-resistive-assumptions","");
  root.append(figure,table,assumptions);
  return root;
}

function renderVerifiedBranch(doc,verified) {
  if(!doc||typeof doc.createElement!=="function"||typeof doc.createElementNS!=="function") {
    throw new TypeError("Branch study cần document DOM hợp lệ.");
  }
  if(!verified||verified.topology!=="r1-series-r2-parallel-r3"||
      verified.provenance?.origin!==ORIGIN||
      verified.claims?.measured!==false||
      verified.claims?.physicalVerified!==false){
    throw new TypeError("Branch study chỉ render verified ideal-model result.");
  }
  const {R1,R2,R3}=verified.resistors;
  const root=text(doc,"div","");
  root.className="resistive-study-presentation";
  root.setAttribute("data-resistive-presentation","verified");
  root.setAttribute("data-resistive-origin",ORIGIN);
  root.setAttribute("data-resistive-topology","branch");

  const figure=text(doc,"figure","");
  figure.className="resistive-study-visual";
  figure.setAttribute("data-resistive-branch-visual","");
  figure.style.margin="12px 0";
  figure.style.maxWidth="100%";
  const svg=svgNode(doc,"svg",{
    viewBox:"0 0 800 300",
    width:"100%",
    role:"img",
    focusable:"false",
    preserveAspectRatio:"xMidYMid meet",
    "aria-label":
      "Sơ đồ khái niệm R1 nối tiếp nhánh song song R2 và R3: VCC "+
      format(verified.nodeVoltages.VCC)+" V qua R1 "+format(R1.resistanceOhms)+
      " Ω đến MID "+format(verified.nodeVoltages.MID)+" V; từ MID dòng tách qua R2 "+
      format(R2.resistanceOhms)+" Ω và R3 "+format(R3.resistanceOhms)+
      " Ω về GND. Dòng lý tưởng I1 "+format(R1.currentMilliAmps)+
      " mA = I2 "+format(R2.currentMilliAmps)+" mA + I3 "+
      format(R3.currentMilliAmps)+" mA.",
  });
  svg.style.maxWidth="100%";
  svg.style.height="auto";
  svg.style.display="block";
  svg.append(
    svgNode(doc,"line",{x1:50,y1:150,x2:115,y2:150,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    resistorPolyline(doc,115,300,150),
    svgNode(doc,"line",{x1:300,y1:150,x2:360,y2:150,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"circle",{cx:50,cy:150,r:7,fill:"currentColor"}),
    svgNode(doc,"circle",{cx:360,cy:150,r:7,fill:"currentColor"}),
    svgNode(doc,"line",{x1:360,y1:90,x2:360,y2:210,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"line",{x1:360,y1:90,x2:420,y2:90,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    resistorPolyline(doc,420,610,90),
    svgNode(doc,"line",{x1:610,y1:90,x2:700,y2:90,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"line",{x1:360,y1:210,x2:420,y2:210,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    resistorPolyline(doc,420,610,210),
    svgNode(doc,"line",{x1:610,y1:210,x2:700,y2:210,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"line",{x1:700,y1:90,x2:700,y2:210,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"line",{x1:700,y1:150,x2:750,y2:150,stroke:"currentColor","stroke-width":"3","vector-effect":"non-scaling-stroke"}),
    svgNode(doc,"circle",{cx:750,cy:150,r:7,fill:"currentColor"}),
    svgNode(doc,"text",{x:50,y:112,"text-anchor":"middle","font-size":"18",fill:"currentColor"},"VCC "+format(verified.nodeVoltages.VCC)+" V"),
    svgNode(doc,"text",{x:208,y:112,"text-anchor":"middle","font-size":"17",fill:"currentColor"},"R1 "+format(R1.resistanceOhms)+" Ω"),
    svgNode(doc,"text",{x:360,y:260,"text-anchor":"middle","font-size":"18",fill:"currentColor"},"MID "+format(verified.nodeVoltages.MID)+" V"),
    svgNode(doc,"text",{x:515,y:55,"text-anchor":"middle","font-size":"17",fill:"currentColor"},"R2 "+format(R2.resistanceOhms)+" Ω"),
    svgNode(doc,"text",{x:515,y:255,"text-anchor":"middle","font-size":"17",fill:"currentColor"},"R3 "+format(R3.resistanceOhms)+" Ω"),
    svgNode(doc,"text",{x:750,y:112,"text-anchor":"middle","font-size":"18",fill:"currentColor"},"GND 0 V"),
    svgNode(doc,"text",{x:210,y:185,"text-anchor":"middle","font-size":"15",fill:"currentColor"},"I1 "+format(R1.currentMilliAmps)+" mA"),
    svgNode(doc,"text",{x:515,y:78,"text-anchor":"middle","font-size":"14",fill:"currentColor"},"I2 "+format(R2.currentMilliAmps)+" mA"),
    svgNode(doc,"text",{x:515,y:235,"text-anchor":"middle","font-size":"14",fill:"currentColor"},"I3 "+format(R3.currentMilliAmps)+" mA"),
  );
  figure.append(
    svg,
    text(doc,"figcaption",
      "Sơ đồ toán học: R1 nối tiếp với R2 || R3. I1 = I2 + I3 theo KCL tại MID. "+
      "Các số lấy từ dc-resistor-network và được kiểm lại bằng phương trình khai báo; không phải phép đo."),
  );

  const table=text(doc,"table","");
  table.className="resistive-study-table";
  table.setAttribute("data-resistive-branch-table","");
  const caption=text(doc,"caption",
    "Bảng tương đương R1 series (R2 || R3): VCC "+format(verified.nodeVoltages.VCC)+
    " V (khai báo), MID "+format(verified.nodeVoltages.MID)+" V (solver), R2 || R3 = "+
    format(verified.equivalentParallelOhms)+" Ω; I1 = "+format(R1.currentMilliAmps)+
    " mA, I2 + I3 = "+format(R2.currentMilliAmps+R3.currentMilliAmps)+" mA.");
  const head=text(doc,"thead","");
  const heading=text(doc,"tr","");
  for(const name of [
    "Điện trở","Từ / đến","Giá trị khai báo (Ω)","Sụt áp lý tưởng (V)",
    "Dòng lý tưởng (mA)","Công suất lý tưởng (mW)",
  ])heading.append(text(doc,"th",name));
  head.append(heading);
  const body=text(doc,"tbody","");
  for(const branch of [R1,R2,R3]){
    const tr=text(doc,"tr","");
    for(const entry of [
      branch.id,
      branch.a+" → "+branch.b,
      format(branch.resistanceOhms),
      format(branch.voltageDropVolts),
      format(branch.currentMilliAmps),
      format(branch.powerMilliWatts),
    ])tr.append(text(doc,"td",entry));
    body.append(tr);
  }
  table.append(caption,head,body);

  const assumptions=text(doc,"p",
    "Nguồn: ideal-dc-resistor-model · VCC và R1/R2/R3 do người học khai báo; GND = 0 V. "+
    "R1/R2/R3 là điện trở lý tưởng tuyến tính. V(MID), dòng và công suất là kết quả toán học "+
    "được kiểm tra lại bằng Ohm/KCL; không phải firmware, phần cứng Arduino hoặc phép đo.");
  assumptions.setAttribute("data-resistive-assumptions","");
  root.append(figure,table,assumptions);
  return root;
}

/**
 * Additive testable renderer. Existing app integration continues to use
 * mountResistiveStudy() with the same no-argument API.
 */
export function renderResistiveStudyDetails(doc,analysis,declared) {
  return renderVerifiedDivider(doc,verifiedDividerSolution(analysis,declared));
}

export function mountResistiveStudy(doc = document) {
  // An optional DOM dependency makes this exact view lifecycle testable in
  // both Bun and a real browser without trying to overwrite Window.document.
  // Existing production caller mountResistiveStudy() stays unchanged.
  if(!doc||typeof doc.getElementById!=="function"||
      typeof doc.createElement!=="function"||typeof doc.createElementNS!=="function"){
    throw new TypeError("Resistive study cần document DOM hợp lệ.");
  }
  const $=id=>doc.getElementById(id);
  const supply=$("resistiveV");
  const r1=$("resistiveR1");
  const r2=$("resistiveR2");
  const topology=$("resistiveTopology");
  const r3=$("resistiveR3");
  const solve=$("resistiveSolve");
  const result=$("resistiveResult");
  const details=$("resistiveDetails");
  if([supply,r1,r2,solve,result,details].some(node=>!node)){
    throw new Error("Resistive study thiếu điều khiển HTML bắt buộc.");
  }
  if(Boolean(topology)!==Boolean(r3)){
    throw new Error("Resistive branch controls phải có đồng thời #resistiveTopology và #resistiveR3.");
  }
  const enhanced=Boolean(topology&&r3);
  let disposed=false;
  let last=null;

  function numeric(node,min,max,label) {
    const raw=node.value.trim();
    const value=Number(raw);
    if(!raw||!Number.isFinite(value)||value<min||value>max){
      throw new RangeError(label+" phải là số hữu hạn trong khoảng "+min+" đến "+max+".");
    }
    return value;
  }

  function calculate() {
    if(disposed)return null;
    details.replaceChildren();
    delete result.dataset.topology;
    try {
      const v=numeric(supply,0,5,"Điện áp nguồn lý tưởng");
      const first=numeric(r1,1,1_000_000,"Điện trở R1 (Ω)");
      const second=numeric(r2,1,1_000_000,"Điện trở R2 (Ω)");
      const mode=enhanced?String(topology.value||"").trim():"divider";
      if(mode!=="divider"&&mode!=="branch"){
        throw new RangeError("resistiveTopology chỉ hỗ trợ divider hoặc branch.");
      }
      if(mode==="branch"){
        const third=numeric(r3,1,1_000_000,"Điện trở R3 (Ω)");
        const study=solveResistiveBranchStudy({
          voltageVolts:v,r1Ohms:first,r2Ohms:second,r3Ohms:third,
        });
        last=study.analysis;
        if(!study.analysis.supported||!study.analysis.calculated||!study.verified){
          const reason=study.analysis.issues?.map(issue=>issue.message).join("; ")||
            "Không giải được topology nhánh trong giới hạn đã hỗ trợ.";
          result.dataset.result="error";
          result.textContent="Bộ giải từ chối: "+reason;
          return study.analysis;
        }
        details.append(renderVerifiedBranch(doc,study.verified));
        result.dataset.result="calculated";
        result.dataset.topology="branch";
        result.textContent=
          "Tính xong mạng lý tưởng R1 series (R2 || R3): V(MID) = "+
          format(study.verified.nodeVoltages.MID)+" V; I1 = "+
          format(study.verified.resistors.R1.currentMilliAmps)+" mA; I2 + I3 = "+
          format(study.verified.resistors.R2.currentMilliAmps+
            study.verified.resistors.R3.currentMilliAmps)+
          " mA. Đây là kết quả toán học ideal-model, không phải số đo thực tế.";
        return study.analysis;
      }
      const declared={voltageVolts:v,r1Ohms:first,r2Ohms:second};
      const analysis=solveResistiveDC({
        ground:"GND",
        voltageNodes:[{node:"VCC",voltageVolts:v}],
        resistors:[
          {id:"R1",a:"VCC",b:"MID",ohms:first},
          {id:"R2",a:"MID",b:"GND",ohms:second},
        ],
      });
      last=analysis;
      if(!analysis.supported||!analysis.calculated){
        const reason=analysis.issues?.map(issue=>issue.message).join("; ")||"Không giải được mạng trong giới hạn đã hỗ trợ.";
        result.dataset.result="error";
        result.textContent="Bộ giải từ chối: "+reason;
        return analysis;
      }
      const verified=verifiedDividerSolution(analysis,declared);
      details.append(renderVerifiedDivider(doc,verified));
      result.dataset.result="calculated";
      result.dataset.topology="divider";
      result.textContent=
        "Tính xong mạng lý tưởng: V(MID) = "+format(verified.mid)+
        " V; I = "+format(verified.r1.currentMilliAmps)+
        " mA. Nguồn/R do người học khai báo; các số còn lại do solver tính, không phải số đo thực tế.";
      return analysis;
    }catch(error) {
      last=null;
      details.replaceChildren();
      result.dataset.result="error";
      result.textContent="Đầu vào hoặc kết quả bị từ chối: "+(error?.message||"dữ liệu không hợp lệ")+
        ". Không hiển thị dòng/áp khi dữ liệu hoặc provenance không đạt kiểm tra.";
      return null;
    }
  }

  const handler=()=>calculate();
  solve.addEventListener("click",handler);
  return Object.freeze({
    calculate,
    snapshot:()=>last,
    dispose(){
      if(disposed)return;
      disposed=true;
      solve.removeEventListener("click",handler);
    },
  });
}
