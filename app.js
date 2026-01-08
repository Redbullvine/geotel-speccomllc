import { isDemo, makeClient } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

const state = {
  client: null,
  session: null,
  user: null,
  profile: null, // {role, display_name}
  activeProject: null,
  activeNode: null,
  lastGPS: null,
  lastProof: null,
  usageEvents: [],
  projects: [],
  realtime: {
    usageChannel: null,
  },
  demo: {
    roles: ["TDS", "PRIME", "SUB", "SPLICER", "OWNER"],
    role: "SPLICER",
    nodes: {},
    invoices: [],
    usageEvents: [],
  },
};

function toast(title, body){
  $("toastTitle").textContent = title;
  $("toastBody").textContent = body;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 4200);
}

function nowISO(){ return new Date().toISOString(); }

function getRole(){
  return state.profile?.role || state.demo.role;
}

function getNodeUnits(node){
  const allowed = node.units_allowed ?? node.allowed_units ?? 0;
  const used = node.units_used ?? node.used_units ?? 0;
  return { allowed, used };
}

function computeNodeCompletion(node){
  // completion = (all splice locations complete) and (inventory checklist complete)
  const locs = node.splice_locations || [];
  const inv = node.inventory_checks || [];
  const locOk = locs.length > 0 && locs.every(l => l.completed);
  const invOk = inv.length > 0 && inv.every(i => i.completed);
  const pct = (locOk && invOk) ? 100 : (locOk || invOk) ? 60 : 15;
  return { locOk, invOk, pct };
}

function updateKPI(){
  const node = state.activeNode;
  if (!node){
    $("kpiNode").textContent = "None";
    $("kpiCompletion").textContent = "0%";
    $("kpiUnits").textContent = "0 / 0";
    $("chipStatus").innerHTML = '<span class="dot warn"></span><span>Waiting</span>';
    return;
  }

  $("kpiNode").textContent = node.node_number;
  const c = computeNodeCompletion(node);
  $("kpiCompletion").textContent = `${c.pct}%`;

  const units = getNodeUnits(node);
  $("kpiUnits").textContent = `${units.used} / ${units.allowed}`;

  // status chip
  const ratio = units.allowed > 0 ? (units.used / units.allowed) : 0;
  const dot = c.pct === 100 ? "ok" : ratio >= 0.9 ? "warn" : "warn";
  const label = c.pct === 100 ? "Ready" : "In progress";
  $("chipStatus").innerHTML = `<span class="dot ${dot}"></span><span>${label}</span>`;

  // unit alert
  if (units.allowed > 0){
    if (ratio >= 1.0){
      toast("Units exceeded", "Used units are over the allowed units. PRIME should review immediately.");
    } else if (ratio >= 0.9){
      toast("Units nearing limit", "Used units are above 90% of allowed. PRIME gets an alert.");
    }
  }
}

function setRoleUI(){
  const role = getRole();
  $("chipRole").innerHTML = `<span class="dot ok"></span><span>Role: ${role}</span>`;

  // Pricing visibility notice
  const pricingHidden = (role === "SPLICER");
  $("chipPricing").style.display = pricingHidden ? "inline-flex" : "inline-flex";
  $("chipPricing").innerHTML = pricingHidden
    ? `<span class="dot bad"></span><span>Pricing hidden (splicer view)</span>`
    : `<span class="dot ok"></span><span>Pricing protected by role</span>`;

  const seedBtn = $("btnSeedDemo");
  if (seedBtn){
    seedBtn.style.display = (!isDemo && canSeedDemo()) ? "" : "none";
  }
}

function showAuth(show){
  $("viewAuth").style.display = show ? "" : "none";
  $("viewApp").style.display = show ? "none" : "";
}

function setWhoami(){
  if (isDemo){
    $("whoami").textContent = `Demo -> ${state.demo.role}`;
    $("btnSignOut").style.display = "";
    return;
  }

  if (state.user){
    const role = state.profile?.role ? ` -> ${state.profile.role}` : "";
    $("whoami").textContent = `${state.user.email}${role}`;
    $("btnSignOut").style.display = "";
  } else {
    $("whoami").textContent = "Not signed in";
    $("btnSignOut").style.display = "none";
  }
}

function ensureDemoSeed(){
  if (Object.keys(state.demo.nodes).length) return;

  // One seeded node
  const node = {
    id: "demo-node-1",
    node_number: "NODE-1001",
    units_allowed: 120,
    units_used: 103,
    splice_locations: [
      { id:"loc-1", name:"Cabinet A - Tray 1", gps:null, photo:null, taken_at:null, completed:false },
      { id:"loc-2", name:"Pedestal 12B - Splice Case", gps:null, photo:null, taken_at:null, completed:false },
    ],
    inventory_checks: [
      { id:"inv-1", item_code:"HAFO(OFDC-B8G)", item_name:"TDS Millennium example", photo:"./assets/millennium_example.png", qty_used: 2, planned_qty: 12, completed:false },
      { id:"inv-2", item_code:"HxFO(1X2)PCOT(80/20)MO", item_name:"Splitter (example)", photo:"./assets/millennium_example.png", qty_used: 1, planned_qty: 6, completed:false },
    ],
    ready_for_billing: false,
  };
  state.demo.nodes[node.node_number] = node;

  state.demo.invoices = [
    { id:"inv-demo-1", node_number:"NODE-1001", from:"SUB", to:"PRIME", status:"Draft", amount_hidden:true },
  ];
}

