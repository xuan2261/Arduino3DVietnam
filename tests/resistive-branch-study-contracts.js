import { solveResistiveDC } from "../src/dc-resistor-network.js";
import {
  RESISTIVE_BRANCH_LIMITS,
  solveResistiveBranchStudy,
  verifyResistiveBranchAnalysis,
} from "../src/resistive-branch-study.js";

function assert(condition,message) {
  if(!condition)throw new Error("resistive-branch-study contract: "+message);
}

function expectThrow(run,pattern,label) {
  let error=null;
  try{run();}catch(caught){error=caught;}
  assert(error&&pattern.test(String(error.message||error)),label);
}

function declared(v=5,r1=1000,r2=2000,r3=2000) {
  return {voltageVolts:v,r1Ohms:r1,r2Ohms:r2,r3Ohms:r3};
}

function solveRaw(input=declared()) {
  return solveResistiveDC({
    ground:"GND",
    voltageNodes:[{node:"VCC",voltageVolts:input.voltageVolts}],
    resistors:[
      {id:"R1",a:"VCC",b:"MID",ohms:input.r1Ohms},
      {id:"R2",a:"MID",b:"GND",ohms:input.r2Ohms},
      {id:"R3",a:"MID",b:"GND",ohms:input.r3Ohms},
    ],
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function forgeBranch(analysis,id,patch) {
  const copy=clone(analysis);
  copy.resistorResults=copy.resistorResults.map(branch=>
    branch.id===id?{...branch,...patch}:branch);
  return copy;
}

function replaceBranch(analysis,id,value) {
  const copy=clone(analysis);
  copy.resistorResults=copy.resistorResults.map(branch=>branch.id===id?value:branch);
  return copy;
}

export function runResistiveBranchStudyContracts() {
  const checks=[];
  const check=(name,run)=>{run();checks.push(name);};

  check("limits-match-ui-and-solver-source-range",()=>{
    assert(RESISTIVE_BRANCH_LIMITS.voltageMinVolts===0,"voltage min");
    assert(RESISTIVE_BRANCH_LIMITS.voltageMaxVolts===5,"voltage max");
    assert(RESISTIVE_BRANCH_LIMITS.resistanceMinOhms===1,"resistance min");
    assert(RESISTIVE_BRANCH_LIMITS.resistanceMaxOhms===1_000_000,"resistance max");
    assert(RESISTIVE_BRANCH_LIMITS.equationAbsoluteTolerance===3e-9,"absolute tolerance");
  });

  check("true-solver-output-verifies-r1-series-parallel",()=>{
    const source=declared();
    const analysis=solveRaw(source);
    const verified=verifyResistiveBranchAnalysis({declared:source,analysis});
    assert(verified.topology==="r1-series-r2-parallel-r3","topology");
    assert(verified.nodeVoltages.MID===2.5,"Vmid 2.5 V");
    assert(verified.equivalentParallelOhms===1000,"parallel equivalent");
    assert(verified.resistors.R1.voltageDropVolts===2.5,"R1 drop");
    assert(verified.resistors.R2.voltageDropVolts===2.5&&
      verified.resistors.R3.voltageDropVolts===2.5,"parallel drops");
    assert(verified.resistors.R1.currentMilliAmps===2.5,"I1");
    assert(verified.resistors.R2.currentMilliAmps===1.25&&
      verified.resistors.R3.currentMilliAmps===1.25,"I2/I3");
    assert(verified.resistors.R1.powerMilliWatts===6.25,"P1");
    assert(verified.resistors.R2.powerMilliWatts===3.125&&
      verified.resistors.R3.powerMilliWatts===3.125,"P2/P3");
  });

  check("solve-api-uses-unchanged-dc-solver-and-returns-verified-result",()=>{
    const study=solveResistiveBranchStudy(declared());
    assert(study.analysis.supported===true&&study.analysis.calculated===true,"solver calculated");
    assert(study.analysis.resistorResults.length===3,"three solver branches");
    assert(study.verified?.provenance.solver==="dc-resistor-network","solver provenance");
    assert(study.verified?.provenance.verification==="declared-equations-ohm-kcl",
      "independent verification provenance");
  });

  check("kcl-i1-equals-i2-plus-i3",()=>{
    const verified=solveResistiveBranchStudy(declared(5,1500,2200,3300)).verified;
    const {R1,R2,R3}=verified.resistors;
    assert(Math.abs(R1.currentMilliAmps-R2.currentMilliAmps-R3.currentMilliAmps)<3e-9,
      "KCL branch current");
  });

  check("zero-volts-produces-zero-mid-drops-currents-and-powers",()=>{
    const verified=solveResistiveBranchStudy(declared(0,1000,2000,3000)).verified;
    assert(verified.nodeVoltages.MID===0,"zero MID");
    for(const branch of Object.values(verified.resistors)){
      assert(branch.voltageDropVolts===0,"zero drop "+branch.id);
      assert(branch.currentMilliAmps===0&&branch.absoluteCurrentMilliAmps===0,
        "zero current "+branch.id);
      assert(branch.powerMilliWatts===0,"zero power "+branch.id);
    }
  });

  check("declared-input-bounds-and-shape-fail-closed",()=>{
    expectThrow(()=>solveResistiveBranchStudy({...declared(),voltageVolts:5.1}),
      /0\.\.5 V/i,"over voltage");
    expectThrow(()=>solveResistiveBranchStudy({...declared(),r1Ohms:0}),
      /1\.\.1000000/i,"zero R1");
    expectThrow(()=>solveResistiveBranchStudy({...declared(),r3Ohms:1_000_001}),
      /1\.\.1000000/i,"R3 upper");
    expectThrow(()=>solveResistiveBranchStudy({...declared(),extra:true}),
      /field không được hỗ trợ/i,"extra input");
    expectThrow(()=>solveResistiveBranchStudy({...declared(),r2Ohms:Infinity}),
      /số hữu hạn/i,"nonfinite input");
  });

  check("forged-provenance-or-positive-physical-claim-fails-closed",()=>{
    const valid=clone(solveRaw());
    valid.boundaries.origin="firmware";
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:valid}),
      /provenance/i,"forged boundary origin");
    const physical=forgeBranch(solveRaw(),"R2",{physicalVerified:true});
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:physical}),
      /provenance/i,"forged branch physical proof");
  });

  check("forged-finite-midpoint-fails-equation",()=>{
    const valid=clone(solveRaw());
    valid.nodeVoltages.MID=2.4;
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:valid}),
      /V\(MID\).*Ohm\/KCL/i,"finite MID");
  });

  check("forged-finite-drop-fails-equation",()=>{
    const forged=forgeBranch(solveRaw(),"R3",{voltageDropVolts:2.4});
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:forged}),
      /R3\.voltageDropVolts.*Ohm\/KCL/i,"finite drop");
  });

  check("forged-finite-current-and-abs-current-fail-equation",()=>{
    expectThrow(()=>verifyResistiveBranchAnalysis({
      declared:declared(),
      analysis:forgeBranch(solveRaw(),"R2",{currentMilliAmps:1.2}),
    }),/R2\.currentMilliAmps.*Ohm\/KCL/i,"finite current");
    expectThrow(()=>verifyResistiveBranchAnalysis({
      declared:declared(),
      analysis:forgeBranch(solveRaw(),"R2",{absoluteCurrentMilliAmps:1.2}),
    }),/R2\.absoluteCurrentMilliAmps.*Ohm\/KCL/i,"finite abs current");
  });

  check("forged-finite-power-fails-equation",()=>{
    const forged=forgeBranch(solveRaw(),"R1",{powerMilliWatts:6});
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:forged}),
      /R1\.powerMilliWatts.*Ohm\/KCL/i,"finite power");
  });

  check("forged-finite-consistent-looking-report-still-fails-declared-equations",()=>{
    const valid=clone(solveRaw());
    valid.nodeVoltages.MID=2;
    const fake={
      R1:{voltageDropVolts:2,currentMilliAmps:2,absoluteCurrentMilliAmps:2,powerMilliWatts:4},
      R2:{voltageDropVolts:2,currentMilliAmps:1,absoluteCurrentMilliAmps:1,powerMilliWatts:2},
      R3:{voltageDropVolts:2,currentMilliAmps:1,absoluteCurrentMilliAmps:1,powerMilliWatts:2},
    };
    valid.resistorResults=valid.resistorResults.map(branch=>({...branch,...fake[branch.id]}));
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:valid}),
      /V\(MID\)|voltageDropVolts|Ohm\/KCL/i,
      "self-consistent-looking finite forged report");
  });

  check("forged-topology-extra-node-or-branch-fails-closed",()=>{
    const extraNode=clone(solveRaw());
    extraNode.nodeVoltages.EXTRA=1;
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:extraNode}),
      /node|field không được hỗ trợ/i,"extra node");
    const wrongEndpoint=replaceBranch(solveRaw(),"R3",{
      ...clone(solveRaw()).resistorResults.find(branch=>branch.id==="R3"),
      a:"VCC",
    });
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:wrongEndpoint}),
      /topology/i,"wrong branch endpoint");
  });

  check("configured-guard-report-is-not-accepted-as-default-study-report",()=>{
    const guarded=solveResistiveDC({
      ground:"GND",
      voltageNodes:[{node:"VCC",voltageVolts:5}],
      resistors:[
        {id:"R1",a:"VCC",b:"MID",ohms:1000},
        {id:"R2",a:"MID",b:"GND",ohms:2000},
        {id:"R3",a:"MID",b:"GND",ohms:2000},
      ],
    },{maxCurrentMilliAmps:10});
    assert(guarded.calculated===true,"guarded fixture calculated");
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:declared(),analysis:guarded}),
      /configured guard/i,"configured guard provenance");
  });

  check("result-is-deeply-frozen-and-inputs-not-mutated",()=>{
    const input=declared(4,1200,2200,3300);
    const before=JSON.stringify(input);
    const study=solveResistiveBranchStudy(input);
    const verified=study.verified;
    assert(JSON.stringify(input)===before,"input unchanged");
    assert(Object.isFrozen(study)&&Object.isFrozen(study.analysis)&&Object.isFrozen(verified),
      "top-level frozen");
    assert(Object.isFrozen(verified.declared)&&Object.isFrozen(verified.nodeVoltages)&&
      Object.isFrozen(verified.resistors)&&Object.values(verified.resistors).every(Object.isFrozen),
      "nested math frozen");
    assert(verified.claims.measured===false&&verified.claims.physicalVerified===false&&
      verified.claims.hardwareValidated===false&&verified.claims.firmwareExecuted===false&&
      verified.claims.compilerOutput===false&&verified.claims.circuitRouterIntegrated===false,
      "forbidden claims stay false");
  });

  check("reject-inherited-analysis-and-branch-provenance-even-when-equations-match",()=>{
    const input=declared();
    const real=solveRaw(input);
    const forged=Object.create(real,{
      resistorResults:{value:real.resistorResults.map(branch=>Object.create(branch))},
    });
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:forged}),
      /plain object|own data/i,"prototype-inherited report repro");
    const oneInherited=clone(real);
    oneInherited.resistorResults[0]=Object.create(real.resistorResults[0]);
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:oneInherited}),
      /ID thiếu\/trùng|plain object|own data/i,"inherited branch fields");
  });

  check("reject-inherited-declared-input-and-verification-wrapper",()=>{
    const input=declared();
    const real=solveRaw(input);
    expectThrow(()=>solveResistiveBranchStudy(Object.create(input)),
      /plain object|own data/i,"declared input prototype");
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:Object.create(input),analysis:real}),
      /plain object|own data/i,"inherited declared values");
    const wrapper=Object.create({declared:input,analysis:real});
    expectThrow(()=>verifyResistiveBranchAnalysis(wrapper),
      /plain object|own data/i,"inherited verify wrapper");
  });

  check("reject-inherited-nested-limits-guards-and-zero-voltage-facts",()=>{
    const input=declared(0,1000,2000,3000);
    const real=solveRaw(input);
    const boundaries=clone(real);
    boundaries.boundaries=Object.create(real.boundaries);
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:boundaries}),
      /plain object|own data/i,"inherited boundary claims");
    const limits=clone(real);
    limits.boundaries.limits=Object.create(real.boundaries.limits);
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:limits}),
      /plain object|own data/i,"inherited numerical bounds");
    const guards=clone(real);
    guards.boundaries.configuredGuards=Object.create(real.boundaries.configuredGuards);
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:guards}),
      /plain object|own data/i,"inherited configured guards");
    const zeroBranch=clone(real);
    zeroBranch.resistorResults[0]=Object.create(real.resistorResults[0]);
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:zeroBranch}),
      /ID thiếu\/trùng|plain object|own data/i,"zero-V inherited zero current/power");
  });

  check("reject-accessor-missing-fields-and-symbols-in-provenance",()=>{
    const input=declared();
    const real=solveRaw(input);
    const accessor=clone(real);
    Object.defineProperty(accessor,"calculated",{enumerable:true,get:()=>true});
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:accessor}),
      /own data/i,"accessor analysis status");
    const missing=clone(real);
    delete missing.resistorResults[0].measured;
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:missing}),
      /own data|thiếu/i,"missing own measured flag");
    const symbol=clone(real);
    symbol.boundaries[Symbol("hidden")]=true;
    expectThrow(()=>verifyResistiveBranchAnalysis({declared:input,analysis:symbol}),
      /field không được hỗ trợ/i,"symbol boundary key");
  });

  check("null-prototype-owned-declared-values-are-allowed",()=>{
    const input=Object.assign(Object.create(null),declared());
    const result=solveResistiveBranchStudy(input);
    assert(result.verified?.topology==="r1-series-r2-parallel-r3", "own values in null-prototype record");
  });

  return Object.freeze({
    total:checks.length,
    passed:checks.length,
    checks:Object.freeze(checks),
  });
}
