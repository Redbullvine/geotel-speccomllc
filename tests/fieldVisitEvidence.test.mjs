import test from "node:test";
import assert from "node:assert/strict";
import {
  canSwitchFieldProject,
  collectBillingCodes,
  collectMaterials,
  getRequiredFieldEvidenceMissing,
  isProjectContextCurrent,
} from "../services/fieldVisitEvidence.mjs";

test("typed billing code is captured without requiring Add Code", () => {
  assert.deepEqual(collectBillingCodes([], { code: "BILL-100", ref: "2", notes: "splice" }), ["BILL-100 - ref 2 - splice"]);
});

test("typed material is captured without requiring Add Material", () => {
  assert.deepEqual(collectMaterials([], { item_key: "Closure", qty_used: "2", unit: "each", notes: "installed" }), [
    { item_key: "Closure", qty_used: 2, unit: "each", notes: "installed" },
  ]);
});

test("closeout requires notes, photo evidence, billing code, and material", () => {
  assert.deepEqual(getRequiredFieldEvidenceMissing(), [
    "Add description notes before finalizing.",
    "Upload photo or enter no-photo reason.",
    "Add at least one billing code before finalizing.",
    "Add material used before finalizing.",
  ]);
  assert.deepEqual(getRequiredFieldEvidenceMissing({
    notes: "Completed repair",
    photoCount: 1,
    billingCodes: ["BILL-100"],
    materials: [{ item_key: "Closure" }],
  }), []);
});

test("imported location notes do not replace required work notes", () => {
  const missing = getRequiredFieldEvidenceMissing({
    referenceNotes: "Imported units, billing quantities, and access notes",
    photoCount: 1,
    billingCodes: ["BILL-100"],
    materials: [{ item_key: "Closure" }],
  });
  assert.deepEqual(missing, ["Add description notes before finalizing."]);
});

test("field workflow accepts any current project and rejects stale project results", () => {
  assert.equal(canSwitchFieldProject(null, "project-b"), true);
  assert.equal(canSwitchFieldProject("project-a", "project-a"), true);
  assert.equal(canSwitchFieldProject("project-a", "project-b"), false);
  assert.equal(canSwitchFieldProject("project-a", null), false);
  assert.equal(isProjectContextCurrent("project-a", "project-a"), true);
  assert.equal(isProjectContextCurrent("project-a", "project-b"), false);
});
