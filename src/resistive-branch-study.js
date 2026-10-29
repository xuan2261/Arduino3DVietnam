/**
 * Pure educational study for R1 series (R2 || R3), backed by solveResistiveDC.
 *
 * This module deliberately verifies the returned finite numbers again from the
 * declared V/R values. It does not model Arduino GPIO, firmware, breadboards,
 * measurements, nonlinear devices or physical safety.
 */
import { solveResistiveDC } from "./dc-resistor-network.js";

const ORIGIN = "ideal-dc-resistor-model";
const TOPOLOGY = "r1-series-r2-parallel-r3";
const INPUT_KEYS = new Set(["voltageVolts","r1Ohms","r2Ohms","r3Ohms"]);
const VERIFY_KEYS = new Set(["declared","analysis"]);
const ANALYSIS_KEYS = new Set([
  "supported","calculated","nodeVoltages","resistorResults","issues","boundaries",
]);
const BRANCH_KEYS = new Set([
  "id","a","b","resistanceOhms","voltageDropVolts","currentMilliAmps",
  "absoluteCurrentMilliAmps","powerMilliWatts","origin","physicalVerified","measured",
]);
const NODE_KEYS = new Set(["GND","MID","VCC"]);
const RESISTOR_IDS = Object.freeze(["R1","R2","R3"]);
const ABS_TOLERANCE = 3e-9;
const REL_TOLERANCE = 1e-9;

export const RESISTIVE_BRANCH_LIMITS = Object.freeze({
  voltageMinVolts: 0,
  voltageMaxVolts: 5,
  resistanceMinOhms: 1,
  resistanceMaxOhms: 1_000_000,
  equationAbsoluteTolerance: ABS_TOLERANCE,
  equationRelativeTolerance: REL_TOLERANCE,
});

