import PDFDocument from "pdfkit";

const PROCEDURE_LABELS = {
  rhinoplasty: "Ринопластика",
  breast_augmentation: "Увеличение груди",
  breast_reduction: "Уменьшение груди",
  blepharoplasty: "Блефаропластика",
  liposuction: "Липосакция",
  abdominoplasty: "Абдоминопластика",
  facelift: "Подтяжка лица",
  otoplasty: "Отопластика",
  chin_implant: "Имплант подбородка",
  lip_augmentation: "Увеличение губ",
  other: "Другое",
};

const STATUS_LABELS = {
  planned: "Запланирована",
  completed: "Выполнена",
  follow_up: "Наблюдение",
  closed: "Закрыт",
};

export function generateSurgeryPlanPDF(cas, stream) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 60, right: 60 },
    info: {
      Title: `Операционный план — ${PROCEDURE_LABELS[cas.procedure] || cas.procedure}`,
      Author: "DocPats Medical Platform",
      Subject: "Хирургическое планирование",
    },
  });

  doc.pipe(stream);

  const W = doc.page.width - 120; // ширина контента
  const L = 60; // левый отступ
  const GRAY = "#64748b";
  const DARK = "#0f172a";
  const ACCENT = "#6366f1";

  // ─── Шапка ──────────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 90).fill("#0f172a");

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("DOCPATS", L, 22);

  doc
    .fillColor("#94a3b8")
    .font("Helvetica")
    .fontSize(9)
    .text("Medical Platform · Surgical Planning", L, 46);

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(PROCEDURE_LABELS[cas.procedure] || cas.procedure, L, 22, {
      align: "right",
      width: W,
    });

  doc
    .fillColor("#94a3b8")
    .font("Helvetica")
    .fontSize(9)
    .text(
      `ID: ${String(cas._id)} · ${new Date().toLocaleDateString("ru-RU")}`,
      L,
      46,
      { align: "right", width: W },
    );

  doc.y = 110;

  // ─── Основная информация ─────────────────────────────────────────────────
  infoRow(
    doc,
    L,
    W,
    "Процедура",
    PROCEDURE_LABELS[cas.procedure] || cas.procedure,
  );
  infoRow(doc, L, W, "Статус", STATUS_LABELS[cas.status] || cas.status);
  infoRow(
    doc,
    L,
    W,
    "Дата операции",
    cas.operationDate
      ? new Date(cas.operationDate).toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "—",
  );
  infoRow(doc, L, W, "ID пациента", cas.patientId || "Конфиденциально");

  doc.moveDown(1);
  divider(doc, L, W);

  // ─── Структурированный план ───────────────────────────────────────────────
  const structured = cas.plan?.structured || {};
  const text = cas.plan?.text || "";

  if (text && text.trim()) {
    const sections = text.split("###").filter(Boolean);
    sections.forEach((sec) => {
      const lines = sec.trim().split("\n");
      const title = lines.shift()?.trim();

      if (title) {
        sectionHeader(doc, L, W, title, ACCENT);
      }

      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const colonIdx = trimmed.indexOf(":");
        if (colonIdx > -1) {
          const key = trimmed.slice(0, colonIdx).trim();
          const val = trimmed.slice(colonIdx + 1).trim();

          doc.x = L;
          doc
            .fillColor(GRAY)
            .font("Helvetica")
            .fontSize(9)
            .text(key + ":", L, doc.y, { continued: false, width: 180 });

          const prevY = doc.y;
          doc
            .fillColor(DARK)
            .font("Helvetica")
            .fontSize(9)
            .text(val || "—", L + 190, prevY - doc.currentLineHeight(true), {
              width: W - 190,
            });

          doc.moveDown(0.3);
        } else {
          doc
            .fillColor(DARK)
            .font("Helvetica")
            .fontSize(9)
            .text(trimmed, L, doc.y, { width: W });
          doc.moveDown(0.2);
        }
      });

      doc.moveDown(0.5);
    });
  } else {
    // Нет плана
    doc
      .fillColor(GRAY)
      .font("Helvetica-Oblique")
      .fontSize(11)
      .text("Операционный план не заполнен.", L, doc.y);
  }

  // ─── Раздел подписей ──────────────────────────────────────────────────────
  const signY = doc.page.height - 120;
  if (doc.y < signY - 40) doc.y = signY - 20;

  divider(doc, L, W);
  doc.moveDown(0.5);

  signLine(doc, L, "Оперирующий хирург:");
  signLine(doc, L + W / 2, "Пациент / Законный представитель:");

  // ─── Футер ────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 45;
  doc.rect(0, footerY - 10, doc.page.width, 55).fill("#f8fafc");

  doc
    .fillColor(GRAY)
    .font("Helvetica")
    .fontSize(8)
    .text(
      `Документ сформирован: ${new Date().toLocaleString("ru-RU")} · DocPats Medical Platform · docpats.com`,
      L,
      footerY,
      { align: "center", width: W },
    );

  doc
    .fillColor("#cbd5e1")
    .font("Helvetica")
    .fontSize(7)
    .text(
      "Данный документ содержит конфиденциальную медицинскую информацию. Хранить в соответствии с требованиями законодательства.",
      L,
      footerY + 14,
      { align: "center", width: W },
    );

  doc.end();
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────

function infoRow(doc, L, W, label, value) {
  const y = doc.y;
  doc
    .fillColor("#64748b")
    .font("Helvetica")
    .fontSize(9)
    .text(label + ":", L, y, { width: 160, continued: false });
  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(value || "—", L + 170, y, { width: W - 170 });
  doc.moveDown(0.5);
}

function divider(doc, L, W) {
  doc
    .strokeColor("#e2e8f0")
    .lineWidth(0.5)
    .moveTo(L, doc.y)
    .lineTo(L + W, doc.y)
    .stroke();
  doc.moveDown(0.8);
}

function sectionHeader(doc, L, W, title, accent) {
  // Полоса слева
  doc.rect(L, doc.y, 3, 18).fill(accent);

  doc
    .fillColor("#0f172a")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title.replace(/[🗣️📐🔬⚠️📋⚙️🔩]/gu, "").trim(), L + 12, doc.y, {
      width: W - 12,
    });

  doc.moveDown(0.6);
}

function signLine(doc, x, label) {
  doc
    .fillColor("#64748b")
    .font("Helvetica")
    .fontSize(8)
    .text(label, x, doc.y, { width: 220 });
  doc.moveDown(0.4);
  doc
    .strokeColor("#334155")
    .lineWidth(0.5)
    .moveTo(x, doc.y)
    .lineTo(x + 200, doc.y)
    .stroke();
  doc.moveDown(0.3);
  doc
    .fillColor("#94a3b8")
    .font("Helvetica")
    .fontSize(7)
    .text("Подпись / Дата", x, doc.y, { width: 200 });
  doc.moveDown(1.5);
}
