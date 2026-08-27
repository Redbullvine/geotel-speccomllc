import { v2Api } from "./v2Api.js";
const $ = (id) => document.getElementById(id);
const sections = { poles:"Poles / Locations", staking:"Staking Sheets", fiber:"Fiber / Splicing", readings:"Test Readings", photos:"Photos", notes:"Notes & Tasks" };
$("gatewayForm").addEventListener("submit", async (event) => { event.preventDefault(); $("gatewayMessage").textContent=""; try { await v2Api.post("project-gateway", { projectCode: $("projectCode").value }); $("gateway").hidden=true; $("workspace").hidden=false; } catch { $("gatewayMessage").textContent="Project ID not found."; } });
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => open(button.dataset.view)));
$("back").onclick=()=>{ $("detail").hidden=true; $("home").hidden=false; };
$("exit").onclick=async()=>{ await fetch("/api/project-exit",{method:"POST",credentials:"same-origin"}); $("workspace").hidden=true; $("gateway").hidden=false; $("projectCode").value=""; };
async function open(view){ $("home").hidden=true; $("detail").hidden=false; $("title").textContent=sections[view]; $("content").innerHTML='<p>Loading field data…</p>'; try { const data=await v2Api.get(`v2-pilot-${view}`); $("content").innerHTML=render(view,data); } catch { $("content").innerHTML='<p class="card">This pilot module is not available until the isolated Node 54 data set is loaded.</p>'; } }
function render(view,data){ const rows=data?.items||[]; if(!rows.length)return '<p class="card">No field records yet.</p>'; return rows.map((row)=>`<article class="card"><strong>${escape(row.name||row.title||"Field record")}</strong><p>${escape(row.summary||row.status||"")}</p>${view==="poles"?'<button>Open Pole</button>':''}</article>`).join(""); }
function escape(v){const e=document.createElement("span");e.textContent=v;return e.innerHTML;}
