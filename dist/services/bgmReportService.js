"use strict";
const { googleSheetsService } = require("./googleSheets");
const { renderExcel, renderPDF } = require("./reportRenderer");

function normalizeDate(row) {
  return row["Event Starts At"] || row["eventStartsAt"] || row["Date"] || row["date"] || "";
}

function isPrivate(membershipName = "") {
  const s = String(membershipName).toLowerCase();
  return s.includes("private") || s.includes("1 to 1") || s.includes("one to one");
}

function mapSession(row, amountField) {
  const membership = row["Membership Name"] || row["membershipName"] || "";
  const customer = row["Customer Name"] || row["Customer"] || row["customer"] || "";
  const date = normalizeDate(row);
  const sessionPrice = parseFloat(row["Session Price"] || row["sessionPrice"] || 0) || 0;
  const discounted = parseFloat(row["Discounted Session Price"] || row["discountedSessionPrice"] || 0) || 0;
  const yourPay = parseFloat(row[amountField] || row[amountField.replace(" ","").toLowerCase()] || 0) || 0;
  const net = discounted > 0 ? discounted : sessionPrice;
  return {
    clientName: customer,
    date,
    sessionType: isPrivate(membership) ? (membership.includes("Group") ? "Group Private Session" : "1 to 1 Private Combat Session") : "",
    classType: isPrivate(membership) ? "" : (membership.toLowerCase().includes("strikezone") ? "STRIKEZONE (13-17) LEADE" : "MMA"),
    membershipUsed: isPrivate(membership) ? "" : membership,
    netPricePerSession: net,
    yourPay,
  };
}

async function generateBgmReport(params = {}) {
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

  const sessions = filtered.map((r) => mapSession(r, "BGM Amount"));
  const privateSessions = sessions.filter((s) => s.sessionType !== "");
  const groupSessions = sessions.filter((s) => s.sessionType === "");

  const totalPrivate = privateSessions.reduce((a, s) => a + s.yourPay, 0);
  const totalGroup = groupSessions.reduce((a, s) => a + s.yourPay, 0);
  const totalPay = totalPrivate + totalGroup;

  const payload = {
    title: "BGM (Landlord) Report",
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

module.exports = { generateBgmReport };


