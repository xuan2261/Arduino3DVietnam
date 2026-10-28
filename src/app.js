import { lessons, lessonById, defaultControls, validateLessons, NOTES } from "./lessons.js";
import { simulate, advanceToggleState } from "./simulator.js";
import { readProgress, saveProgress, normalizeProgress, exportProgress } from "./storage.js";

const $ = id => document.getElementById(id);
const safe = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
})[c]);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const pad = n => String(n).padStart(2, "0");
const state = {
  lessonId: 1, controls: {}, memory: {}, running: false,
  elapsedMs: 0, previousTime: 0, frame: 0, lastLogTime: 0,
  previousSignature: "", progress: readProgress(), quizSolved: false,
  infoTab: "overview", stageTab: "3d", scene: null, code: "",
  serial: [], audio: null, audioTone: null
};

function currentLesson() { return lessonById(state.lessonId); }
function updateCounter() {
  const count=state.progress.completed.length;
  $("sidebarCounter").textContent=`${count}/16`;
  $("sidebarProgress").style.width=`${count/16*100}%`;
  $("progressText").textContent=`${count}/16 bài đã hoàn thành`;
}
function renderLessonList() {
  const query=$("lessonSearch").value.trim().toLocaleLowerCase("vi");
  const found=lessons.filter(x=>`${x.title} ${x.category} ${x.description}`.toLocaleLowerCase("vi").includes(query));
  const container=$("lessonList");container.replaceChildren();
  if(!found.length){container.append(el("p","no-results","Không tìm thấy bài phù hợp. Hãy thử một từ khóa khác."));return;}
  for(const lesson of found) {
    const entry=el("button","lesson-link");
    entry.type="button";entry.dataset.lesson=String(lesson.id);
    entry.setAttribute("aria-current",lesson.id===state.lessonId?"page":"false");
    const no=el("span","lesson-num",pad(lesson.id));
    const copy=el("span","lesson-link-copy");
    copy.append(el("strong","",lesson.title),el("small","",`${lesson.minutes} phút · ${lesson.level}`));
    entry.append(no,copy);
    if(state.progress.completed.includes(lesson.id))entry.append(el("span","done-mark","✓"));
    container.append(entry);
  }
  updateCounter();
}
function renderHeading(lesson) {
  $("lessonCategory").textContent=lesson.category;
  $("lessonTitle").textContent=lesson.title;
  $("lessonDescription").textContent=lesson.description;
  $("lessonDuration").textContent=`◷ ${lesson.minutes} phút`;
  $("lessonDifficulty").textContent=lesson.level;
  $("breadcrumb").textContent=`Bài ${pad(lesson.id)}`;
  $("previousLesson").disabled=lesson.id===1;
  $("nextLesson").disabled=lesson.id===16;
  document.title=`${lesson.title} — Arduino 3D Việt Nam`;
  $("sceneLabel").textContent=lesson.category.split("·").at(-1).trim();
}
function renderInfo() {
  const lesson=currentLesson();
  for(const tab of document.querySelectorAll("[data-info]")){
    tab.setAttribute("aria-selected",String(tab.dataset.info===state.infoTab));
  }
  const host=$("infoContent");
  if(state.infoTab==="overview"){
    host.innerHTML=`<div class="goal-box"><small>MỤC TIÊU CỦA BÀI</small><strong>${safe(lesson.goal)}</strong></div>
    <h3>Kiến thức cần nắm</h3><p>${safe(lesson.theory)}</p>
    <h3>Điều quan trọng</h3><p>${safe(lesson.insight)}</p>
    <h3>Linh kiện trong bài</h3><div class="part-chip-list">${lesson.components.map(x=>`<span class="part-chip">${safe(x)}</span>`).join("")}</div>`;
  }else if(state.infoTab==="pinout"){
    host.innerHTML=`<h3>Bảng kết nối chân và linh kiện</h3><p>Chọn tab “Sơ đồ kết nối” để xem tổng quan trực quan.</p>
    <table class="wire-table"><thead><tr><th>TỪ</th><th>ĐẾN</th><th>Ý NGHĨA</th></tr></thead><tbody>
    ${lesson.wiring.map(([a,b,c])=>`<tr><td>${safe(a)}</td><td>${safe(b)}</td><td>${safe(c)}</td></tr>`).join("")}
    </tbody></table>`;
  }else{
    host.innerHTML=`<div class="goal-box"><small>THỰC HÀNH CÓ HƯỚNG DẪN</small><strong>${safe(lesson.goal)}</strong></div>
    <h3>Thực hiện theo thứ tự</h3><ol>${lesson.steps.map(x=>`<li>${safe(x)}</li>`).join("")}</ol>
    <h3>Lưu ý kỹ thuật</h3><p>${safe(lesson.caution)}</p>`;
  }
  $("safetyNote").textContent=lesson.caution;
}
function renderStage() {
  for(const tab of document.querySelectorAll("[data-stage]")){
    tab.setAttribute("aria-selected",String(tab.dataset.stage===state.stageTab));
  }
  const viewport=$("viewport");
  viewport.querySelector(".wiring-view")?.remove();
  viewport.querySelector(".parts-view")?.remove();
  const sceneMount=$("sceneMount");
  sceneMount.hidden=state.stageTab!=="3d";
  $("cameraToolbar").hidden=state.stageTab!=="3d";
  const lesson=currentLesson();
  if(state.stageTab==="wiring"){
    const panel=el("div","wiring-view");
    panel.innerHTML=`<h3>Sơ đồ đấu nối của bài ${pad(lesson.id)}</h3><p>${safe(lesson.goal)}</p>
      <div class="wiring-diagram">${lesson.wiring.map(([from,to],i)=>
      `<div class="wire-route"><span class="wire-from">${safe(from)}</span><span class="wire-arrow">⟶</span><span class="wire-to">${safe(to)}</span></div>`).join("")}</div>`;
    viewport.append(panel);
  }else if(state.stageTab==="overview"){
    const panel=el("div","parts-view");
    panel.innerHTML=`<h3>Bộ linh kiện mô phỏng</h3><p>Các linh kiện của bài ${pad(lesson.id)} được dựng như hình minh họa, không thay thế sơ đồ kỹ thuật chi tiết.</p>
    <div class="part-chip-list parts-chips">${lesson.components.map(x=>`<span class="part-chip">${safe(x)}</span>`).join("")}</div>`;
    viewport.append(panel);
  }else state.scene?.resize();
}
function renderControls(){
  const lesson=currentLesson(),controls=$("experimentControls");
  controls.replaceChildren();
  for(const config of lesson.controls){
    if(config.type==="slider"){
      const wrap=el("div","control-field");
      const label=el("label","");label.htmlFor=`control-${config.key}`;
      label.append(el("span","",config.label),el("output","",`${state.controls[config.key]} ${config.unit}`.trim()));
      label.querySelector("output").htmlFor=`control-${config.key}`;
      const input=el("input","");
      input.type="range";input.id=`control-${config.key}`;input.dataset.control=config.key;
      Object.assign(input,{min:config.min,max:config.max,step:config.step,value:state.controls[config.key]});
      wrap.append(label,input);controls.append(wrap);
    }else if(config.type==="toggle"){
      const wrap=el("label","quiz-choice");wrap.style.minHeight="43px";
      const input=el("input","");input.type="checkbox";input.dataset.control=config.key;input.checked=!!state.controls[config.key];
      wrap.append(input,el("span","",config.label));controls.append(wrap);
    }else if(config.type==="select"){
      const wrap=el("div","control-field");
      const label=el("label","",config.label);label.htmlFor=`control-${config.key}`;
      const input=el("select","");input.id=label.htmlFor;input.dataset.control=config.key;
      for(const [value,title] of config.options){const option=el("option","",title);option.value=value;input.append(option);}
      input.value=state.controls[config.key];wrap.append(label,input);controls.append(wrap);
    }else if(config.type==="button"){
      const b=el("button","press-control",config.label);b.type="button";
      b.dataset.press=config.key;b.setAttribute("aria-pressed","false");controls.append(b);
    }else if(config.type==="piano"){
      const wrap=el("div","note-buttons");wrap.setAttribute("role","group");wrap.setAttribute("aria-label","Chọn nốt nhạc");
      for(const [title] of NOTES) {
        const b=el("button","note-button",title);b.type="button";b.dataset.note=title;
        b.setAttribute("aria-pressed",String(state.controls.note===title));wrap.append(b);
      }
      controls.append(wrap);
    }
  }
  $("experimentTitle").textContent=lesson.id===1?"Đèn L trên bo":lesson.controls.some(x=>x.type==="button")?"Tương tác trực tiếp":lesson.id===9?"Chọn nốt để thử":"Điều chỉnh thông số";
  $("experimentHint").textContent=lesson.id===3||lesson.id===16?"Nhấn và giữ nút; nếu dùng bàn phím, giữ phím Space.":"Thay đổi tham số trước hoặc trong khi mô phỏng.";
}
function highlightArduino(code) {
  const escaped=safe(code);
  const parts=escaped.split(/(\/\/[^\n]*|\b(?:void|const|int|float|bool|unsigned|long|for|if|else|true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)\b|\b\d+(?:\.\d+)?\b|\b(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|noTone|delay|delayMicroseconds|pulseIn|Serial|begin|println|map|setup|loop|write|attach)\b)/g);
  return parts.map(p=>{
    if(p.startsWith("//")) return `<span class="token-comment">${p}</span>`;
    if(/^(?:void|const|int|float|bool|unsigned|long|for|if|else|true|false|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP)$/.test(p))return `<span class="token-key">${p}</span>`;
    if(/^\d+(?:\.\d+)?$/.test(p))return `<span class="token-num">${p}</span>`;
    if(/^(?:pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|noTone|delay|delayMicroseconds|pulseIn|Serial|begin|println|map|setup|loop|write|attach)$/.test(p))return `<span class="token-function">${p}</span>`;
    return p;
  }).join("");
}
function renderSketch(){
  state.code=currentLesson().sketch;
  $("codeFilename").textContent=`bai_${pad(state.lessonId)}.ino`;
  $("codeViewer").innerHTML=`<code>${highlightArduino(state.code)}</code>`;
}
function renderQuiz(){
  state.quizSolved=false;
  const lesson=currentLesson();
  $("quizQuestion").textContent=lesson.quiz.question;
  const host=$("quizChoices");host.replaceChildren();
  lesson.quiz.choices.forEach((choice,index)=>{
    const label=el("label","quiz-choice");
    const input=el("input","");input.type="radio";input.name="quizAnswer";input.value=String(index);
    label.append(input,el("span","",choice));host.append(label);
  });
  $("quizFeedback").replaceChildren();$("quizFeedback").removeAttribute("data-result");
  $("completeButton").hidden=true;
  $("completeButton").disabled=false;
  $("completeButton").textContent="✓ Xác nhận hoàn thành bài học";
  if(state.progress.completed.includes(lesson.id)) {
    $("completeButton").hidden=false;$("completeButton").disabled=true;
    $("completeButton").textContent="✓ Đã hoàn thành bài học này";
  }
}
function stopClock() {
  state.running=false;
  if(state.frame)cancelAnimationFrame(state.frame);
  state.frame=0;state.previousTime=0;stopAudio();
}
function log(message){
  state.serial.push({time:new Date().toLocaleTimeString("vi-VN",{hour12:false}),message:String(message)});
  if(state.serial.length>24) state.serial.shift();
  const host=$("serialConsole");host.replaceChildren();
  for(const entry of state.serial) host.append(el("p","",`[${entry.time}] ${entry.message}`));
  host.scrollTop=host.scrollHeight;
}
function updateSnapshot(force=false) {
  const snapshot=simulate(state.lessonId,state.controls,state.elapsedMs,state.running,state.memory);
  const signature=JSON.stringify(snapshot);
  if(!force&&state.previousSignature===signature)return;
  state.previousSignature=signature;
  $("simOutput").textContent=`${snapshot.value} · ${snapshot.status}`;
  $("runStatus").classList.toggle("is-running",state.running);
  $("runStatus").innerHTML=`<i aria-hidden="true"></i> ${state.running ? "Đang chạy" : "Đang dừng"}`;
  $("runButton").innerHTML=state.running?'Ⅱ <span>Tạm dừng</span>':'▶ <span>Chạy mô phỏng</span>';
  $("runButton").classList.toggle("is-running",state.running);
  state.scene?.update(snapshot);
  return snapshot;
}
function tick(now) {
  if(!state.running)return;
  const dt=state.previousTime?Math.max(0,Math.min(120,now-state.previousTime)):0;
  state.previousTime=now;
  state.elapsedMs+=dt;
  const snap=updateSnapshot();
  if(state.elapsedMs-state.lastLogTime>=1100) {
    state.lastLogTime=state.elapsedMs;
    log((snap || simulate(state.lessonId,state.controls,state.elapsedMs,state.running,state.memory)).serial);
  }
  state.frame=requestAnimationFrame(tick);
}
function startPause(){
  if(state.running) {
    stopClock();log("Đã tạm dừng mô phỏng.");updateSnapshot(true);
  }else {
    state.running=true;state.previousTime=0;state.lastLogTime=state.elapsedMs;
    log(`Bắt đầu bài ${pad(state.lessonId)}: ${currentLesson().title}`);
    const snap=updateSnapshot(true);log(snap.serial);
    state.frame=requestAnimationFrame(tick);
  }
}
function resetSimulation() {
  stopClock();state.controls=defaultControls(currentLesson());state.memory={};
  state.elapsedMs=0;state.lastLogTime=0;state.previousSignature="";
  renderControls();updateSnapshot(true);log("Đã đưa mô phỏng về trạng thái ban đầu.");
}
function setLesson(id,replaceHash=true){
  const lesson=lessonById(id);
  if(!lesson)return;
  stopClock();
  state.lessonId=lesson.id;state.elapsedMs=0;state.lastLogTime=0;state.controls=defaultControls(lesson);
  state.memory={};state.serial=[];state.previousSignature="";state.infoTab="overview";state.stageTab="3d";
  renderHeading(lesson);renderLessonList();renderInfo();renderControls();renderStage();renderSketch();renderQuiz();
  state.scene?.setLesson(lesson);
  updateSnapshot(true);
  log("Đã tải bài học. Chọn Chạy mô phỏng để bắt đầu.");
  if(replaceHash) history.replaceState(null,"",`#bai-${pad(lesson.id)}`);
  document.querySelector(".lesson-link[aria-current='page']")?.scrollIntoView?.({block:"nearest"});
}
function onControlsInput(event){
  const target=event.target;
  if(!target.dataset.control)return;
  const key=target.dataset.control;
  const config=currentLesson().controls.find(c=>c.key===key);
  if(!config)return;
  if(config.type==="slider"){
    const value=Math.max(config.min,Math.min(config.max,Number(target.value)));
    state.controls[key]=value;
    target.closest(".control-field")?.querySelector("output")?.replaceChildren(document.createTextNode(`${value} ${config.unit}`.trim()));
  }else if(config.type==="toggle")state.controls[key]=target.checked;
  else if(config.type==="select"){
    state.controls[key]=target.value;
    if(key==="buttonMode")state.memory={};
  }
  const snap=updateSnapshot(true);
  if(state.running&&event.type==="change")log(snap.serial);
}
function setButtonPress(pressed){
  if(state.lessonId!==3&&state.lessonId!==16)return;
  if(!!state.controls.pressed===pressed)return;
  state.controls.pressed=pressed;
  if(pressed&&state.lessonId===3&&state.running){
    state.memory=advanceToggleState(state.memory,state.controls.buttonMode,performance.now());
  }
  const button=$("experimentControls").querySelector("[data-press]");
  button?.classList.toggle("is-pressed",pressed);
  button?.setAttribute("aria-pressed",String(pressed));
  const snap=updateSnapshot(true);
  if(state.running)log(snap.serial);
}
function playNote(hz){
  if(!state.running||!hz)return;
  try{
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context)return;
    state.audio=state.audio||new Context();
    if(state.audio.state==="suspended")state.audio.resume().catch(()=>{});
    const osc=state.audio.createOscillator(),gain=state.audio.createGain();
    osc.type="sine";osc.frequency.value=hz;gain.gain.setValueAtTime(0.0001,state.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.045,state.audio.currentTime+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,state.audio.currentTime+.25);
    osc.connect(gain);gain.connect(state.audio.destination);
    osc.start();osc.stop(state.audio.currentTime+.27);
  }catch{ /* Audio is optional; visual and serial feedback remain usable. */ }
}
function stopAudio(){
  // Individual piano notes are short-lived; suspend context between runs.
  try{state.audio?.suspend?.();}catch{}
}
function onQuizSubmit(event){
  event.preventDefault();
  const selected=new FormData(event.currentTarget).get("quizAnswer");
  const feedback=$("quizFeedback");
  if(selected===null){feedback.textContent="Hãy chọn một đáp án trước khi kiểm tra.";feedback.dataset.result="retry";return;}
  const correct=Number(selected)===currentLesson().quiz.answer;
  state.quizSolved=correct;
  feedback.dataset.result=correct?"success":"retry";
  feedback.textContent=correct ? `Chính xác! ${currentLesson().quiz.explanation} Hãy xác nhận hoàn thành bài học khi bạn đã thực hành.` :
    "Chưa chính xác. Hãy đọc lại phần Tổng quan và thử một lần nữa.";
  if(correct)$("completeButton").hidden=false;
}
function markCompleted(){
  if(!state.quizSolved||state.progress.completed.includes(state.lessonId))return;
  state.progress.completed.push(state.lessonId);
  state.progress=normalizeProgress(state.progress);
  const saved=saveProgress(state.progress);
  renderLessonList();
  $("completeButton").textContent="✓ Đã hoàn thành bài học này";
  $("completeButton").disabled=true;
  $("quizFeedback").dataset.result="success";
  $("quizFeedback").textContent=saved?
    "Đã ghi nhận hoàn thành. Tiến độ được lưu trên thiết bị này." :
    "Đã ghi nhận trong phiên này; trình duyệt không cho phép lưu tiến độ lâu dài. Hãy xuất bản sao JSON.";
}
function closeSidebar() {
  $("sidebar").classList.remove("is-open");$("sidebarBackdrop").hidden=true;
  $("openSidebar").setAttribute("aria-expanded","false");
}
function onHashChange(){
  const match=location.hash.match(/^#bai-(\d{1,2})$/);
  if(match&&Number(match[1])!==state.lessonId) setLesson(Number(match[1]),false);
}
function wireEvents(){
  $("lessonSearch").addEventListener("input",renderLessonList);
  $("lessonList").addEventListener("click",event=>{
    const b=event.target.closest("[data-lesson]");
    if(b){setLesson(Number(b.dataset.lesson));closeSidebar();window.scrollTo({top:0,behavior:"auto"});}
  });
  $("previousLesson").addEventListener("click",()=>setLesson(state.lessonId-1));
  $("nextLesson").addEventListener("click",()=>setLesson(state.lessonId+1));
  window.addEventListener("hashchange",onHashChange);
  document.querySelector(".stage-tabs").addEventListener("click",event=>{
    const tab=event.target.closest("[data-stage]");
    if(tab){state.stageTab=tab.dataset.stage;renderStage();}
  });
  document.querySelector(".info-tabs").addEventListener("click",event=>{
    const tab=event.target.closest("[data-info]");
    if(tab){state.infoTab=tab.dataset.info;renderInfo();}
  });
  $("experimentControls").addEventListener("input",onControlsInput);
  $("experimentControls").addEventListener("change",onControlsInput);
  const exp=$("experimentControls");
  exp.addEventListener("pointerdown",event=>{if(event.target.closest("[data-press]"))setButtonPress(true);});
  window.addEventListener("pointerup",()=>setButtonPress(false));
  window.addEventListener("pointercancel",()=>setButtonPress(false));
  exp.addEventListener("keydown",event=>{
    if(event.target.closest("[data-press]") && (event.key===" "||event.key==="Enter")){
      event.preventDefault();if(!event.repeat)setButtonPress(true);
    }
  });
  exp.addEventListener("keyup",event=>{
    if(event.target.closest("[data-press]")&&(event.key===" "||event.key==="Enter")){event.preventDefault();setButtonPress(false);}
  });
  exp.addEventListener("click",event=>{
    const note=event.target.closest("[data-note]");
    if(!note)return;
    state.controls.note=note.dataset.note;
    for(const b of exp.querySelectorAll("[data-note]")) b.setAttribute("aria-pressed",String(b.dataset.note===state.controls.note));
    const snap=updateSnapshot(true);
    if(state.running){log(snap.serial);playNote(snap.toneHz);}
  });
  $("runButton").addEventListener("click",startPause);
  $("resetButton").addEventListener("click",resetSimulation);
  $("cameraToolbar").addEventListener("click",event=>{
    const b=event.target.closest("[data-camera]");if(b)state.scene?.control(b.dataset.camera);
  });
  $("clearSerial").addEventListener("click",()=>{state.serial=[];$("serialConsole").replaceChildren(el("p","","Đã xóa nhật ký."));});
  $("copyCode").addEventListener("click",async()=>{
    const button=$("copyCode"),original=button.textContent;
    try{
      if(!navigator.clipboard?.writeText) throw new Error("No clipboard API");
      await navigator.clipboard.writeText(state.code);
      button.textContent="✓ Đã sao chép";
    }catch{
      // No invented clipboard success on blocked or insecure contexts.
      button.textContent="Không thể sao chép tự động";
    }
    window.setTimeout(()=>button.textContent=original,1800);
  });
  $("quizForm").addEventListener("submit",onQuizSubmit);
  $("completeButton").addEventListener("click",markCompleted);
  $("exportProgress").addEventListener("click",()=>{
    const blob=new Blob([exportProgress(state.progress)],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="arduino-3d-viet-tien-do.json";
    document.body.append(a);a.click();a.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),500);
  });
  $("importProgress").addEventListener("click",()=>$("progressFile").click());
  $("progressFile").addEventListener("change",async event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try {
      if(file.size>15000) throw new Error("Tệp quá lớn");
      const json=JSON.parse(await file.text());
      state.progress=normalizeProgress(json);
      const saved=saveProgress(state.progress);
      renderLessonList();renderQuiz();
      alert(saved?"Đã nhập và lưu tiến độ thành công.":"Đã nhập tiến độ trong phiên này; lưu lâu dài không khả dụng.");
    }catch(error){alert("Không thể nhập tiến độ: "+(error?.message||"Dữ liệu không hợp lệ"));}
    event.target.value="";
  });
  $("openSidebar").addEventListener("click",()=>{
    const open=!$("sidebar").classList.contains("is-open");
    $("sidebar").classList.toggle("is-open",open);
    $("sidebarBackdrop").hidden=!open;$("openSidebar").setAttribute("aria-expanded",String(open));
  });
  $("closeSidebar").addEventListener("click",closeSidebar);
  $("sidebarBackdrop").addEventListener("click",closeSidebar);
  const help=$("helpDialog");
  $("helpButton").addEventListener("click",()=>help.showModal());
  $("closeHelp").addEventListener("click",()=>help.close());
  $("helpGotIt").addEventListener("click",()=>help.close());
  window.addEventListener("keydown",event=>{if(event.key==="Escape")closeSidebar();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&state.running)startPause();});
  window.addEventListener("beforeunload",()=>state.scene?.dispose());
}
async function init(){
  validateLessons();
  wireEvents();
  const hash=location.hash.match(/^#bai-(\d{1,2})$/);
  setLesson(hash && lessonById(Number(hash[1]))?Number(hash[1]):1);
  document.documentElement.dataset.ready="content";
  // The app and all controls remain usable when WebGL or the 3D module cannot load.
  try{
    const {mountScene}=await import("./scene3d.js");
    state.scene=mountScene($("sceneMount"),()=>{ $("simOutput").textContent="Arduino Uno R3 · chọn bài học để quan sát chân và linh kiện"; });
    state.scene.setLesson(currentLesson());
    updateSnapshot(true);
    document.documentElement.dataset.ready="3d";
  }catch(error){
    $("sceneMount").replaceChildren();
    const div=el("div","scene-fallback");
    div.innerHTML=`<div><strong>Không thể tải mô hình 3D</strong><p>${safe(error?.message||"Trình duyệt không hỗ trợ WebGL.")}</p><p>Bạn vẫn có thể sử dụng sơ đồ kết nối, bài học, điều khiển và bài kiểm tra.</p></div>`;
    $("sceneMount").append(div);
    document.documentElement.dataset.ready="fallback";
  }
}
init().catch(error=>{
  console.error("Không thể khởi tạo Arduino 3D Việt:",error);
  $("lessonList").replaceChildren(el("p","no-results","Không thể tải bài học. Hãy tải lại trang qua máy chủ HTTP."));
});
// Published sites can be revisited offline after their static assets are cached.
// Avoid caching during local development, so edited lessons remain fresh.
if ("serviceWorker" in navigator && location.protocol === "https:" &&
    !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error =>
      console.warn("Không thể bật chế độ offline:", error));
  });
}
