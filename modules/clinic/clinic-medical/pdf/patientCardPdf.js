// modules/clinic/clinic-medical/pdf/patientCardPdf.js
//
// Печатная медицинская карта пациента.
//
// Зачем она, если есть выгрузка в FHIR. FHIR — машинный формат: его читает
// другая система, а человек видит код. Врачу же нужен лист бумаги, который
// можно положить в историю, отдать пациенту на руки или взять с собой на
// консультацию. Это разные задачи, и одна кнопка их не закрывает.
//
// Порядок разделов не алфавитный и не «как в базе», а по цене незнания:
// аллергии, хронические, что принимает сейчас — сверху, потому что именно
// они меняют решение врача в первую минуту. Прививки и наследственность —
// ниже: их читают, когда есть время.
//
// Вёрстка намеренно повторяет рецептурный бланк: те же цвета, подписи
// разделов и рамки. Два документа из одной системы должны выглядеть роднёй.

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { CARD_LABELS } from "./patientCardLabels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "fonts");

const FONTS = {
  sans: path.join(FONT_DIR, "NotoSans-Regular.ttf"),
  sansBold: path.join(FONT_DIR, "NotoSans-Bold.ttf"),
  arabic: path.join(FONT_DIR, "NotoNaskhArabic-Regular.ttf"),
  arabicBold: path.join(FONT_DIR, "NotoNaskhArabic-Bold.ttf"),
};

const RTL_LANGS = new Set(["ar"]);

const NAVY = "#12507e";
const INK = "#16232e";
const MUTED = "#5c7180";
const RULE = "#c3d2dd";
const PANEL = "#f3f8fc";
const WARN = "#b23b2e";

