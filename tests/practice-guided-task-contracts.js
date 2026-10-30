/** Pure/native DOM boundaries for the 48-checkpoint ACTION -> DO -> CHECK card. */
import { lessons } from "../src/lessons.js";
import { createCircuit, createSampleCircuit, analyzeCircuit } from "../src/circuit-router.js";
import { inspectPracticeEvidence } from "../src/practice-evidence.js";
import {
  createPracticeStepAttemptSession,startPracticeStepAttempt,
  recordPracticeStepAttemptEvent,checkPracticeStepAttempt,inspectPracticeStepAttempt,
} from "../src/practice-step-attempt.js";
import {
  buildPracticeGuidedTaskPlan,inspectPracticeGuidedTaskPlan,
  PRACTICE_GUIDED_TASK_EVENT_ACTIONS,
} from "../src/practice-guided-task.js";
import { renderPracticeGuidedTask } from "../src/practice-guided-task-ui.js";

function assert(value,message){if(!value)throw new Error(message);}
function throws(fn,message){let yes=false;try{fn();}catch{yes=true;}assert(yes,message);}

class FakeNode {
  constructor(tag){
    this.tagName=tag.toUpperCase();this.children=[];this.attributes=Object.create(null);
    this.listeners=Object.create(null);this.style={};this.className="";
    this.textContent="";this.disabled=false;this.type="";
  }
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  append(...items){this.children.push(...items);}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  click(){if(!this.disabled)for(const fn of this.listeners.click??[])fn({type:"click"});}
}
class FakeDocument {createElement(tag){return new FakeNode(tag);}}
function descendants(node){return [node,...node.children.flatMap(descendants)];}

function context(lesson,stepIndex){
  const circuit=lesson.id===1?null:createCircuit(lesson.id);
  const evidence=inspectPracticeEvidence({
    lesson,stepIndex,circuit,referenceCircuit:circuit?createSampleCircuit(lesson.id):null,
    analysis:circuit?analyzeCircuit(lesson.id,circuit):null,hasLearnerDraft:false,
  });
  const input={lesson,stepIndex};
  const session=createPracticeStepAttemptSession();
  const inspect=s=>inspectPracticeStepAttempt(s,input);
  const plan=s=>buildPracticeGuidedTaskPlan({lesson,stepIndex,attemptSnapshot:inspect(s),evidence});
  return {lesson,stepIndex,input,evidence,session,inspect,plan};
}