function renderProjects(){
  const select = $("projectSelect");
  const meta = $("projectMeta");
  if (!select) return;
  select.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = "Select project";
  select.appendChild(opt);

  state.projects.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    select.appendChild(o);
  });

  if (state.activeProject){
    select.value = state.activeProject.id;
    if (meta){
      meta.textContent = state.activeProject.location ? `Location: ${state.activeProject.location}` : "";
    }
  } else if (meta){
    meta.textContent = "";
  }
}

async function loadProjects(){
  if (isDemo) return;
  const { data, error } = await state.client
    .from("projects")
    .select("id, name, location")
    .order("name");
  if (error){
    toast("Projects load error", error.message);
    return;
  }
  state.projects = data || [];
  if (state.activeProject){
    const match = state.projects.find(p => p.id === state.activeProject.id);
    state.activeProject = match || null;
  }
  renderProjects();
}

function setActiveProjectById(id){
  const next = state.projects.find(p => p.id === id) || null;
  state.activeProject = next;
  renderProjects();
}

function canSeedDemo(){
  const role = getRole();
  return role === "OWNER" || role === "PRIME";
}

async function seedDemoNode(){
  if (isDemo) return;
  if (!canSeedDemo()){
    toast("Not allowed", "Only Owner/PM can load the demo node.");
    return;
  }

  const projectName = "Ruidoso Fire Rebuild (Demo)";
  const projectLocation = "Ruidoso, NM";

  const { data: project, error: projectErr } = await state.client
    .from("projects")
    .upsert({ name: projectName, location: projectLocation }, { onConflict: "name" })
    .select("id, name, location")
    .maybeSingle();
  if (projectErr){
    toast("Project seed failed", projectErr.message);
    return;
  }

  const { data: node, error: nodeErr } = await state.client
    .from("nodes")
    .upsert({
      node_number: "NODE 11",
      project_id: project.id,
      allowed_units: 0,
      used_units: 0,
    }, { onConflict: "node_number" })
    .select("id, node_number, project_id")
    .maybeSingle();
  if (nodeErr){
    toast("Node seed failed", nodeErr.message);
    return;
  }

  const items = [
    { code: "HO-1", name: "HO-1", planned_qty: 362 },
    { code: "HO-2", name: "HO-2", planned_qty: 120 },
    { code: "HO-3", name: "HO-3", planned_qty: 85 },
    { code: "Drop/Bury", name: "Drop/Bury", planned_qty: 40 },
    { code: "Splice", name: "Splice", planned_qty: 60 },
  ];

  const { data: itemRows, error: itemErr } = await state.client
    .from("inventory_items")
    .upsert(
      items.map(i => ({ vendor_code: i.code, display_name: i.name })),
      { onConflict: "vendor_code" }
    )
    .select("id, vendor_code");
  if (itemErr){
    toast("Item seed failed", itemErr.message);
    return;
  }

  const itemMap = new Map((itemRows || []).map(r => [r.vendor_code, r.id]));
  const itemIds = Array.from(itemMap.values());

  const { data: existingInv } = await state.client
    .from("node_inventory")
    .select("id, item_id")
    .eq("node_id", node.id)
    .in("item_id", itemIds);

  const existingMap = new Map((existingInv || []).map(r => [r.item_id, r.id]));

  const inserts = [];
  const updates = [];

  items.forEach((i) => {
    const itemId = itemMap.get(i.code);
    if (!itemId) return;
    const existingId = existingMap.get(itemId);
    if (existingId){
      updates.push({ id: existingId, planned_qty: i.planned_qty });
    } else {
      inserts.push({
        node_id: node.id,
        item_id: itemId,
        qty_used: 0,
        planned_qty: i.planned_qty,
        completed: false,
      });
    }
  });

  if (updates.length){
    const { error } = await state.client.from("node_inventory").upsert(updates, { onConflict: "id" });
    if (error){
      toast("Inventory update failed", error.message);
      return;
    }
  }
  if (inserts.length){
    const { error } = await state.client.from("node_inventory").insert(inserts);
    if (error){
      toast("Inventory seed failed", error.message);
      return;
    }
  }

  await loadProjects();
  state.activeProject = project;
  renderProjects();
  $("nodeNumber").value = "NODE 11";
  await openNode("NODE 11");
  toast("Demo loaded", "Project and NODE 11 are ready.");
}

