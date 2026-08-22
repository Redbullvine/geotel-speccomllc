/**
 * EBC — measured versus predicted diagnostics.
 *
 * These are indicators, not verdicts. Each one states the evidence it used and
 * carries a confidence level, so a technician can tell the difference between
 * "this reading is a little low" and "these two ports are swapped". Nothing
 * here edits a reading; it only reads the calculated result and the recorded
 * measurements side by side.
 */

import { DEFAULT_PCOT_SPECS, PCOT_RATIOS, finiteOrNull, getPcotSpec } from "./pcotSpecs.mjs";

export const EBC_INDICATOR_CONFIDENCE = Object.freeze({
  /** Consistent with the evidence, but other explanations fit equally well. */
  POSSIBLE: "POSSIBLE",
  /** The numbers point this way and few other explanations fit. */
  LIKELY: "LIKELY",
  /** The measurement itself demonstrates it. */
  DEMONSTRATED: "DEMONSTRATED",
});

/**
 * Thresholds are configurable because they encode local practice and meter
 * quality, not physics. They are deliberately not buried in the comparisons.
 */
export const DEFAULT_DIAGNOSTIC_TOLERANCES = Object.freeze({
  /** Combined meter/connector repeatability. Differences inside this are noise. */
  measurementUncertaintyDb: 0.5,
  /** Device loss above specification before it is called excessive. */
  excessiveDeviceLossDb: 1.5,
  /** Span loss above prediction before the span is called into question. */
  unexpectedSpanLossDb: 1.0,
  /** How close a measured loss must sit to another ratio to suspect the wrong part. */
  ratioMatchDb: 1.0,
  /** A single connector or splice anomaly band. */
  connectorSuspicionDb: 0.75,
});

const round2 = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(2)));

function indicator(code, title, detail, confidence, evidence = {}){
  return Object.freeze({ code, title, detail, confidence, evidence: Object.freeze(evidence) });
}

/**
 * Build the Measurement / Predicted / Actual / Difference table for one node
 * plus any diagnostic indicators the numbers support.
 *
 * Difference is actual minus predicted: negative means the field is worse than
 * the engineering prediction.
 */
