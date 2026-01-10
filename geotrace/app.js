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
  unitTypes: [],
  allowedQuantities: [],
  alerts: [],
  materialCatalog: [],
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
    unitTypes: [],
    allowedQuantities: [],
    alerts: [],
    materialCatalog: [],
  },
};

function toast(title, body){
  $("toastTitle").textContent = title;
  $("toastBody").textContent = body;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 4200);
}

function nowISO(){ return new Date().toISOString(); }

function setText(id, value){
  const el = $(id);
  if (el) el.textContent = value;
}

function setActiveView(viewId){
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });
}

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

function computeProofStatus(node){
  const locs = node.splice_locations || [];
  const locProofOk = locs.length > 0 && locs.every(l => l.gps && l.photo && l.taken_at);
  const missingUsage = getMissingUsageProof(node.id);
  const usageProofOk = missingUsage.length === 0;
  return { locProofOk, usageProofOk, proofOk: locProofOk && usageProofOk };
}

function updateKPI(){
  const node = state.activeNode;
  if (!node){
    setText("kpiNode", "None");
    setText("kpiCompletion", "0%");
    setText("kpiUnits", "0 / 0");
    setText("dashNode", "None");
    setText("dashCompletion", "0%");
    setText("dashUnits", "0 / 0");
    const chipStatus = $("chipStatus");
    if (chipStatus){
      chipStatus.innerHTML = '<span class="dot warn"></span><span>Waiting</span>';
    }
    return;
  }

  setText("kpiNode", node.node_number);
  setText("dashNode", node.node_number);
  const c = computeNodeCompletion(node);
  setText("kpiCompletion", `${c.pct}%`);
  setText("dashCompletion", `${c.pct}%`);

  const units = getNodeUnits(node);
  setText("kpiUnits", `${units.used} / ${units.allowed}`);
  setText("dashUnits", `${units.used} / ${units.allowed}`);

  // status chip
  const ratio = units.allowed > 0 ? (units.used / units.allowed) : 0;
  const dot = c.pct === 100 ? "ok" : ratio >= 0.9 ? "warn" : "warn";
  const label = c.pct === 100 ? "Ready" : "In progress";
  const chipStatus = $("chipStatus");
  if (chipStatus){
    chipStatus.innerHTML = `<span class="dot ${dot}"></span><span>${label}</span>`;
  }

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

  updateAlertsBadge();
  renderAlerts();
}

function showAuth(show){
  $("viewAuth").style.display = show ? "" : "none";
  $("viewApp").style.display = show ? "none" : "";
}