function deepFreeze(value) {
  if(Array.isArray(value)){
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if(value&&typeof value==="object"&&!Object.isFrozen(value)){
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value) {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===Object.prototype||prototype===null;
}

function ownDataRecord(value,required,label,allowed=null) {
  if(!isRecord(value))throw new TypeError(label+" phải là plain object không kế thừa dữ liệu.");
  const keys=Reflect.ownKeys(value);
  const unknown=keys.filter(key=>typeof key!=="string"||(allowed!==null&&!allowed.has(key)));
  if(unknown.length)throw new TypeError(label+" có field không được hỗ trợ: "+String(unknown[0]));
  for(const key of keys){
    if(!Object.hasOwn(value,key)||!("value" in Object.getOwnPropertyDescriptor(value,key))){
      throw new TypeError(label+" chỉ chấp nhận own data field: "+key);
    }
  }
  for(const key of required){
    if(!Object.hasOwn(value,key))throw new TypeError(label+" thiếu own data field: "+key);
  }
  return value;
}

function exactRecord(value,allowed,label) {
  return ownDataRecord(value,allowed,label,allowed);
}

function finite(value,label) {
  if(typeof value!=="number"||!Number.isFinite(value)){
    throw new TypeError(label+" phải là số hữu hạn.");
  }
  return value;
}

function closeTo(actual,expected) {
  const scale=Math.max(Math.abs(actual),Math.abs(expected));
  return Math.abs(actual-expected)<=Math.max(ABS_TOLERANCE,REL_TOLERANCE*scale);
}

function requireClose(actual,expected,label) {
  if(!closeTo(actual,expected)){
    throw new TypeError(label+" không nhất quán với R1 series (R2 || R3), Ohm/KCL.");
  }
}

function normalizeDeclared(input,label="declared") {
  const source=exactRecord(input,INPUT_KEYS,label);
  const voltageVolts=finite(source.voltageVolts,label+".voltageVolts");
  const r1Ohms=finite(source.r1Ohms,label+".r1Ohms");
  const r2Ohms=finite(source.r2Ohms,label+".r2Ohms");
  const r3Ohms=finite(source.r3Ohms,label+".r3Ohms");
  if(voltageVolts<RESISTIVE_BRANCH_LIMITS.voltageMinVolts||
      voltageVolts>RESISTIVE_BRANCH_LIMITS.voltageMaxVolts){
    throw new RangeError(label+".voltageVolts phải trong 0..5 V.");
  }
  for(const [name,value] of [["r1Ohms",r1Ohms],["r2Ohms",r2Ohms],["r3Ohms",r3Ohms]]){
    if(value<RESISTIVE_BRANCH_LIMITS.resistanceMinOhms||
        value>RESISTIVE_BRANCH_LIMITS.resistanceMaxOhms){
      throw new RangeError(label+"."+name+" phải trong 1..1000000 Ω.");
    }
  }
  return Object.freeze({voltageVolts,r1Ohms,r2Ohms,r3Ohms});
}

function verifyBoundaries(boundaries) {
  ownDataRecord(boundaries,["origin","model","physicalVerified","measured","educationalOnly",
    "limits","configuredGuards"],"analysis.boundaries");
  if(boundaries.origin!==ORIGIN||
      boundaries.model!=="linear-ideal-dc-resistor-network"||
      boundaries.physicalVerified!==false||
      boundaries.measured!==false||
      boundaries.educationalOnly!==true){
    throw new TypeError("analysis.boundaries không đúng provenance ideal DC resistor model.");
  }
  const limits=boundaries.limits;
  ownDataRecord(limits,["sourceVoltageMinVolts","sourceVoltageMaxVolts","maxResistors"],
    "analysis.boundaries.limits");
  if(limits.sourceVoltageMinVolts!==0||
      limits.sourceVoltageMaxVolts!==5||
      limits.maxResistors<3){
    throw new TypeError("analysis.boundaries.limits không khớp solver bounds cần thiết.");
  }
  const guards=boundaries.configuredGuards;
  ownDataRecord(guards,["maxCurrentMilliAmps","maxPowerMilliWatts"],
    "analysis.boundaries.configuredGuards");
  if(guards.maxCurrentMilliAmps!==null||guards.maxPowerMilliWatts!==null){
    throw new TypeError("Branch study không chấp nhận solver report có configured guard khác mặc định.");
  }
}

function verifyBranch(branch,{id,a,b,ohms}) {
  const source=exactRecord(branch,BRANCH_KEYS,"analysis.resistorResults["+id+"]");
  if(source.id!==id||source.a!==a||source.b!==b){
    throw new TypeError("Branch "+id+" không khớp topology R1 series (R2 || R3).");
  }
  if(source.origin!==ORIGIN||source.physicalVerified!==false||source.measured!==false){
    throw new TypeError("Branch "+id+" thiếu provenance ideal-dc-resistor-model.");
  }
  const normalized=Object.freeze({
    id,
    a,
    b,
    resistanceOhms:finite(source.resistanceOhms,id+".resistanceOhms"),
    voltageDropVolts:finite(source.voltageDropVolts,id+".voltageDropVolts"),
    currentMilliAmps:finite(source.currentMilliAmps,id+".currentMilliAmps"),
    absoluteCurrentMilliAmps:finite(source.absoluteCurrentMilliAmps,id+".absoluteCurrentMilliAmps"),
    powerMilliWatts:finite(source.powerMilliWatts,id+".powerMilliWatts"),
  });
  requireClose(normalized.resistanceOhms,ohms,id+".resistanceOhms");
  if(normalized.absoluteCurrentMilliAmps<0||normalized.powerMilliWatts<0){
    throw new TypeError("Branch "+id+" có abs current/power âm.");
  }
  return normalized;
}

function expectedMath(declared) {
  const parallelOhms=declared.r2Ohms*declared.r3Ohms/(declared.r2Ohms+declared.r3Ohms);
  const midVolts=declared.voltageVolts*parallelOhms/(declared.r1Ohms+parallelOhms);
  const r1DropVolts=declared.voltageVolts-midVolts;
  const r2DropVolts=midVolts;
  const r3DropVolts=midVolts;
  const r1CurrentMilliAmps=1000*r1DropVolts/declared.r1Ohms;
  const r2CurrentMilliAmps=1000*r2DropVolts/declared.r2Ohms;
  const r3CurrentMilliAmps=1000*r3DropVolts/declared.r3Ohms;
  const power=(currentMilliAmps,ohms)=>
    currentMilliAmps*currentMilliAmps*ohms/1000;
  return Object.freeze({
    parallelOhms,
    midVolts,
    r1DropVolts,
    r2DropVolts,
    r3DropVolts,
    r1CurrentMilliAmps,
    r2CurrentMilliAmps,
    r3CurrentMilliAmps,
    r1PowerMilliWatts:power(r1CurrentMilliAmps,declared.r1Ohms),
    r2PowerMilliWatts:power(r2CurrentMilliAmps,declared.r2Ohms),
    r3PowerMilliWatts:power(r3CurrentMilliAmps,declared.r3Ohms),
  });
}

export function verifyResistiveBranchAnalysis(input) {
  const source=exactRecord(input,VERIFY_KEYS,"verifyResistiveBranchAnalysis input");
  const declared=normalizeDeclared(source.declared);
  const analysis=exactRecord(source.analysis,ANALYSIS_KEYS,"analysis");
  if(analysis.supported!==true||analysis.calculated!==true){
    throw new TypeError("Branch study chỉ hiển thị analysis supported/calculated.");
  }
  if(!Array.isArray(analysis.issues)||analysis.issues.length!==0){
    throw new TypeError("Branch study không hiển thị analysis còn issue.");
  }
  verifyBoundaries(analysis.boundaries);

  const nodeVoltages=exactRecord(analysis.nodeVoltages,NODE_KEYS,"analysis.nodeVoltages");
  if(Object.keys(nodeVoltages).length!==3){
    throw new TypeError("Branch study yêu cầu đúng ba node GND/MID/VCC.");
  }
  const vcc=finite(nodeVoltages.VCC,"nodeVoltages.VCC");
  const mid=finite(nodeVoltages.MID,"nodeVoltages.MID");
  const gnd=finite(nodeVoltages.GND,"nodeVoltages.GND");
  requireClose(vcc,declared.voltageVolts,"VCC");
  requireClose(gnd,0,"GND");

  if(!Array.isArray(analysis.resistorResults)||analysis.resistorResults.length!==3){
    throw new TypeError("Branch study yêu cầu đúng ba resistor result R1/R2/R3.");
  }
  const byId=new Map();
  for(const branch of analysis.resistorResults){
    if(!isRecord(branch)||typeof branch.id!=="string"||byId.has(branch.id)){
      throw new TypeError("analysis.resistorResults có ID thiếu/trùng.");
    }
    byId.set(branch.id,branch);
  }
  if(RESISTOR_IDS.some(id=>!byId.has(id))||byId.size!==3){
    throw new TypeError("Branch study yêu cầu đúng ID R1/R2/R3.");
  }
  const r1=verifyBranch(byId.get("R1"),{id:"R1",a:"VCC",b:"MID",ohms:declared.r1Ohms});
  const r2=verifyBranch(byId.get("R2"),{id:"R2",a:"MID",b:"GND",ohms:declared.r2Ohms});
  const r3=verifyBranch(byId.get("R3"),{id:"R3",a:"MID",b:"GND",ohms:declared.r3Ohms});
  const expected=expectedMath(declared);

  requireClose(mid,expected.midVolts,"V(MID)");
  requireClose(r1.voltageDropVolts,expected.r1DropVolts,"R1.voltageDropVolts");
  requireClose(r2.voltageDropVolts,expected.r2DropVolts,"R2.voltageDropVolts");
  requireClose(r3.voltageDropVolts,expected.r3DropVolts,"R3.voltageDropVolts");
  requireClose(r1.currentMilliAmps,expected.r1CurrentMilliAmps,"R1.currentMilliAmps");
  requireClose(r2.currentMilliAmps,expected.r2CurrentMilliAmps,"R2.currentMilliAmps");
  requireClose(r3.currentMilliAmps,expected.r3CurrentMilliAmps,"R3.currentMilliAmps");
  requireClose(r1.absoluteCurrentMilliAmps,Math.abs(expected.r1CurrentMilliAmps),"R1.absoluteCurrentMilliAmps");
  requireClose(r2.absoluteCurrentMilliAmps,Math.abs(expected.r2CurrentMilliAmps),"R2.absoluteCurrentMilliAmps");
  requireClose(r3.absoluteCurrentMilliAmps,Math.abs(expected.r3CurrentMilliAmps),"R3.absoluteCurrentMilliAmps");
  requireClose(r1.powerMilliWatts,expected.r1PowerMilliWatts,"R1.powerMilliWatts");
  requireClose(r2.powerMilliWatts,expected.r2PowerMilliWatts,"R2.powerMilliWatts");
  requireClose(r3.powerMilliWatts,expected.r3PowerMilliWatts,"R3.powerMilliWatts");
  requireClose(r1.currentMilliAmps,r2.currentMilliAmps+r3.currentMilliAmps,"KCL I1=I2+I3");

  return deepFreeze({
    schemaVersion:1,
    topology:TOPOLOGY,
    declared,
    nodeVoltages:{VCC:vcc,MID:mid,GND:gnd},
    equivalentParallelOhms:expected.parallelOhms,
    resistors:{R1:r1,R2:r2,R3:r3},
    currents:{
      sourceMilliAmps:r1.currentMilliAmps,
      branchR2MilliAmps:r2.currentMilliAmps,
      branchR3MilliAmps:r3.currentMilliAmps,
    },
    provenance:{
      origin:ORIGIN,
      solver:"dc-resistor-network",
      verification:"declared-equations-ohm-kcl",
    },
    claims:{
      measured:false,
      physicalVerified:false,
      hardwareValidated:false,
      firmwareExecuted:false,
      compilerOutput:false,
      circuitRouterIntegrated:false,
    },
  });
}

export function solveResistiveBranchStudy(input) {
  const declared=normalizeDeclared(input,"branch input");
  const analysis=solveResistiveDC({
    ground:"GND",
    voltageNodes:[{node:"VCC",voltageVolts:declared.voltageVolts}],
    resistors:[
      {id:"R1",a:"VCC",b:"MID",ohms:declared.r1Ohms},
      {id:"R2",a:"MID",b:"GND",ohms:declared.r2Ohms},
      {id:"R3",a:"MID",b:"GND",ohms:declared.r3Ohms},
    ],
  });
  if(!analysis.supported||!analysis.calculated){
    return Object.freeze({analysis,verified:null});
  }
  return Object.freeze({
    analysis,
    verified:verifyResistiveBranchAnalysis({declared,analysis}),
  });
}