export async function runPracticeGuidedTaskContracts(){
  const checks=[];
  const check=(name,condition)=>{
    assert(condition,name);
    checks.push(name);
  };
  const fixtures=lessons.flatMap(lesson=>[0,1,2].map(stepIndex=>context(lesson,stepIndex)));
  const idle=fixtures.map(f=>f.plan(f.session));
  check("all-48-canonical-checkpoints-have-current-idle-start-action",
    fixtures.length===48&&idle.length===48&&idle.every((plan,index)=>
      plan.action.id==="start"&&plan.lessonId===fixtures[index].lesson.id&&
      plan.stepIndex===fixtures[index].stepIndex&&
      plan.checkpointId===`lesson-${String(plan.lessonId).padStart(2,"0")}-step-${String(plan.stepIndex+1).padStart(2,"0")}`&&
      plan.sourceStep===fixtures[index].lesson.steps[plan.stepIndex]));
  check("preserves-36-manual-and-12-wiring-authored-checkpoints",
    idle.filter(x=>x.checkpointKind==="manual").length===36&&
    idle.filter(x=>x.checkpointKind==="wiring").length===12);
  check("all-48-plans-carry-frozen-nonauthoritative-claims",
    idle.every(plan=>Object.isFrozen(plan)&&Object.isFrozen(plan.action)&&
      Object.isFrozen(plan.expectedEventTypes)&&Object.isFrozen(plan.claims)&&
      plan.claims.mastery===false&&plan.claims.autoCompletion===false&&
      plan.claims.teacherValidated===false&&plan.claims.physicalVerified===false&&
      plan.claims.electricalAuthority===false));

  const started=fixtures.map(f=>startPracticeStepAttempt(f.session,f.input));
  const active=fixtures.map((f,i)=>f.plan(started[i]));
  const none=active.filter(plan=>plan.expectedEventTypes.length===0);
  check("five-no-observable-event-steps-are-neutral-self-review",
    none.length===5&&none.every(plan=>plan.action.id==="self-review")&&
    [[4,2],[7,2],[9,0],[9,2],[11,0]].every(([id,index])=>
      none.some(plan=>plan.lessonId===id&&plan.stepIndex===index)));
  check("all-seven-observable-event-categories-map-to-existing-safe-ui-intents",
    Object.keys(PRACTICE_GUIDED_TASK_EVENT_ACTIONS).length===7&&
    ["view-3d","view-wiring","view-pinout","change-control","start-simulation","edit-sketch","connect-wire"]
      .every(event=>PRACTICE_GUIDED_TASK_EVENT_ACTIONS[event]?.eventType===event)&&
    active.every(plan=>plan.action.id==="self-review"||
      PRACTICE_GUIDED_TASK_EVENT_ACTIONS[plan.expectedEventTypes[0]]?.id===plan.action.id));
  check("lessons-10-and-14-keep-signal-only-boundaries",
    active.filter(plan=>[10,14].includes(plan.lessonId)).every(plan=>
      plan.lessonScope==="signal-only"&&plan.claims.physicalVerified===false));

  let allComplete=0,allPartial=0;
  for(let i=0;i<fixtures.length;i++){
    const fixture=fixtures[i],expected=active[i].expectedEventTypes;
    let session=started[i];
    if(expected.length){
      for(const eventType of expected){
        session=recordPracticeStepAttemptEvent(session,{
          ...fixture.input,attemptToken:session.active.token,eventType,
        });
      }
      const plan=fixture.plan(session);
      assert(plan.action.id==="focus-check","actual expected events must show Check CTA");
      const checked=checkPracticeStepAttempt(session,{
        ...fixture.input,attemptToken:session.active.token,
      });
      const reviewed=fixture.plan(checked);
      assert(reviewed.action.id===(fixture.stepIndex<2?"focus-next":"self-review"),
        "category-complete review may only focus Next for a second explicit action, not navigate");
      allComplete++;
      const partial=checkPracticeStepAttempt(started[i],{
        ...fixture.input,attemptToken:started[i].active.token,
      });
      assert(fixture.plan(partial).action.id==="focus-retry",
        "unchecked expectation must never yield a false pass");
      allPartial++;
    }else{
      const checked=checkPracticeStepAttempt(started[i],{
        ...fixture.input,attemptToken:started[i].active.token,
      });
      assert(fixture.plan(checked).action.id==="self-review",
        "no expectation must remain self-review after Check");
    }
  }
  check("real-current-step-events-change-CTA-only-after-host-reported-action",
    allComplete===43&&allPartial===43);
  check("checked-incomplete-or-no-event-never-upgrades-to-next",
    allPartial===43&&none.length===5);

  const sample=fixtures[1],samplePlan=sample.plan(sample.session);
  throws(()=>buildPracticeGuidedTaskPlan({...sample.input,
    attemptSnapshot:sample.inspect(sample.session),
    evidence:fixtures[2].evidence}),"foreign evidence must reject");
  check("stale-evidence-checkpoint-fails-closed",true);
  const forgedEvidence=Object.freeze({...sample.evidence,status:"topology-match"});
  throws(()=>buildPracticeGuidedTaskPlan({
    ...sample.input,attemptSnapshot:sample.inspect(sample.session),evidence:forgedEvidence,
  }),"frozen forged circuit evidence must reject");
  let getterCalls=0;
  const nested=Object.freeze(Object.defineProperty({},"id",{
    enumerable:true,get(){getterCalls++;return samplePlan.checkpointId;},
  }));
  const accessorEvidence=Object.freeze({...sample.evidence,checkpoint:nested});
  throws(()=>buildPracticeGuidedTaskPlan({
    ...sample.input,attemptSnapshot:sample.inspect(sample.session),evidence:accessorEvidence,
  }),"getter-bearing nested checkpoint must be rejected before getter access");
  check("forged-evidence-status-and-nested-accessors-rejected-before-read",
    getterCalls===0);
  throws(()=>buildPracticeGuidedTaskPlan({
    lesson:sample.lesson,stepIndex:2,
    attemptSnapshot:sample.inspect(sample.session),evidence:sample.evidence,
  }),"stale step snapshot must reject");
  check("stale-step-attempt-identity-fails-closed",true);
  const validSession=startPracticeStepAttempt(sample.session,sample.input);
  const legitimateSnapshot=inspectPracticeStepAttempt(validSession,sample.input);
  const forgedAttempt=Object.freeze({...legitimateSnapshot});
  throws(()=>buildPracticeGuidedTaskPlan({
    ...sample.input,attemptSnapshot:forgedAttempt,evidence:sample.evidence,
  }),"structurally exact active snapshot must require branded provenance");
  const validChecked=checkPracticeStepAttempt(validSession,{
    ...sample.input,attemptToken:validSession.active.token,
  });
  const forgedChecked=Object.freeze({...inspectPracticeStepAttempt(validChecked,sample.input)});
  throws(()=>buildPracticeGuidedTaskPlan({
    ...sample.input,attemptSnapshot:forgedChecked,evidence:sample.evidence,
  }),"structurally exact checked snapshot must require branded provenance");
  check("forged-active-and-checked-attempt-snapshots-never-mint-next",true);
  const forged=Object.freeze({...samplePlan,lessonId:16});
  throws(()=>inspectPracticeGuidedTaskPlan(forged),"forged plain object cannot impersonate plan");
  check("plan-brand-rejects-forged-and-prototype-variants",true);
  const getter=Object.create(null);
  Object.defineProperty(getter,"lesson",{enumerable:true,get(){throw new Error("getter executed");}});
  throws(()=>buildPracticeGuidedTaskPlan(getter),"getter input must reject");
  check("input-getters-and-unknown-shapes-rejected-before-execution",true);

  let actions=[];
  const root=renderPracticeGuidedTask(new FakeDocument(),samplePlan,{
    onAction:request=>{actions.push(request);return true;},
  });
  const buttons=descendants(root).filter(x=>x.tagName==="BUTTON");
  check("dom-renders-one-native-enabled-44px-cta-with-current-step-aria",
    buttons.length===1&&buttons[0].type==="button"&&
    buttons[0].style.minHeight==="44px"&&!buttons[0].disabled&&
    root.getAttribute("data-practice-guided-task")===""&&
    root.getAttribute("data-guided-task-checkpoint")==samplePlan.checkpointId&&
    buttons[0].getAttribute("data-guided-task-action")==="start"&&
    root.getAttribute("aria-label")?.includes("bài 1 bước 2"));
  check("dom-callback-is-explicit-and-frozen-current-authored-context",
    actions.length===0&&(()=>{buttons[0].click();return actions.length===1&&
      Object.isFrozen(actions[0])&&actions[0].lessonId===samplePlan.lessonId&&
      actions[0].stepIndex===samplePlan.stepIndex&&
      actions[0].checkpointId===samplePlan.checkpointId&&actions[0].actionId==="start";})());
  const noCallback=renderPracticeGuidedTask(new FakeDocument(),samplePlan,{});
  const disabled=descendants(noCallback).filter(x=>x.tagName==="BUTTON");
  check("missing-dom-action-callback-disables-native-cta",
    disabled.length===1&&disabled[0].disabled===true);
  throws(()=>renderPracticeGuidedTask(new FakeDocument(),forged,{onAction:()=>{}}),
    "forged view must reject");
  check("dom-rejects-forged-plan-before-rendering-callback",true);
  throws(()=>renderPracticeGuidedTask(new FakeDocument(),samplePlan,
    Object.defineProperty({},"onAction",{get(){throw new Error("getter callback");}})),
    "getters must be rejected without evaluation");
  check("dom-rejects-callback-accessor-and-never-needs-innerHTML",true);
  return Object.freeze({total:checks.length,passed:checks.length,failed:0,
    checks:Object.freeze(checks)});
}