function setWhoami(){
  if (isDemo){
    $("whoami").textContent = `Signed in (Demo: ${state.demo.role})`;
    $("btnSignOut").style.display = "";
    return;
  }

  if (state.user){
    const role = state.profile?.role ? ` -> ${state.profile.role}` : "";
    $("whoami").textContent = `Signed in (${state.user.email}${role})`;
    $("btnSignOut").style.display = "";
  } else {
    $("whoami").textContent = "Signed out";
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

  state.demo.unitTypes = [
    { id:"ut-ho-1", code:"HO-1", description:"Fiber housing 1" },
    { id:"ut-ho-2", code:"HO-2", description:"Fiber housing 2" },
    { id:"ut-splice", code:"SPLICE", description:"Splice unit" },
  ];

  state.demo.allowedQuantities = [
    {
      id: "aq-1",
      node_id: node.id,
      unit_type_id: "ut-ho-1",
      allowed_qty: 362,
      alert_threshold_pct: 0.15,
      alert_threshold_abs: 50,
    },
  ];

  state.demo.usageEvents = [
    {
      id: "use-1",
      node_id: node.id,
      item_id: null,
      unit_type_id: "ut-ho-1",
      qty: 320,
      status: "approved",
      captured_at: nowISO(),
      gps_lat: 32.123456,
      gps_lng: -104.987654,
      photo_path: "demo-only",
      proof_required: true,
    },
  ];

  state.demo.materialCatalog = [
    {
      id: "mc-1",
      millennium_part: "HAFO(OFDC-B8G)",
      mfg_sku: "MFG-HAFO-B8G",
      description: "TDS Millennium housing assembly (8G)",
      photo_url: "./assets/millennium_example.png",
    },
    {
      id: "mc-2",
      millennium_part: "HxFO(1X2)PCOT(80/20)MO",
      mfg_sku: "MFG-1X2-8020",
      description: "Splitter module 1x2, 80/20",
      photo_url: "./assets/millennium_example.png",
    },
    {
      id: "mc-3",
      millennium_part: "PF3-3",
      mfg_sku: "MFG-PF3-3",
      description: "PF3-3 splice tray kit",
      photo_url: "./assets/millennium_example.png",
    },
  ];

  state.demo.alerts = [
    {
      id: "alert-1",
      node_id: node.id,
      unit_type_id: "ut-ho-1",
      allowed_qty: 362,
      used_qty: 320,
      remaining_qty: 42,
      message: "Remaining units below threshold. Request approval for additional units.",
      severity: "warning",
      status: "open",
      created_at: nowISO(),
    },
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

async function loadUnitTypes(){
  if (isDemo){
    state.unitTypes = state.demo.unitTypes || [];
    return;
  }
  const { data, error } = await state.client
    .from("unit_types")
    .select("id, code, description")
    .order("code");
  if (error){
    toast("Unit types error", error.message);
    return;
  }
  state.unitTypes = data || [];
}

async function loadAllowedQuantities(nodeId){
  if (isDemo){
    state.allowedQuantities = (state.demo.allowedQuantities || [])
      .filter(a => !nodeId || a.node_id === nodeId)
      .map((row) => {
        const unit = getUnitTypeMeta(row.unit_type_id);
        return {
          ...row,
          unit_code: unit.code,
          unit_description: unit.description,
        };
      });
    return;
  }
  if (!nodeId){
    state.allowedQuantities = [];
    return;
  }
  const { data, error } = await state.client
    .from("allowed_quantities")
    .select("id, node_id, unit_type_id, allowed_qty, alert_threshold_pct, alert_threshold_abs, unit_types(code, description)")
    .eq("node_id", nodeId);
  if (error){
    toast("Allowed qty error", error.message);
    return;
  }
  state.allowedQuantities = (data || []).map((row) => ({
    id: row.id,
    node_id: row.node_id,
    unit_type_id: row.unit_type_id,
    unit_code: row.unit_types?.code || "-",
    unit_description: row.unit_types?.description || "",
    allowed_qty: row.allowed_qty,
    alert_threshold_pct: row.alert_threshold_pct,
    alert_threshold_abs: row.alert_threshold_abs,
  }));
}

async function loadMaterialCatalog(){
  if (isDemo){
    state.materialCatalog = state.demo.materialCatalog || [];
    return;
  }
  const { data, error } = await state.client
    .from("material_catalog")
    .select("id, millennium_part, mfg_sku, description, photo_url")
    .eq("active", true)
    .order("millennium_part");
  if (error){
    toast("Catalog error", error.message);
    return;
  }
  state.materialCatalog = data || [];
}

async function loadAlerts(nodeId){
  if (isDemo){
    state.alerts = (state.demo.alerts || []).filter(a => !nodeId || a.node_id === nodeId);
    updateAlertsBadge();
    return;
  }
  let query = state.client
    .from("alerts")
    .select("id, node_id, unit_type_id, allowed_qty, used_qty, remaining_qty, message, severity, status, created_at, unit_types(code)")
    .order("created_at", { ascending: false });
  if (nodeId){
    query = query.eq("node_id", nodeId);
  }
  const { data, error } = await query;
  if (error){
    toast("Alerts error", error.message);
    return;
  }
  state.alerts = data || [];
  updateAlertsBadge();
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

  const { data: unitRows, error: unitErr } = await state.client
    .from("unit_types")
    .upsert(
      items.map(i => ({ code: i.code, description: i.name })),
      { onConflict: "code" }
    )
    .select("id, code");
  if (unitErr){
    toast("Unit types seed failed", unitErr.message);
    return;
  }

  const unitMap = new Map((unitRows || []).map(r => [r.code, r.id]));
  const allowedRows = items.map((i) => ({
    node_id: node.id,
    unit_type_id: unitMap.get(i.code),
    allowed_qty: i.planned_qty,
    alert_threshold_pct: 0.15,
    alert_threshold_abs: 50,
  })).filter(r => r.unit_type_id);

  if (allowedRows.length){
    const { error } = await state.client
      .from("allowed_quantities")
      .upsert(allowedRows, { onConflict: "node_id,unit_type_id" });
    if (error){
      toast("Allowed qty seed failed", error.message);
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
        renderProofChecklist();
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
      renderProofChecklist();
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
  const mini = $("proofStatusMini");
  if (!state.lastProof){
    if (el) el.textContent = "No proof photo captured";
    if (mini) mini.textContent = "No proof captured yet.";
    return;
  }
  const gps = state.lastProof.gps
    ? `${state.lastProof.gps.lat.toFixed(6)}, ${state.lastProof.gps.lng.toFixed(6)}`
    : "GPS missing";
  if (el) el.textContent = `Proof ready: ${state.lastProof.captured_at} (${gps})`;
  if (mini) mini.textContent = `Proof ready: ${state.lastProof.captured_at}`;
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

async function recordProofUpload(payload){
  if (isDemo) return;
  if (!state.client) return;
  const { error } = await state.client.from("proof_uploads").insert(payload);
  if (error){
    toast("Proof log failed", error.message);
  }
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
  const unitTypeId = resolveUnitTypeIdForItem(plannedItem);
  const remaining = getRemainingForItem(plannedItem);
  const status = qty > remaining ? "needs_approval" : "approved";

  if (isDemo){
    state.demo.usageEvents.push({
      id: `use-${Date.now()}`,
      node_id: node.id,
      item_id: itemId,
      unit_type_id: unitTypeId,
      qty,
      status,
      captured_at: state.lastProof.captured_at,
      gps_lat: state.lastProof.gps.lat,
      gps_lng: state.lastProof.gps.lng,
      gps_accuracy_m: state.lastProof.gps.accuracy_m,
      photo_path: "demo-only",
      proof_required: true,
    });
    if (status === "needs_approval"){
      toast("Needs approval", "Overage submitted and pending approval.");
    } else {
      toast("Usage submitted", "Approved usage recorded.");
    }
    if (unitTypeId){
      maybeCreateDemoAlert(node.id, unitTypeId);
      state.alerts = state.demo.alerts || [];
      updateAlertsBadge();
      renderAlerts();
    }
    clearProof();
    renderInventory();
    renderAllowedQuantities();
    renderProofChecklist();
    return;
  }

  const uploadPath = await uploadProofPhoto(state.lastProof.file, node.id, "usage");
  if (!uploadPath) return;

  const { data, error } = await state.client
    .from("usage_events")
    .insert({
      node_id: node.id,
      item_id: itemId,
      unit_type_id: unitTypeId,
      qty,
      status,
      photo_path: uploadPath,
      captured_at: state.lastProof.captured_at,
      gps_lat: state.lastProof.gps.lat,
      gps_lng: state.lastProof.gps.lng,
      gps_accuracy_m: state.lastProof.gps.accuracy_m,
      proof_required: true,
    })
    .select("id");

  if (error){
    toast("Usage error", error.message);
    return;
  }
  const usageId = data?.[0]?.id;
  if (usageId){
    await recordProofUpload({
      node_id: node.id,
      usage_event_id: usageId,
      photo_url: uploadPath,
      lat: state.lastProof.gps.lat,
      lng: state.lastProof.gps.lng,
      captured_at: state.lastProof.captured_at,
      captured_by: state.user?.id || null,
    });
  }
  if (status === "needs_approval"){
    toast("Needs approval", "Overage submitted and pending approval.");
  } else {
    toast("Usage submitted", "Approved usage recorded.");
  }
  clearProof();
  await loadUsageEvents(node.id);
  await loadAlerts(node.id);
  renderInventory();
  renderAllowedQuantities();
  renderAlerts();
  renderProofChecklist();
}

async function loadUsageEvents(nodeId){
  if (isDemo) return;
  const { data, error } = await state.client
    .from("usage_events")
    .select("id,node_id,item_id,unit_type_id,qty,status,photo_path,gps_lat,gps_lng,captured_at,proof_required")
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
        await loadAlerts(nodeId);
        renderInventory();
        renderAllowedQuantities();
        renderProofChecklist();
        renderAlerts();
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
  const proof = computeProofStatus(node);
  const eligible = completion.pct === 100 && node.ready_for_billing && proof.proofOk;

  html += `<div class="note">
    <div style="font-weight:900;">Billing gate</div>
    <div class="muted small">Node can be invoiced only when: splice locations complete + inventory checklist complete + proof captured + node marked READY.</div>
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

function resolveUnitTypeIdForItem(item){
  const code = String(item.unit_type_code || item.item_code || "").toUpperCase();
  const match = state.unitTypes.find(u => String(u.code || "").toUpperCase() === code);
  return match?.id || null;
}

function getApprovedUsageQty(itemId){
  const events = isDemo ? state.demo.usageEvents : state.usageEvents;
  const nodeId = state.activeNode?.id;
  return events
    .filter(e => e.item_id === itemId && e.status === "approved" && (!nodeId || e.node_id === nodeId))
    .reduce((sum, e) => sum + e.qty, 0);
}

function getApprovedUsageByUnitType(unitTypeId){
  const events = isDemo ? state.demo.usageEvents : state.usageEvents;
  const nodeId = state.activeNode?.id;
  return events
    .filter(e => e.unit_type_id === unitTypeId && e.status === "approved" && (!nodeId || e.node_id === nodeId))
    .reduce((sum, e) => sum + e.qty, 0);
}

function getMissingUsageProof(nodeId){
  const events = isDemo ? state.demo.usageEvents : state.usageEvents;
  return events.filter((e) => {
    if (nodeId && e.node_id !== nodeId) return false;
    if (e.proof_required === false) return false;
    return !e.photo_path || e.gps_lat == null || e.gps_lng == null || !e.captured_at;
  });
}

function getUnitTypeMeta(unitTypeId){
  const unit = state.unitTypes.find(u => u.id === unitTypeId);
  if (!unit) return { code: "-", description: "" };
  return { code: unit.code, description: unit.description || "" };
}

function getRemainingForItem(item){
  const planned = Number.isFinite(item.planned_qty) ? item.planned_qty : (item.qty_used || 0);
  const approved = getApprovedUsageQty(getUsageItemId(item));
  return planned - approved;
}

function updateAlertsBadge(){
  const role = getRole();
  const canSeeAlerts = role === "PRIME" || role === "OWNER";
  const openAlerts = canSeeAlerts ? (state.alerts || []).filter(a => a.status === "open") : [];
  const count = openAlerts.length;
  const badge = $("alertsBadge");
  if (badge){
    badge.textContent = canSeeAlerts
      ? (count ? `${count} alert${count > 1 ? "s" : ""}` : "No alerts")
      : "Alerts for PRIME only";
    badge.classList.toggle("warn", count > 0 && canSeeAlerts);
  }
  const navBadge = $("alertsNavBadge");
  if (navBadge){
    navBadge.textContent = count ? String(count) : "";
    navBadge.style.display = count && canSeeAlerts ? "inline-flex" : "none";
  }
}

function renderAlerts(){
  const role = getRole();
  const canSeeAlerts = role === "PRIME" || role === "OWNER";
  const list = canSeeAlerts ? (state.alerts || []) : [];
  const targets = [$("alertsFeed"), $("alertsFeedFull")].filter(Boolean);
  if (!targets.length) return;
  const html = list.length
    ? list.map((alert) => {
        const unit = getUnitTypeMeta(alert.unit_type_id);
        const unitCode = alert.unit_types?.code || unit.code;
        const unitDesc = unit.description;
        const created = alert.created_at ? new Date(alert.created_at).toLocaleString() : "";
        const nodeLabel = state.activeNode?.node_number || (alert.node_id ? String(alert.node_id).slice(0, 8) : "-");
        return `
          <div class="alert-card">
            <div class="row" style="justify-content:space-between;">
              <div>
                <div style="font-weight:900">Node ${escapeHtml(nodeLabel)}</div>
                <div class="muted small">${escapeHtml(unitCode)} ${escapeHtml(unitDesc)}</div>
              </div>
              <span class="chip"><span class="dot warn"></span><span>${escapeHtml(alert.severity || "warning")}</span></span>
            </div>
            <div class="muted small" style="margin-top:6px;">Allowed: ${alert.allowed_qty ?? "-"} | Used: ${alert.used_qty ?? "-"} | Remaining: ${alert.remaining_qty ?? "-"}</div>
            <div style="margin-top:6px;">${escapeHtml(alert.message || "")}</div>
            <div class="muted small" style="margin-top:6px;">${created}</div>
          </div>
        `;
      }).join("")
    : `<div class="muted small">${canSeeAlerts ? "No alerts right now." : "Alerts are available to PRIME / OWNER."}</div>`;
  targets.forEach((el) => {
    el.innerHTML = html;
  });
}

function renderAllowedQuantities(){
  const wrap = $("allowedQuantities");
  if (!wrap) return;
  const rows = state.allowedQuantities || [];
  if (!state.activeNode || !rows.length){
    wrap.innerHTML = '<div class="muted small">Open a node to see allowed quantities.</div>';
    return;
  }
  wrap.innerHTML = `
    <table class="table">
      <thead><tr><th>Unit type</th><th>Allowed</th><th>Used</th><th>Remaining</th><th>Threshold</th></tr></thead>
      <tbody>
        ${rows.map((row) => {
          const used = getApprovedUsageByUnitType(row.unit_type_id);
          const remaining = row.allowed_qty - used;
          const pct = row.alert_threshold_pct != null ? `${Math.round(row.alert_threshold_pct * 100)}%` : "-";
          const abs = row.alert_threshold_abs != null ? row.alert_threshold_abs : "-";
          return `
            <tr>
              <td>${escapeHtml(row.unit_code || "-")}</td>
              <td>${row.allowed_qty}</td>
              <td>${used}</td>
              <td>${remaining}</td>
              <td>${pct} / ${abs}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function maybeCreateDemoAlert(nodeId, unitTypeId){
  if (!isDemo) return;
  const row = (state.demo.allowedQuantities || []).find(a => a.node_id === nodeId && a.unit_type_id === unitTypeId);
  if (!row) return;
  const used = getApprovedUsageByUnitType(unitTypeId);
  const remaining = row.allowed_qty - used;
  const thresholdPct = row.alert_threshold_pct ?? 0.15;
  const thresholdAbs = row.alert_threshold_abs ?? null;
  const hitPct = row.allowed_qty > 0 && (remaining / row.allowed_qty) <= thresholdPct;
  const hitAbs = thresholdAbs != null && remaining <= thresholdAbs;
  if (!(hitPct || hitAbs)) return;
  const exists = (state.demo.alerts || []).some(a => a.node_id === nodeId && a.unit_type_id === unitTypeId && a.status === "open");
  if (exists) return;
  state.demo.alerts = state.demo.alerts || [];
  state.demo.alerts.unshift({
    id: `alert-${Date.now()}`,
    node_id: nodeId,
    unit_type_id: unitTypeId,
    allowed_qty: row.allowed_qty,
    used_qty: used,
    remaining_qty: remaining,
    message: "Remaining units below threshold. Request approval for additional units.",
    severity: "warning",
    status: "open",
    created_at: nowISO(),
  });
}

function filterCatalog(term){
  const needle = (term || "").trim().toLowerCase();
  if (!needle) return state.materialCatalog || [];
  return (state.materialCatalog || []).filter((item) => {
    return [
      item.millennium_part,
      item.mfg_sku,
      item.description,
    ].some((field) => String(field || "").toLowerCase().includes(needle));
  });
}

function renderCatalogResults(targetId, term){
  const target = $(targetId);
  if (!target) return;
  const results = filterCatalog(term);
  if (!results.length){
    target.innerHTML = '<div class="muted small">No matching catalog items.</div>';
    return;
  }
  target.innerHTML = results.map((item) => `
    <div class="catalog-card">
      <img class="catalog-photo" src="${item.photo_url || "./assets/millennium_example.png"}" alt="catalog photo"/>
      <div>
        <div class="catalog-title">${escapeHtml(item.description || "Catalog item")}</div>
        <div class="muted small">Millennium: <b>${escapeHtml(item.millennium_part || "-")}</b></div>
        <div class="muted small">MFG SKU: <b>${escapeHtml(item.mfg_sku || "-")}</b></div>
      </div>
    </div>
  `).join("");
}

function renderProofChecklist(){
  const wrap = $("proofChecklist");
  const summary = $("proofChecklistSummary");
  const node = state.activeNode;
  if (!wrap || !summary){
    return;
  }
  if (!node){
    wrap.innerHTML = '<div class="muted small">Open a node to see proof requirements.</div>';
    summary.innerHTML = '<div class="muted small">No node selected.</div>';
    return;
  }

  const locs = node.splice_locations || [];
  const missingLocs = locs.filter(l => !l.gps || !l.photo || !l.taken_at);
  const missingUsage = getMissingUsageProof(node.id);

  summary.innerHTML = `
    <div style="font-weight:900;">Proof required</div>
    <div class="muted small">${missingLocs.length} splice locations missing proof, ${missingUsage.length} usage entries missing proof.</div>
  `;

  if (!locs.length){
    wrap.innerHTML = '<div class="muted small">No splice locations yet.</div>';
    return;
  }

  wrap.innerHTML = `
    <table class="table">
      <thead><tr><th>Location</th><th>GPS</th><th>Photo</th><th>Timestamp</th></tr></thead>
      <tbody>
        ${locs.map((loc) => `
          <tr>
            <td>${escapeHtml(loc.name)}</td>
            <td>${loc.gps ? '<span class="pill-ok">OK</span>' : '<span class="pill-warn">Missing</span>'}</td>
            <td>${loc.photo ? '<span class="pill-ok">OK</span>' : '<span class="pill-warn">Missing</span>'}</td>
            <td>${loc.taken_at ? '<span class="pill-ok">OK</span>' : '<span class="pill-warn">Missing</span>'}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
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
    renderProofChecklist();
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
  await recordProofUpload({
    node_id: node.id,
    splice_location_id: loc.id,
    photo_url: data.photo_path,
    lat: gps?.lat ?? null,
    lng: gps?.lng ?? null,
    captured_at: takenAt,
    captured_by: state.user?.id || null,
  });
  renderLocations();
  updateKPI();
  renderProofChecklist();
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
    renderProofChecklist();
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
  renderProofChecklist();
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
    state.unitTypes = state.demo.unitTypes || [];
    await loadAllowedQuantities(state.activeNode.id);
    await loadAlerts(state.activeNode.id);

    // In real app, pricing is server-side protected.
    // Here we just display message.
    setRoleUI();
    renderLocations();
    renderInventory();
    renderInvoicePanel();
    renderAllowedQuantities();
    renderAlerts();
    renderProofChecklist();
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
  await loadAllowedQuantities(node.id);
  await loadAlerts(node.id);
  subscribeUsageEvents(node.id);

  setRoleUI();
  renderLocations();
  renderInventory();
  renderInvoicePanel();
  renderAllowedQuantities();
  renderAlerts();
  renderProofChecklist();
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
  const proof = computeProofStatus(node);
  if (!proof.proofOk){
    toast("Proof required", "Upload proof (GPS + photo + timestamp) before marking the node ready.");
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
  const proof = computeProofStatus(node);
  if (!proof.proofOk){
    toast("Blocked", "Proof is required before invoice submission.");
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
    await loadUnitTypes();
    await loadMaterialCatalog();
    setWhoami();
    setRoleUI();
    renderLocations();
    renderInventory();
    renderInvoicePanel();
    renderAllowedQuantities();
    renderAlerts();
    renderProofChecklist();
    updateKPI();
    setProofStatus();
    renderCatalogResults("catalogResults", "");
    renderCatalogResults("catalogResultsQuick", "");
    setActiveView("viewDashboard");
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
      await loadUnitTypes();
      await loadMaterialCatalog();
      await loadAlerts();
      renderAlerts();
      renderCatalogResults("catalogResults", "");
      renderCatalogResults("catalogResultsQuick", "");
      setActiveView("viewDashboard");
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
    await loadUnitTypes();
    await loadMaterialCatalog();
    await loadAlerts();
    renderAlerts();
    renderCatalogResults("catalogResults", "");
    renderCatalogResults("catalogResultsQuick", "");
    setActiveView("viewDashboard");
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
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => setActiveView(btn.dataset.view));
  });

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
      $("whoami").textContent = "Signed out";
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

  const catalogSearch = $("catalogSearch");
  if (catalogSearch){
    catalogSearch.addEventListener("input", (e) => {
      renderCatalogResults("catalogResults", e.target.value);
    });
  }
  const catalogSearchQuick = $("catalogSearchQuick");
  if (catalogSearchQuick){
    catalogSearchQuick.addEventListener("input", (e) => {
      renderCatalogResults("catalogResultsQuick", e.target.value);
    });
  }
  const catalogClear = $("btnCatalogClear");
  if (catalogClear){
    catalogClear.addEventListener("click", () => {
      if (catalogSearch) catalogSearch.value = "";
      renderCatalogResults("catalogResults", "");
    });
  }

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