export function compareMeasuredToPredicted(nodeResult, options = {}){
  const { specs = DEFAULT_PCOT_SPECS, tolerances = DEFAULT_DIAGNOSTIC_TOLERANCES } = options;
  const limits = { ...DEFAULT_DIAGNOSTIC_TOLERANCES, ...tolerances };

  const measured = nodeResult?.measured || {};
  const measuredInput = finiteOrNull(measured.inputDbm);
  const measuredThrough = finiteOrNull(measured.throughDbm);
  const measuredTap = finiteOrNull(measured.tapDbm);

  const predictedInput = finiteOrNull(nodeResult?.inputDbm);
  const predictedThrough = finiteOrNull(nodeResult?.throughOutputDbm);
  const predictedTap = finiteOrNull(nodeResult?.tapOutputDbm);

  const rows = [
    buildRow("Input", predictedInput, measuredInput, limits),
    buildRow("Through", predictedThrough, measuredThrough, limits),
    buildRow("Tap", predictedTap, measuredTap, limits),
  ];

  const indicators = [];
  const hasMeasurements = [measuredInput, measuredThrough, measuredTap].some((value) => value !== null);

  if (!hasMeasurements){
    return Object.freeze({
      nodeId: String(nodeResult?.id || ""),
      label: String(nodeResult?.label || ""),
      hasMeasurements: false,
      rows: Object.freeze(rows),
      indicators: Object.freeze([]),
      note: "No field readings have been recorded at this location yet.",
    });
  }

  // --- Upstream ----------------------------------------------------------
  if (measuredInput !== null && predictedInput !== null){
    const delta = measuredInput - predictedInput;
    if (delta < -limits.unexpectedSpanLossDb){
      indicators.push(indicator(
        "UNEXPECTED_UPSTREAM_LOSS",
        "Unexpected upstream loss",
        "The input here is " + round2(Math.abs(delta)) + " dB below prediction, so the shortfall was already present before this device. Test the span and the previous location before touching this one.",
        Math.abs(delta) > limits.unexpectedSpanLossDb * 2 ? EBC_INDICATOR_CONFIDENCE.LIKELY : EBC_INDICATOR_CONFIDENCE.POSSIBLE,
        { predictedInputDbm: predictedInput, measuredInputDbm: measuredInput, differenceDb: round2(delta) },
      ));
    } else if (delta > limits.unexpectedSpanLossDb){
      indicators.push(indicator(
        "INPUT_ABOVE_PREDICTION",
        "Input above prediction",
        "The input is " + round2(delta) + " dB stronger than predicted. The launch power, the span length or an upstream ratio in the model may not match what is in the ground.",
        EBC_INDICATOR_CONFIDENCE.POSSIBLE,
        { predictedInputDbm: predictedInput, measuredInputDbm: measuredInput, differenceDb: round2(delta) },
      ));
    }
  }

  // --- Device losses actually measured -----------------------------------
  const measuredThroughLossDb = measuredInput !== null && measuredThrough !== null ? measuredInput - measuredThrough : null;
  const measuredTapLossDb = measuredInput !== null && measuredTap !== null ? measuredInput - measuredTap : null;
  const specThroughLossDb = finiteOrNull(nodeResult?.throughInsertionLossDb);
  const specTapLossDb = finiteOrNull(nodeResult?.tapInsertionLossDb);

  if (measuredThroughLossDb !== null && specThroughLossDb !== null){
    const excess = measuredThroughLossDb - specThroughLossDb;
    if (excess > limits.excessiveDeviceLossDb){
      indicators.push(indicator(
        "EXCESSIVE_THROUGH_LOSS",
        "Excessive through loss",
        "The through path is losing " + round2(measuredThroughLossDb) + " dB against a specified " + specThroughLossDb + " dB, an excess of " + round2(excess) + " dB. Inspect the through ports and their connectors before condemning the device.",
        excess > limits.excessiveDeviceLossDb * 2 ? EBC_INDICATOR_CONFIDENCE.LIKELY : EBC_INDICATOR_CONFIDENCE.POSSIBLE,
        { measuredThroughLossDb: round2(measuredThroughLossDb), specThroughLossDb, excessDb: round2(excess) },
      ));
    }
  }

  if (measuredTapLossDb !== null && specTapLossDb !== null){
    const excess = measuredTapLossDb - specTapLossDb;
    if (excess > limits.excessiveDeviceLossDb){
      indicators.push(indicator(
        "EXCESSIVE_TAP_LOSS",
        "Excessive tap loss",
        "The tap is losing " + round2(measuredTapLossDb) + " dB against a specified " + specTapLossDb + " dB, an excess of " + round2(excess) + " dB.",
        excess > limits.excessiveDeviceLossDb * 2 ? EBC_INDICATOR_CONFIDENCE.LIKELY : EBC_INDICATOR_CONFIDENCE.POSSIBLE,
        { measuredTapLossDb: round2(measuredTapLossDb), specTapLossDb, excessDb: round2(excess) },
      ));
    }
    if (excess > limits.connectorSuspicionDb && excess <= limits.excessiveDeviceLossDb){
      indicators.push(indicator(
        "POSSIBLE_DIRTY_CONNECTOR",
        "Possible dirty or damaged connector",
        "The tap is " + round2(excess) + " dB down on specification, which is the size of a single poor connection. Clean and reseat the tap connector, then re-measure before drawing any other conclusion.",
        EBC_INDICATOR_CONFIDENCE.POSSIBLE,
        { excessDb: round2(excess) },
      ));
    }
  }

  // --- Reversed device ---------------------------------------------------
  if (measuredThroughLossDb !== null && measuredTapLossDb !== null && specThroughLossDb !== null && specTapLossDb !== null){
    const swappedFit = Math.abs(measuredThroughLossDb - specTapLossDb) <= limits.ratioMatchDb
      && Math.abs(measuredTapLossDb - specThroughLossDb) <= limits.ratioMatchDb;
    const normalFit = Math.abs(measuredThroughLossDb - specThroughLossDb) <= limits.ratioMatchDb
      && Math.abs(measuredTapLossDb - specTapLossDb) <= limits.ratioMatchDb;
    if (swappedFit && !normalFit){
      indicators.push(indicator(
        "PROBABLE_REVERSED_PCOT",
        "Probable reversed PCOT or port identification",
        "The port recorded as THROUGH is losing about the tap value and the port recorded as TAP is losing about the through value. Either the device is installed backwards or the two ports are labelled the wrong way round. Confirm the port identification physically before changing anything.",
        EBC_INDICATOR_CONFIDENCE.LIKELY,
        {
          measuredThroughLossDb: round2(measuredThroughLossDb),
          measuredTapLossDb: round2(measuredTapLossDb),
          specThroughLossDb, specTapLossDb,
        },
      ));
    }
  }

  // --- Wrong part installed ---------------------------------------------
  if (measuredTapLossDb !== null && specTapLossDb !== null){
    const installedRatio = String(nodeResult?.ratioUsed || "");
    const fitsInstalled = Math.abs(measuredTapLossDb - specTapLossDb) <= limits.ratioMatchDb;
    if (!fitsInstalled){
      const better = PCOT_RATIOS
        .map((ratio) => ({ ratio, spec: getPcotSpec(ratio, specs) }))
        .filter((entry) => entry.spec && finiteOrNull(entry.spec.nominalTapLossDb) !== null && entry.ratio !== installedRatio)
        .map((entry) => ({ ratio: entry.ratio, delta: Math.abs(measuredTapLossDb - Number(entry.spec.nominalTapLossDb)) }))
        .filter((entry) => entry.delta <= limits.ratioMatchDb)
        .sort((a, b) => a.delta - b.delta)[0] || null;
      if (better){
        indicators.push(indicator(
          "PROBABLE_WRONG_PCOT",
          "Probable wrong PCOT installed",
          "The measured tap loss of " + round2(measuredTapLossDb) + " dB does not fit the recorded " + installedRatio + " (" + specTapLossDb + " dB) but sits within " + round2(better.delta) + " dB of a " + better.ratio + " device. Photograph the installed label to confirm which part is actually in the enclosure.",
          EBC_INDICATOR_CONFIDENCE.LIKELY,
          { measuredTapLossDb: round2(measuredTapLossDb), recordedRatio: installedRatio, bestFitRatio: better.ratio, bestFitDeltaDb: round2(better.delta) },
        ));
      }
    }
  }

  // --- Span between prediction and here ----------------------------------
  const span = nodeResult?.span || null;
  if (measuredInput !== null && predictedInput !== null && span){
    const delta = predictedInput - measuredInput;
    if (delta > limits.unexpectedSpanLossDb && span.totalDb > 0){
      indicators.push(indicator(
        "UNEXPECTED_SPAN_LOSS",
        "Unexpected span loss",
        "The span into this location is " + round2(delta) + " dB worse than the modelled " + round2(span.totalDb) + " dB. Extra splices, a longer route than recorded, a bend or a damaged section would all produce this.",
        EBC_INDICATOR_CONFIDENCE.POSSIBLE,
        { modelledSpanLossDb: round2(span.totalDb), shortfallDb: round2(delta), spliceCount: span.spliceCount, connectorCount: span.connectorCount },
      ));
      if (delta > limits.connectorSuspicionDb && span.spliceCount > 0){
        indicators.push(indicator(
          "POSSIBLE_SPLICE_LOSS",
          "Possible splice loss in the span",
          "There are " + span.spliceCount + " splice(s) modelled in this span at " + span.perSpliceDb + " dB each. The " + round2(delta) + " dB shortfall is consistent with one or more of them being poor. An OTDR trace would locate it; a power meter alone cannot.",
          EBC_INDICATOR_CONFIDENCE.POSSIBLE,
          { spliceCount: span.spliceCount, perSpliceDb: span.perSpliceDb, shortfallDb: round2(delta) },
        ));
      }
    }
  }

  // --- Direct contradiction ----------------------------------------------
  if (measuredInput !== null && measuredThrough !== null && measuredThrough > measuredInput + limits.measurementUncertaintyDb){
    indicators.push(indicator(
      "THROUGH_EXCEEDS_INPUT",
      "Through reading exceeds input",
      "The recorded through power is above the recorded input power. Passive plant cannot add power, so one of these two readings is on the wrong port or in the wrong direction.",
      EBC_INDICATOR_CONFIDENCE.DEMONSTRATED,
      { measuredInputDbm: measuredInput, measuredThroughDbm: measuredThrough },
    ));
  }
  if (measuredInput !== null && measuredTap !== null && measuredTap > measuredInput + limits.measurementUncertaintyDb){
    indicators.push(indicator(
      "TAP_EXCEEDS_INPUT",
      "Tap reading exceeds input",
      "The recorded tap power is above the recorded input power, which a passive tap cannot do. Re-identify the ports and re-measure.",
      EBC_INDICATOR_CONFIDENCE.DEMONSTRATED,
      { measuredInputDbm: measuredInput, measuredTapDbm: measuredTap },
    ));
  }

  return Object.freeze({
    nodeId: String(nodeResult?.id || ""),
    label: String(nodeResult?.label || ""),
    hasMeasurements: true,
    rows: Object.freeze(rows),
    indicators: Object.freeze(indicators),
    measuredThroughLossDb: round2(measuredThroughLossDb),
    measuredTapLossDb: round2(measuredTapLossDb),
    specThroughLossDb,
    specTapLossDb,
    note: "Indicators describe what the readings are consistent with. Confirm physically before replacing hardware.",
  });
}

