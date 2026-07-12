// server/modules/clinic/clinic-pharmacy/services/pharmacyReportPdf.service.js
//
// Renders the leadership dispense report to PDF with pdfkit and streams it
// into an Express response — same approach as the prescription / surgery-plan
// PDFs already in the project (pdfkit, TTF font for Cyrillic).
//
// This module does NOT query anything — it takes the object produced by
// pharmacyReport.service.getPeriodSummary() and draws it. The controller wires
// data → this renderer.
//
// ⚠ FONT: pdfkit's built-in fonts have NO Cyrillic. We register a Unicode TTF.
// Point FONT_REGULAR / FONT_BOLD at the SAME font files your existing
// pdf.service uses (Noto Sans / DejaVu). Defaults below assume a fonts dir at
// server/assets/fonts — adjust to your real path.

import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ⚠ Adjust these to your project's registered fonts.
const FONT_DIR = path.resolve(__dirname, "../../../../assets/fonts");
const FONT_REGULAR = path.join(FONT_DIR, "NotoSans-Regular.ttf");
const FONT_BOLD = path.join(FONT_DIR, "NotoSans-Bold.ttf");

// Fallback to built-in Helvetica if the TTFs aren't found (Latin only — better
// than crashing; Cyrillic will render as boxes, signalling the font is missing).
function resolveFonts() {
  const hasRegular = fs.existsSync(FONT_REGULAR);
  const hasBold = fs.existsSync(FONT_BOLD);
  return {
    regular: hasRegular ? FONT_REGULAR : "Helvetica",
    bold: hasBold ? FONT_BOLD : "Helvetica-Bold",
    usingTtf: hasRegular && hasBold,
  };
}

const TARGET_LABELS = {
  requisition: "По заявкам",
  patient: "Пациентам",
  department: "На отделения",
};

