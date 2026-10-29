/**
 * A declarative two-resistor divider UI over the bounded DC nodal solver.
 * User-supplied ideal values only; never reads lesson wiring or physical pins.
 */
import { solveResistiveDC } from "./dc-resistor-network.js";

const $=id=>document.getElementById(id);
const text=(tag,message)=>{
  const node=document.createElement(tag);
  node.textContent=String(message);
  return node;
};

export function mountResistiveStudy() {
  const supply=$("resistiveV");
  const r1=$("resistiveR1");
  const r2=$("resistiveR2");
  const solve=$("resistiveSolve");
  const result=$("resistiveResult");
  const details=$("resistiveDetails");
  if([supply,r1,r2,solve,result,details].some(node=>!node)){
    throw new Error("Resistive study thiếu điều khiển HTML bắt buộc.");
  }
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
    try {
      const v=numeric(supply,0,5,"Điện áp nguồn lý tưởng");
      const first=numeric(r1,1,1_000_000,"Điện trở R1 (Ω)");
      const second=numeric(r2,1,1_000_000,"Điện trở R2 (Ω)");
      const analysis=solveResistiveDC({
        ground:"GND",
        voltageNodes:[{node:"VCC",voltageVolts:v}],
        resistors:[
          {id:"R1",a:"VCC",b:"MID",ohms:first},
          {id:"R2",a:"MID",b:"GND",ohms:second},
        ],
      });
      last=analysis;
      details.replaceChildren();
      if(!analysis.supported||!analysis.calculated){
        const reason=analysis.issues?.map(issue=>issue.message).join("; ")||"Không giải được mạng trong giới hạn đã hỗ trợ.";
        result.dataset.result="error";
        result.textContent="Bộ giải từ chối: "+reason;
        return analysis;
      }
      result.dataset.result="calculated";
      result.textContent=`Tính xong mạng lý tưởng: V(MID) = ${analysis.nodeVoltages.MID.toLocaleString("vi-VN")} V. Nguồn do người học nhập; không phải số đo thực tế.`;
      const table=text("table","");
      table.className="resistive-study-table";
      const head=document.createElement("thead");
      const heading=document.createElement("tr");
      for(const name of ["Điện trở","Từ / đến","Giá trị (Ω)","Dòng (mA)","Công suất (mW)"])heading.append(text("th",name));
      head.append(heading);
      const body=document.createElement("tbody");
      for(const branch of analysis.resistorResults) {
        const tr=document.createElement("tr");
        for(const entry of [
          branch.id,
          branch.a+" → "+branch.b,
          branch.resistanceOhms.toLocaleString("vi-VN"),
          branch.currentMilliAmps.toLocaleString("vi-VN"),
          branch.powerMilliWatts.toLocaleString("vi-VN"),
        ])tr.append(text("td",entry));
        body.append(tr);
      }
      table.append(head,body);
      details.append(table,text("p","Nguồn: ideal-dc-resistor-model · VCC cố định, GND = 0 V, điện trở không phụ thuộc nhiệt độ. Không phải phần cứng Arduino."));
      return analysis;
    }catch(error) {
      last=null;
      details.replaceChildren();
      result.dataset.result="error";
      result.textContent="Đầu vào bị từ chối: "+(error?.message||"giá trị không hợp lệ")+". Không tính dòng/áp khi dữ liệu sai.";
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
