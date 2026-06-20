// modules/clinic/clinic-medical/pdf/labResultPdf.js
//
// Lab Result PDF generator (clinic letterhead + parameter table).
// Stage 2 #A, Variant X. Node.js / pdfkit. Streams a Buffer back.
// Mirrors prescriptionPdf.js (fonts, header, RTL, fmtDate).
//
// Layout: clinic letterhead → title + lab no + date → patient → panel title →
// parameter table (Name | Value+unit+flag | Reference) → report → signature.
//
// FONTS — same NotoSans + NotoNaskhArabic in pdf/fonts/ as prescriptionPdf.

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "fonts");

const FONTS = {
  sans: path.join(FONT_DIR, "NotoSans-Regular.ttf"),
  sansBold: path.join(FONT_DIR, "NotoSans-Bold.ttf"),
  arabic: path.join(FONT_DIR, "NotoNaskhArabic-Regular.ttf"),
  arabicBold: path.join(FONT_DIR, "NotoNaskhArabic-Bold.ttf"),
};

const L = {
  ru: {
    title: "РЕЗУЛЬТАТ АНАЛИЗА",
    patient: "Пациент",
    dob: "Дата рождения",
    date: "Дата забора",
    diagnosis: "Диагноз",
    panel: "Тип анализа",
    lab: "Лаборатория",
    report: "Заключение",
    colName: "Показатель",
    colValue: "Значение",
    colRef: "Норма",
    doctor: "Врач",
    signature: "Подпись",
    stamp: "Печать",
    labNo: "Анализ №",
    voen: "ВОЕН",
    flagHigh: "В",
    flagLow: "Н",
    flagCrit: "!!",
    status: {
      preliminary: "Предварительно",
      final: "Готов",
      corrected: "Исправлен",
      amended: "Дополнен",
    },
  },
  en: {
    title: "LAB RESULT",
    patient: "Patient",
    dob: "Date of birth",
    date: "Collection date",
    diagnosis: "Diagnosis",
    panel: "Panel",
    lab: "Laboratory",
    report: "Conclusion",
    colName: "Parameter",
    colValue: "Value",
    colRef: "Reference",
    doctor: "Doctor",
    signature: "Signature",
    stamp: "Stamp",
    labNo: "Lab No.",
    voen: "Tax ID",
    flagHigh: "H",
    flagLow: "L",
    flagCrit: "!!",
    status: {
      preliminary: "Preliminary",
      final: "Final",
      corrected: "Corrected",
      amended: "Amended",
    },
  },
  az: {
    title: "ANALİZ NƏTİCƏSİ",
    patient: "Xəstə",
    dob: "Doğum tarixi",
    date: "Götürülmə tarixi",
    diagnosis: "Diaqnoz",
    panel: "Analiz növü",
    lab: "Laboratoriya",
    report: "Rəy",
    colName: "Göstərici",
    colValue: "Dəyər",
    colRef: "Norma",
    doctor: "Həkim",
    signature: "İmza",
    stamp: "Möhür",
    labNo: "Analiz №",
    voen: "VÖEN",
    flagHigh: "Y",
    flagLow: "A",
    flagCrit: "!!",
    status: {
      preliminary: "İlkin",
      final: "Hazır",
      corrected: "Düzəldilmiş",
      amended: "Əlavə edilmiş",
    },
  },
  tr: {
    title: "TAHLİL SONUCU",
    patient: "Hasta",
    dob: "Doğum tarihi",
    date: "Alınma tarihi",
    diagnosis: "Tanı",
    panel: "Tahlil türü",
    lab: "Laboratuvar",
    report: "Sonuç",
    colName: "Parametre",
    colValue: "Değer",
    colRef: "Referans",
    doctor: "Doktor",
    signature: "İmza",
    stamp: "Kaşe",
    labNo: "Tahlil No.",
    voen: "Vergi No.",
    flagHigh: "Y",
    flagLow: "D",
    flagCrit: "!!",
    status: {
      preliminary: "Ön",
      final: "Hazır",
      corrected: "Düzeltilmiş",
      amended: "Eklenmiş",
    },
  },
  ar: {
    title: "نتيجة التحليل",
    patient: "المريض",
    dob: "تاريخ الميلاد",
    date: "تاريخ السحب",
    diagnosis: "التشخيص",
    panel: "نوع التحليل",
    lab: "المختبر",
    report: "الخلاصة",
    colName: "المؤشر",
    colValue: "القيمة",
    colRef: "المرجع",
    doctor: "الطبيب",
    signature: "التوقيع",
    stamp: "الختم",
    labNo: "تحليل رقم",
    voen: "الرقم الضريبي",
    flagHigh: "م",
    flagLow: "خ",
    flagCrit: "!!",
    status: {
      preliminary: "أولي",
      final: "جاهز",
      corrected: "مصحح",
      amended: "معدل",
    },
  },
};

