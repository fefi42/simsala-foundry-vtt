/**
 * Deterministic damage formula calculator.
 *
 * Given a target average damage and a die size, computes a dice expression
 * (e.g. "2d8+3") that hits as close to the target as possible.
 *
 * Constraint: the scalar modifier never exceeds the die average — extra
 * damage is expressed as additional dice instead (3d12 rather than 2d12+7).
 */

/**
 * @param {number} targetAvg  Desired average damage per hit (clamped 1–200)
 * @param {number} dieSides   Die type: 4, 6, 8, 10, or 12
 * @returns {string} Dice formula, e.g. "2d12+2" or "3d8"
 */
export function buildDamageFormula(targetAvg, dieSides) {
  targetAvg = Math.max(1, Math.min(Math.round(targetAvg), 200));
  if (![4, 6, 8, 10, 12].includes(dieSides)) dieSides = 8;

  const dieAvg = (dieSides + 1) / 2;

  let numDice = Math.max(1, Math.round(targetAvg / dieAvg));
  let scalar = Math.round(targetAvg - numDice * dieAvg);

  // Scalar must not exceed die average — add dice instead
  while (scalar > dieAvg) {
    numDice++;
    scalar = Math.round(targetAvg - numDice * dieAvg);
  }

  // Don't allow large negative scalar either — remove dice
  while (scalar < -dieAvg && numDice > 1) {
    numDice--;
    scalar = Math.round(targetAvg - numDice * dieAvg);
  }

  numDice = Math.max(1, numDice);
  scalar = Math.round(targetAvg - numDice * dieAvg);

  if (scalar === 0) return `${numDice}d${dieSides}`;
  if (scalar > 0) return `${numDice}d${dieSides}+${scalar}`;
  return `${numDice}d${dieSides}${scalar}`; // negative sign included
}