function fmtDate(d, lang) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar" : lang, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export async function buildPatientCardPdf({ summary, patient, clinic, lang }) {
  const language = lang || clinic?.defaultLanguage || "ru";
  const t = CARD_LABELS[language] || CARD_LABELS.ru;
  const isRtl = RTL_LANGS.has(language);

  for (const [key, p] of Object.entries(FONTS)) {
    if (!fs.existsSync(p)) {
      throw new Error(`[patientCardPdf] Missing font ${key} at ${p}`);
    }
  }

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  doc.registerFont("sans", FONTS.sans);
  doc.registerFont("sansBold", FONTS.sansBold);
  doc.registerFont("arabic", FONTS.arabic);
  doc.registerFont("arabicBold", FONTS.arabicBold);

  // Шрифт по содержимому строки, а не по языку карты: в арабском шрифте нет
  // латиницы и кириллицы, и имя пациента, названия препаратов и диагнозы
  // печатались бы рядами пустых квадратов. Обратное тоже верно.
  const F_REG = "sans";
  const F_BOLD = "sansBold";

  const ARABIC_TEXT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
  let boldWanted = false;
  const applyFont = doc.font.bind(doc);
  doc.font = (name, ...rest) => {
    if (name === "sans" || name === "arabic") boldWanted = false;
    else if (name === "sansBold" || name === "arabicBold") boldWanted = true;
    return applyFont(name, ...rest);
  };
  const drawText = doc.text.bind(doc);
  doc.text = (str, ...rest) => {
    if (typeof str === "string" && str) {
      const arabic = ARABIC_TEXT.test(str);
      applyFont(
        arabic
          ? boldWanted
            ? "arabicBold"
            : "arabic"
          : boldWanted
            ? "sansBold"
            : "sans",
      );
    }
    return drawText(str, ...rest);
  };

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((r) => doc.on("end", () => r(Buffer.concat(chunks))));

  const pageW = doc.page.width;
  const left = doc.page.margins.left;
  const right = pageW - doc.page.margins.right;
  const contentW = right - left;
  const align = isRtl ? "right" : "left";

  let y = doc.page.margins.top;

  // Разрыв страницы делаем сами: разделы рисуются по координатам, и
  // автоматический перенос pdfkit разорвал бы рамку посередине.
  const need = (h) => {
    if (y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  };

  const sectionTag = (text) => {
    need(28);
    doc.font(F_BOLD).fontSize(7).fillColor(NAVY);
    doc.text(String(text).toUpperCase(), left, y, { width: contentW, align });
    y = doc.y + 4;
  };

  // Раздел-список. Пустой раздел печатаем тоже: «не зафиксированы» — это
  // сведение, а пропуск раздела читается как «забыли посмотреть».
  const listSection = (title, rows, emptyText) => {
    sectionTag(title);
    if (!rows.length) {
      need(16);
      doc.font(F_REG).fontSize(9).fillColor("#9fb0bd");
      doc.text(emptyText || t.empty, left, y, { width: contentW, align });
      y = doc.y + 10;
      return;
    }
    doc.font(F_REG).fontSize(9.5).fillColor(INK);
    for (const row of rows) {
      need(20);
      doc.font(F_REG).fontSize(9.5).fillColor(INK);
      doc.text(`•  ${row.main}`, left, y, { width: contentW - 90, align });
      const bottom = doc.y;
      if (row.aside) {
        doc.font(F_REG).fontSize(8).fillColor(MUTED);
        doc.text(row.aside, right - 86, y, { width: 86, align: "right" });
      }
      y = Math.max(bottom, doc.y) + 3;
    }
    y += 6;
  };

  // ── Шапка ─────────────────────────────────────────────────────────
  doc.rect(0, 0, pageW, 5).fill(NAVY);

  doc.font(F_BOLD).fontSize(15).fillColor(NAVY);
  doc.text(clinic?.legalName || clinic?.name || "", left, y, { width: contentW * 0.66 });
  let headBottom = doc.y;

  doc.font(F_REG).fontSize(8).fillColor(MUTED);
  const addr = [clinic?.address?.line1, clinic?.address?.city, clinic?.address?.country]
    .filter(Boolean)
    .join(", ");
  if (addr) {
    doc.text(addr, left, headBottom + 2, { width: contentW * 0.66 });
    headBottom = doc.y;
  }

  doc.font(F_REG).fontSize(8).fillColor(MUTED);
  doc.text(
    `${t.generated}: ${fmtDate(summary?.generatedAt || new Date(), language)}`,
    left + contentW * 0.66,
    y,
    { width: contentW * 0.34, align: "right" },
  );

  y = Math.max(headBottom, doc.y) + 12;

  doc.moveTo(left, y).lineTo(right, y).lineWidth(1.6).strokeColor(NAVY).stroke();
  y += 7;
  doc.font(F_BOLD).fontSize(12).fillColor(NAVY);
  doc.text(String(t.title).toUpperCase(), left, y, { width: contentW, align });
  y = doc.y + 4;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(RULE).stroke();
  y += 10;

  // ── Данные пациента ───────────────────────────────────────────────
  sectionTag(t.patientDetails);

  const patientName =
    patient?.fullName ||
    [patient?.lastName, patient?.firstName].filter(Boolean).join(" ") ||
    "";

  const facts = [
    [t.fullName, patientName],
    [t.dob, fmtDate(patient?.dateOfBirth, language)],
    [t.age, patient?.age != null ? String(patient.age) : ""],
    // Пол хранится кодом (male/female/…), а на бумаге он должен читаться
    // словом на языке документа.
    [t.sex, t.genders?.[patient?.gender] || patient?.sex || patient?.gender || ""],
    [t.weight, patient?.weightKg != null ? String(patient.weightKg) : ""],
    [t.phone, patient?.phone || ""],
    [t.cardNo, patient?.medicalRecordNumber || ""],
  ].filter(([, v]) => v);

  const colW = (contentW - 24) / 3;
  let col = 0;
  let rowTop = y;
  for (const [k, v] of facts) {
    const x = left + col * (colW + 12);
    doc.font(F_BOLD).fontSize(6.5).fillColor(MUTED);
    doc.text(String(k).toUpperCase(), x, rowTop, { width: colW, align });
    doc.font(F_REG).fontSize(10).fillColor(INK);
    doc.text(v, x, rowTop + 9, { width: colW, align });
    col += 1;
    if (col === 3) {
      col = 0;
      rowTop += 30;
      need(34);
    }
  }
  y = (col === 0 ? rowTop : rowTop + 30) + 4;

  // ── Аллергии ──────────────────────────────────────────────────────
  // Первым разделом и в рамке: это единственная часть карты, незнание
  // которой убивает в течение минут.
  const allergyLines = (summary?.allergies || []).map((a) => a.content).filter(Boolean);
  need(46);
  const aH = Math.max(34, 20 + allergyLines.length * 12);
  doc.rect(left, y, contentW, aH).fillAndStroke(PANEL, RULE);
  doc.rect(left, y, 2.5, aH).fill(WARN);
  doc.font(F_BOLD).fontSize(6.5).fillColor(WARN);
  doc.text(String(t.allergies).toUpperCase(), left + 10, y + 6, { width: contentW - 20 });
  doc.font(F_REG).fontSize(9.5).fillColor(allergyLines.length ? INK : "#9fb0bd");
  doc.text(
    allergyLines.length ? allergyLines.join("; ") : t.allergiesEmpty,
    left + 10,
    y + 17,
    { width: contentW - 20 },
  );
  y += aH + 10;

  // ── Разделы по цене незнания ──────────────────────────────────────
  listSection(
    t.chronic,
    (summary?.chronic || []).map((c) => ({
      main: c.content,
      aside: fmtDate(c.recordedAt, language),
    })),
  );

  listSection(
    t.current,
    (summary?.prescriptions || []).map((p) => ({
      main: [p.medication, p.dosage].filter(Boolean).join(" · "),
      aside: fmtDate(p.prescribedAt, language),
    })),
    t.currentEmpty,
  );

  listSection(
    t.encounters,
    (summary?.encounters || []).map((e) => ({
      main: [e.code, e.diagnosis || t.noDiagnosis].filter(Boolean).join(" — "),
      aside: fmtDate(e.date, language),
    })),
  );

  // Из анализов печатаем только отклонения: норму врач смотрит, когда есть
  // время, а на бумаге она вытеснила бы всё остальное.
  listSection(
    t.labsAbnormal,
    (summary?.labs?.abnormal || []).map((l) => ({
      main: [l.name || l.analyte, l.value != null ? `${l.value} ${l.unit || ""}`.trim() : ""]
        .filter(Boolean)
        .join(": "),
      aside: fmtDate(l.date || l.recordedAt, language),
    })),
  );

  listSection(
    t.operations,
    (summary?.operations || []).map((o) => ({
      main: o.content,
      aside: fmtDate(o.recordedAt, language),
    })),
  );

  listSection(
    t.immunization,
    (summary?.immunization || []).map((i) => ({
      main: i.content,
      aside: fmtDate(i.recordedAt, language),
    })),
  );

  listSection(
    t.family,
    (summary?.familyHistory || []).map((f) => ({
      main: f.content,
      aside: fmtDate(f.recordedAt, language),
    })),
  );

  // ── Оговорка ──────────────────────────────────────────────────────
  // Не юридическая формальность: врач, читающий распечатку, должен знать,
  // что пустой раздел означает «не внесено», а не «этого нет».
  need(40);
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(RULE).stroke();
  y += 6;
  doc.font(F_REG).fontSize(7).fillColor(MUTED);
  doc.text(t.disclaimer, left, y, { width: contentW, align });

  doc.end();
  return done;
}

export default buildPatientCardPdf;
