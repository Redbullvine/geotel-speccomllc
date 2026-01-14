import { appMode, hasSupabaseConfig, isDemo, makeClient } from "./supabaseClient.js";

const $ = (id) => document.getElementById(id);

const state = {
  client: null,
  session: null,
  user: null,
  profile: null, // {role, display_name}
  activeProject: null,
  activeNode: null,
  projectNodes: [],
  billingLocations: [],
  billingLocation: null,
  billingInvoice: null,
  billingItems: [],
  workCodes: [],
  rateCards: [],
  rateCardItems: [],
  locationProofRules: [],
  activeRateCardId: null,
  locationWorkCodes: new Map(),
  nodeProofStatus: null,
  ownerOverrides: [],
  billingStatus: null,
  lastGPS: null,
  lastProof: null,
  cameraStream: null,
  cameraReady: false,
  cameraInvalidated: false,
  cameraStartedAt: null,
  lastVisibilityChangeAt: null,
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
    nodesList: [],
    invoices: [],
    usageEvents: [],
    unitTypes: [],
    allowedQuantities: [],
    alerts: [],
    materialCatalog: [],
    workCodes: [],
    rateCards: [],
    rateCardItems: [],
    locationProofRules: [],
  },
};

function toast(title, body){
  $("toastTitle").textContent = title;
  $("toastBody").textContent = body;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 4200);
}

function nowISO(){ return new Date().toISOString(); }

const DEFAULT_TERMINAL_PORTS = 2;
const MAX_TERMINAL_PORTS = 8;
const DEFAULT_RATE_CARD_NAME = String(
  (window.__ENV && window.__ENV.DEFAULT_RATE_CARD_NAME)
  || (window.ENV && window.ENV.DEFAULT_RATE_CARD_NAME)
  || (window.process && window.process.env && window.process.env.DEFAULT_RATE_CARD_NAME)
  || ""
).trim();

function normalizeTerminalPorts(value){
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TERMINAL_PORTS;
  return Math.min(MAX_TERMINAL_PORTS, Math.max(1, parsed));
}

function requiredSlotsForPorts(ports){
  const count = normalizeTerminalPorts(ports);
  const slots = [];
  for (let i = 1; i <= count; i += 1){
    slots.push(`port_${i}`);
  }
  slots.push("splice_completion");
  return slots;
}

function getSlotLabel(slotKey){
  if (slotKey === "splice_completion") return "Splice completion";
  const match = String(slotKey || "").match(/^port_(\d+)$/);
  if (match) return `Port ${match[1]}`;
  return slotKey;
}

function getRequiredSlotsForLocation(loc){
  return requiredSlotsForPorts(loc?.terminal_ports ?? DEFAULT_TERMINAL_PORTS);
}

function countRequiredSlotUploads(loc){
  const required = getRequiredSlotsForLocation(loc);
  const photos = loc?.photosBySlot || {};
  let uploaded = 0;
  required.forEach((slot) => {
    if (photos[slot]) uploaded += 1;
  });
  return { uploaded, required: required.length };
}

function hasAllRequiredSlotPhotos(loc){
  const required = getRequiredSlotsForLocation(loc);
  const photos = loc?.photosBySlot || {};
  return required.length > 0 && required.every((slot) => Boolean(photos[slot]));
}

function getBackfillSlotKey(loc, photoType){
  if (photoType === "splice_complete") return "splice_completion";
  const photos = loc?.photosBySlot || {};
  const requiredPorts = getRequiredSlotsForLocation(loc).filter(slot => slot.startsWith("port_"));
  const missingRequired = requiredPorts.find(slot => !photos[slot]);
  if (missingRequired) return missingRequired;
  for (let i = 1; i <= MAX_TERMINAL_PORTS; i += 1){
    const slot = `port_${i}`;
    if (!photos[slot]) return slot;
  }
  return null;
}

function setText(id, value){
  const el = $(id);
  if (el) el.textContent = value;
}

function setAppModeUI(){
  const badge = $("appModeBadge");
  if (!badge) return;
  const live = appMode === "real";
  badge.textContent = live ? "LIVE" : "DEMO";
  badge.classList.toggle("live", live);
  badge.classList.toggle("demo", !live);
}

function setEnvWarning(){
  const banner = $("envWarning");
  if (!banner) return;
  if (appMode === "real" && !hasSupabaseConfig){
    banner.style.display = "";
    banner.classList.add("warning-banner");
    banner.textContent = "LIVE mode requires SUPABASE_URL and SUPABASE_ANON_KEY. Set Netlify env vars before using the app.";
  } else {
    banner.style.display = "none";
    banner.textContent = "";
  }
}

function setAuthButtonsDisabled(disabled){
  const ids = ["btnSignIn", "btnMagicLink", "btnSignUp"];
  ids.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = disabled;
  });
  const note = $("authConfigNote");
  if (note) note.style.display = disabled ? "" : "none";
}

function setActiveView(viewId){
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });
}

function startVisibilityWatch(){
  document.addEventListener("visibilitychange", () => {
    state.lastVisibilityChangeAt = Date.now();
    if (document.hidden){
      state.cameraInvalidated = true;
    }
  });
}

function getRole(){
  return state.profile?.role || state.demo.role;
}

function isBillingManager(){
  const role = getRole();
  return role === "OWNER" || role === "PRIME" || role === "TDS";
}

function isOwner(){
  return getRole() === "OWNER";
}

function isBillingUnlocked(){
  if (isDemo) return true;
  return Boolean(state.nodeProofStatus?.billing_unlocked);
}

function formatMoney(value){
  const num = Number(value || 0);
  return `$${num.toFixed(2)}`;
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
  const locPhotosOk = locs.length > 0 && locs.every((l) => hasAllRequiredSlotPhotos(l));
  const missingUsage = getMissingUsageProof(node.id);
  const usagePhotosOk = missingUsage.length === 0;
  return { locPhotosOk, usagePhotosOk, photosOk: locPhotosOk && usagePhotosOk };
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
  return;
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
    o.textContent = p.job_number ? `${p.name} (Job ${p.job_number})` : p.name;
    select.appendChild(o);
  });

  if (state.activeProject){
    select.value = state.activeProject.id;
    if (meta){
      const job = state.activeProject.job_number ? `Job ${state.activeProject.job_number}` : "Job -";
      const loc = state.activeProject.location ? ` | ${state.activeProject.location}` : "";
      meta.textContent = `${job}${loc}`;
    }
    setText("jobTitle", state.activeProject.job_number ? `Job ${state.activeProject.job_number}` : "Job -");
    setText("jobSubtitle", state.activeProject.name || "Project");
  } else if (meta){
    meta.textContent = "";
    setText("jobTitle", "Job -");
    setText("jobSubtitle", "Project");
  }
}