function renderLocations(){
  const wrap = $("locations");
  wrap.innerHTML = "";
  const node = state.activeNode;
  if (!node){
    wrap.innerHTML = '<div class="muted small">Open a node to see splice locations.</div>';
    return;
  }

  const rows = node.splice_locations || [];
  if (!rows.length){
    wrap.innerHTML = '<div class="muted small">No splice locations yet. Click "Add splice location".</div>';
    return;
  }

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Location</th>
        <th>GPS</th>
        <th>Photo</th>
        <th>Timestamp</th>
        <th>Done</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tb = table.querySelector("tbody");

  rows.forEach((r) => {
    const gps = r.gps ? `${r.gps.lat.toFixed(6)}, ${r.gps.lng.toFixed(6)}` : "-";
    const photo = r.photo ? "attached" : "-";
    const ts = r.taken_at ? new Date(r.taken_at).toLocaleString() : "-";
    const done = r.completed ? '<span class="pill-ok">YES</span>' : '<span class="pill-warn">NO</span>';

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="font-weight:900">${escapeHtml(r.name)}</div>
        <div class="muted small">${escapeHtml(r.id)}</div>
      </td>
      <td>${gps}</td>
      <td>${photo}</td>
      <td>${ts}</td>
      <td>
        <div class="row">
          <button class="btn secondary small" data-action="toggleComplete" data-id="${r.id}">${r.completed ? "Undo" : "Mark complete"}</button>
        </div>
      </td>
    `;
    tb.appendChild(tr);
  });

  table.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === "toggleComplete"){
      const loc = node.splice_locations.find(x => x.id === id);
      if (!loc) return;

      // Must have gps + photo + timestamp
      if (!loc.completed){
        if (!loc.gps || !loc.photo || !loc.taken_at){
          toast("Missing evidence", "This splice location needs GPS, photo, and timestamp before it can be completed.");
          return;
        }
      }
      const next = !loc.completed;
      if (isDemo){
        loc.completed = next;
        renderLocations();
        updateKPI();
        return;
      }
      const { error } = await state.client
        .from("splice_locations")
        .update({ completed: next, completed_by: state.user?.id || null })
        .eq("id", loc.id);
      if (error){
        toast("Update failed", error.message);
        return;
      }
      loc.completed = next;
      renderLocations();
      updateKPI();
    }
  });

  wrap.appendChild(table);
}

function renderInventory(){
  const wrap = $("inventory");
  wrap.innerHTML = "";
  const node = state.activeNode;
  if (!node){
    wrap.innerHTML = '<div class="muted small">Open a node to see inventory checklist.</div>';
    return;
  }
  const items = node.inventory_checks || [];
  if (!items.length){
    wrap.innerHTML = '<div class="muted small">No inventory items yet (demo seeds two). In Supabase, these come from inventory master + node checklist.</div>';
    return;
  }

  items.forEach((it) => {
    const planned = Number.isFinite(it.planned_qty) ? it.planned_qty : (it.qty_used || 0);
    const remaining = getRemainingForItem(it);
    const usageItemId = getUsageItemId(it);
    const defaultQty = it.qty_used || 1;

    const card = document.createElement("div");
    card.className = "card";
    card.style.marginBottom = "12px";
    card.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div>
          <div style="font-weight:900">${escapeHtml(it.item_name)}</div>
          <div class="muted small">${escapeHtml(it.item_code)}</div>
          <div class="muted small">Planned: <b>${planned}</b> | Remaining: <b>${remaining}</b></div>
          <div class="muted small">Default qty: <b>${defaultQty}</b></div>
        </div>
        <div class="row">
          <span class="chip"><span class="dot ${it.completed ? "ok" : "warn"}"></span><span>${it.completed ? "Checked" : "Pending"}</span></span>
          <input class="input" style="width:90px;" type="number" min="1" step="1" value="${defaultQty}" data-qty-for="${usageItemId}"/>
          <button class="btn secondary" data-action="submitUsage" data-id="${usageItemId}">Submit usage</button>
          <button class="btn secondary" data-action="toggleInv" data-id="${it.id}">${it.completed ? "Uncheck" : "Check"}</button>
        </div>
      </div>
      <div style="height:10px"></div>
      <img class="item-photo" src="${it.photo}" alt="item photo"/>
    `;
    card.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "toggleInv"){
        const item = node.inventory_checks.find(x => x.id === id);
        if (!item) return;
        const next = !item.completed;
        if (isDemo){
          item.completed = next;
          renderInventory();
          updateKPI();
        } else {
          const { error } = await state.client
            .from("node_inventory")
            .update({ completed: next, completed_by: state.user?.id || null })
            .eq("id", item.id);
          if (error){
            toast("Update failed", error.message);
            return;
          }
          item.completed = next;
          renderInventory();
          updateKPI();
        }
      } else if (action === "submitUsage"){
        const qtyInput = card.querySelector(`[data-qty-for="${id}"]`);
        const qty = Number.parseInt(qtyInput?.value || "0", 10);
        submitUsage(id, qty);
      }
    });
    wrap.appendChild(card);
  });
}

function setProofStatus(){
  const el = $("proofStatus");
  if (!el) return;
  if (!state.lastProof){
    el.textContent = "No proof photo captured";
    return;
  }
  const gps = state.lastProof.gps
    ? `${state.lastProof.gps.lat.toFixed(6)}, ${state.lastProof.gps.lng.toFixed(6)}`
    : "GPS missing";
  el.textContent = `Proof ready: ${state.lastProof.captured_at} (${gps})`;
}

function clearProof(){
  state.lastProof = null;
  const input = $("proofPhotoFile");
  if (input) input.value = "";
  setProofStatus();
}

