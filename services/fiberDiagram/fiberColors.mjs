/**
 * Fiber Engineer — TIA-598-D fiber and buffer-tube colour model.
 *
 * The standard 12-colour sequence repeats within every buffer tube, and the
 * tubes themselves follow the same sequence. A 48ct cable built on 24-fiber
 * tubes therefore has a Blue tube carrying fibers 1-24 and an Orange tube
 * carrying 25-48, with each tube running Blue..Aqua twice.
 *
 * Tube size is configurable because the same project mixes 12F and 24F tube
 * constructions; the Node 54 distribution cable is 48ct on 2 x 24F tubes, which
 * is the default here.
 *
 * No DOM, no I/O.
 */

/** TIA-598-D standard sequence. Index 0 is position 1. */
export const TIA598_COLORS = Object.freeze([
  Object.freeze({ name: "Blue", hex: "#0060A9", ink: "#FFFFFF" }),
  Object.freeze({ name: "Orange", hex: "#F58220", ink: "#20160B" }),
  Object.freeze({ name: "Green", hex: "#00A551", ink: "#FFFFFF" }),
  Object.freeze({ name: "Brown", hex: "#8B5F3B", ink: "#FFFFFF" }),
  Object.freeze({ name: "Slate", hex: "#808285", ink: "#FFFFFF" }),
  Object.freeze({ name: "White", hex: "#FFFFFF", ink: "#20160B" }),
  Object.freeze({ name: "Red", hex: "#ED1C24", ink: "#FFFFFF" }),
  Object.freeze({ name: "Black", hex: "#000000", ink: "#FFFFFF" }),
  Object.freeze({ name: "Yellow", hex: "#FFD700", ink: "#20160B" }),
  Object.freeze({ name: "Violet", hex: "#8560A8", ink: "#FFFFFF" }),
  Object.freeze({ name: "Rose", hex: "#F49AC1", ink: "#20160B" }),
  Object.freeze({ name: "Aqua", hex: "#00AEEF", ink: "#20160B" }),
]);

export const TIA598_SEQUENCE_LENGTH = TIA598_COLORS.length;

/** Node 54 distribution build: 48ct on 24-fiber buffer tubes. */
export const DEFAULT_CABLE_BUILD = Object.freeze({ fiberCount: 48, tubeSize: 24 });

export class FiberColorError extends Error {
  constructor(message, details = {}){
    super(message);
    this.name = "FiberColorError";
    Object.assign(this, details);
  }
}

function positionColor(position){
  // position is 1-based within the repeating 12-colour sequence
  return TIA598_COLORS[(position - 1) % TIA598_SEQUENCE_LENGTH];
}

/**
 * Resolve a fiber number to its buffer tube and strand colour.
 *
 * @param {number} fiber 1-based fiber number within the cable
 * @param {object} [build]
 * @param {number} [build.tubeSize] fibers per buffer tube (12 or 24 typically)
 * @returns {{fiber:number, tube:number, tubeColor:object, positionInTube:number,
 *            color:object, sequencePosition:number}}
 */
export function fiberColor(fiber, build = {}){
  const number = Number(fiber);
  if (!Number.isInteger(number) || number < 1){
    throw new FiberColorError(`Fiber number must be a positive integer, received ${JSON.stringify(fiber)}.`, { fiber });
  }
  const tubeSize = Number(build.tubeSize ?? DEFAULT_CABLE_BUILD.tubeSize);
  if (!Number.isInteger(tubeSize) || tubeSize < 1){
    throw new FiberColorError(`Tube size must be a positive integer, received ${JSON.stringify(build.tubeSize)}.`, { tubeSize: build.tubeSize });
  }

  const tubeIndex = Math.floor((number - 1) / tubeSize); // 0-based
  const positionInTube = ((number - 1) % tubeSize) + 1;  // 1-based

  return Object.freeze({
    fiber: number,
    tube: tubeIndex + 1,
    tubeColor: positionColor(tubeIndex + 1),
    positionInTube,
    color: positionColor(positionInTube),
    sequencePosition: ((positionInTube - 1) % TIA598_SEQUENCE_LENGTH) + 1,
  });
}

/**
 * Describe a whole cable build as its ordered buffer tubes.
 * @returns {Array<{tube:number, tubeColor:object, firstFiber:number, lastFiber:number}>}
 */
export function describeCableBuild(build = {}){
  const fiberCount = Number(build.fiberCount ?? DEFAULT_CABLE_BUILD.fiberCount);
  const tubeSize = Number(build.tubeSize ?? DEFAULT_CABLE_BUILD.tubeSize);
  if (!Number.isInteger(fiberCount) || fiberCount < 1){
    throw new FiberColorError(`Fiber count must be a positive integer, received ${JSON.stringify(build.fiberCount)}.`, { fiberCount: build.fiberCount });
  }
  if (!Number.isInteger(tubeSize) || tubeSize < 1){
    throw new FiberColorError(`Tube size must be a positive integer, received ${JSON.stringify(build.tubeSize)}.`, { tubeSize: build.tubeSize });
  }
  const tubes = [];
  for (let first = 1; first <= fiberCount; first += tubeSize){
    const tubeIndex = tubes.length;
    tubes.push(Object.freeze({
      tube: tubeIndex + 1,
      tubeColor: positionColor(tubeIndex + 1),
      firstFiber: first,
      lastFiber: Math.min(first + tubeSize - 1, fiberCount),
    }));
  }
  return Object.freeze(tubes);
}

/**
 * Infer a plausible tube size for a cable count when the build is not stated.
 * Returns null rather than guessing when the count is not a standard build.
 */
export function inferTubeSize(fiberCount){
  const count = Number(fiberCount);
  if (!Number.isInteger(count) || count < 1) return null;
  if (count % 24 === 0 && count >= 48) return 24;
  if (count % 12 === 0) return 12;
  return null;
}