const RTL_LANGS = new Set(["ar"]);

function prepareRtl(text, lang) {
  if (!RTL_LANGS.has(lang) || !text) return text;
  return [...String(text)].reverse().join("");
}

function fmtDate(d, lang) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString(lang === "ar" ? "ar" : lang, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return new Date(d).toISOString().split("T")[0];
  }
}

// flag → short text tag (avoids glyphs Noto may lack)
function flagTag(flag, t) {
  switch (flag) {
    case "high":
      return ` (${t.flagHigh})`;
    case "low":
      return ` (${t.flagLow})`;
    case "critical_high":
      return ` (${t.flagCrit}${t.flagHigh})`;
    case "critical_low":
      return ` (${t.flagCrit}${t.flagLow})`;
    case "abnormal":
      return ` (${t.flagCrit})`;
    default:
      return "";
  }
}

function refText(rr) {
  if (!rr) return "—";
  if (rr.text) return rr.text;
  if (rr.min != null || rr.max != null) {
    return `${rr.min ?? ""}–${rr.max ?? ""}`;
  }
  return "—";
}

/**
 * Build a lab result PDF as a Buffer.
 *
 * @param {object} args
 * @param {object} args.labResult — toApiShape output from the service
 * @param {object} [args.clinic]
 * @param {object} [args.patient]
 * @param {string} [args.lang]
 * @returns {Promise<Buffer>}
 */
