// Chạy trong browser: import("/tests/browser-contracts.js").then(m => m.runContracts())
import { lessons, lessonById, defaultControls, validateLessons, NOTES } from "../src/lessons.js";
import { simulate, advanceToggleState } from "../src/simulator.js";
import { normalizeProgress, exportProgress } from "../src/storage.js";

export function runContracts() {
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error("FAIL: " + name);
    results.push({ name, status: "PASS" });
  };
  check("curriculum-16", validateLessons() && lessons.length === 16);
  check("lesson-ids", lessons.every((x,i) => x.id === i+1 && lessonById(i+1) === x));
  check("lessons-Vietnamese", lessons.every(x => /[À-ỹà-ỹ]/u.test(x.title) && x.steps.length >= 3 && x.quiz.choices.length >= 3));
  for (const lesson of lessons) {
    const controls=defaultControls(lesson);
    const stopped=simulate(lesson.id,controls,0,false);
    const running=simulate(lesson.id,controls,0,true);
    check(`lesson-${lesson.id}-initial`,typeof stopped.status==="string" && typeof running.value==="string" && Array.isArray(running.pins));
    check(`lesson-${lesson.id}-no-virtual-energy`,!stopped.led && stopped.brightness===0 && stopped.toneHz===0 && !stopped.pump);
  }
  check("blink-HIGH",simulate(2,{interval:1000},0,true).led);
  check("blink-LOW",!simulate(2,{interval:1000},1000,true).led);
  check("blink-cycle",simulate(2,{interval:1000},2000,true).led);
  check("button-released",!simulate(3,{buttonMode:"hold",pressed:false},0,true).led);
  check("button-pressed",simulate(3,{buttonMode:"hold",pressed:true},0,true).led);
  check("button-toggle-edge",advanceToggleState({}, "toggle", 100).toggleLed === true);
  const toggled=advanceToggleState({}, "toggle", 100);
  check("button-debounce",advanceToggleState(toggled, "toggle", 115).toggleLed === true);
  check("button-new-edge",advanceToggleState(toggled, "toggle", 140).toggleLed === false);
  check("button-toggle-led",simulate(3,{buttonMode:"toggle",pressed:false},0,true,{toggleLed:true}).led);
  check("analog-min",simulate(4,{analog:0},0,true).brightness===0);
  check("analog-max",simulate(4,{analog:1023},0,true).brightness===1);
  check("rgb-red",simulate(5,{red:255,green:0,blue:0},0,true).rgb==="#ff0000");
  check("ldr-dark",simulate(6,{light:399},0,true).led);
  check("ldr-boundary",!simulate(6,{light:400},0,true).led);
  check("sonar-close",simulate(7,{distance:19},0,true).led);
  check("sonar-boundary",!simulate(7,{distance:20},0,true).led);
  check("buzzer-frequency",simulate(8,{frequency:440,sound:true},0,true).toneHz===440);
  check("piano-A4",NOTES.some(([note,hz])=>note==="La"&&hz===440)&&simulate(9,{note:"La"},0,true).toneHz===440);
  check("motor-stop",simulate(10,{motor:0,direction:"forward"},0,true).motorSpeed===0);
  check("motor-reverse",simulate(10,{motor:180,direction:"reverse"},0,true).motorDirection===-1);
  check("temp-threshold",!simulate(11,{temp:30},0,true).led&&simulate(11,{temp:31},0,true).led);
  check("servo-angle",simulate(12,{angle:165},0,true).angle===165);
  check("stepper-50",simulate(13,{steps:50},0,true).angle===90);
  check("plant-dry",simulate(14,{moisture:34},0,true).pump);
  check("plant-boundary",!simulate(14,{moisture:35},0,true).pump);
  check("force-strong",simulate(15,{force:700},0,true).led);
  check("force-boundary",!simulate(15,{force:650},0,true).led);
  check("project-dark",simulate(16,{light:300,temp:25,pressed:false},0,true).led);
  check("project-override",!simulate(16,{light:300,temp:25,pressed:true},0,true).led);
  check("project-independent-alert",simulate(16,{light:300,temp:40,pressed:true},0,true).toneHz===880);
  check("progress-unique-sort",JSON.stringify(normalizeProgress({schemaVersion:1,completed:[4,1,4,2]}).completed)==="[1,2,4]");
  check("progress-export",JSON.parse(exportProgress({schemaVersion:1,completed:[1]})).completed[0]===1);
  for(const invalid of [null,{}, {schemaVersion:2,completed:[]}, {schemaVersion:1,completed:[0]}, {schemaVersion:1,completed:[17]}, {schemaVersion:1,completed:["3"]}]) {
    let rejected=false;try{normalizeProgress(invalid);}catch{rejected=true;}
    check("progress-reject-"+JSON.stringify(invalid),rejected);
  }
  let rejected=false;try{simulate(99,{},0,true);}catch(e){rejected=e instanceof RangeError;}
  check("unknown-lesson-rejected",rejected);
  return { total: results.length, passed: results.length, failed: 0, results };
}