async function handleProofFileSelected(file){
  if (!file){
    toast("Choose a photo", "Pick a proof photo first.");
    return;
  }
  if (!state.lastGPS){
    toast("GPS required", "Capture GPS before attaching a proof photo.");
    return;
  }
  state.lastProof = {
    file,
    captured_at: nowISO(),
    gps: { ...state.lastGPS },
  };
  setProofStatus();
}

async function uploadProofPhoto(file, nodeId, prefix){
  if (!state.client) return null;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folder = `${prefix || "proof"}/node-${nodeId}`;
  const path = `${folder}/${Date.now()}-${safeName}`;
  const { data, error } = await state.client
    .storage
    .from("proof-photos")
    .upload(path, file, { contentType: file.type });
  if (error){
    toast("Upload failed", error.message);
    return null;
  }
  return data?.path || path;
}

async function submitUsage(itemId, qty){
  const node = state.activeNode;
  if (!node) return;
  if (!Number.isFinite(qty) || qty <= 0){
    toast("Qty required", "Enter a valid quantity to submit.");
    return;
  }
  if (!state.lastProof?.file || !state.lastProof?.gps || !state.lastProof?.captured_at){
    toast("Proof required", "Capture a live photo with GPS before submitting usage.");
    return;
  }

  const plannedItem = node.inventory_checks.find(i => getUsageItemId(i) === itemId);
  if (!plannedItem){
    toast("Item missing", "This item is no longer available.");
    return;
  }
  const remaining = getRemainingForItem(plannedItem);
  const status = qty > remaining ? "needs_approval" : "approved";

  if (isDemo){
    state.demo.usageEvents.push({
      id: `use-${Date.now()}`,
      node_id: node.id,
      item_id: itemId,
      qty,
      status,
      captured_at: state.lastProof.captured_at,
      gps_lat: state.lastProof.gps.lat,
      gps_lng: state.lastProof.gps.lng,
      gps_accuracy_m: state.lastProof.gps.accuracy_m,
      photo_path: "demo-only",
    });
    if (status === "needs_approval"){
      toast("Needs approval", "Overage submitted and pending approval.");
    } else {
      toast("Usage submitted", "Approved usage recorded.");
    }
    clearProof();
    renderInventory();
    return;
  }

  const uploadPath = await uploadProofPhoto(state.lastProof.file, node.id, "usage");
  if (!uploadPath) return;

  const { error } = await state.client
    .from("usage_events")
    .insert({
      node_id: node.id,
      item_id: itemId,
      qty,
      status,
      photo_path: uploadPath,
      captured_at: state.lastProof.captured_at,
      gps_lat: state.lastProof.gps.lat,
      gps_lng: state.lastProof.gps.lng,
      gps_accuracy_m: state.lastProof.gps.accuracy_m,
    });

  if (error){
    toast("Usage error", error.message);
    return;
  }
  if (status === "needs_approval"){
    toast("Needs approval", "Overage submitted and pending approval.");
  } else {
    toast("Usage submitted", "Approved usage recorded.");
  }
  clearProof();
  await loadUsageEvents(node.id);
  renderInventory();
}

async function loadUsageEvents(nodeId){
  if (isDemo) return;
  const { data, error } = await state.client
    .from("usage_events")
    .select("id,node_id,item_id,qty,status")
    .eq("node_id", nodeId);
  if (error){
    toast("Usage load error", error.message);
    return;
  }
  state.usageEvents = data || [];
}

async function loadInvoices(nodeId){
  if (isDemo) return;
  const [subRes, primeRes] = await Promise.all([
    state.client
      .from("sub_invoices")
      .select("id, invoice_number, status, total, currency")
      .eq("node_id", nodeId),
    state.client
      .from("prime_invoices")
      .select("id, invoice_number, status, total, currency")
      .eq("node_id", nodeId),
  ]);
  if (subRes.error){
    toast("Invoice load error", subRes.error.message);
  }
  if (primeRes.error){
    toast("Invoice load error", primeRes.error.message);
  }
  if (state.activeNode && state.activeNode.id === nodeId){
    state.activeNode.invoices = {
      sub: subRes.data || [],
      prime: primeRes.data || [],
    };
  }
}