export async function buildLabResultPdf({
  labResult,
  clinic = null,
  patient = null,
  lang,
}) {
  const language = lang || clinic?.defaultLanguage || "ru";
  const t = L[language] || L.ru;
  const isRtl = RTL_LANGS.has(language);
  const tx = (s) => prepareRtl(s, language);

  for (const [key, p] of Object.entries(FONTS)) {
    if (!fs.existsSync(p)) {
      throw new Error(
        `[labResultPdf] Missing font ${key} at ${p}. ` +
          `Place Noto fonts in pdf/fonts/ — see prescriptionPdf header.`,
      );
    }
  }

  const useArabic = isRtl;
  const F_REG = useArabic ? "arabic" : "sans";
  const F_BOLD = useArabic ? "arabicBold" : "sansBold";

  const doc = new PDFDocument({ size: "A4", margin: 48 });

  doc.registerFont("sans", FONTS.sans);
  doc.registerFont("sansBold", FONTS.sansBold);
  doc.registerFont("arabic", FONTS.arabic);
  doc.registerFont("arabicBold", FONTS.arabicBold);

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const pageW = doc.page.width;
  const left = doc.page.margins.left;
  const right = pageW - doc.page.margins.right;
  const contentW = right - left;

  const alignOpt = isRtl
    ? { align: "right", width: contentW }
    : { width: contentW };

  // ─── HEADER: clinic letterhead ────────────────────────────────────
  let y = doc.page.margins.top;

  const clinicName = clinic?.legalName || clinic?.name || "";
  doc.font(F_BOLD).fontSize(16).fillColor("#0f172a");
  doc.text(tx(clinicName), left, y, alignOpt);
  y = doc.y + 2;

  const addr = clinic?.address
    ? [clinic.address.street, clinic.address.city, clinic.address.country]
        .filter(Boolean)
        .join(", ")
    : "";
  const contactLine = clinic?.contacts
    ? [clinic.contacts.phone, clinic.contacts.email, clinic.contacts.website]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  doc.font(F_REG).fontSize(9).fillColor("#64748b");
  if (addr) {
    doc.text(tx(addr), left, y, alignOpt);
    y = doc.y;
  }
  if (contactLine) {
    doc.text(tx(contactLine), left, y, alignOpt);
    y = doc.y;
  }
  if (clinic?.taxId) {
    doc.text(tx(`${t.voen}: ${clinic.taxId}`), left, y, alignOpt);
    y = doc.y;
  }

  y += 8;
  doc
    .moveTo(left, y)
    .lineTo(right, y)
    .strokeColor("#cbd5e1")
    .lineWidth(1)
    .stroke();
  y += 16;

  // ─── TITLE + lab number + date + status ───────────────────────────
  doc.font(F_BOLD).fontSize(20).fillColor("#1e293b");
  doc.text(tx(t.title), left, y, alignOpt);
  y = doc.y + 4;

  doc.font(F_REG).fontSize(10).fillColor("#475569");
  const labShort = labResult._id ? String(labResult._id).slice(-8) : "";
  const statusLabel = t.status[labResult.status] || labResult.status || "";
  doc.text(
    tx(
      `${t.labNo} ${labShort}   ·   ${t.date}: ${fmtDate(labResult.effectiveDateTime || labResult.createdAt, language)}   ·   ${statusLabel}`,
    ),
    left,
    y,
    alignOpt,
  );
  y = doc.y + 12;

  // ─── PATIENT block ────────────────────────────────────────────────
  const patientName = patient
    ? [patient.firstName, patient.lastName].filter(Boolean).join(" ")
    : "";
  doc.font(F_BOLD).fontSize(11).fillColor("#0f172a");
  doc.text(tx(`${t.patient}: ${patientName}`), left, y, alignOpt);
  y = doc.y;
  if (patient?.dateOfBirth) {
    doc.font(F_REG).fontSize(10).fillColor("#475569");
    doc.text(
      tx(`${t.dob}: ${fmtDate(patient.dateOfBirth, language)}`),
      left,
      y,
      alignOpt,
    );
    y = doc.y;
  }

  // Panel + lab name
  const panelTitle = labResult.panelTitle || labResult.panelType || "";
  if (panelTitle) {
    doc.font(F_REG).fontSize(10).fillColor("#475569");
    doc.text(tx(`${t.panel}: ${panelTitle}`), left, y, alignOpt);
    y = doc.y;
  }
  if (labResult.labName) {
    doc.font(F_REG).fontSize(10).fillColor("#475569");
    doc.text(tx(`${t.lab}: ${labResult.labName}`), left, y, alignOpt);
    y = doc.y;
  }
  if (labResult.diagnosis?.text || labResult.diagnosis?.code) {
    const dx = [labResult.diagnosis.code, labResult.diagnosis.text]
      .filter(Boolean)
      .join(" — ");
    doc.font(F_REG).fontSize(10).fillColor("#475569");
    doc.text(tx(`${t.diagnosis}: ${dx}`), left, y, alignOpt);
    y = doc.y;
  }

  y += 12;
  doc
    .moveTo(left, y)
    .lineTo(right, y)
    .strokeColor("#e2e8f0")
    .lineWidth(0.5)
    .stroke();
  y += 14;

  // ─── PARAMETER TABLE ──────────────────────────────────────────────
  const params = Array.isArray(labResult.parameters)
    ? labResult.parameters
    : [];

  // column geometry (LTR). For RTL we just right-align text in same columns.
  const colNameW = contentW * 0.45;
  const colValW = contentW * 0.3;
  const colRefW = contentW * 0.25;
  const xName = left;
  const xVal = left + colNameW;
  const xRef = left + colNameW + colValW;

  // header row
  doc.font(F_BOLD).fontSize(9).fillColor("#64748b");
  doc.text(tx(t.colName), xName, y, { width: colNameW });
  doc.text(tx(t.colValue), xVal, y, { width: colValW });
  doc.text(tx(t.colRef), xRef, y, { width: colRefW });
  y = doc.y + 4;
  doc
    .moveTo(left, y)
    .lineTo(right, y)
    .strokeColor("#e2e8f0")
    .lineWidth(0.5)
    .stroke();
  y += 6;

  for (const p of params) {
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    const isCrit = p.flag === "critical_high" || p.flag === "critical_low";
    const isAbn = p.flag && p.flag !== "normal";
    const valColor = isCrit ? "#b91c1c" : isAbn ? "#b45309" : "#0f172a";

    const unit = p.unit && p.unit !== "—" ? ` ${p.unit}` : "";
    const valStr = `${p.value}${unit}${flagTag(p.flag, t)}`;
    const ref = refText(p.referenceRange);

    const rowTop = y;
    doc.font(F_REG).fontSize(10).fillColor("#1e293b");
    doc.text(tx(String(p.name || "")), xName, rowTop, { width: colNameW });
    const nameBottom = doc.y;

    doc
      .font(isAbn ? F_BOLD : F_REG)
      .fontSize(10)
      .fillColor(valColor);
    doc.text(tx(valStr), xVal, rowTop, { width: colValW });
    const valBottom = doc.y;

    doc.font(F_REG).fontSize(10).fillColor("#64748b");
    doc.text(tx(ref), xRef, rowTop, { width: colRefW });
    const refBottom = doc.y;

    y = Math.max(nameBottom, valBottom, refBottom) + 5;
    doc
      .moveTo(left, y - 2)
      .lineTo(right, y - 2)
      .strokeColor("#f1f5f9")
      .lineWidth(0.5)
      .stroke();
  }

  // ─── REPORT / conclusion ──────────────────────────────────────────
  if (labResult.report) {
    y += 10;
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font(F_BOLD).fontSize(10).fillColor("#0f172a");
    doc.text(tx(`${t.report}:`), left, y, alignOpt);
    y = doc.y + 2;
    doc.font(F_REG).fontSize(10).fillColor("#334155");
    doc.text(tx(labResult.report), left, y, alignOpt);
    y = doc.y;
  }

  // ─── SIGNATURE / STAMP ────────────────────────────────────────────
  const sigY = Math.max(y + 40, doc.page.height - 130);
  doc.font(F_REG).fontSize(10).fillColor("#475569");

  // doctor name (optional) printed on the signature line
  const docName = labResult.doctorName ? ` ${labResult.doctorName}` : "";

  if (!isRtl) {
    doc.text(
      `${t.doctor}:${docName ? docName + "  " : "  "}__________________________`,
      left,
      sigY,
    );
    doc.text(`${t.signature}: ____________________`, left, sigY + 22);
    doc
      .rect(right - 130, sigY - 6, 130, 90)
      .dash(3, { space: 3 })
      .strokeColor("#cbd5e1")
      .stroke();
    doc.undash();
    doc
      .fontSize(9)
      .fillColor("#94a3b8")
      .text(t.stamp, right - 130, sigY + 36, { width: 130, align: "center" });
  } else {
    doc.text(
      tx(
        `${t.doctor}:${docName ? docName + "  " : "  "}__________________________`,
      ),
      left,
      sigY,
      alignOpt,
    );
    doc.text(
      tx(`${t.signature}: ____________________`),
      left,
      sigY + 22,
      alignOpt,
    );
    doc
      .rect(left, sigY - 6, 130, 90)
      .dash(3, { space: 3 })
      .strokeColor("#cbd5e1")
      .stroke();
    doc.undash();
    doc
      .fontSize(9)
      .fillColor("#94a3b8")
      .text(tx(t.stamp), left, sigY + 36, { width: 130, align: "center" });
  }

  doc.end();
  return done;
}

export default buildLabResultPdf;
