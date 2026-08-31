'use strict';

/**
 * Renders the monthly invoice summary.
 *
 * This file carries the seeded violation for the plain-js first win: it reaches for
 * `moment` to format a date. The project's date-handling rule says otherwise — see the
 * walkthrough in ../../README.md.
 */
const moment = require('moment');

const { totalCents } = require('./money');

function renderInvoiceSummary(invoice) {
  const issued = moment(invoice.issuedAt).format('YYYY-MM-DD');
  return {
    reference: invoice.reference,
    issued,
    total: totalCents(invoice.lines),
  };
}

module.exports = { renderInvoiceSummary };
