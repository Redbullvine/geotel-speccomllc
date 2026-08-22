/**
 * Role-based landing routes.
 *
 * Pure helpers: no DOM, no Supabase, no permission decisions. The app supplies
 * an `isAllowedRoute` predicate so that access control keeps living in
 * `isViewAllowed()` — this module only decides *where a signed-in user should
 * land by default*, never *what they are allowed to open*.
 */

export const LANDING_ROLE_TIER = Object.freeze({
  ROOT: "root",
  ADMIN: "admin",
  MEMBER: "member",
});

const ROOT_ROLE_CODES = Object.freeze(["ROOT"]);
const ADMIN_ROLE_CODES = Object.freeze(["OWNER", "ADMIN", "OFFICE", "SUPPORT"]);

export const LANDING_ROUTES = Object.freeze({
  root: "#root-command-center",
  admin: "#admin",
  gateway: "#home",
});

/** Trade workspace key -> landing hash. Mirrors the splash gateway tiles. */
export const TRADE_LANDING_ROUTES = Object.freeze({
  technician: "#technician",
  splicer: "#map",
  drop_crew: "#map",
  warehouse: "#warehouse",
  dispatch: "#dispatch",
  supervisor: "#supervisor",
  office: "#office",
  admin: "#admin",
});

/**
 * `profiles` has no dedicated trade column today, so the role code doubles as
 * the trade for members. Explicit trade fields (if one is ever added) win.
 */
const ROLE_TRADE_KEYS = Object.freeze({
  TECHNICIAN: "technician",
  SPLICER: "splicer",
  DROP_CREW: "drop_crew",
  WAREHOUSE: "warehouse",
  DISPATCH: "dispatch",
  SUPERVISOR: "supervisor",
});

const TRADE_KEY_ALIASES = Object.freeze({
  tech: "technician",
  technician: "technician",
  i_r: "technician",
  ir_tech: "technician",
  timesheet: "technician",
  splicer: "splicer",
  osp: "splicer",
  osp_splicer: "splicer",
  drop: "drop_crew",
  drop_crew: "drop_crew",
  dropcrew: "drop_crew",
  warehouse: "warehouse",
  catalog: "warehouse",
  dispatch: "dispatch",
  operations: "dispatch",
  supervisor: "supervisor",
  office: "office",
  billing: "office",
  admin: "admin",
  administration: "admin",
});

/** Hash routes that address a workspace. Kept in sync with parseViewFromHash(). */
export const WORKSPACE_HASH_ROUTES = Object.freeze([
  "root-command-center",
  "root",
  "command-center",
  "admin",
  "admin/onboarding",
  "admin-onboarding",
  "dispatch",
  "supervisor",
  "map",
  "splicer",
  "redline",
  "technician",
  "tech",
  "timesheet",
  "warehouse",
  "catalog",
  "office",
  "billing",
  "invoices",
  "demo",
  "onboarding",
  "home",
  "dashboard",
]);

const WORKSPACE_HASH_SET = new Set(WORKSPACE_HASH_ROUTES);

const LAST_WORKSPACE_KEY_PREFIX = "speccom.lastWorkspace.";

export function lastWorkspaceStorageKey(userId){
  const id = String(userId || "").trim();
  return id ? `${LAST_WORKSPACE_KEY_PREFIX}${id}` : "";
}

export function normalizeRoleCode(value){
  return String(value || "").trim().toUpperCase();
}

/** Collapses the production role list onto the three landing tiers. */
export function resolveRoleTier(profile){
  const role = normalizeRoleCode(typeof profile === "string" ? profile : profile?.role);
  if (ROOT_ROLE_CODES.includes(role)) return LANDING_ROLE_TIER.ROOT;
  if (ADMIN_ROLE_CODES.includes(role)) return LANDING_ROLE_TIER.ADMIN;
  return LANDING_ROLE_TIER.MEMBER;
}

export function normalizeTradeKey(value){
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return "";
  return TRADE_KEY_ALIASES[raw] || "";
}

/** Hash for the member's trade workspace, or "" when the trade is unknown. */
export function resolveTradeRoute(profile){
  const explicit = profile?.trade
    ?? profile?.workspace
    ?? profile?.trade_workspace
    ?? profile?.default_workspace
    ?? profile?.ws_key;
  const explicitKey = normalizeTradeKey(explicit);
  if (explicitKey) return TRADE_LANDING_ROUTES[explicitKey] || "";
  const roleKey = ROLE_TRADE_KEYS[normalizeRoleCode(profile?.role)];
  return roleKey ? (TRADE_LANDING_ROUTES[roleKey] || "") : "";
}

/** "#Billing?x=1" -> "#billing"; anything that is not a workspace route -> "". */
export function normalizeWorkspaceHash(value){
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;
  const token = withoutHash
    .split(/[?&]/)[0]
    .replace(/^\/+|\/+$/g, "")
    .trim()
    .toLowerCase();
  if (!token || !WORKSPACE_HASH_SET.has(token)) return "";
  return `#${token}`;
}

/**
 * @param {object|null} profile      the loaded `profiles` row
 * @param {object}  [options]
 * @param {string}  [options.lastWorkspace]  persisted hash for this user
 * @param {(hash: string) => boolean} [options.isAllowedRoute]
 * @returns {string} a workspace hash, always falling back to the Gateway
 */
export function resolveLandingRoute(profile, options = {}){
  const { lastWorkspace = "", isAllowedRoute = null } = options;
  const accept = (hash) => {
    const normalized = normalizeWorkspaceHash(hash);
    if (!normalized) return "";
    if (typeof isAllowedRoute === "function" && !isAllowedRoute(normalized)) return "";
    return normalized;
  };
  const gateway = () => accept(LANDING_ROUTES.gateway) || LANDING_ROUTES.gateway;
  const tier = resolveRoleTier(profile);
  if (tier === LANDING_ROLE_TIER.ROOT){
    return accept(LANDING_ROUTES.root) || gateway();
  }
  if (tier === LANDING_ROLE_TIER.ADMIN){
    return accept(LANDING_ROUTES.admin) || accept(lastWorkspace) || gateway();
  }
  return accept(resolveTradeRoute(profile)) || accept(lastWorkspace) || gateway();
}
