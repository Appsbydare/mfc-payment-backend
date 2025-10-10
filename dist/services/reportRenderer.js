"use strict";
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

function formatCurrency(v) {
  const n = Number(v || 0);
  return `€${n.toFixed(2)}`;
}

function buildPeriod(fromDate, toDate, fallbackDates) {
  if (fromDate && toDate) return `${fromDate} - ${toDate}`;
  if (Array.isArray(fallbackDates) && fallbackDates.length > 0) {
    const sorted = fallbackDates
      .filter(Boolean)
      .map((d) => new Date(d))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    if (sorted.length) {
      const first = sorted[0].toISOString().split("T")[0];
      const last = sorted[sorted.length - 1].toISOString().split("T")[0];
      return `${first} - ${last}`;
    }
  }
  const now = new Date();
  return now.toISOString().split("T")[0];
}

async function renderExcel(payload) {
  const { title, fromDate, toDate, privateSessions, groupSessions, totalPrivate, totalGroup, totalPay } = payload;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");

  ws.columns = [
    { header: "", width: 28 },
    { header: "", width: 16 },
    { header: "", width: 28 },
    { header: "", width: 18 },
    { header: "", width: 14 },
  ];

  ws.mergeCells("A1:E1");
  ws.getCell("A1").value = `Malta Fight Co. - ${title}`;
  ws.getCell("A1").font = { bold: true, size: 16 };
  ws.getCell("A1").alignment = { horizontal: "center" };

  const period = buildPeriod(fromDate, toDate, [
    ...(privateSessions || []).map((s) => s.date),
    ...(groupSessions || []).map((s) => s.date),
  ]);

  ws.addRow([]);
  ws.addRow(["PERIOD:", period]);
  ws.addRow([]);

  ws.mergeCells("A5:E5");
  ws.getCell("A5").value = "PRIVATE SESSION REVENUE";
  ws.getCell("A5").font = { bold: true };
  ws.addRow(["CLIENT NAME", "DATE", "SESSION TYPE", "NET PRICE PER SESSION", "YOUR PAY"]).font = { bold: true };
  (privateSessions || []).forEach((s) => {
    ws.addRow([s.clientName, s.date, s.sessionType, formatCurrency(s.netPricePerSession), formatCurrency(s.yourPay)]);
  });
  ws.addRow(["", "", "", "TOTAL", formatCurrency(totalPrivate)]).font = { bold: true };
  ws.addRow([]);

  const rowIdx = ws.rowCount + 1;
  ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
  ws.getCell(`A${rowIdx}`).value = "GROUP SESSION REVENUE";
  ws.getCell(`A${rowIdx}`).font = { bold: true };
  ws.addRow(["CLIENT NAME", "DATE", "CLASS TYPE", "MEMBERSHIP USED", "YOUR PAY"]).font = { bold: true };
  (groupSessions || []).forEach((s) => {
    ws.addRow([s.clientName, s.date, s.classType, s.membershipUsed, formatCurrency(s.yourPay)]);
  });
  ws.addRow(["", "", "", "TOTAL", formatCurrency(totalGroup)]).font = { bold: true };
  ws.addRow([]);

  const dRow = ws.rowCount + 1;
  ws.mergeCells(`A${dRow}:E${dRow}`);
  ws.getCell(`A${dRow}`).value = "DEDUCTIONS";
  ws.getCell(`A${dRow}`).font = { bold: true };
  ws.addRow(["", "", "", "TOTAL", formatCurrency(0)]).font = { bold: true };
  ws.addRow([]);

  ws.addRow(["TOTAL PAY", "", "", "", formatCurrency(totalPay)]).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function renderPDF(payload) {
  const { title, fromDate, toDate, privateSessions, groupSessions, totalPrivate, totalGroup, totalPay } = payload;

  const doc = new PDFDocument({ margin: 50 });
  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  const left = 40;
  const tableWidth = 520;
  const colWidths = [150, 80, 130, 120, 40];
  const cols = [left, left + colWidths[0], left + colWidths[0] + colWidths[1], left + colWidths[0] + colWidths[1] + colWidths[2], left + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3]];
  const baseRowHeight = 16;
  const pageBottom = doc.page.height - 50;

  const drawHeaderRow = (y, headers) => {
    doc.save();
    doc.rect(left, y, tableWidth, baseRowHeight).fill("#000");
    doc.fillColor("#fff").fontSize(10);
    let x = left; headers.forEach((h, i) => { doc.text(h, x + 4, y + 4, { width: colWidths[i], ellipsis: true }); x += colWidths[i]; });
    doc.restore();
    return y + baseRowHeight;
  };
  const measureRowHeight = (cells) => {
    doc.fontSize(9);
    const paddX = 4, paddY = 3;
    let maxH = baseRowHeight;
    cells.forEach((c, i) => {
      const h = doc.heightOfString(String(c), { width: colWidths[i] - paddX * 2, lineGap: 1 });
      maxH = Math.max(maxH, h + paddY * 2);
    });
    return maxH;
  };
  const drawRow = (y, cells) => {
    const paddX = 4, paddY = 3;
    const maxH = measureRowHeight(cells);
    doc.save();
    doc.strokeColor("#B0B0B0").lineWidth(0.5).rect(left, y, tableWidth, maxH).stroke();
    doc.fillColor("#000");
    let x = left; cells.forEach((c, i) => {
      doc.text(String(c), x + paddX, y + paddY, { width: colWidths[i] - paddX * 2, lineGap: 1 });
      x += colWidths[i];
    });
    doc.restore();
    return y + maxH;
  };
  const ensurePage = (y) => {
    if (y + baseRowHeight > pageBottom) {
      doc.addPage();
      return 100;
    }
    return y;
  };

  // Header band
  doc.save();
  doc.rect(0, 0, doc.page.width, 60).fill("#111827");
  doc.fillColor("#F9FAFB").fontSize(20).text(`Malta Fight Co. - ${title}`, 0, 18, { align: "center" });
  doc.restore();

  const period = buildPeriod(fromDate, toDate, [
    ...(privateSessions || []).map((s) => s.date),
    ...(groupSessions || []).map((s) => s.date),
  ]);
  doc.fontSize(12).fillColor("#000");
  doc.text(`PERIOD: ${period}`, left, 80);

  // PRIVATE
  doc.fontSize(14).text("PRIVATE SESSION REVENUE", { underline: true });
  let y = doc.y + 8;
  y = drawHeaderRow(y, ["CLIENT NAME","DATE","SESSION TYPE","NET PRICE","YOUR PAY"]);
  if (!privateSessions || privateSessions.length === 0) {
    y = drawRow(y, ["No private sessions", "", "", "", ""]);
  } else {
    privateSessions.forEach((s) => {
      const cells = [s.clientName, s.date, s.sessionType, formatCurrency(s.netPricePerSession), formatCurrency(s.yourPay)];
      const need = measureRowHeight(cells) + 2;
      if (y + need > pageBottom - 12) {
        doc.addPage();
        doc.fontSize(14).text("PRIVATE SESSION REVENUE", { underline: true });
        y = doc.y + 8;
        y = drawHeaderRow(y, ["CLIENT NAME","DATE","SESSION TYPE","NET PRICE","YOUR PAY"]);
      }
      y = drawRow(y, cells);
    });
  }
  if (y + baseRowHeight > pageBottom - 12) {
    doc.addPage();
    doc.fontSize(14).text("PRIVATE SESSION REVENUE", { underline: true });
    y = doc.y + 8;
    y = drawHeaderRow(y, ["CLIENT NAME","DATE","SESSION TYPE","NET PRICE","YOUR PAY"]);
  }
  doc.save();
  doc.rect(left, y, tableWidth, baseRowHeight).fill("#111827");
  doc.fillColor("#F9FAFB").fontSize(10).text("TOTAL", cols[3] + 4, y + 4);
  doc.text(formatCurrency(totalPrivate), cols[4] + 4, y + 4);
  doc.restore();
  y += baseRowHeight + 10;

  // GROUP
  doc.fontSize(14).text("GROUP SESSION REVENUE", { underline: true });
  y = doc.y + 8;
  y = drawHeaderRow(y, ["CLIENT NAME","DATE","CLASS TYPE","MEMBERSHIP","YOUR PAY"]);
  if (!groupSessions || groupSessions.length === 0) {
    y = drawRow(y, ["No group sessions", "", "", "", ""]);
  } else {
    groupSessions.forEach((s) => {
      const cells = [s.clientName, s.date, s.classType, s.membershipUsed, formatCurrency(s.yourPay)];
      const need = measureRowHeight(cells) + 2;
      if (y + need > pageBottom - 12) {
        doc.addPage();
        doc.fontSize(14).text("GROUP SESSION REVENUE", { underline: true });
        y = doc.y + 8;
        y = drawHeaderRow(y, ["CLIENT NAME","DATE","CLASS TYPE","MEMBERSHIP","YOUR PAY"]);
      }
      y = drawRow(y, cells);
    });
  }
  if (y + baseRowHeight > pageBottom - 12) {
    doc.addPage();
    doc.fontSize(14).text("GROUP SESSION REVENUE", { underline: true });
    y = doc.y + 8;
    y = drawHeaderRow(y, ["CLIENT NAME","DATE","CLASS TYPE","MEMBERSHIP","YOUR PAY"]);
  }
  doc.save();
  doc.rect(left, y, tableWidth, baseRowHeight).fill("#111827");
  doc.fillColor("#F9FAFB").fontSize(10).text("TOTAL", cols[3] + 4, y + 4);
  doc.text(formatCurrency(totalGroup), cols[4] + 4, y + 4);
  doc.restore();
  y += baseRowHeight + 16;

  // DEDUCTIONS
  doc.save();
  doc.rect(left, y, tableWidth, baseRowHeight).fill("#000");
  doc.fillColor("#fff").fontSize(10).text("DEDUCTIONS", left + 4, y + 4);
  doc.restore();
  y += baseRowHeight + 8;
  doc.fillColor("#000").fontSize(12).text("No deductions recorded", left, y);
  y += 28;
  // TOTAL PAY footer
  doc.fontSize(16).text(`TOTAL PAY: ${formatCurrency(totalPay)}`, { align: "center" });

  return await new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
    doc.end();
  });
}

module.exports = {
  renderExcel,
  renderPDF,
};