async function loadProjects(){
  if (isDemo){
    state.projects = state.demo.project ? [state.demo.project] : [];
    state.activeProject = state.projects[0] || null;
    renderProjects();
    return;
  }
  const { data, error } = await state.client
    .from("projects")
    .select("id, name, location, job_number")
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

async function loadProjectNodes(projectId){
  if (isDemo){
    state.projectNodes = (state.demo.nodesList || []).filter(n => !projectId || n.project_id === projectId);
    renderNodeCards();
    return;
  }
  if (!projectId){
    state.projectNodes = [];
    renderNodeCards();
    return;
  }
  const { data, error } = await state.client
    .from("nodes")
    .select("id, node_number, description, status, started_at, completed_at, project_id")
    .eq("project_id", projectId)
    .order("node_number");
  if (error){
    toast("Nodes load error", error.message);
    return;
  }
  state.projectNodes = data || [];
  renderNodeCards();
}

function renderNodeCards(){
  const wrap = $("nodeCards");
  if (!wrap) return;
  if (!state.projectNodes.length){
    wrap.innerHTML = '<div class="muted small">Select a project to see nodes.</div>';
    return;
  }
  const activeNode = state.projectNodes.find(n => n.status === "ACTIVE");
  wrap.innerHTML = state.projectNodes.map((node) => {
    const status = node.status || "NOT_STARTED";
    const isActive = status === "ACTIVE";
    const isComplete = status === "COMPLETE";
    const canStart = !activeNode || activeNode.id === node.id || isComplete;
    const actionLabel = isComplete ? "Completed" : isActive ? "Continue" : "Start";
    const disabled = !canStart && !isActive;
    const completeDisabled = !isActive && !isComplete;
    return `
      <div class="node-card">
        <div class="node-meta">
          <div class="node-title">${escapeHtml(node.node_number)}</div>
          <div class="muted small">${escapeHtml(node.description || "Ruidoso FTTH node")}</div>
        </div>
        <div class="node-status ${status.toLowerCase()}">${status.replace("_", " ")}</div>
        <div class="row">
          <button class="btn ${isActive ? "" : "secondary"}" data-action="openNode" data-id="${node.id}" ${disabled ? "disabled" : ""}>${actionLabel}</button>
          <button class="btn ghost" data-action="completeNode" data-id="${node.id}" ${completeDisabled ? "disabled" : ""}>Complete</button>
        </div>
      </div>
    `;
  }).join("");
}

function getActiveProjectNode(){
  return state.projectNodes.find(n => n.status === "ACTIVE") || null;
}

async function startNode(nodeId){
  const node = state.projectNodes.find(n => n.id === nodeId);
  if (!node){
    toast("Node missing", "Node not found.");
    return;
  }
  const active = getActiveProjectNode();
  if (active && active.id !== nodeId && active.status !== "COMPLETE"){
    toast("Active node in progress", `Finish ${active.node_number} before starting another node.`);
    return;
  }
  if (isDemo){
    node.status = "ACTIVE";
    node.started_at = nowISO();
    state.demo.nodes[node.node_number].status = "ACTIVE";
    state.activeNode = state.demo.nodes[node.node_number];
    renderNodeCards();
    await openNode(node.node_number);
    setActiveView("viewNodes");
    return;
  }
  const { error } = await state.client
    .from("nodes")
    .update({ status: "ACTIVE", started_at: new Date().toISOString() })
    .eq("id", node.id);
  if (error){
    toast("Start failed", error.message);
    return;
  }
  node.status = "ACTIVE";
  await openNode(node.node_number);
  await loadProjectNodes(node.project_id);
  setActiveView("viewNodes");
}

async function completeNode(nodeId){
  const node = state.projectNodes.find(n => n.id === nodeId);
  if (!node){
    toast("Node missing", "Node not found.");
    return;
  }
  const role = getRole();
  if (!(role === "PRIME" || role === "OWNER")){
    toast("Not allowed", "Only PRIME/OWNER can complete a node.");
    return;
  }
  if (!state.activeNode || state.activeNode.node_number !== node.node_number){
    toast("Open node", "Open the node before marking it complete.");
    return;
  }
  const photos = computeProofStatus(state.activeNode);
  if (!photos.photosOk){
    toast("No pay", "Photos missing. Completion is blocked.");
    return;
  }
  if (isDemo){
    node.status = "COMPLETE";
    node.completed_at = nowISO();
    state.demo.nodes[node.node_number].status = "COMPLETE";
    renderNodeCards();
    return;
  }
  const { error } = await state.client
    .from("nodes")
    .update({ status: "COMPLETE", completed_at: new Date().toISOString() })
    .eq("id", node.id);
  if (error){
    toast("Complete failed", error.message);
    return;
  }
  node.status = "COMPLETE";
  await loadProjectNodes(node.project_id);
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

async function loadWorkCodes(){
  if (isDemo){
    state.workCodes = state.demo.workCodes || [];
    return;
  }
  const { data, error } = await state.client
    .from("work_codes")
    .select("id, code, description, unit, default_rate")
    .order("code");
  if (error){
    toast("Work codes error", error.message);
    return;
  }
  state.workCodes = data || [];
}

async function loadRateCards(projectId){
  if (isDemo){
    state.rateCards = state.demo.rateCards || [];
    return;
  }
  let query = state.client
    .from("rate_cards")
    .select("id, name, project_id")
    .order("created_at", { ascending: false });
  if (projectId){
    query = query.or(`project_id.eq.${projectId},project_id.is.null`);
  }
  const { data, error } = await query;
  if (error){
    toast("Rate cards error", error.message);
    return;
  }
  state.rateCards = data || [];
  if (DEFAULT_RATE_CARD_NAME){
    const named = state.rateCards.find(r => r.name === DEFAULT_RATE_CARD_NAME);
    if (named) state.activeRateCardId = named.id;
  }
  if (!state.activeRateCardId && state.rateCards.length){
    state.activeRateCardId = state.rateCards[0].id;
  } else if (state.activeRateCardId){
    const exists = state.rateCards.find(r => r.id === state.activeRateCardId);
    if (!exists && state.rateCards.length){
      state.activeRateCardId = state.rateCards[0].id;
    }
  }
  if (state.activeRateCardId){
    await loadRateCardItems(state.activeRateCardId);
  }
}

async function loadRateCardItems(rateCardId){
  if (!rateCardId) {
    state.rateCardItems = [];
    return;
  }
  if (isDemo){
    state.rateCardItems = (state.demo.rateCardItems || []).filter(r => r.rate_card_id === rateCardId);
    return;
  }
  const { data, error } = await state.client
    .from("rate_card_items")
    .select("id, rate_card_id, work_code_id, rate")
    .eq("rate_card_id", rateCardId);
  if (error){
    toast("Rate card items error", error.message);
    return;
  }
  state.rateCardItems = data || [];
}

async function loadLocationProofRequirements(projectId){
  if (isDemo){
    state.locationProofRules = state.demo.locationProofRules || [];
    return;
  }
  if (!projectId){
    state.locationProofRules = [];
    return;
  }
  const { data, error } = await state.client
    .from("location_proof_requirements")
    .select("id, project_id, location_type, required_photos, enforce_geofence")
    .eq("project_id", projectId);
  if (error){
    toast("Proof rules error", error.message);
    return;
  }
  state.locationProofRules = data || [];
}

async function loadNodeProofStatus(nodeId){
  if (!nodeId || isDemo) return;
  const { data, error } = await state.client
    .rpc("node_proof_status", { p_node_id: nodeId });
  if (error){
    toast("Proof status error", error.message);
    return;
  }
  state.nodeProofStatus = data || null;
  renderBackfillPanel();
}

async function loadOwnerOverrides(nodeId){
  if (!nodeId || isDemo) return;
  const { data, error } = await state.client
    .from("owner_overrides")
    .select("id, override_type, reason, created_at, node_id, invoice_id")
    .eq("node_id", nodeId)
    .order("created_at", { ascending: false });
  if (error){
    toast("Overrides load error", error.message);
    return;
  }
  state.ownerOverrides = data || [];
}

async function loadBillingLocations(projectId){
  if (!projectId){
    state.billingLocations = [];
    renderBillingLocations();
    return;
  }
  if (isDemo){
    const rows = Object.values(state.demo.nodes || {}).flatMap(node => (node.splice_locations || []).map((loc) => ({
      id: loc.id,
      node_id: node.id,
      location_label: loc.name,
      completed: loc.completed,
      terminal_ports: loc.terminal_ports,
      photo_count: getLocationProofUploaded(loc),
      node_number: node.node_number,
      invoice_status: "draft",
    })));
    state.billingLocations = rows;
    state.locationWorkCodes = new Map();
    renderBillingLocations();
    return;
  }
  if (!state.client) return;
  const { data: locs, error: locErr } = await state.client
    .from("splice_locations")
    .select("id, node_id, location_label, completed, terminal_ports, nodes!inner(project_id,node_number)")
    .eq("nodes.project_id", projectId)
    .order("created_at", { ascending: true });
  if (locErr){
    toast("Locations load error", locErr.message);
    return;
  }
  const locationIds = (locs || []).map(l => l.id);
  let counts = new Map();
  let invoiceStatus = new Map();
  let invoiceIdsByLocation = new Map();
  let proofRequiredByLocation = new Map();
  let proofUploadedByLocation = new Map();
  if (locationIds.length){
    const { data: photos, error: photoErr } = await state.client
      .from("splice_location_photos")
      .select("splice_location_id")
      .in("splice_location_id", locationIds);
    if (photoErr){
      toast("Proof load error", photoErr.message);
    } else {
      (photos || []).forEach((row) => {
        counts.set(row.splice_location_id, (counts.get(row.splice_location_id) || 0) + 1);
      });
    }
    const { data: proofRows, error: proofErr } = await state.client
      .from("location_proof_status")
      .select("location_id, proof_required, proof_uploaded")
      .in("location_id", locationIds);
    if (!proofErr){
      (proofRows || []).forEach((row) => {
        proofRequiredByLocation.set(row.location_id, Number(row.proof_required || 0));
        proofUploadedByLocation.set(row.location_id, Number(row.proof_uploaded || 0));
      });
    }
    const { data: invoices } = await state.client
      .from("invoices")
      .select("id, location_id, status")
      .in("location_id", locationIds);
    (invoices || []).forEach((row) => {
      if (row.location_id) invoiceStatus.set(row.location_id, row.status);
      if (row.location_id && row.id) invoiceIdsByLocation.set(row.location_id, row.id);
    });

    const invoiceIds = Array.from(invoiceIdsByLocation.values());
    if (invoiceIds.length){
      const locationByInvoice = new Map();
      invoiceIdsByLocation.forEach((invId, locId) => {
        locationByInvoice.set(invId, locId);
      });
      const { data: items } = await state.client
        .from("invoice_items")
        .select("invoice_id, work_codes(code)")
        .in("invoice_id", invoiceIds);
      const codeMap = new Map();
      (items || []).forEach((row) => {
        const code = row.work_codes?.code;
        if (!code) return;
        const locId = locationByInvoice.get(row.invoice_id);
        if (!locId) return;
        if (!codeMap.has(locId)) codeMap.set(locId, new Set());
        codeMap.get(locId).add(code);
      });
      state.locationWorkCodes = codeMap;
    } else {
      state.locationWorkCodes = new Map();
    }
  }
  state.billingLocations = (locs || []).map((loc) => ({
    id: loc.id,
    node_id: loc.node_id,
    location_label: loc.location_label,
    completed: loc.completed,
    terminal_ports: normalizeTerminalPorts(loc.terminal_ports ?? DEFAULT_TERMINAL_PORTS),
    photo_count: proofUploadedByLocation.get(loc.id) ?? counts.get(loc.id) ?? 0,
    proof_required: proofRequiredByLocation.get(loc.id),
    node_number: loc.nodes?.node_number || "",
    invoice_status: invoiceStatus.get(loc.id) || "draft",
  }));
  if (state.billingLocation){
    const updated = state.billingLocations.find(l => l.id === state.billingLocation.id);
    if (updated) state.billingLocation = updated;
  }
  renderBillingLocations();
}

function setActiveProjectById(id){
  const next = state.projects.find(p => p.id === id) || null;
  state.activeProject = next;
  renderProjects();
  loadProjectNodes(state.activeProject?.id || null);
  loadRateCards(state.activeProject?.id || null);
  loadLocationProofRequirements(state.activeProject?.id || null);
  loadBillingLocations(state.activeProject?.id || null);
  state.billingLocation = null;
  state.billingInvoice = null;
  state.billingItems = [];
  renderBillingDetail();
}

function canSeedDemo(){
  const role = getRole();
  return role === "OWNER" || role === "PRIME";
}

async function seedDemoNode(){
  toast("Demo disabled", "Demo mode is disabled in LIVE mode.");
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

  const list = document.createElement("div");
  list.className = "location-list";
  rows.forEach((r) => {
    r.terminal_ports = normalizeTerminalPorts(r.terminal_ports ?? DEFAULT_TERMINAL_PORTS);
    r.photosBySlot = r.photosBySlot || {};
    r.isEditing = Boolean(r.isEditing);
    r.isEditingPorts = Boolean(r.isEditingPorts);
    const activePorts = normalizeTerminalPorts(r.isEditingPorts ? (r.pending_ports ?? r.terminal_ports) : r.terminal_ports);
    const portValue = [2, 4, 6, 8].includes(activePorts) ? String(activePorts) : "custom";
    const customValue = portValue === "custom" ? activePorts : "";
    const customStyle = portValue === "custom" ? "" : 'style="display:none;"';
    const counts = countRequiredSlotUploads(r);
    const missing = counts.uploaded < counts.required;
    const disableToggle = !r.completed && missing;
    const billingLocked = isLocationBillingLocked(r.id);
    if (billingLocked && r.isEditing) r.isEditing = false;
    if (billingLocked && r.isEditingPorts) r.isEditingPorts = false;
    const nameHtml = r.isEditing
      ? `<input class="input" data-action="nameInput" data-id="${r.id}" value="${escapeHtml(r.name)}" ${billingLocked ? "disabled" : ""} data-autofocus="true" />`
      : `<span class="clickable-name" data-action="editName" data-id="${r.id}" ${billingLocked ? "" : ""}>${escapeHtml(r.name)}</span>`;
    const workCodes = state.locationWorkCodes?.get(r.id);
    const workCodesLabel = workCodes && workCodes.size ? Array.from(workCodes).join(", ") : "None";
    const done = r.completed ? '<span class="pill-ok">COMPLETE</span>' : '<span class="pill-warn">INCOMPLETE</span>';

    const card = document.createElement("div");
    card.className = "card location-card";
    card.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div>
          <div style="font-weight:900">${nameHtml}</div>
          <div class="muted small">${escapeHtml(r.id)}</div>
          <div class="muted small">Photos: <b>${counts.uploaded}/${counts.required}</b> required</div>
          <div class="muted small">Work codes logged here: <b>${escapeHtml(workCodesLabel)}</b></div>
        </div>
        <div>${done}</div>
      </div>
      <div class="hr"></div>
      ${r.isEditingPorts ? `
        <div class="row" style="align-items:flex-end;">
          <div class="muted small">Terminal ports</div>
          <select class="input" data-action="portsSelect" data-id="${r.id}" style="width:140px; flex:0 0 auto;">
            <option value="2" ${portValue === "2" ? "selected" : ""}>2</option>
            <option value="4" ${portValue === "4" ? "selected" : ""}>4</option>
            <option value="6" ${portValue === "6" ? "selected" : ""}>6</option>
            <option value="8" ${portValue === "8" ? "selected" : ""}>8</option>
            <option value="custom" ${portValue === "custom" ? "selected" : ""}>Custom</option>
          </select>
          <input class="input" type="number" min="1" max="8" step="1" data-action="portsCustom" data-id="${r.id}" value="${customValue}" ${customStyle} style="width:120px; flex:0 0 auto;" />
          <div class="muted small">Required = ports + 1 completion.</div>
        </div>
        <div class="row" style="justify-content:flex-end;">
          <button class="btn ghost" data-action="cancelPorts" data-id="${r.id}">Cancel</button>
          <button class="btn secondary" data-action="savePorts" data-id="${r.id}">Save ports</button>
        </div>
        <div class="muted small">Required photos update after Save.</div>
      ` : `
        <div class="row" style="align-items:center; justify-content:space-between;">
          <div class="muted small">Ports required: <b>${activePorts}</b></div>
          <button class="btn ghost" data-action="editPorts" data-id="${r.id}" ${billingLocked ? "disabled" : ""}>Edit ports</button>
        </div>
      `}
      <div class="hr"></div>
      ${renderSplicePhotoGrid(r)}
      <div class="hr"></div>
      <div class="row">
        <button class="btn ghost" data-action="toggleComplete" data-id="${r.id}" ${disableToggle ? "disabled" : ""}>${r.completed ? "Undo complete" : "Mark complete"}</button>
      </div>
    `;
    list.appendChild(card);
  });

  list.addEventListener("change", async (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('input[type="file"][data-slot-key]')){
      const locId = target.dataset.locationId;
      const slotKey = target.dataset.slotKey;
      const file = target.files?.[0];
      await handleSpliceSlotPhotoUpload(locId, slotKey, file);
      target.value = "";
      return;
    }
    if (target.dataset.action === "portsSelect"){
      const loc = node.splice_locations.find(x => x.id === target.dataset.id);
      if (!loc) return;
      if (target.value === "custom"){
        loc.pending_ports = normalizeTerminalPorts(loc.pending_ports ?? loc.terminal_ports ?? DEFAULT_TERMINAL_PORTS);
        renderLocations();
        return;
      }
      loc.pending_ports = normalizeTerminalPorts(target.value);
      renderLocations();
      return;
    }
    if (target.dataset.action === "portsCustom"){
      const loc = node.splice_locations.find(x => x.id === target.dataset.id);
      if (!loc) return;
      const nextPorts = normalizeTerminalPorts(target.value);
      loc.pending_ports = nextPorts;
      target.value = String(nextPorts);
    }
  });

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    const label = e.target.closest("[data-action='editName']");
    const removeBtn = e.target.closest("[data-action='removeSlotPhoto']");
    if (removeBtn){
      e.preventDefault();
      e.stopPropagation();
      const locId = removeBtn.dataset.locationId;
      const slotKey = removeBtn.dataset.slotKey;
      await deleteSpliceSlotPhoto(locId, slotKey);
      return;
    }
    if (label){
      const loc = node.splice_locations.find(x => x.id === label.dataset.id);
      if (!loc) return;
      if (isLocationBillingLocked(loc.id)){
        toast("Billing locked", "Location name is locked after billing is ready.");
        return;
      }
      loc.isEditing = true;
      renderLocations();
      return;
    }
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === "editPorts"){
      const loc = node.splice_locations.find(x => x.id === id);
      if (!loc) return;
      if (isLocationBillingLocked(loc.id)){
        toast("Billing locked", "Terminal ports are locked after billing is ready.");
        return;
      }
      loc.isEditingPorts = true;
      loc.pending_ports = loc.terminal_ports;
      renderLocations();
      return;
    }
    if (action === "cancelPorts"){
      const loc = node.splice_locations.find(x => x.id === id);
      if (!loc) return;
      loc.isEditingPorts = false;
      loc.pending_ports = null;
      renderLocations();
      return;
    }
    if (action === "savePorts"){
      const loc = node.splice_locations.find(x => x.id === id);
      if (!loc) return;
      const nextPorts = normalizeTerminalPorts(loc.pending_ports ?? loc.terminal_ports);
      const ok = await updateTerminalPorts(loc.id, nextPorts);
      if (ok){
        loc.isEditingPorts = false;
        loc.pending_ports = null;
        renderLocations();
      }
      return;
    }
    if (action === "toggleComplete"){
      const loc = node.splice_locations.find(x => x.id === id);
      if (!loc) return;
      if (!hasAllRequiredSlotPhotos(loc)){
        toast("Photos required", "All required splice photos are needed before completion.");
        return;
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

  wrap.appendChild(list);

  const nameInput = wrap.querySelector("[data-autofocus='true']");
  if (nameInput){
    setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 0);
    nameInput.addEventListener("blur", async () => {
      await saveSpliceLocationName(nameInput.dataset.id, nameInput.value);
    });
    nameInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        await saveSpliceLocationName(nameInput.dataset.id, nameInput.value);
      }
    });
  }
}

function renderSplicePhotoGrid(loc){
  const requiredSlots = getRequiredSlotsForLocation(loc);
  const photos = loc.photosBySlot || {};
  const extraSlots = Object.keys(photos).filter((slot) => !requiredSlots.includes(slot));
  const orderedExtras = extraSlots.sort((a, b) => {
    const aNum = Number.parseInt(String(a).replace("port_", ""), 10);
    const bNum = Number.parseInt(String(b).replace("port_", ""), 10);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a).localeCompare(String(b));
  });
  const slots = requiredSlots.concat(orderedExtras);
  return `
    <div class="photo-grid">
      ${slots.map((slotKey) => renderSpliceSlotCard(loc, slotKey, requiredSlots.includes(slotKey))).join("")}
    </div>
  `;
}

function renderSpliceSlotCard(loc, slotKey, isRequired){
  const photo = loc.photosBySlot?.[slotKey];
  const label = getSlotLabel(slotKey);
  const badge = isRequired ? "" : '<span class="slot-badge">Extra</span>';
  const timestamp = photo?.taken_at ? new Date(photo.taken_at).toLocaleString() : "";
  const locked = isLocationBillingLocked(loc.id);
  const thumb = photo?.previewUrl
    ? `<img class="slot-thumb" src="${photo.previewUrl}" alt="${escapeHtml(label)} photo"/>`
    : photo
      ? `<div class="muted small">Photo captured</div>`
      : "";
  const placeholder = `
    <div class="slot-placeholder">
      <div class="camera-icon" aria-hidden="true"></div>
      <div class="muted small">Tap to capture</div>
    </div>
  `;
  return `
    <label class="photo-slot ${isRequired ? "" : "extra"}">
      <input type="file" accept="image/*" capture="environment" data-location-id="${loc.id}" data-slot-key="${slotKey}" />
      <div class="row" style="justify-content:space-between; width:100%;">
        <div class="slot-title">${escapeHtml(label)}</div>
        ${badge}
      </div>
      ${photo ? `
        ${thumb}
        <div class="slot-meta">${timestamp || "Timestamp pending"}</div>
        ${locked ? "" : `
          <div class="row" style="justify-content:flex-end; width:100%;">
            <button type="button" class="btn ghost small" data-action="removeSlotPhoto" data-location-id="${loc.id}" data-slot-key="${slotKey}">Remove</button>
          </div>
        `}
      ` : placeholder}
    </label>
  `;
}

async function updateTerminalPorts(locationId, nextPorts){
  const node = state.activeNode;
  if (!node) return false;
  const loc = node.splice_locations.find(x => x.id === locationId);
  if (!loc) return false;
  if (isLocationBillingLocked(loc.id)){
    toast("Billing locked", "Terminal ports are locked after billing is ready.");
    return false;
  }
  const normalized = normalizeTerminalPorts(nextPorts);
  if (normalized === loc.terminal_ports) return true;
  if (isDemo){
    loc.terminal_ports = normalized;
    renderLocations();
    renderProofChecklist();
    toast("Ports saved", `Terminal ports set to ${normalized}.`);
    return true;
  }
  const { error } = await state.client
    .from("splice_locations")
    .update({ terminal_ports: normalized })
    .eq("id", loc.id);
  if (error){
    toast("Update failed", error.message);
    return false;
  }
  loc.terminal_ports = normalized;
  renderLocations();
  renderProofChecklist();
  toast("Ports saved", `Terminal ports set to ${normalized}.`);
  return true;
}

async function saveSpliceLocationName(locationId, nextName){
  const node = state.activeNode;
  if (!node) return;
  const loc = node.splice_locations.find(x => x.id === locationId);
  if (!loc) return;
  if (isLocationBillingLocked(loc.id)){
    toast("Billing locked", "Location name is locked after billing is ready.");
    loc.isEditing = false;
    renderLocations();
    return;
  }
  const trimmed = String(nextName || "").trim();
  if (!trimmed){
    toast("Name required", "Enter a location name.");
    renderLocations();
    return;
  }
  if (trimmed === loc.name){
    loc.isEditing = false;
    renderLocations();
    return;
  }
  if (isDemo){
    loc.name = trimmed;
    loc.isEditing = false;
    renderLocations();
    return;
  }
  const { error } = await state.client
    .from("splice_locations")
    .update({ location_label: trimmed })
    .eq("id", loc.id);
  if (error){
    toast("Rename failed", error.message);
    return;
  }
  loc.name = trimmed;
  loc.isEditing = false;
  renderLocations();
}

async function handleSpliceSlotPhotoUpload(locationId, slotKey, file){
  const node = state.activeNode;
  if (!node) return;
  if (!file){
    toast("Choose a photo", "Pick a photo file first.");
    return;
  }
  const loc = node.splice_locations.find(l => l.id === locationId);
  if (!loc){
    toast("Location missing", "Splice location not found.");
    return;
  }
  if (isLocationBillingLocked(loc.id)){
    toast("Billing locked", "Photos are locked after billing is ready.");
    return;
  }
  const takenAt = nowISO();
  const previewUrl = URL.createObjectURL(file);
  loc.photosBySlot = loc.photosBySlot || {};
  loc.photosBySlot[slotKey] = { previewUrl, taken_at: takenAt, pending: true };
  renderLocations();
  renderProofChecklist();

  if (isDemo){
    loc.photosBySlot[slotKey] = { previewUrl, taken_at: takenAt };
    renderLocations();
    renderProofChecklist();
    return;
  }

  const uploadPath = await uploadProofPhoto(file, node.id, `splice-location/${locationId}`);
  if (!uploadPath){
    delete loc.photosBySlot[slotKey];
    renderLocations();
    renderProofChecklist();
    return;
  }

  const gps = state.lastGPS;
  const { data, error } = await state.client
    .from("splice_location_photos")
    .upsert({
      splice_location_id: loc.id,
      slot_key: slotKey,
      photo_path: uploadPath,
      taken_at: takenAt,
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      gps_accuracy_m: gps?.accuracy_m ?? null,
      uploaded_by: state.user?.id || null,
    }, { onConflict: "splice_location_id,slot_key" })
    .select("photo_path, taken_at, gps_lat, gps_lng, gps_accuracy_m")
    .maybeSingle();

  if (error){
    delete loc.photosBySlot[slotKey];
    renderLocations();
    renderProofChecklist();
    toast("Upload failed", error.message);
    return;
  }

  loc.photosBySlot[slotKey] = {
    path: data?.photo_path || uploadPath,
    taken_at: data?.taken_at || takenAt,
    gps: data?.gps_lat != null && data?.gps_lng != null
      ? { lat: data.gps_lat, lng: data.gps_lng, accuracy_m: data.gps_accuracy_m }
      : null,
    previewUrl,
  };
  await loadSplicePhotos(node.id, [loc]);
  renderLocations();
  renderProofChecklist();
}

async function deleteSpliceSlotPhoto(locationId, slotKey){
  const node = state.activeNode;
  if (!node) return;
  const loc = node.splice_locations.find(l => l.id === locationId);
  if (!loc) return;
  if (isLocationBillingLocked(loc.id)){
    toast("Billing locked", "Photos are locked after billing is ready.");
    return;
  }
  const existing = loc.photosBySlot?.[slotKey];
  if (!existing){
    toast("No photo", "No photo found for this slot.");
    return;
  }
  if (isDemo){
    delete loc.photosBySlot[slotKey];
    renderLocations();
    renderProofChecklist();
    return;
  }

  const path = existing.path || existing.photo_path;
  if (path){
    const { error: storageErr } = await state.client
      .storage
      .from("proof-photos")
      .remove([path]);
    if (storageErr){
      toast("Remove failed", storageErr.message);
    }
  }

  const { error } = await state.client
    .from("splice_location_photos")
    .delete()
    .eq("splice_location_id", loc.id)
    .eq("slot_key", slotKey);
  if (error){
    toast("Remove failed", error.message);
    return;
  }
  delete loc.photosBySlot[slotKey];
  renderLocations();
  renderProofChecklist();
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
  const el = $("photoStatus");
  const mini = $("photoStatusMini");
  if (!state.lastProof){
    if (el) el.textContent = "No photo captured";
    if (mini) mini.textContent = "No photo captured yet.";
    renderProofPreview();
    return;
  }
  const gps = state.lastProof.gps
    ? `${state.lastProof.gps.lat.toFixed(6)}, ${state.lastProof.gps.lng.toFixed(6)}`
    : "GPS missing";
  if (el) el.textContent = `Photo ready: ${state.lastProof.captured_at} (${gps})`;
  if (mini) mini.textContent = `Photo ready: ${state.lastProof.captured_at}`;
  renderProofPreview();
}

function renderProofPreview(){
  const wrap = $("photoPreview");
  if (!wrap) return;
  const items = [
    state.lastProof ? { label: "Usage photo", data: state.lastProof } : null,
  ].filter(Boolean);

  if (!items.length){
    wrap.innerHTML = '<div class="muted small">No photo captured yet.</div>';
    return;
  }

  wrap.innerHTML = items.map((item) => {
    const photoUrl = item.data.previewUrl || "";
    const gps = item.data.gps
      ? `${item.data.gps.lat.toFixed(6)}, ${item.data.gps.lng.toFixed(6)}`
      : "GPS missing";
    return `
      <div class="row" style="gap:16px; align-items:flex-start;">
        ${photoUrl ? `<img src="${photoUrl}" alt="usage photo" />` : ""}
        <div>
          <div style="font-weight:900">${item.label}</div>
          <div class="muted small">${item.data.captured_at}</div>
          <div class="muted small">${gps}</div>
        </div>
      </div>
    `;
  }).join("<div class=\"hr\"></div>");
}

function clearProof(){
  state.lastProof = null;
  state.cameraInvalidated = false;
  setProofStatus();
  renderProofPreview();
}

function clearUsageProof(){
  state.lastProof = null;
  state.cameraInvalidated = false;
  setProofStatus();
  renderProofPreview();
}

async function captureUsageProof(){
  const shot = await captureFrame();
  if (!shot) return;
  state.lastProof = {
    file: makeFileFromBlob(shot.blob),
    captured_at: shot.captured_at,
    gps: shot.gps,
    previewUrl: shot.previewUrl,
    camera: true,
  };
  setProofStatus();
}

async function uploadBackfillPhoto(file, projectId, nodeId, locationId, photoType){
  if (!state.client) return null;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = Date.now();
  const root = projectId || "project";
  const path = `${root}/${nodeId}/${locationId}/${photoType}/${ts}-${safeName}`;
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

async function handleBackfillPhotoUpload(photoType, file){
  const node = state.activeNode;
  const projectId = state.activeProject?.id || null;
  if (!node){
    toast("Open a node", "Select or open a node first.");
    return;
  }
  if (!isOwner()){
    toast("Not allowed", "Owner role required.");
    return;
  }
  if (!state.nodeProofStatus?.backfill_allowed){
    toast("Backfill locked", "Backfill is not enabled for this node.");
    return;
  }
  if (!file){
    toast("Choose a photo", "Pick a photo file first.");
    return;
  }
  const locId = $("backfillLocationSelect")?.value;
  if (!locId){
    toast("Location required", "Select a splice location first.");
    return;
  }
  const loc = node.splice_locations.find(l => l.id === locId);
  if (!loc){
    toast("Location missing", "Splice location not found.");
    return;
  }
  const slotKey = getBackfillSlotKey(loc, photoType);
  if (!slotKey){
    toast("Slots full", "All port slots already have photos. Use the slot grid to retake.");
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  const exifTakenAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;
  const takenAt = exifTakenAt || nowISO();
  loc.photosBySlot = loc.photosBySlot || {};
  loc.photosBySlot[slotKey] = { previewUrl, taken_at: takenAt, pending: true, backfilled: true };
  renderLocations();
  renderProofChecklist();

  if (isDemo){
    loc.photosBySlot[slotKey] = { previewUrl, taken_at: takenAt, backfilled: true };
    renderLocations();
    renderProofChecklist();
    return;
  }

  const uploadPath = await uploadBackfillPhoto(file, projectId, node.id, loc.id, photoType);
  if (!uploadPath){
    delete loc.photosBySlot[slotKey];
    renderLocations();
    renderProofChecklist();
    return;
  }

  const { data, error } = await state.client
    .from("splice_location_photos")
    .upsert({
      splice_location_id: loc.id,
      slot_key: slotKey,
      photo_path: uploadPath,
      taken_at: takenAt,
      uploaded_by: state.user?.id || null,
      source: "upload",
      backfilled: true,
      exif_taken_at: exifTakenAt,
    }, { onConflict: "splice_location_id,slot_key" })
    .select("photo_path, taken_at")
    .maybeSingle();

  if (error){
    delete loc.photosBySlot[slotKey];
    renderLocations();
    renderProofChecklist();
    toast("Upload failed", error.message);
    return;
  }

  loc.photosBySlot[slotKey] = {
    path: data?.photo_path || uploadPath,
    taken_at: data?.taken_at || takenAt,
    previewUrl,
    backfilled: true,
  };
  await loadNodeProofStatus(node.id);
  renderLocations();
  renderProofChecklist();
}

async function uploadProofPhoto(file, nodeId, prefix){
  if (!state.client) return null;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const folder = `${prefix || "photos"}/node-${nodeId}`;
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
  const { error } = await state.client.from("proof_uploads").insert({
    device_info: navigator.userAgent,
    camera: true,
    ...payload,
  });
  if (error){
    toast("Photo log failed", error.message);
  }
}

async function submitUsage(itemId, qty){
  const node = state.activeNode;
  if (!node) return;
  if (!Number.isFinite(qty) || qty <= 0){
    toast("Qty required", "Enter a valid quantity to submit.");
    return;
  }
  if (!state.lastProof?.file || !state.lastProof?.gps || !state.lastProof?.captured_at || state.cameraInvalidated){
    toast("Photos required", "Capture a live photo with GPS before submitting usage.");
    return;
  }
  if (!state.lastProof.camera){
    toast("Camera required", "Camera capture required. Gallery uploads are not allowed.");
    return;
  }
  const jobNumber = state.activeProject?.job_number;
  if (!jobNumber){
    toast("Job required", "Job number required to submit usage photos.");
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
      captured_at_client: state.lastProof.captured_at,
      gps_lat: state.lastProof.gps.lat,
      gps_lng: state.lastProof.gps.lng,
      gps_accuracy_m: state.lastProof.gps.accuracy_m,
      photo_path: "demo-only",
      proof_required: true,
      camera: true,
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
    clearUsageProof();
    state.cameraInvalidated = false;
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
      captured_at_client: state.lastProof.captured_at,
      gps_lat: state.lastProof.gps.lat,
      gps_lng: state.lastProof.gps.lng,
      gps_accuracy_m: state.lastProof.gps.accuracy_m,
      proof_required: true,
      camera: true,
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
      captured_at_client: state.lastProof.captured_at,
      job_number: jobNumber,
      camera: true,
      captured_by: state.user?.id || null,
    });
  }
  if (status === "needs_approval"){
    toast("Needs approval", "Overage submitted and pending approval.");
  } else {
    toast("Usage submitted", "Approved usage recorded.");
  }
  clearUsageProof();
  state.cameraInvalidated = false;
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
    .select("id,node_id,item_id,unit_type_id,qty,status,photo_path,gps_lat,gps_lng,captured_at_server,captured_at_client,proof_required,camera")
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
  const photos = computeProofStatus(node);
  const eligible = completion.pct === 100 && node.ready_for_billing && photos.photosOk;

  html += `<div class="note">
    <div style="font-weight:900;">Billing gate</div>
    <div class="muted small">Node can be invoiced only when: splice locations complete + inventory checklist complete + photos captured + node marked READY.</div>
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


function renderBillingLocations(){
  const wrap = $("billingLocationList");
  const status = $("billingStatus");
  if (!wrap || !status) return;
  if (!state.activeProject){
    wrap.innerHTML = '<div class="muted small">Select a project to see locations.</div>';
    status.textContent = "";
    return;
  }
  const rows = state.billingLocations || [];
  status.textContent = rows.length ? `${rows.length} locations` : "No locations";
  if (!rows.length){
    wrap.innerHTML = '<div class="muted small">No splice locations yet.</div>';
    return;
  }
  wrap.innerHTML = rows.map((loc) => {
    const required = getLocationRequiredPhotos(loc, state.activeProject?.id);
    const uploaded = loc.photo_count || 0;
    const proofOk = uploaded >= required;
    const proofLabel = required === 0 ? "Proof: Not required" : `Proof: ${uploaded}/${required}`;
    const invoiceStatus = loc.invoice_status || "draft";
    const invoiceLabel = invoiceStatus.toUpperCase();
    const disabled = !proofOk && !isOwner();
    return `
      <div class="billing-location-card ${disabled ? "disabled" : ""}">
        <div class="row" style="justify-content:space-between;">
          <div>
            <div style="font-weight:900">${escapeHtml(loc.location_label || "Splice location")}</div>
            <div class="muted small">${escapeHtml(loc.node_number || "")}</div>
          </div>
          <span class="status-pill ${proofOk ? "ok" : "warn"}">${proofLabel} ${proofOk ? "OK" : "LOCKED"}</span>
        </div>
        <div class="row" style="justify-content:space-between;">
          <span class="status-pill">${invoiceLabel}</span>
          <button class="btn secondary" data-action="openBilling" data-id="${loc.id}" ${disabled ? "disabled" : ""}>Open billing</button>
        </div>
      </div>
    `;
  }).join("");
}


function renderBillingDetail(){
  const wrap = $("billingDetail");
  if (!wrap) return;
  const loc = state.billingLocation;
  const exportBtn = $("btnBillingExportCsv");
  const printBtn = $("btnBillingPrint");
  const importBtn = $("btnImportUsage");
  if (!loc){
    wrap.innerHTML = '<div class="muted small">Select a location to start billing.</div>';
    if (exportBtn) exportBtn.disabled = true;
    if (printBtn) printBtn.disabled = true;
    if (importBtn) importBtn.disabled = true;
    return;
  }
  const invoice = state.billingInvoice;
  const items = state.billingItems || [];
  const canEditRates = isBillingManager();
  const proofRequired = getLocationRequiredPhotos(loc, state.activeProject?.id);
  const proofUploaded = loc.photo_count || 0;
  const proofOk = proofUploaded >= proofRequired;
  const proofLabel = proofRequired === 0 ? "Not required" : `${proofUploaded}/${proofRequired}`;
  const totals = computeInvoiceTotals(items);
  const status = invoice?.status || "draft";
  const locked = ["submitted", "paid", "void"].includes(status);
  const billingUnlocked = isBillingUnlocked();
  const editLocked = locked || !billingUnlocked;
  const rateCard = state.rateCards.find(r => r.id === state.activeRateCardId);
  const overrides = state.ownerOverrides || [];
  const hasOverride = overrides.length > 0;
  const showOverrideAction = !billingUnlocked && isOwner() && !isDemo;

  wrap.innerHTML = `
    <div class="note">
      <div style="font-weight:900;">${escapeHtml(loc.location_label || "Location")}</div>
      <div class="muted small">Node: ${escapeHtml(loc.node_number || "-")}</div>
      <div class="muted small">Proof: ${proofLabel} ${proofOk ? "OK" : "LOCKED"}</div>
      <div class="muted small">Rate card: ${escapeHtml(rateCard?.name || "Default")}</div>
      <div class="muted small">Status: ${escapeHtml(status.toUpperCase())}</div>
      ${hasOverride ? '<div class="muted small">Override: ACTIVE</div>' : ""}
    </div>
    ${!billingUnlocked ? `
      <div class="note warning" style="margin-top:12px;">
        <div style="font-weight:900;">Billing locked</div>
        <div class="muted small">Proof is incomplete for this node. Owner can apply an override if needed.</div>
        ${showOverrideAction ? '<button id="btnOwnerOverride" class="btn secondary" style="margin-top:10px;">Owner override</button>' : ""}
      </div>
    ` : ""}
    ${showOverrideAction ? `
      <div id="ownerOverridePanel" class="note override-panel" style="display:none; margin-top:12px;">
        <div style="font-weight:900;">Owner override</div>
        <div class="muted small" style="margin-bottom:8px;">Reason is required for audit.</div>
        <div class="row" style="flex-wrap:wrap;">
          <select id="ownerOverrideType" class="input" style="width:220px;">
            <option value="BILLING_UNLOCKED">Unlock billing</option>
            <option value="BACKFILL_ALLOWED">Allow backfill uploads</option>
          </select>
          <input id="ownerOverrideReason" class="input" placeholder="Reason (required)" style="min-width:220px; flex:1 1 auto;" />
          <button id="btnApplyOwnerOverride" class="btn">Apply</button>
        </div>
      </div>
    ` : ""}
    <div class="hr"></div>
    <table class="table billing-table">
      <thead>
        <tr>
          <th>Work code</th>
          <th>Description</th>
          <th>Unit</th>
          <th>Qty</th>
          <th>Rate</th>
          <th>Amount</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, idx) => renderBillingItemRow(item, idx, canEditRates && !editLocked, editLocked)).join("")}
      </tbody>
    </table>
    <div class="billing-actions">
      <button id="btnAddLineItem" class="btn secondary" ${editLocked ? "disabled" : ""}>Add line item</button>
    </div>
    <div class="hr"></div>
    <div class="billing-summary">
      <div>Subtotal: <b>${formatMoney(totals.subtotal)}</b></div>
      <div>Tax: <b>${formatMoney(totals.tax)}</b></div>
      <div>Total: <b>${formatMoney(totals.total)}</b></div>
    </div>
    <div class="hr"></div>
    <div>
      <div class="muted small">Notes</div>
      <textarea id="billingNotes" class="input" rows="3" style="width:100%;" ${editLocked ? "disabled" : ""}>${escapeHtml(invoice?.notes || "")}</textarea>
    </div>
    <div class="billing-actions">
      <button id="btnBillingSave" class="btn" ${editLocked ? "disabled" : ""}>Save</button>
      <button id="btnBillingReady" class="btn secondary" ${editLocked || !hasBillableItems(items) ? "disabled" : ""}>Ready to submit</button>
    </div>
  `;

  wrap.querySelectorAll("[data-action='removeLine']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number.parseInt(btn.dataset.index, 10);
      removeBillingItem(idx);
    });
  });
  wrap.querySelectorAll("[data-action='codeChange']").forEach((el) => {
    el.addEventListener("change", () => handleBillingItemChange(el.dataset.index, "work_code_id", el.value));
  });
  wrap.querySelectorAll("[data-action='qtyChange']").forEach((el) => {
    el.addEventListener("input", () => handleBillingItemChange(el.dataset.index, "qty", el.value));
  });
  wrap.querySelectorAll("[data-action='rateChange']").forEach((el) => {
    el.addEventListener("input", () => handleBillingItemChange(el.dataset.index, "rate", el.value));
  });

  const addBtn = wrap.querySelector("#btnAddLineItem");
  if (addBtn) addBtn.addEventListener("click", () => addBillingItem());
  const saveBtn = wrap.querySelector("#btnBillingSave");
  if (saveBtn) saveBtn.addEventListener("click", () => saveBillingInvoice());
  const readyBtn = wrap.querySelector("#btnBillingReady");
  if (readyBtn) readyBtn.addEventListener("click", () => markInvoiceReady());

  const overrideBtn = wrap.querySelector("#btnOwnerOverride");
  if (overrideBtn){
    overrideBtn.addEventListener("click", () => {
      const panel = wrap.querySelector("#ownerOverridePanel");
      if (panel) panel.style.display = "";
    });
  }
  const applyOverrideBtn = wrap.querySelector("#btnApplyOwnerOverride");
  if (applyOverrideBtn){
    applyOverrideBtn.addEventListener("click", () => {
      const type = wrap.querySelector("#ownerOverrideType")?.value || "";
      const reason = wrap.querySelector("#ownerOverrideReason")?.value || "";
      createOwnerOverride(type, reason);
    });
  }

  const canExport = ["ready", "submitted", "paid"].includes(status);
  if (exportBtn) exportBtn.disabled = !canExport;
  if (printBtn) printBtn.disabled = !canExport;
  if (importBtn) importBtn.disabled = editLocked;
}

function renderBillingItemRow(item, idx, canEditRates, locked){
  const workCodes = state.workCodes || [];
  const options = ['<option value="">Select</option>'].concat(
    workCodes.map((code) => `<option value="${code.id}" ${code.id === item.work_code_id ? "selected" : ""}>${escapeHtml(code.code)}</option>`)
  );
  const amount = Number(item.qty || 0) * Number(item.rate || 0);
  const desc = item.description || "";
  const unit = item.unit || "";
  return `
    <tr>
      <td><select data-action="codeChange" data-index="${idx}" ${locked ? "disabled" : ""}>${options.join("")}</select></td>
      <td>${escapeHtml(desc)}</td>
      <td>${escapeHtml(unit)}</td>
      <td><input data-action="qtyChange" data-index="${idx}" type="number" min="0" step="0.01" value="${item.qty ?? 0}" ${locked ? "disabled" : ""} /></td>
      <td><input data-action="rateChange" data-index="${idx}" type="number" min="0" step="0.01" value="${item.rate ?? 0}" ${canEditRates ? "" : "disabled"} /></td>
      <td>${formatMoney(amount)}</td>
      <td><button class="btn ghost small" data-action="removeLine" data-index="${idx}" ${locked ? "disabled" : ""}>Remove</button></td>
    </tr>
  `;
}

function computeInvoiceTotals(items){
  const subtotal = (items || []).reduce((sum, item) => {
    const qty = Number(item.qty || 0);
    const rate = Number(item.rate || 0);
    return sum + qty * rate;
  }, 0);
  const tax = 0;
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

function hasBillableItems(items){
  return (items || []).some(item => Number(item.qty || 0) > 0);
}

function getWorkCodeById(id){
  return (state.workCodes || []).find(code => code.id === id) || null;
}

function getRateForWorkCode(workCodeId){
  const cardItem = (state.rateCardItems || []).find(r => r.work_code_id === workCodeId);
  if (cardItem) return Number(cardItem.rate || 0);
  const work = getWorkCodeById(workCodeId);
  return Number(work?.default_rate || 0);
}

function addBillingItem(){
  state.billingItems = state.billingItems || [];
  state.billingItems.push({
    work_code_id: "",
    description: "",
    unit: "",
    qty: 0,
    rate: 0,
    sort_order: state.billingItems.length,
  });
  renderBillingDetail();
}

function removeBillingItem(index){
  state.billingItems = (state.billingItems || []).filter((_, idx) => idx !== index);
  renderBillingDetail();
}

function handleBillingItemChange(index, field, value){
  const item = (state.billingItems || [])[Number(index)];
  if (!item) return;
  if (field === "work_code_id"){
    item.work_code_id = value;
    const code = getWorkCodeById(value);
    item.description = code?.description || "";
    item.unit = code?.unit || "";
    item.rate = getRateForWorkCode(value);
  } else if (field === "qty"){
    item.qty = Number(value || 0);
  } else if (field === "rate"){
    if (isBillingManager()){
      item.rate = Number(value || 0);
    }
  }
  renderBillingDetail();
}

async function openBillingLocation(locationId){
  const loc = (state.billingLocations || []).find(l => l.id === locationId);
  if (!loc) return;
  state.billingLocation = loc;
  await loadNodeProofStatus(loc.node_id);
  await loadOwnerOverrides(loc.node_id);
  if (!state.activeRateCardId && state.rateCards.length){
    state.activeRateCardId = state.rateCards[0].id;
    await loadRateCardItems(state.activeRateCardId);
  }
  await ensureBillingInvoice();
  renderBillingDetail();
}

async function ensureBillingInvoice(){
  const loc = state.billingLocation;
  if (!loc) return;
  if (isDemo){
    state.billingInvoice = {
      id: `inv-${loc.id}`,
      project_id: state.activeProject?.id || null,
      location_id: loc.id,
      invoice_number: `SC-${new Date().getFullYear()}-0001`,
      status: "draft",
      notes: "",
    };
    state.billingItems = state.billingItems?.length ? state.billingItems : [];
    return;
  }
  const { data, error } = await state.client
    .from("invoices")
    .select("id, project_id, location_id, invoice_number, status, notes, subtotal, tax, total")
    .eq("project_id", state.activeProject?.id || null)
    .eq("location_id", loc.id)
    .maybeSingle();
  if (error){
    toast("Invoice load error", error.message);
    return;
  }
  if (data){
    state.billingInvoice = data;
    await loadInvoiceItems(data.id);
    return;
  }
  const invoiceNumber = await generateInvoiceNumber();
  const { data: created, error: createErr } = await state.client
    .from("invoices")
    .insert({
      project_id: state.activeProject?.id || null,
      location_id: loc.id,
      invoice_number: invoiceNumber,
      status: "draft",
      created_by: state.user?.id || null,
    })
    .select("id, project_id, location_id, invoice_number, status, notes, subtotal, tax, total")
    .maybeSingle();
  if (createErr){
    toast("Invoice create error", createErr.message);
    return;
  }
  state.billingInvoice = created;
  state.billingItems = [];
}

async function loadInvoiceItems(invoiceId){
  if (!invoiceId){
    state.billingItems = [];
    return;
  }
  if (isDemo){
    return;
  }
  const { data, error } = await state.client
    .from("invoice_items")
    .select("id, invoice_id, work_code_id, description, unit, qty, rate, sort_order")
    .eq("invoice_id", invoiceId)
    .order("sort_order");
  if (error){
    toast("Line items error", error.message);
    return;
  }
  state.billingItems = (data || []).map((row) => {
    const work = getWorkCodeById(row.work_code_id);
    return {
      ...row,
      description: row.description || work?.description || "",
      unit: row.unit || work?.unit || "",
    };
  });
}

async function saveBillingInvoice(){
  const invoice = state.billingInvoice;
  if (!invoice){
    toast("No invoice", "Select a location first.");
    return;
  }
  if (!isBillingUnlocked()){
    toast("Billing locked", "Proof is incomplete for this node.");
    return;
  }
  const totals = computeInvoiceTotals(state.billingItems);
  const notes = $("billingNotes")?.value || "";

  if (isDemo){
    state.billingInvoice = { ...invoice, notes, ...totals };
    toast("Saved", "Invoice saved (demo).");
    renderBillingDetail();
    return;
  }

  const { error: invErr } = await state.client
    .from("invoices")
    .update({
      notes,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice.id);
  if (invErr){
    toast("Save failed", invErr.message);
    return;
  }

  await upsertInvoiceItems(invoice.id, state.billingItems || []);
  toast("Saved", "Invoice saved.");
  await loadBillingLocations(state.activeProject?.id || null);
}

async function upsertInvoiceItems(invoiceId, items){
  if (isDemo) return;
  const payload = (items || []).map((item, idx) => ({
    invoice_id: invoiceId,
    work_code_id: item.work_code_id || null,
    description: item.description || "",
    unit: item.unit || "",
    qty: Number(item.qty || 0),
    rate: Number(item.rate || 0),
    sort_order: item.sort_order ?? idx,
  })).map((row, idx) => {
    const item = items[idx];
    if (item && item.id) row.id = item.id;
    return row;
  });
  if (!payload.length){
    await state.client.from("invoice_items").delete().eq("invoice_id", invoiceId);
    return;
  }
  const keepIds = payload.map(r => r.id).filter(Boolean);
  if (keepIds.length){
    const idList = keepIds.map(id => `"${id}"`).join(",");
    await state.client
      .from("invoice_items")
      .delete()
      .eq("invoice_id", invoiceId)
      .not("id", "in", `(${idList})`);
  }
  const { error } = await state.client
    .from("invoice_items")
    .upsert(payload, { onConflict: "id" });
  if (error){
    toast("Line items save failed", error.message);
  }
}

async function markInvoiceReady(){
  const invoice = state.billingInvoice;
  if (!invoice){
    toast("No invoice", "Select a location first.");
    return;
  }
  if (!isBillingUnlocked()){
    toast("Billing locked", "Proof is incomplete for this node.");
    return;
  }
  if (!hasBillableItems(state.billingItems)){
    toast("Missing items", "Add at least one line item with qty.");
    return;
  }
  if (isDemo){
    state.billingInvoice.status = "ready";
    toast("Ready", "Invoice marked ready (demo).");
    renderBillingDetail();
    return;
  }
  const { error } = await state.client
    .from("invoices")
    .update({ status: "ready", updated_at: new Date().toISOString() })
    .eq("id", invoice.id);
  if (error){
    toast("Update failed", error.message);
    return;
  }
  state.billingInvoice.status = "ready";
  toast("Ready", "Invoice marked ready.");
  await loadBillingLocations(state.activeProject?.id || null);
  renderBillingDetail();
}

async function createOwnerOverride(overrideType, reason){
  if (!isOwner()){
    toast("Not allowed", "Owner role required.");
    return;
  }
  const loc = state.billingLocation;
  const projectId = state.activeProject?.id || null;
  const nodeId = loc?.node_id || null;
  const trimmed = String(reason || "").trim();
  if (!projectId || !nodeId){
    toast("Missing context", "Select a location first.");
    return;
  }
  if (!trimmed){
    toast("Reason required", "Provide a reason for the override.");
    return;
  }
  if (isDemo){
    state.ownerOverrides = state.ownerOverrides || [];
    state.ownerOverrides.unshift({
      id: `override-${Date.now()}`,
      override_type: overrideType,
      reason: trimmed,
      created_at: nowISO(),
      node_id: nodeId,
    });
    toast("Override added", "Override applied (demo).");
    renderBillingDetail();
    return;
  }
  const { error } = await state.client
    .rpc("create_owner_override", {
      project_id: projectId,
      node_id: nodeId,
      override_type: overrideType,
      reason: trimmed,
      splice_location_id: null,
    });
  if (error){
    toast("Override failed", error.message);
    return;
  }
  toast("Override added", "Override applied.");
  await loadOwnerOverrides(nodeId);
  await loadNodeProofStatus(nodeId);
  renderBillingDetail();
}

async function generateInvoiceNumber(){
  const year = new Date().getFullYear();
  if (isDemo) return `SC-${year}-0001`;
  const { data } = await state.client
    .from("invoices")
    .select("invoice_number")
    .ilike("invoice_number", `SC-${year}-%`);
  const used = (data || []).map(r => Number(String(r.invoice_number || "").split("-")[2] || 0)).filter(n => Number.isFinite(n));
  const next = (used.length ? Math.max(...used) + 1 : 1);
  return `SC-${year}-${String(next).padStart(4, "0")}`;
}

function exportInvoiceCsv(){
  const invoice = state.billingInvoice;
  const loc = state.billingLocation;
  if (!invoice || !loc) return;
  const project = state.activeProject;
  const overrideUsed = (state.ownerOverrides || []).length > 0;
  const header = [
    ["Invoice Number", invoice.invoice_number || ""],
    ["Project", project?.name || ""],
    ["Job Number", project?.job_number || ""],
    ["Location", loc.location_label || ""],
    ["Prepared By", state.profile?.display_name || state.user?.email || ""],
    ["Prepared At", new Date().toLocaleString()],
    ["Work Codes", (state.billingItems || []).map(i => getWorkCodeById(i.work_code_id)?.code).filter(Boolean).join(", ")],
    ["Status", invoice.status || ""],
    ["Override Used", overrideUsed ? "Yes" : "No"],
  ];
  const rows = (state.billingItems || []).map((item) => ([
    getWorkCodeById(item.work_code_id)?.code || "",
    item.description || "",
    item.unit || "",
    item.qty ?? 0,
    item.rate ?? 0,
    (Number(item.qty || 0) * Number(item.rate || 0)).toFixed(2),
  ]));
  const csv = []
    .concat(header.map(row => row.map(escapeCsv).join(",")))
    .concat([["Work Code","Description","Unit","Qty","Rate","Amount"].join(",")])
    .concat(rows.map(row => row.map(escapeCsv).join(",")))
    .join("\n");
  downloadFile(`invoice-${invoice.invoice_number || "draft"}.csv`, csv, "text/csv");
}

function escapeCsv(value){
  const str = String(value ?? "");
  if (/[",\n]/.test(str)){
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadFile(filename, content, type){
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function printInvoice(){
  const invoice = state.billingInvoice;
  const loc = state.billingLocation;
  if (!invoice || !loc) return;
  const project = state.activeProject;
  const items = state.billingItems || [];
  const totals = computeInvoiceTotals(items);
  const now = new Date().toLocaleString();
  const codeList = items.map(i => getWorkCodeById(i.work_code_id)?.code).filter(Boolean).join(", ");
  const overrideUsed = (state.ownerOverrides || []).length > 0;
  const html = `
    <html>
      <head>
        <title>Invoice ${invoice.invoice_number || ""}</title>
        <style>
          body{font-family:Arial, sans-serif; padding:24px; color:#111;}
          h1{margin:0 0 8px;}
          table{width:100%; border-collapse:collapse; margin-top:16px;}
          th,td{border-bottom:1px solid #ccc; text-align:left; padding:8px;}
          .meta{margin-top:12px; font-size:14px;}
          .totals{margin-top:16px; text-align:right;}
        </style>
      </head>
      <body>
        <h1>Invoice ${invoice.invoice_number || ""}</h1>
        <div class="meta">Project: ${escapeHtml(project?.name || "")} (${escapeHtml(project?.job_number || "")})</div>
        <div class="meta">Location: ${escapeHtml(loc.location_label || "")}</div>
        <div class="meta">Prepared by: ${escapeHtml(state.profile?.display_name || state.user?.email || "")}</div>
        <div class="meta">Prepared at: ${escapeHtml(now)}</div>
        <div class="meta">Work codes: ${escapeHtml(codeList || "-")}</div>
        <div class="meta">Override used: ${overrideUsed ? "Yes" : "No"}</div>
        <table>
          <thead><tr><th>Work Code</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            ${items.map((item) => `
              <tr>
                <td>${escapeHtml(getWorkCodeById(item.work_code_id)?.code || "")}</td>
                <td>${escapeHtml(item.description || "")}</td>
                <td>${escapeHtml(item.unit || "")}</td>
                <td>${Number(item.qty || 0)}</td>
                <td>${formatMoney(item.rate)}</td>
                <td>${formatMoney(Number(item.qty || 0) * Number(item.rate || 0))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="totals">
          <div>Subtotal: ${formatMoney(totals.subtotal)}</div>
          <div>Tax: ${formatMoney(totals.tax)}</div>
          <div><b>Total: ${formatMoney(totals.total)}</b></div>
        </div>
      </body>
    </html>
  `;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

async function importUsageToInvoice(){
  const invoice = state.billingInvoice;
  if (!invoice){
    toast("No invoice", "Select a location first.");
    return;
  }
  const nodeId = state.billingLocation?.node_id;
  if (!nodeId){
    toast("No node", "Node data unavailable for this location.");
    return;
  }
  if (isDemo){
    toast("Imported", "Usage imported (demo).");
    return;
  }
  const { data, error } = await state.client
    .from("usage_events")
    .select("qty, unit_type_id, unit_types(code, description)")
    .eq("node_id", nodeId)
    .eq("status", "approved");
  if (error){
    toast("Usage load error", error.message);
    return;
  }
  const map = new Map();
  (data || []).forEach((row) => {
    const code = row.unit_types?.code;
    if (!code) return;
    map.set(code, (map.get(code) || 0) + Number(row.qty || 0));
  });
  const items = [];
  map.forEach((qty, code) => {
    const work = (state.workCodes || []).find(w => w.code === code);
    if (!work) return;
    items.push({
      work_code_id: work.id,
      description: work.description || "",
      unit: work.unit || "",
      qty,
      rate: getRateForWorkCode(work.id),
    });
  });
  if (!items.length){
    toast("No matches", "No usage matches work codes.");
    return;
  }
  state.billingItems = items;
  renderBillingDetail();
  toast("Imported", "Usage imported into invoice.");
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
    if (e.camera !== true) return true;
    const serverTime = e.captured_at_server || e.captured_at;
    return !e.photo_path || e.gps_lat == null || e.gps_lng == null || !serverTime;
  });
}

function getUnitTypeMeta(unitTypeId){
  const unit = state.unitTypes.find(u => u.id === unitTypeId);
  if (!unit) return { code: "-", description: "" };
  return { code: unit.code, description: unit.description || "" };
}

function getLocationProofRule(projectId){
  if (!projectId) return null;
  return (state.locationProofRules || []).find(r => r.project_id === projectId && !r.location_type) || null;
}

function getLocationRequiredPhotos(loc, projectId){
  if (loc && Number.isFinite(loc.proof_required)){
    return Math.max(0, Number(loc.proof_required || 0));
  }
  const rule = getLocationProofRule(projectId);
  if (rule && Number.isFinite(rule.required_photos)){
    return Math.max(0, rule.required_photos);
  }
  const slots = requiredSlotsForPorts(loc?.terminal_ports ?? DEFAULT_TERMINAL_PORTS);
  return slots.length;
}

function getLocationProofUploaded(loc){
  const photos = loc?.photosBySlot || {};
  return Object.keys(photos).length;
}

function getLocationBillingStatus(locationId){
  const row = (state.billingLocations || []).find(l => l.id === locationId);
  return row?.invoice_status || "draft";
}

function isLocationBillingLocked(locationId){
  const status = getLocationBillingStatus(locationId);
  return ["ready", "submitted", "paid", "void"].includes(String(status).toLowerCase());
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

async function loadSplicePhotos(nodeId, locs){
  if (isDemo){
    locs.forEach((loc) => {
      loc.photosBySlot = loc.photosBySlot || {};
    });
    return;
  }
  if (!state.client || !locs.length) return;
  const locIds = locs.map((loc) => loc.id);
  const { data, error } = await state.client
    .from("splice_location_photos")
    .select("splice_location_id, slot_key, photo_path, taken_at, gps_lat, gps_lng, gps_accuracy_m")
    .in("splice_location_id", locIds);
  if (error){
    toast("Photos load error", error.message);
    return;
  }
  const byLoc = new Map();
  (data || []).forEach((row) => {
    if (!row.slot_key) return;
    const key = row.splice_location_id;
    if (!byLoc.has(key)) byLoc.set(key, {});
    const current = byLoc.get(key);
    current[row.slot_key] = {
      path: row.photo_path,
      taken_at: row.taken_at,
      gps: row.gps_lat != null && row.gps_lng != null
        ? { lat: row.gps_lat, lng: row.gps_lng, accuracy_m: row.gps_accuracy_m }
        : null,
    };
  });
  locs.forEach((loc) => {
    const photos = byLoc.get(loc.id) || {};
    const existing = loc.photosBySlot || {};
    const merged = {};
    Object.keys(photos).forEach((slotKey) => {
      merged[slotKey] = {
        ...photos[slotKey],
        previewUrl: existing[slotKey]?.previewUrl || null,
      };
    });
    loc.photosBySlot = merged;
  });
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
  const wrap = $("photoChecklist");
  const summary = $("photoChecklistSummary");
  const node = state.activeNode;
  if (!wrap || !summary){
    return;
  }
  if (!node){
    wrap.innerHTML = '<div class="muted small">Open a node to see photo requirements.</div>';
    summary.innerHTML = '<div class="muted small">No node selected.</div>';
    renderBackfillPanel();
    return;
  }

  const locs = node.splice_locations || [];
  const missingLocs = locs.filter(l => !hasAllRequiredSlotPhotos(l));
  const slotCounts = locs.map((loc) => {
    const requiredSlots = getRequiredSlotsForLocation(loc);
    const photos = loc.photosBySlot || {};
    const missingSlots = requiredSlots.filter((slot) => !photos[slot]).length;
    return {
      required: requiredSlots.length,
      missing: missingSlots,
      uploaded: requiredSlots.length - missingSlots,
    };
  });
  const missingSlotCount = slotCounts.reduce((sum, row) => sum + row.missing, 0);
  const missingUsage = getMissingUsageProof(node.id);

  summary.innerHTML = `
    <div style="font-weight:900;">Photos required</div>
    <div class="muted small">${missingLocs.length} splice locations missing photos (${missingSlotCount} slots), ${missingUsage.length} usage entries missing photos.</div>
  `;

  if (!locs.length){
    wrap.innerHTML = '<div class="muted small">No splice locations yet.</div>';
    return;
  }

  wrap.innerHTML = `
    <table class="table">
      <thead><tr><th>Location</th><th>Photos</th><th>Status</th></tr></thead>
      <tbody>
        ${locs.map((loc) => {
          const counts = countRequiredSlotUploads(loc);
          const ok = counts.uploaded >= counts.required;
          return `
            <tr>
              <td>${escapeHtml(loc.name)}</td>
              <td>${counts.uploaded}/${counts.required}</td>
              <td>${ok ? '<span class="pill-ok">OK</span>' : '<span class="pill-warn">Missing</span>'}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
  renderBackfillPanel();
}

function renderBackfillPanel(){
  const panel = $("backfillPanel");
  const select = $("backfillLocationSelect");
  if (!panel || !select) return;
  const node = state.activeNode;
  const allowed = isOwner() && Boolean(state.nodeProofStatus?.backfill_allowed) && !isDemo;
  if (!node || !allowed){
    panel.style.display = "none";
    return;
  }
  panel.style.display = "";
  const locs = node.splice_locations || [];
  const current = select.value;
  const options = ['<option value=\"\">Select splice location</option>'].concat(
    locs.map((loc) => `<option value=\"${loc.id}\">${escapeHtml(loc.name || loc.location_label || loc.id)}</option>`)
  );
  select.innerHTML = options.join("");
  if (current && locs.some(l => l.id === current)){
    select.value = current;
  }
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

async function startCamera(){
  const video = $("cameraStream");
  const videoNodes = $("cameraStreamNodes");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    toast("Camera required", "Camera access required. Gallery uploads are not allowed.");
    return false;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    state.cameraStream = stream;
    state.cameraReady = true;
    state.cameraInvalidated = false;
    state.cameraStartedAt = Date.now();
    if (video){
      video.srcObject = stream;
    }
    if (videoNodes){
      videoNodes.srcObject = stream;
    }
    return true;
  } catch (err){
    toast("Camera required", "Camera access required. Gallery uploads are not allowed.");
    state.cameraReady = false;
    return false;
  }
}

function ensureCameraReady(){
  if (!state.cameraReady){
    toast("Camera required", "Start the camera before capturing photos.");
    return false;
  }
  if (state.cameraInvalidated){
    toast("Capture blocked", "Page focus changed. Restart the camera to capture photos.");
    return false;
  }
  return true;
}

async function captureFrame(){
  const video = $("cameraStream");
  if (!video){
    toast("Camera required", "Camera access required. Gallery uploads are not allowed.");
    return null;
  }
  if (!ensureCameraReady()){
    return null;
  }
  if (document.hidden){
    toast("Capture blocked", "Camera capture must be in the foreground.");
    return null;
  }
  if (state.lastVisibilityChangeAt && state.cameraStartedAt && state.lastVisibilityChangeAt > state.cameraStartedAt){
    toast("Capture blocked", "Page focus changed. Restart the camera to capture photos.");
    return null;
  }
  const gps = await captureGPS();
  if (!gps){
    toast("GPS required", "GPS is required for payment.");
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob){
    toast("Capture failed", "Unable to capture camera frame.");
    return null;
  }
  return { blob, gps, captured_at: nowISO(), previewUrl: URL.createObjectURL(blob) };
}

function makeFileFromBlob(blob){
  return new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
}

async function addSpliceLocation(){
  const node = state.activeNode;
  if (!node) return;
  const n = (node.splice_locations?.length || 0) + 1;
  const tempName = `Splice location ${n}`;
  if (isDemo){
    node.splice_locations = node.splice_locations || [];
    node.splice_locations.push({
      id: `loc-${Date.now()}`,
      name: tempName,
      gps: null,
      photo: null,
      taken_at: null,
      completed: false,
      terminal_ports: DEFAULT_TERMINAL_PORTS,
      photosBySlot: {},
      isEditing: true,
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
      location_label: tempName,
      terminal_ports: DEFAULT_TERMINAL_PORTS,
    })
    .select("id, location_label, gps_lat, gps_lng, gps_accuracy_m, photo_path, taken_at, completed, terminal_ports")
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
    terminal_ports: normalizeTerminalPorts(data.terminal_ports ?? DEFAULT_TERMINAL_PORTS),
    photosBySlot: {},
    isEditing: true,
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
  clearProof();

  if (isDemo){
    if (!state.demo.nodes[n]){
      toast("Not found", "That node doesn't exist in demo. Click Create node to add it.");
      return;
    }

    const nodeMeta = (state.demo.nodesList || []).find(x => x.node_number === n);
    const activeMeta = (state.demo.nodesList || []).find(x => x.status === "ACTIVE");
    if (nodeMeta && activeMeta && activeMeta.node_number !== n && activeMeta.status !== "COMPLETE"){
      toast("Active node in progress", `Finish ${activeMeta.node_number} before starting another node.`);
      return;
    }
    if (nodeMeta && nodeMeta.status !== "COMPLETE"){
      nodeMeta.status = "ACTIVE";
    }

    state.activeNode = state.demo.nodes[n];
    state.unitTypes = state.demo.unitTypes || [];
    await loadAllowedQuantities(state.activeNode.id);
    await loadAlerts(state.activeNode.id);
    state.activeNode.splice_locations = (state.activeNode.splice_locations || []).map((loc) => ({
      ...loc,
      terminal_ports: normalizeTerminalPorts(loc.terminal_ports ?? DEFAULT_TERMINAL_PORTS),
      photosBySlot: loc.photosBySlot || {},
    }));

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
    renderNodeCards();

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
    .select("id, node_number, description, status, allowed_units, used_units, ready_for_billing, project_id")
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

  const activeNodeMeta = state.projectNodes.find(n => n.status === "ACTIVE");
  if (activeNodeMeta && activeNodeMeta.node_number !== nodeRow.node_number){
    toast("Active node in progress", `Finish ${activeNodeMeta.node_number} before starting another node.`);
    return;
  }

  if (nodeRow.status !== "COMPLETE" && nodeRow.status !== "ACTIVE"){
    const { error: statusErr } = await state.client
      .from("nodes")
      .update({ status: "ACTIVE", started_at: new Date().toISOString() })
      .eq("id", nodeRow.id);
    if (statusErr){
      toast("Node start failed", statusErr.message);
      return;
    }
    nodeRow.status = "ACTIVE";
  }

  const node = {
    id: nodeRow.id,
    node_number: nodeRow.node_number,
    description: nodeRow.description,
    status: nodeRow.status,
    units_allowed: nodeRow.allowed_units || 0,
    units_used: nodeRow.used_units || 0,
    ready_for_billing: nodeRow.ready_for_billing,
    project_id: nodeRow.project_id,
  };

  const [spliceRes, invRes, subInvRes, primeInvRes] = await Promise.all([
    state.client
      .from("splice_locations")
      .select("id, location_label, gps_lat, gps_lng, gps_accuracy_m, photo_path, taken_at, completed, terminal_ports")
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
    terminal_ports: normalizeTerminalPorts(r.terminal_ports ?? DEFAULT_TERMINAL_PORTS),
    photosBySlot: {},
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
  await loadSplicePhotos(node.id, node.splice_locations);
  await loadAllowedQuantities(node.id);
  await loadAlerts(node.id);
  await loadNodeProofStatus(node.id);
  await loadOwnerOverrides(node.id);
  subscribeUsageEvents(node.id);

  setRoleUI();
  renderLocations();
  renderInventory();
  renderInvoicePanel();
  renderAllowedQuantities();
  renderAlerts();
  renderProofChecklist();
  renderBillingDetail();
  updateKPI();
  await loadProjectNodes(node.project_id);
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
    const newNode = {
      id: `demo-${Date.now()}`,
      node_number: n,
      description: "New node",
      status: "NOT_STARTED",
      project_id: state.activeProject?.id || state.demo.project?.id,
      units_allowed: 120,
      units_used: 0,
      splice_locations: [],
      inventory_checks: [
        { id:`inv-${Date.now()}-1`, item_code:"HAFO(OFDC-B8G)", item_name:"TDS Millennium example", photo:"./assets/millennium_example.png", qty_used: 1, planned_qty: 8, completed:false },
      ],
      ready_for_billing: false,
    };
    state.demo.nodes[n] = newNode;
    state.demo.nodesList = state.demo.nodesList || [];
    state.demo.nodesList.push({
      id: newNode.id,
      node_number: newNode.node_number,
      description: newNode.description,
      status: newNode.status,
      project_id: newNode.project_id,
    });
    renderNodeCards();
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
      status: "NOT_STARTED",
    });

  if (error){
    toast("Create failed", error.message);
    return;
  }
  await loadProjectNodes(state.activeProject?.id || null);
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
  const photos = computeProofStatus(node);
  if (!photos.photosOk){
    toast("Photos required", "Take photos (GPS + photo + timestamp) before marking the node ready.");
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
  const photos = computeProofStatus(node);
  if (!photos.photosOk){
    toast("Blocked", "Photos are required before invoice submission.");
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
  setAppModeUI();
  setEnvWarning();

  if (appMode === "real" && !hasSupabaseConfig){
    showAuth(true);
    setWhoami();
    setAuthButtonsDisabled(true);
    return;
  }

  state.client = await makeClient();
  if (!state.client){
    showAuth(true);
    setAuthButtonsDisabled(true);
    return;
  }
  setAuthButtonsDisabled(false);

  // Demo: choose role via prompt for now
  if (isDemo){
    ensureDemoSeed();
    showAuth(false);
    const pick = prompt("Demo mode: choose a role (TDS, PRIME, SUB, SPLICER, OWNER)", state.demo.role) || state.demo.role;
    const role = state.demo.roles.includes(pick.toUpperCase()) ? pick.toUpperCase() : state.demo.role;
    state.demo.role = role;
    await loadProjects();
    await loadProjectNodes(state.activeProject?.id || null);
    await loadUnitTypes();
    await loadWorkCodes();
    await loadRateCards(state.activeProject?.id || null);
    await loadLocationProofRequirements(state.activeProject?.id || null);
    await loadBillingLocations(state.activeProject?.id || null);
    await loadMaterialCatalog();
    setWhoami();
    setRoleUI();
    renderLocations();
    renderInventory();
    renderInvoicePanel();
    renderAllowedQuantities();
    renderAlerts();
    renderProofChecklist();
    renderBillingLocations();
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
      await loadProjectNodes(state.activeProject?.id || null);
      await loadUnitTypes();
      await loadWorkCodes();
      await loadRateCards(state.activeProject?.id || null);
      await loadLocationProofRequirements(state.activeProject?.id || null);
      await loadBillingLocations(state.activeProject?.id || null);
      await loadMaterialCatalog();
      await loadAlerts();
      renderAlerts();
      renderCatalogResults("catalogResults", "");
      renderCatalogResults("catalogResultsQuick", "");
      renderBillingLocations();
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
    await loadProjectNodes(state.activeProject?.id || null);
    await loadUnitTypes();
    await loadWorkCodes();
    await loadRateCards(state.activeProject?.id || null);
    await loadLocationProofRequirements(state.activeProject?.id || null);
    await loadBillingLocations(state.activeProject?.id || null);
    await loadMaterialCatalog();
    await loadAlerts();
    renderAlerts();
    renderCatalogResults("catalogResults", "");
    renderCatalogResults("catalogResultsQuick", "");
    renderBillingLocations();
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

  const nodeCards = $("nodeCards");
  if (nodeCards){
    nodeCards.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;
      if (action === "openNode"){
        startNode(id);
      } else if (action === "completeNode"){
        completeNode(id);
      }
    });
  }

  const billingList = $("billingLocationList");
  if (billingList){
    billingList.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.action === "openBilling"){
        openBillingLocation(btn.dataset.id);
      }
    });
  }

  const importBtn = $("btnImportUsage");
  if (importBtn){
    importBtn.addEventListener("click", () => importUsageToInvoice());
  }
  const exportBtn = $("btnBillingExportCsv");
  if (exportBtn){
    exportBtn.addEventListener("click", () => exportInvoiceCsv());
  }
  const printBtn = $("btnBillingPrint");
  if (printBtn){
    printBtn.addEventListener("click", () => printInvoice());
  }

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
    if (!email){
      toast("Email needed", "Enter your email address first.");
      return;
    }
    const { error } = await state.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) toast("Invite failed", error.message);
    else toast("Invite sent", "Magic link sent. User is created on first login.");
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
  $("btnAddLocation").addEventListener("click", () => addSpliceLocation());

  const startCameraBtn = $("btnStartCamera");
  if (startCameraBtn){
    startCameraBtn.addEventListener("click", () => startCamera());
  }
  const startCameraNodesBtn = $("btnStartCameraNodes");
  if (startCameraNodesBtn){
    startCameraNodesBtn.addEventListener("click", () => startCamera());
  }

  const photoBtn = $("btnCapturePhoto");
  if (photoBtn){
    photoBtn.addEventListener("click", () => captureUsageProof());
  }

  const backfillPortInput = $("backfillPortInput");
  if (backfillPortInput){
    backfillPortInput.addEventListener("change", async (e) => {
      await handleBackfillPhotoUpload("port_test", e.target.files?.[0] || null);
      e.target.value = "";
    });
  }
  const backfillSpliceInput = $("backfillSpliceInput");
  if (backfillSpliceInput){
    backfillSpliceInput.addEventListener("change", async (e) => {
      await handleBackfillPhotoUpload("splice_complete", e.target.files?.[0] || null);
      e.target.value = "";
    });
  }

  $("btnMarkNodeReady").addEventListener("click", () => markNodeReady());
  $("btnCreateInvoice").addEventListener("click", () => createInvoice());
}

startVisibilityWatch();
wireUI();
initAuth();