function fmtDate(d) {
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/**
 * Stream the report PDF into res.
 *
 * @param {object} args
 * @param {import("express").Response} args.res
 * @param {object} args.summary   from getPeriodSummary()
 * @param {object} [args.clinic]  { name } for the header
 * @param {string} [args.periodLabel]  e.g. "Месяц", "Квартал"
 * @param {string} [args.filename]
 */
export function streamDispenseReportPdf({
  res,
  summary,
  clinic = {},
  periodLabel = "",
  filename = "pharmacy-report.pdf",
}) {
  const fonts = resolveFonts();
  const doc = new PDFDocument({ size: "A4", margin: 48 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const F = fonts.regular;
  const FB = fonts.bold;
  const pageWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // ── header ──
  doc.font(FB).fontSize(18).fillColor("#111827");
  doc.text("Отчёт по выдаче препаратов", { align: "left" });
  doc.moveDown(0.2);
  doc.font(F).fontSize(11).fillColor("#6b7280");
  if (clinic.name) doc.text(clinic.name);
  const { from, to } = summary.range || {};
  const rangeStr =
    from && to
      ? `${fmtDate(from)} — ${fmtDate(new Date(new Date(to).getTime() - 1))}`
      : "";
  doc.text(
    [periodLabel && `Период: ${periodLabel}`, rangeStr]
      .filter(Boolean)
      .join("   ·   "),
  );
  doc.moveDown(0.6);
  doc
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .moveTo(left, doc.y)
    .lineTo(left + pageWidth, doc.y)
    .stroke();
  doc.moveDown(0.8);

  // ── totals ──
  const t = summary.totals || { qty: 0, events: 0 };
  doc.font(FB).fontSize(13).fillColor("#111827").text("Итоги");
  doc.moveDown(0.3);
  doc.font(F).fontSize(11).fillColor("#374151");
  doc.text(`Всего выдач: ${t.events}`);
  doc.text(`Суммарное количество (в базовых единицах): ${t.qty}`);
  doc.moveDown(0.3);

  const bt = summary.byTarget || {};
  const targetLine = ["requisition", "patient", "department"]
    .map((k) => {
      const v = bt[k];
      return v ? `${TARGET_LABELS[k]}: ${v.qty}` : null;
    })
    .filter(Boolean)
    .join("   ·   ");
  if (targetLine) doc.text(`По каналам — ${targetLine}`);
  doc.moveDown(0.8);

  // ── table helper ──
  function drawTable(title, rows, cols) {
    doc.font(FB).fontSize(13).fillColor("#111827").text(title);
    doc.moveDown(0.3);

    const startX = left;
    let y = doc.y;
    const rowH = 20;

    // header
    doc.font(FB).fontSize(10).fillColor("#6b7280");
    cols.forEach((c) => {
      doc.text(c.header, c.x, y, { width: c.w, align: c.align || "left" });
    });
    y += rowH;
    doc
      .strokeColor("#e5e7eb")
      .lineWidth(0.7)
      .moveTo(startX, y - 4)
      .lineTo(startX + pageWidth, y - 4)
      .stroke();

    doc.font(F).fontSize(10).fillColor("#374151");
    for (const row of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - rowH) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      cols.forEach((c) => {
        const val = c.get(row);
        doc.text(String(val ?? "—"), c.x, y, {
          width: c.w,
          align: c.align || "left",
        });
      });
      y += rowH;
    }
    doc.y = y + 6;
    doc.moveDown(0.4);
  }

  // ── top drugs ──
  const colX = left;
  const topCols = [
    { header: "Препарат", x: colX, w: 220, get: (r) => r.name },
    { header: "Форма", x: colX + 225, w: 90, get: (r) => r.form || "—" },
    {
      header: "Кол-во",
      x: colX + 320,
      w: 80,
      align: "right",
      get: (r) => r.qty,
    },
    {
      header: "Выдач",
      x: colX + 405,
      w: 80,
      align: "right",
      get: (r) => r.events,
    },
  ];
  drawTable("Топ препаратов", summary.topDrugs || [], topCols);

  // ── by department ──
  if ((summary.byDepartment || []).length) {
    const deptCols = [
      { header: "Отделение", x: colX, w: 300, get: (r) => r.name },
      {
        header: "Кол-во",
        x: colX + 320,
        w: 80,
        align: "right",
        get: (r) => r.qty,
      },
      {
        header: "Выдач",
        x: colX + 405,
        w: 80,
        align: "right",
        get: (r) => r.events,
      },
    ];
    drawTable("По отделениям", summary.byDepartment, deptCols);
  }

  // ── controlled (ПКУ) ──
  const ctrl = summary.controlled || {
    totals: { qty: 0, events: 0 },
    byDrug: [],
  };
  doc
    .font(FB)
    .fontSize(13)
    .fillColor("#b91c1c")
    .text("Предметно-количественный учёт (ПКУ)");
  doc.moveDown(0.3);
  doc.font(F).fontSize(11).fillColor("#374151");
  doc.text(
    `Выдач контролируемых: ${ctrl.totals.events}   ·   Количество: ${ctrl.totals.qty}`,
  );
  doc.moveDown(0.4);
  if ((ctrl.byDrug || []).length) {
    const ctrlCols = [
      { header: "Препарат", x: colX, w: 220, get: (r) => r.name },
      { header: "Форма", x: colX + 225, w: 90, get: (r) => r.form || "—" },
      {
        header: "Кол-во",
        x: colX + 320,
        w: 80,
        align: "right",
        get: (r) => r.qty,
      },
      {
        header: "Выдач",
        x: colX + 405,
        w: 80,
        align: "right",
        get: (r) => r.events,
      },
    ];
    drawTable("ПКУ — по препаратам", ctrl.byDrug, ctrlCols);
  } else {
    doc
      .font(F)
      .fontSize(10)
      .fillColor("#9ca3af")
      .text("Нет выдач контролируемых препаратов за период.");
    doc.moveDown(0.4);
  }

  // ── footer ──
  doc.font(F).fontSize(8).fillColor("#9ca3af");
  doc.text(
    `Сформировано: ${fmtDate(new Date())}${fonts.usingTtf ? "" : "  [шрифт кириллицы не найден — проверьте FONT_DIR]"}`,
    left,
    doc.page.height - doc.page.margins.bottom - 12,
    { width: pageWidth, align: "center" },
  );

  doc.end();
}
