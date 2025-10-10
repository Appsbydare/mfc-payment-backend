"use strict";
const { googleSheetsService } = require("./googleSheets");
const { renderExcel, renderPDF } = require("./reportRenderer");

function normalizeDate(row) {
  return row["Event Starts At"] || row["eventStartsAt"] || row["Date"] || row["date"] || "";
}

function isPrivateBySessionType(sessionType = "") {
  return /private/i.test(String(sessionType));
}

function mapSession(row, amountField) {
  const get = (keys, fb = '') => (keys.find(k => row[k] !== undefined) ? row[keys.find(k => row[k] !== undefined)] : fb);
  const membership = get(["Membership Name","membershipName"], "");
  const customer = get(["Customer Name","Customer","customer"], "");
  const date = normalizeDate(row);
  const sessionType = String(get(["Session Type","sessionType"], ""));
  let classType = String(get(["Class Type","ClassType","classType","Class Name","ClassName","className"], ""));
  const sessionPrice = parseFloat(row["Session Price"] || row["sessionPrice"] || 0) || 0;
  const discounted = parseFloat(row["Discounted Session Price"] || row["discountedSessionPrice"] || 0) || 0;
  const yourPay = parseFloat(row[amountField] || row[amountField.replace(" ","").toLowerCase()] || 0) || 0;
  const net = discounted > 0 ? discounted : sessionPrice;
  const isPriv = isPrivateBySessionType(sessionType);
  if (!isPriv && !classType) {
    classType = /strike/i.test(membership) ? 'STRIKEZONE' : 'MMA';
  }
  return {
    clientName: customer,
    date,
    // For private rows, display membership/package name instead of literal 'private'
    sessionType: isPriv ? String(membership) : "",
    classType: isPriv ? "" : classType,
    membershipUsed: isPriv ? "" : String(membership),
    netPricePerSession: net,
    yourPay,
  };
}

async function generateManagementReport(params = {}) {
  const { fromDate, toDate, format = "excel" } = params;
  const data = await googleSheetsService.readSheet("payment_calc_detail");
  const filtered = (data || []).filter((r) => {
    const d = normalizeDate(r);
    if (!d) return false;
    const dd = new Date(d);
    if (fromDate && dd < new Date(fromDate)) return false;
    if (toDate && dd > new Date(toDate)) return false;
    return true;
  });

  const sessions = filtered.map((r) => mapSession(r, "Management Amount"));
  const privateSessions = sessions.filter((s) => s.sessionType !== "");
  const groupSessions = sessions.filter((s) => s.sessionType === "");

  const totalPrivate = privateSessions.reduce((a, s) => a + s.yourPay, 0);
  const totalGroup = groupSessions.reduce((a, s) => a + s.yourPay, 0);
  const totalPay = totalPrivate + totalGroup;

  const payload = {
    title: "Management Report",
    fromDate,
    toDate,
    privateSessions,
    groupSessions,
    totalPrivate,
    totalGroup,
    totalPay,
  };
  if (format === "pdf") return await renderPDF(payload);
  return await renderExcel(payload);
}

module.exports = { generateManagementReport };