function buildRow(measurement, predictedDbm, actualDbm, limits){
  const differenceDb = predictedDbm === null || actualDbm === null ? null : round2(actualDbm - predictedDbm);
  let flag = "none";
  if (differenceDb !== null){
    if (Math.abs(differenceDb) <= limits.measurementUncertaintyDb) flag = "within_uncertainty";
    else if (differenceDb < 0) flag = "below_prediction";
    else flag = "above_prediction";
  } else if (predictedDbm === null && actualDbm !== null){
    flag = "no_prediction";
  } else if (predictedDbm !== null && actualDbm === null){
    flag = "not_measured";
  }
  return Object.freeze({ measurement, predictedDbm: round2(predictedDbm), actualDbm: round2(actualDbm), differenceDb, flag });
}

/** Roll every node up into one Field Mode comparison for a whole leg. */
export function compareLeg(result, options = {}){
  const comparisons = (result?.nodes || [])
    .filter((node) => node.type === "pcot" || node.type === "terminal")
    .map((node) => compareMeasuredToPredicted(node, options));
  const withReadings = comparisons.filter((entry) => entry.hasMeasurements);
  return Object.freeze({
    legId: String(result?.legId || ""),
    comparisons: Object.freeze(comparisons),
    measuredLocations: withReadings.length,
    indicatorCount: withReadings.reduce((total, entry) => total + entry.indicators.length, 0),
    indicators: Object.freeze(withReadings.flatMap((entry) => entry.indicators.map((item) => ({ ...item, nodeId: entry.nodeId, label: entry.label })))),
  });
}
