'use strict';

/** Sums invoice lines in integer cents — no floating point, no date handling. */
function totalCents(lines) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
}

module.exports = { totalCents };
