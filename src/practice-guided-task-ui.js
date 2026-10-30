/** Native, keyboard-operable primary CTA for one authored current checkpoint. */
import { inspectPracticeGuidedTaskPlan } from "./practice-guided-task.js";

function node(doc,tag,className,text){
  const element=doc.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=text;
  return element;
}

export function renderPracticeGuidedTask(doc,plan,options={}){
  if(!doc||typeof doc.createElement!=="function"){
    throw new TypeError("Guided task UI cần DOM document.");
  }
  const model=inspectPracticeGuidedTaskPlan(plan);
  if(!options||typeof options!=="object"||Array.isArray(options)||
     Object.getPrototypeOf(options)!==Object.prototype){
    throw new TypeError("Guided task options phải là plain object.");
  }
  const keys=Reflect.ownKeys(options);
  if(keys.some(key=>key!=="onAction")){
    throw new RangeError("Guided task UI không nhận callback ngoài onAction.");
  }
  const descriptor=Object.getOwnPropertyDescriptor(options,"onAction");
  if(descriptor&&!("value" in descriptor)){
    throw new TypeError("Guided task onAction không được là getter.");
  }
  const callback=descriptor?.value??null;
  if(callback!==null&&typeof callback!=="function"){
    throw new TypeError("Guided task onAction phải là function hoặc null.");
  }

  const section=node(doc,"section","practice-guided-task");
  section.setAttribute("data-practice-guided-task","");
  section.setAttribute("data-guided-task-lesson",String(model.lessonId));
  section.setAttribute("data-guided-task-step",String(model.stepIndex));
  section.setAttribute("data-guided-task-checkpoint",model.checkpointId);
  section.setAttribute("data-guided-task-current-action",model.action.id);
  section.setAttribute("role","group");
  section.setAttribute("aria-label",`Hành động tiếp theo · bài ${model.lessonId} bước ${model.stepIndex+1}`);
  section.append(
    node(doc,"h5","practice-guided-task-heading","Hành động tiếp theo trong bước này"),
    node(doc,"p","practice-guided-task-source",`BƯỚC ${model.stepIndex+1}/3 · ${model.sourceStep}`),
    node(doc,"p","practice-guided-task-guidance",model.guidance),
  );
  const status=node(doc,"p","practice-guided-task-status",
    model.attemptState==="idle"
      ?"Chưa bắt đầu lượt thực hành. Cần chủ động Bắt đầu trước khi ứng dụng ghi nhận thao tác của bước."
      :model.attemptState==="checked"
        ?"Đã Check lượt hiện tại; đây chỉ là đối chiếu tương tác trong ứng dụng, không phải đạt bài."
        :"Lượt thực hành đang mở. Hãy làm thao tác thật rồi chủ động Check.");
  status.setAttribute("data-guided-task-status","");
  status.setAttribute("role","status");
  status.setAttribute("aria-live","polite");
  section.append(status);
  if(model.expectedEventTypes.length===0){
    section.append(node(doc,"p","practice-guided-task-self-review",
      "Bước này không có category tương tác quan sát được theo biên tập; chỉ tự đối chiếu, không có đánh giá đạt/rớt."));
  }
  const button=node(doc,"button","practice-guided-task-action",model.action.label);
  button.type="button";
  button.setAttribute("data-guided-task-action",model.action.id);
  button.setAttribute("aria-label",`${model.action.label} · bài ${model.lessonId} bước ${model.stepIndex+1}`);
  button.style.minHeight="44px";
  button.disabled=callback===null;
  if(callback){
    button.addEventListener("click",()=>{
      const context=Object.freeze({
        lessonId:model.lessonId,stepIndex:model.stepIndex,
        checkpointId:model.checkpointId,actionId:model.action.id,
      });
      try{
        if(callback(context)===false){
          status.textContent="Hành động không còn phù hợp với bước hiện tại; hãy mở lại tab Thực hành.";
        }
      }catch{
        status.textContent="Không thể mở hành động; thử chọn lại bước Thực hành hiện tại.";
      }
    });
  }
  section.append(button,node(doc,"p","practice-guided-task-boundary",
    "Hướng dẫn chỉ mở công cụ hoặc đưa focus; không tự nối dây, đổi giá trị điều khiển, chạy Sketch, xác nhận phần cứng, chấm mastery hay hoàn thành bài."));
  return section;
}
