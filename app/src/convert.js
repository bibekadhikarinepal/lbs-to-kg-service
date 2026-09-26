const LBS_TO_KG_FACTOR = 0.45359237;

function roundTo3(n) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/**
 * Validates and converts an lbs query value.
 * Returns { ok: true, lbs, kg } or { ok: false, status, error }.
 */
function convertLbsToKg(rawLbs) {
  if (rawLbs === undefined || rawLbs === null || rawLbs === '') {
    return { ok: false, status: 400, error: 'Missing required query parameter: lbs' };
  }

  const lbs = Number(rawLbs);

  if (Number.isNaN(lbs)) {
    return { ok: false, status: 400, error: 'lbs must be a number' };
  }

  if (!Number.isFinite(lbs) || lbs < 0) {
    return { ok: false, status: 422, error: 'lbs must be a finite, non-negative number' };
  }

  const kg = roundTo3(lbs * LBS_TO_KG_FACTOR);
  return { ok: true, lbs, kg };
}

module.exports = { convertLbsToKg, LBS_TO_KG_FACTOR, roundTo3 };
