export function collectBillingCodes(savedCodes = [], pending = {}){
  const rows = Array.isArray(savedCodes) ? savedCodes.slice() : [];
  if (String(pending?.code || "").trim()) rows.push(pending);
  return Array.from(new Set(rows.map((row) => [
    String(row?.code || "").trim(),
    String(row?.ref || "").trim() ? `ref ${String(row.ref).trim()}` : "",
    String(row?.notes || "").trim(),
  ].filter(Boolean).join(" - ")).filter(Boolean)));
}

export function collectMaterials(savedMaterials = [], pending = {}){
  const rows = Array.isArray(savedMaterials) ? savedMaterials.slice() : [];
  if (String(pending?.item_key || "").trim()) rows.push(pending);
  return rows.map((row) => ({
    item_key: String(row?.item_key || "").trim(),
    qty_used: Number(row?.qty_used ?? 1) > 0 ? Number(row?.qty_used ?? 1) : 1,
    unit: String(row?.unit || "each").trim() || "each",
    notes: String(row?.notes || "").trim(),
  })).filter((row) => row.item_key);
}

export function getRequiredFieldEvidenceMissing({
  notes = "",
  photoCount = 0,
  noPhotoPossible = false,
  noPhotoReason = "",
  billingCodes = [],
  materials = [],
} = {}){
  const missing = [];
  if (!String(notes || "").trim()) missing.push("Add description notes before finalizing.");
  if (!Number(photoCount) && !(noPhotoPossible && String(noPhotoReason || "").trim())) missing.push("Upload photo or enter no-photo reason.");
  if (!billingCodes.length) missing.push("Add at least one billing code before finalizing.");
  if (!materials.length) missing.push("Add material used before finalizing.");
  return missing;
}

export function isProjectContextCurrent(requestedProjectId, activeProjectId){
  const requested = String(requestedProjectId || "").trim();
  const active = String(activeProjectId || "").trim();
  return Boolean(requested && active && requested === active);
}

export function canSwitchFieldProject(openSessionProjectId, targetProjectId){
  const openProject = String(openSessionProjectId || "").trim();
  const targetProject = String(targetProjectId || "").trim();
  return !openProject || Boolean(targetProject && openProject === targetProject);
}