function subscribeUsageEvents(nodeId){
  if (isDemo || !state.client) return;
  if (state.realtime.usageChannel){
    state.client.removeChannel(state.realtime.usageChannel);
    state.realtime.usageChannel = null;
  }
  state.realtime.usageChannel = state.client
    .channel(`usage-events-${nodeId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "usage_events", filter: `node_id=eq.${nodeId}` },
      async () => {
        await loadUsageEvents(nodeId);
        renderInventory();
      }
    )
    .subscribe();
}

function renderInvoicePanel(){
  const wrap = $("invoicePanel");
  const role = getRole();
  const node = state.activeNode;

  const canSeeSubInvoices = (role === "PRIME" || role === "SUB" || role === "OWNER");
  const canSeeTdsInvoices = (role === "TDS" || role === "PRIME" || role === "OWNER");
  const canSeeAnyPricing = (role !== "SPLICER");

  let html = "";
  html += `<div class="row">
    <span class="chip"><span class="dot ${canSeeAnyPricing ? "ok" : "bad"}"></span><span>${canSeeAnyPricing ? "Pricing visible (per role)" : "Pricing hidden"}</span></span>
    <span class="chip"><span class="dot ${canSeeSubInvoices ? "ok" : "bad"}"></span><span>SUB invoices: ${canSeeSubInvoices ? "visible" : "hidden"}</span></span>
    <span class="chip"><span class="dot ${canSeeTdsInvoices ? "ok" : "bad"}"></span><span>TDS invoices: ${canSeeTdsInvoices ? "visible" : "hidden"}</span></span>
  </div>`;

  html += `<div class="hr"></div>`;

  if (!node){
    html += `<div class="muted small">Open a node to see invoice actions.</div>`;
    wrap.innerHTML = html;
    return;
  }

  const completion = computeNodeCompletion(node);
  const eligible = completion.pct === 100 && node.ready_for_billing;

  html += `<div class="note">
    <div style="font-weight:900;">Billing gate</div>
    <div class="muted small">Node can be invoiced only when: splice locations complete + inventory checklist complete + node marked READY.</div>
    <div style="margin-top:8px;">Status: ${eligible ? '<span class="pill-ok">ELIGIBLE</span>' : '<span class="pill-warn">NOT READY</span>'}</div>
  </div>`;

  html += `<div class="hr"></div>`;

  if (isDemo){
    const invoices = state.demo.invoices.filter(i => i.node_number === node.node_number);
    if (!invoices.length){
      html += `<div class="muted small">No invoices created yet.</div>`;
    } else {
      html += `<table class="table">
        <thead><tr><th>From</th><th>To</th><th>Status</th><th>Amount</th></tr></thead><tbody>
        ${invoices.map(inv => {
          const showAmount = canSeeAnyPricing && ( (inv.from === "SUB" && canSeeSubInvoices) || (inv.to === "SUB" && canSeeSubInvoices) || (inv.to === "TDS" && canSeeTdsInvoices) || (inv.from === "TDS" && canSeeTdsInvoices) );
          const amt = showAmount ? "$1,234.00 (demo)" : "Hidden";
          return `<tr><td>${inv.from}</td><td>${inv.to}</td><td>${inv.status}</td><td>${amt}</td></tr>`;
        }).join("")}
        </tbody></table>`;
    }
    wrap.innerHTML = html;
    return;
  }

  const sub = node.invoices?.sub || [];
  const prime = node.invoices?.prime || [];
  const rows = [];

  if (canSeeSubInvoices){
    sub.forEach(inv => rows.push({
      from: "SUB",
      to: "PRIME",
      status: inv.status || "Draft",
      amount: inv.total,
      number: inv.invoice_number || "-",
    }));
  }
  if (canSeeTdsInvoices){
    prime.forEach(inv => rows.push({
      from: "PRIME",
      to: "TDS",
      status: inv.status || "Draft",
      amount: inv.total,
      number: inv.invoice_number || "-",
    }));
  }

  if (!rows.length){
    html += `<div class="muted small">No invoices created yet.</div>`;
  } else {
    html += `<table class="table">
      <thead><tr><th>From</th><th>To</th><th>Invoice #</th><th>Status</th><th>Amount</th></tr></thead><tbody>
      ${rows.map(inv => {
        const amt = (canSeeAnyPricing && inv.amount != null) ? `$${Number(inv.amount).toFixed(2)}` : "Hidden";
        return `<tr><td>${inv.from}</td><td>${inv.to}</td><td>${inv.number}</td><td>${inv.status}</td><td>${amt}</td></tr>`;
      }).join("")}
      </tbody></table>`;
  }

  wrap.innerHTML = html;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function getUsageItemId(item){
  return item.item_id || item.id;
}

function getApprovedUsageQty(itemId){
  const events = isDemo ? state.demo.usageEvents : state.usageEvents;
  const nodeId = state.activeNode?.id;
  return events
    .filter(e => e.item_id === itemId && e.status === "approved" && (!nodeId || e.node_id === nodeId))
    .reduce((sum, e) => sum + e.qty, 0);
}

function getRemainingForItem(item){
  const planned = Number.isFinite(item.planned_qty) ? item.planned_qty : (item.qty_used || 0);
  const approved = getApprovedUsageQty(getUsageItemId(item));
  return planned - approved;
}

async function captureGPS(){
  if (!navigator.geolocation){
    toast("No GPS", "This browser/device doesn't support geolocation.");
    return;
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.lastGPS = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy };
        toast("GPS captured", `${state.lastGPS.lat.toFixed(6)}, ${state.lastGPS.lng.toFixed(6)} (+/-${Math.round(state.lastGPS.accuracy_m)}m)`);
        if (state.lastProof){
          state.lastProof.gps = { ...state.lastGPS };
          setProofStatus();
        }
        resolve(state.lastGPS);
      },
      (err) => {
        toast("GPS error", err.message || "Unable to get location.");
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  });
}

async function attachPhotoToLastIncomplete(file){
  const node = state.activeNode;
  if (!node) return;

  const loc = (node.splice_locations || []).find(l => !l.photo) || node.splice_locations?.[0];
  if (!loc){
    toast("No location", "Add a splice location first.");
    return;
  }

  if (isDemo){
    const url = URL.createObjectURL(file);
    loc.photo = { kind:"local", url, name:file.name, size:file.size };
    loc.taken_at = nowISO();
    toast("Photo attached", `Attached to: ${loc.name}`);

    // If GPS already captured, apply it too (common workflow: capture once at the case)
    if (state.lastGPS && !loc.gps){
      loc.gps = { lat: state.lastGPS.lat, lng: state.lastGPS.lng, accuracy_m: state.lastGPS.accuracy_m };
    }

    renderLocations();
    updateKPI();
    return;
  }

  const takenAt = nowISO();
  const uploadPath = await uploadProofPhoto(file, node.id, "splice");
  if (!uploadPath) return;

  const gps = state.lastGPS;
  const { data, error } = await state.client
    .from("splice_locations")
    .update({
      photo_path: uploadPath,
      taken_at: takenAt,
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      gps_accuracy_m: gps?.accuracy_m ?? null,
    })
    .eq("id", loc.id)
    .select("id, photo_path, taken_at, gps_lat, gps_lng, gps_accuracy_m")
    .maybeSingle();

  if (error){
    toast("Photo error", error.message);
    return;
  }

  loc.photo = { kind:"storage", path: data.photo_path };
  loc.taken_at = data.taken_at;
  loc.gps = (data.gps_lat != null && data.gps_lng != null)
    ? { lat: data.gps_lat, lng: data.gps_lng, accuracy_m: data.gps_accuracy_m }
    : null;
  toast("Photo attached", `Attached to: ${loc.name}`);
  renderLocations();
  updateKPI();
}

async function addSpliceLocation(){
  const node = state.activeNode;
  if (!node) return;
  const n = (node.splice_locations?.length || 0) + 1;
  if (isDemo){
    node.splice_locations = node.splice_locations || [];
    node.splice_locations.push({
      id: `loc-${Date.now()}`,
      name: `Splice location ${n}`,
      gps: null,
      photo: null,
      taken_at: null,
      completed: false,
    });
    renderLocations();
    updateKPI();
    return;
  }

  const { data, error } = await state.client
    .from("splice_locations")
    .insert({
      node_id: node.id,
      location_label: `Splice location ${n}`,
    })
    .select("id, location_label, gps_lat, gps_lng, gps_accuracy_m, photo_path, taken_at, completed")
    .maybeSingle();

  if (error){
    toast("Add location failed", error.message);
    return;
  }
  node.splice_locations = node.splice_locations || [];
  node.splice_locations.push({
    id: data.id,
    name: data.location_label,
    gps: (data.gps_lat != null && data.gps_lng != null)
      ? { lat: data.gps_lat, lng: data.gps_lng, accuracy_m: data.gps_accuracy_m }
      : null,
    photo: data.photo_path ? { kind:"storage", path:data.photo_path } : null,
    taken_at: data.taken_at,
    completed: data.completed,
  });
  renderLocations();
  updateKPI();
}

async function openNode(nodeNumber){
  ensureDemoSeed();
  const role = getRole();

  const n = (nodeNumber || "").trim();
  if (!n){
    toast("Node number needed", "Enter a node number (example: NODE-1001).");
    return;
  }

  if (isDemo){
    if (!state.demo.nodes[n]){
      toast("Not found", "That node doesn't exist in demo. Click Create node to add it.");
      return;
    }

    state.activeNode = state.demo.nodes[n];

    // In real app, pricing is server-side protected.
    // Here we just display message.
    setRoleUI();
    renderLocations();
    renderInventory();
    renderInvoicePanel();
    updateKPI();

    // PRIME alert when near units
    if (role === "PRIME" && state.activeNode.units_allowed > 0){
      const ratio = state.activeNode.units_used / state.activeNode.units_allowed;
      if (ratio >= 0.9){
        toast("Prime alert", "Units are close to the allowed threshold for this node.");
      }
    }
    return;
  }

  const nodeQuery = state.client
    .from("nodes")
    .select("id, node_number, allowed_units, used_units, ready_for_billing, project_id")
    .eq("node_number", n);

  if (state.activeProject?.id){
    nodeQuery.eq("project_id", state.activeProject.id);
  }

  const { data: nodeRow, error: nodeErr } = await nodeQuery.maybeSingle();
  if (nodeErr){
    toast("Node error", nodeErr.message);
    return;
  }
  if (!nodeRow){
    toast("Not found", "That node doesn't exist. Click Create node to add it.");
    return;
  }

  const node = {
    id: nodeRow.id,
    node_number: nodeRow.node_number,
    units_allowed: nodeRow.allowed_units || 0,
    units_used: nodeRow.used_units || 0,
    ready_for_billing: nodeRow.ready_for_billing,
    project_id: nodeRow.project_id,
  };

  const [spliceRes, invRes, subInvRes, primeInvRes] = await Promise.all([
    state.client
      .from("splice_locations")
      .select("id, location_label, gps_lat, gps_lng, gps_accuracy_m, photo_path, taken_at, completed")
      .eq("node_id", node.id),
    state.client
      .from("node_inventory")
      .select("id, item_id, qty_used, planned_qty, completed, inventory_items(id, vendor_code, display_name, photo_path)")
      .eq("node_id", node.id),
    state.client
      .from("sub_invoices")
      .select("id, invoice_number, status, total, currency")
      .eq("node_id", node.id),
    state.client
      .from("prime_invoices")
      .select("id, invoice_number, status, total, currency")
      .eq("node_id", node.id),
  ]);

  if (spliceRes.error){
    toast("Splice load error", spliceRes.error.message);
  }
  if (invRes.error){
    toast("Inventory load error", invRes.error.message);
  }
  if (subInvRes.error){
    toast("Invoice load error", subInvRes.error.message);
  }
  if (primeInvRes.error){
    toast("Invoice load error", primeInvRes.error.message);
  }

  node.splice_locations = (spliceRes.data || []).map((r) => ({
    id: r.id,
    name: r.location_label,
    gps: (r.gps_lat != null && r.gps_lng != null)
      ? { lat: r.gps_lat, lng: r.gps_lng, accuracy_m: r.gps_accuracy_m }
      : null,
    photo: r.photo_path ? { kind:"storage", path:r.photo_path } : null,
    taken_at: r.taken_at,
    completed: r.completed,
  }));

  node.inventory_checks = (invRes.data || []).map((r) => ({
    id: r.id,
    item_id: r.item_id,
    item_code: r.inventory_items?.vendor_code || "-",
    item_name: r.inventory_items?.display_name || "Item",
    photo: r.inventory_items?.photo_path || "./assets/millennium_example.png",
    qty_used: r.qty_used || 0,
    planned_qty: Number.isFinite(r.planned_qty) ? r.planned_qty : r.qty_used || 0,
    completed: r.completed,
  }));

  node.invoices = {
    sub: subInvRes.data || [],
    prime: primeInvRes.data || [],
  };

  state.activeNode = node;
  await loadUsageEvents(node.id);
  subscribeUsageEvents(node.id);

  setRoleUI();
  renderLocations();
  renderInventory();
  renderInvoicePanel();
  updateKPI();
}

async function createNode(nodeNumber){
  ensureDemoSeed();
  const n = (nodeNumber || "").trim();
  if (!n){
    toast("Node number needed", "Enter a node number then click Create node.");
    return;
  }
  if (isDemo){
    if (state.demo.nodes[n]){
      toast("Already exists", "That node already exists.");
      return;
    }
    state.demo.nodes[n] = {
      id: `demo-${Date.now()}`,
      node_number: n,
      units_allowed: 120,
      units_used: 0,
      splice_locations: [],
      inventory_checks: [
        { id:`inv-${Date.now()}-1`, item_code:"HAFO(OFDC-B8G)", item_name:"TDS Millennium example", photo:"./assets/millennium_example.png", qty_used: 1, planned_qty: 8, completed:false },
      ],
      ready_for_billing: false,
    };
    toast("Node created", `Created node ${n}. Now click Open node.`);
    return;
  }

  const { error } = await state.client
    .from("nodes")
    .insert({
      node_number: n,
      allowed_units: 0,
      used_units: 0,
      project_id: state.activeProject?.id || null,
    });

  if (error){
    toast("Create failed", error.message);
    return;
  }
  toast("Node created", `Created node ${n}. Now click Open node.`);
}

async function markNodeReady(){
  const node = state.activeNode;
  if (!node) return;

  const c = computeNodeCompletion(node);
  if (!(c.locOk && c.invOk)){
    toast("Not ready", "Finish all splice locations + inventory checklist first.");
    return;
  }
  if (isDemo){
    node.ready_for_billing = true;
  } else {
    const { error } = await state.client
      .from("nodes")
      .update({ ready_for_billing: true })
      .eq("id", node.id);
    if (error){
      toast("Update failed", error.message);
      return;
    }
    node.ready_for_billing = true;
  }
  $("readyNote").style.display = "";
  $("readyNote").innerHTML = `
    <div style="font-weight:900;">Node READY</div>
    <div class="muted small">All required activities are complete for billing. Next: SUB creates invoice to PRIME, then PRIME forwards invoice to TDS/PM.</div>
  `;
  renderInvoicePanel();
  updateKPI();
}

async function createInvoice(){
  const node = state.activeNode;
  if (!node) return;

  const role = getRole();
  if (role === "SPLICER"){
    toast("Nope", "Splicers can't create invoices.");
    return;
  }

  const completion = computeNodeCompletion(node);
  if (!(completion.pct === 100 && node.ready_for_billing)){
    toast("Blocked", "Invoices are blocked until documentation is complete and node is marked READY.");
    return;
  }

  // Minimal demo invoice routing
  let to = null;
  if (role === "SUB") to = "PRIME";
  else if (role === "PRIME") to = "TDS";
  else if (role === "OWNER") to = "PRIME";
  else if (role === "TDS") to = "OWNER";
  else to = "PRIME";

  if (isDemo){
    state.demo.invoices.push({
      id: `inv-${Date.now()}`,
      node_number: node.node_number,
      from: role,
      to,
      status: "Draft",
      amount_hidden: false,
    });
    toast("Invoice created", `${role} -> ${to} (demo). Visibility depends on role.`);
    renderInvoicePanel();
    return;
  }

  if (role === "TDS"){
    toast("Blocked", "TDS can't create invoices in this MVP.");
    return;
  }

  if (role === "SUB"){
    const { error } = await state.client
      .from("sub_invoices")
      .insert({ node_id: node.id, status: "Draft" });
    if (error){
      toast("Invoice error", error.message);
      return;
    }
  } else if (role === "PRIME" || role === "OWNER"){
    const { error } = await state.client
      .from("prime_invoices")
      .insert({ node_id: node.id, status: "Draft" });
    if (error){
      toast("Invoice error", error.message);
      return;
    }
  }
  await loadInvoices(node.id);
  toast("Invoice created", `${role} -> ${to}. Visibility depends on role.`);
  renderInvoicePanel();
}

async function initAuth(){
  state.client = await makeClient();

  // Demo: choose role via prompt for now
  if (isDemo){
    ensureDemoSeed();
    showAuth(false);
    const pick = prompt("Demo mode: choose a role (TDS, PRIME, SUB, SPLICER, OWNER)", state.demo.role) || state.demo.role;
    const role = state.demo.roles.includes(pick.toUpperCase()) ? pick.toUpperCase() : state.demo.role;
    state.demo.role = role;
    setWhoami();
    setRoleUI();
    renderLocations();
    renderInventory();
    renderInvoicePanel();
    updateKPI();
    setProofStatus();
    return;
  }

  // Supabase session
  const { data } = await state.client.auth.getSession();
  state.session = data.session;
  state.user = data.session?.user || null;

  state.client.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    await loadProfile();
    setWhoami();
    if (state.user) {
      showAuth(false);
      await loadProjects();
    } else {
      showAuth(true);
      state.activeNode = null;
      state.usageEvents = [];
      clearProof();
      if (state.realtime.usageChannel){
        state.client.removeChannel(state.realtime.usageChannel);
        state.realtime.usageChannel = null;
      }
    }
  });

  await loadProfile();
  if (state.user){
    await loadProjects();
  }
  setWhoami();
  showAuth(!state.user);
  setProofStatus();
}

async function loadProfile(){
  if (isDemo) return;

  if (!state.user){
    state.profile = null;
    return;
  }

  // Expect a public.profiles row keyed by auth.uid()
  const { data, error } = await state.client
    .from("profiles")
    .select("role, display_name")
    .eq("id", state.user.id)
    .maybeSingle();

  if (error){
    toast("Profile error", error.message);
    state.profile = null;
    return;
  }
  state.profile = data || null;
  setRoleUI();
  renderInvoicePanel();
}

function wireUI(){
  $("btnDemo").addEventListener("click", () => {
    showAuth(false);
    initAuth();
  });

  $("btnSignOut").addEventListener("click", async () => {
    if (isDemo){
      // reset
      state.activeNode = null;
      showAuth(true);
      $("btnSignOut").style.display = "none";
      $("whoami").textContent = "Not signed in";
      clearProof();
      return;
    }
    await state.client.auth.signOut();
  });

  $("btnSignIn").addEventListener("click", async () => {
    if (isDemo) return;
    const email = $("email").value.trim();
    const password = $("password").value;
    const { error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) toast("Sign-in failed", error.message);
  });

  const btnMagic = $("btnMagicLink");
  if (btnMagic){
    btnMagic.addEventListener("click", async () => {
      if (isDemo) return;
      const email = $("email").value.trim();
      if (!email){
        toast("Email needed", "Enter your email address first.");
        return;
      }
      const { error } = await state.client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) toast("Magic link failed", error.message);
      else toast("Magic link sent", "Check your email to finish sign-in.");
    });
  }

  $("btnSignUp").addEventListener("click", async () => {
    if (isDemo) return;
    const email = $("email").value.trim();
    const password = $("password").value;
    const { data, error } = await state.client.auth.signUp({ email, password });
    if (error) toast("Sign-up failed", error.message);
    else toast("Signed up", "Now assign a role in profiles (OWNER/PRIME/SUB/SPLICER/TDS).");
  });

  $("btnOpenNode").addEventListener("click", () => openNode($("nodeNumber").value));
  $("btnNewNode").addEventListener("click", () => createNode($("nodeNumber").value));

  const projectSelect = $("projectSelect");
  if (projectSelect){
    projectSelect.addEventListener("change", () => {
      setActiveProjectById(projectSelect.value);
    });
  }
  const seedBtn = $("btnSeedDemo");
  if (seedBtn){
    seedBtn.addEventListener("click", () => seedDemoNode());
  }

  $("btnAddLocation").addEventListener("click", () => addSpliceLocation());
  $("btnCaptureGPS").addEventListener("click", () => captureGPS());

  $("btnAttachPhoto").addEventListener("click", () => {
    const f = $("photoFile").files?.[0];
    if (!f){
      toast("Choose a photo", "Pick a photo file first.");
      return;
    }
    attachPhotoToLastIncomplete(f);
  });

  const proofInput = $("proofPhotoFile");
  if (proofInput){
    proofInput.addEventListener("change", () => {
      const f = proofInput.files?.[0];
      handleProofFileSelected(f);
    });
  }
  const proofBtn = $("btnCaptureProof");
  if (proofBtn && proofInput){
    proofBtn.addEventListener("click", () => proofInput.click());
  }

  $("btnMarkNodeReady").addEventListener("click", () => markNodeReady());
  $("btnCreateInvoice").addEventListener("click", () => createInvoice());
}

wireUI();
initAuth();
