// modules/clinic/clinic-medical/pdf/prescriptionPdf.js
//
// Prescription PDF generator (Level 2 — clinic letterhead + signature area).
// Stage 2 #4. Node.js / pdfkit. Streams a Buffer back to the controller.
//
// WHO Good Prescribing item layout (revision 2 Jun 2026):
//   INN (bold) + brand in parens, strength · form · route line,
//   dose · frequency · duration · qty · prn line, instructions line.
//
// ─────────────────────────────────────────────────────────────────────────
//  FONTS — REQUIRED SETUP (NotoSans + NotoNaskhArabic in pdf/fonts/)
// ─────────────────────────────────────────────────────────────────────────

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { FORM_LABELS } from "./prescriptionFormLabels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "fonts");

const FONTS = {
  sans: path.join(FONT_DIR, "NotoSans-Regular.ttf"),
  sansBold: path.join(FONT_DIR, "NotoSans-Bold.ttf"),
  arabic: path.join(FONT_DIR, "NotoNaskhArabic-Regular.ttf"),
  arabicBold: path.join(FONT_DIR, "NotoNaskhArabic-Bold.ttf"),
};

// ─── i18n labels for the PDF (self-contained — not the app i18n) ──────
const L = {
  ru: {
    title: "РЕЦЕПТ",
    patient: "Пациент",
    dob: "Дата рождения",
    date: "Дата",
    diagnosis: "Диагноз",
    inn: "МНН",
    brand: "Торговое",
    strength: "Сила",
    form: "Форма",
    route: "Путь введения",
    dose: "Доза",
    freq: "Приём",
    duration: "Длительность",
    instructions: "Указания",
    qty: "Кол-во",
    prn: "по требованию",
    generalNotes: "Общие указания",
    doctor: "Врач",
    signature: "Подпись",
    stamp: "Печать",
    rxNo: "Рецепт №",
    voen: "ВОЕН",
    forms: {
      tablet: "таблетки",
      capsule: "капсулы",
      syrup: "сироп",
      spray: "спрей",
      drops: "капли",
      ointment: "мазь",
      injection: "инъекции",
      inhaler: "ингалятор",
      suppository: "свечи",
      solution: "раствор",
      powder: "порошок",
      other: "—",
    },
    routes: {
      oral: "перорально",
      topical: "наружно",
      intramuscular: "в/м",
      intravenous: "в/в",
      subcutaneous: "п/к",
      inhalation: "ингаляционно",
      nasal: "интраназально",
      otic: "в ухо",
      ophthalmic: "в глаз",
      rectal: "ректально",
      sublingual: "под язык",
      other: "—",
    },
  },
  en: {
    title: "PRESCRIPTION",
    patient: "Patient",
    dob: "Date of birth",
    date: "Date",
    diagnosis: "Diagnosis",
    inn: "INN",
    brand: "Brand",
    strength: "Strength",
    form: "Form",
    route: "Route",
    dose: "Dose",
    freq: "Frequency",
    duration: "Duration",
    instructions: "Instructions",
    qty: "Qty",
    prn: "as needed",
    generalNotes: "General notes",
    doctor: "Doctor",
    signature: "Signature",
    stamp: "Stamp",
    rxNo: "Rx No.",
    voen: "Tax ID",
    forms: {
      tablet: "tablets",
      capsule: "capsules",
      syrup: "syrup",
      spray: "spray",
      drops: "drops",
      ointment: "ointment",
      injection: "injection",
      inhaler: "inhaler",
      suppository: "suppository",
      solution: "solution",
      powder: "powder",
      other: "—",
    },
    routes: {
      oral: "oral",
      topical: "topical",
      intramuscular: "IM",
      intravenous: "IV",
      subcutaneous: "SC",
      inhalation: "inhalation",
      nasal: "nasal",
      otic: "otic",
      ophthalmic: "ophthalmic",
      rectal: "rectal",
      sublingual: "sublingual",
      other: "—",
    },
  },
  az: {
    title: "RESEPT",
    patient: "Xəstə",
    dob: "Doğum tarixi",
    date: "Tarix",
    diagnosis: "Diaqnoz",
    inn: "BDA",
    brand: "Ticarət adı",
    strength: "Güc",
    form: "Forma",
    route: "Yeridilmə yolu",
    dose: "Doza",
    freq: "Qəbul",
    duration: "Müddət",
    instructions: "Göstərişlər",
    qty: "Sayı",
    prn: "tələb olduqda",
    generalNotes: "Ümumi göstərişlər",
    doctor: "Həkim",
    signature: "İmza",
    stamp: "Möhür",
    rxNo: "Resept №",
    voen: "VÖEN",
    forms: {
      tablet: "tablet",
      capsule: "kapsul",
      syrup: "şərbət",
      spray: "sprey",
      drops: "damcı",
      ointment: "məlhəm",
      injection: "inyeksiya",
      inhaler: "inhalyator",
      suppository: "şam",
      solution: "məhlul",
      powder: "toz",
      other: "—",
    },
    routes: {
      oral: "ağızdan",
      topical: "xarici",
      intramuscular: "ə/d",
      intravenous: "v/d",
      subcutaneous: "d/a",
      inhalation: "inhalyasiya",
      nasal: "burundan",
      otic: "qulağa",
      ophthalmic: "gözə",
      rectal: "rektal",
      sublingual: "dilaltı",
      other: "—",
    },
  },
  tr: {
    title: "REÇETE",
    patient: "Hasta",
    dob: "Doğum tarihi",
    date: "Tarih",
    diagnosis: "Tanı",
    inn: "INN",
    brand: "Ticari ad",
    strength: "Güç",
    form: "Form",
    route: "Uygulama yolu",
    dose: "Doz",
    freq: "Kullanım",
    duration: "Süre",
    instructions: "Talimatlar",
    qty: "Adet",
    prn: "gerektiğinde",
    generalNotes: "Genel talimatlar",
    doctor: "Doktor",
    signature: "İmza",
    stamp: "Kaşe",
    rxNo: "Reçete No.",
    voen: "Vergi No.",
    forms: {
      tablet: "tablet",
      capsule: "kapsül",
      syrup: "şurup",
      spray: "sprey",
      drops: "damla",
      ointment: "merhem",
      injection: "enjeksiyon",
      inhaler: "inhaler",
      suppository: "fitil",
      solution: "çözelti",
      powder: "toz",
      other: "—",
    },
    routes: {
      oral: "oral",
      topical: "topikal",
      intramuscular: "IM",
      intravenous: "IV",
      subcutaneous: "SC",
      inhalation: "inhalasyon",
      nasal: "nazal",
      otic: "kulağa",
      ophthalmic: "göze",
      rectal: "rektal",
      sublingual: "dilaltı",
      other: "—",
    },
  },
  ar: {
    title: "وصفة طبية",
    patient: "المريض",
    dob: "تاريخ الميلاد",
    date: "التاريخ",
    diagnosis: "التشخيص",
    inn: "الاسم العلمي",
    brand: "الاسم التجاري",
    strength: "التركيز",
    form: "الشكل",
    route: "طريقة الإعطاء",
    dose: "الجرعة",
    freq: "التكرار",
    duration: "المدة",
    instructions: "التعليمات",
    qty: "الكمية",
    prn: "عند الحاجة",
    generalNotes: "تعليمات عامة",
    doctor: "الطبيب",
    signature: "التوقيع",
    stamp: "الختم",
    rxNo: "وصفة رقم",
    voen: "الرقم الضريبي",
    forms: {
      tablet: "أقراص",
      capsule: "كبسولات",
      syrup: "شراب",
      spray: "بخاخ",
      drops: "قطرات",
      ointment: "مرهم",
      injection: "حقن",
      inhaler: "بخاخ استنشاق",
      suppository: "تحاميل",
      solution: "محلول",
      powder: "مسحوق",
      other: "—",
    },
    routes: {
      oral: "فموي",
      topical: "موضعي",
      intramuscular: "عضلي",
      intravenous: "وريدي",
      subcutaneous: "تحت الجلد",
      inhalation: "استنشاق",
      nasal: "أنفي",
      otic: "أذني",
      ophthalmic: "عيني",
      rectal: "شرجي",
      sublingual: "تحت اللسان",
      other: "—",
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

/**
 * Build a prescription PDF as a Buffer.
 *
 * @param {object} args
 * @param {object} args.prescription — toApiShape output from the service
 * @param {object} [args.clinic]     — Clinic doc
 * @param {object} [args.patient]    — ClinicPatient
 * @param {string} [args.lang]       — "ru"|"en"|"az"|"tr"|"ar"
 * @returns {Promise<Buffer>}
 */
export async function buildPrescriptionPdf({
  prescription,
  clinic = null,
  patient = null,
  lang,
}) {
  const language = lang || clinic?.defaultLanguage || "ru";
  // Подписи бланка лежат отдельным файлом и накладываются поверх
  // старого словаря: там уже пять языковых объектов, и дописывать в
  // каждый по два десятка ключей значило бы править пять мест сразу.
  const t = { ...(L[language] || L.ru), ...(FORM_LABELS[language] || FORM_LABELS.ru) };
  const isRtl = RTL_LANGS.has(language);
  const tx = (s) => prepareRtl(s, language);

  for (const [key, p] of Object.entries(FONTS)) {
    if (!fs.existsSync(p)) {
      throw new Error(
        `[prescriptionPdf] Missing font ${key} at ${p}. ` +
          `Place Noto fonts in pdf/fonts/ — see file header.`,
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

  // ══ Бланк по образцу ВОЗ ══════════════════════════════════════════
  //
  // Раньше рецепт печатался сплошным текстом сверху вниз: заголовок, строки
  // «Пациент: …», нумерованный список препаратов. Читаемо, но на бланк не
  // похоже — а рецепт бумажный документ, его несут в аптеку, и аптекарь
  // ищет глазами привычные места: кто выписал, кому, что, сколько, до какого
  // числа, где подпись.
  //
  // Поэтому: шапка учреждения с лицензией, полоса заголовка с номером и
  // датой, поля пациента с подчёркиваниями, отдельная рамка аллергий,
  // рамка диагноза, таблица препаратов с колонками и строкой приёма под
  // каждым, условия замены и срок действия, блок врача с подписью и печатью.
  // Пустые поля печатаются линиями — их дозаполняют от руки, как на любом
  // официальном бланке.

  const clinicName = clinic?.legalName || clinic?.name || "";

  const NAVY = "#12507e";
  const INK = "#16232e";
  const MUTED = "#5c7180";
  const RULE = "#c3d2dd";
  const PANEL = "#f3f8fc";
  const WARN = "#b23b2e";

  // Верхняя полоса — по ней бланк узнают, не читая.
  doc.rect(0, 0, pageW, 5).fill(NAVY);

  let y = doc.page.margins.top;

  const label = (text, x, yy, w) => {
    doc.font(F_BOLD).fontSize(6.5).fillColor(MUTED);
    doc.text(tx(String(text).toUpperCase()), x, yy, { width: w, align: isRtl ? "right" : "left" });
    return doc.y;
  };

  const value = (text, x, yy, w, size = 9.5) => {
    doc.font(F_REG).fontSize(size).fillColor(INK);
    doc.text(tx(String(text || "")), x, yy, { width: w, align: isRtl ? "right" : "left" });
    return doc.y;
  };

  // Поле с подписью и подчёркиванием. Пустое поле остаётся линией — его
  // дозаполняют от руки.
  const field = (labelText, text, x, yy, w) => {
    label(labelText, x, yy, w);
    const vy = yy + 9;
    value(text, x, vy, w);
    const lineY = vy + 12;
    doc.moveTo(x, lineY).lineTo(x + w, lineY).lineWidth(0.7).strokeColor(RULE).stroke();
    return lineY + 9;
  };

  const sectionTag = (text, yy) => {
    doc.font(F_BOLD).fontSize(7).fillColor(NAVY);
    doc.text(tx(String(text).toUpperCase()), left, yy, { width: contentW, align: isRtl ? "right" : "left" });
    return doc.y + 3;
  };

  // ── Шапка учреждения ──────────────────────────────────────────────
  const licW = 150;
  const headW = contentW - licW - 16;

  doc.font(F_BOLD).fontSize(15).fillColor(NAVY);
  doc.text(tx(clinicName), left, y, { width: headW });
  let leftY = doc.y + 2;

  if (clinic?.department || clinic?.type) {
    doc.font(F_REG).fontSize(7.5).fillColor(MUTED);
    doc.text(tx(String(clinic.department || clinic.type).toUpperCase()), left, leftY, { width: headW });
    leftY = doc.y + 3;
  }

  doc.font(F_REG).fontSize(8).fillColor(MUTED);
  const addr = [clinic?.address?.line1, clinic?.address?.city, clinic?.address?.country]
    .filter(Boolean)
    .join(", ");
  if (addr) {
    doc.text(tx(addr), left, leftY, { width: headW });
    leftY = doc.y;
  }
  const contactLine = [clinic?.phone, clinic?.email].filter(Boolean).join(" · ");
  if (contactLine) {
    doc.text(tx(contactLine), left, leftY, { width: headW });
    leftY = doc.y;
  }

  // Лицензия и ссылка на форму — справа, как на официальных бланках.
  const licX = right - licW;
  let licY = y;
  label(t.facilityLicence, licX, licY, licW);
  licY = doc.y + 1;
  doc.font(F_REG).fontSize(8.5).fillColor(INK);
  doc.text(tx(clinic?.licenseNumber || "________________"), licX, licY, { width: licW });
  licY = doc.y + 5;
  label(t.formRef, licX, licY, licW);
  licY = doc.y + 1;
  doc.font(F_REG).fontSize(8.5).fillColor(INK);
  doc.text("RX-STD / WHO", licX, licY, { width: licW });

  y = Math.max(leftY, doc.y) + 12;

  // ── Полоса заголовка ──────────────────────────────────────────────
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1.6).strokeColor(NAVY).stroke();
  y += 7;
  doc.font(F_BOLD).fontSize(11).fillColor(NAVY);
  doc.text(tx(String(t.title).toUpperCase()), left, y, { width: contentW * 0.5 });

  doc.font(F_REG).fontSize(8).fillColor(MUTED);
  const metaY = y + 2;
  const rxText = `${t.rxNo} ${prescription?.rxNumber || "__________"}`;
  const dateText = `${t.date} ${fmtDate(prescription?.issuedAt || prescription?.createdAt || new Date(), language)}`;
  doc.text(tx(`${rxText}     ${dateText}`), left + contentW * 0.5, metaY, {
    width: contentW * 0.5,
    align: "right",
  });

  y = Math.max(doc.y, y + 14) + 4;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(RULE).stroke();
  y += 10;

  // ── Данные пациента ───────────────────────────────────────────────
  y = sectionTag(t.patientDetails, y);

  const gap = 12;
  const w2 = (contentW - gap) / 2;
  const w4 = (contentW - gap * 3) / 4;

  const patientName =
    patient?.fullName ||
    [patient?.lastName, patient?.firstName].filter(Boolean).join(" ") ||
    "";

  let rowY = field(t.fullName, patientName, left, y, w2 + w4 + gap);
  field(t.patientId, patient?.medicalRecordNumber || patient?.patientId || "", left + w2 + w4 + gap * 2, y, w4);
  y = rowY;

  rowY = field(t.dob, patient?.dateOfBirth ? fmtDate(patient.dateOfBirth, language) : "", left, y, w4);
  field(t.age, patient?.age != null ? String(patient.age) : "", left + w4 + gap, y, w4);
  field(t.sex, patient?.sex || patient?.gender || "", left + (w4 + gap) * 2, y, w4);
  field(t.weight, patient?.weightKg != null ? String(patient.weightKg) : "", left + (w4 + gap) * 3, y, w4);
  y = rowY;

  rowY = field(t.address, patient?.address || "", left, y, w2 + w4 + gap);
  field(t.phone, patient?.phone || "", left + w2 + w4 + gap * 2, y, w4);
  y = rowY + 2;

  // ── Аллергии ──────────────────────────────────────────────────────
  // Отдельной рамкой и красной полосой слева: это единственное поле, из-за
  // которого рецепт может убить, и искать его глазами не должно быть надо.
  const allergyText = patient?.allergiesSummary || "";
  const allergyBoxY = y;
  const allergyH = 34;
  doc.rect(left, allergyBoxY, contentW, allergyH).fillAndStroke(PANEL, RULE);
  doc.rect(left, allergyBoxY, 2.5, allergyH).fill(WARN);
  doc.font(F_BOLD).fontSize(6.5).fillColor(WARN);
  doc.text(tx(String(t.allergies).toUpperCase()), left + 10, allergyBoxY + 6, { width: contentW - 20 });
  doc.font(F_REG).fontSize(9).fillColor(allergyText ? INK : "#9fb0bd");
  doc.text(tx(allergyText || t.allergiesNone), left + 10, allergyBoxY + 17, { width: contentW - 20 });
  y = allergyBoxY + allergyH + 8;

  // ── Диагноз ───────────────────────────────────────────────────────
  const dx = prescription?.diagnosisText || prescription?.diagnosis || "";
  if (dx) {
    const dxH = 34;
    doc.rect(left, y, contentW, dxH).fillAndStroke(PANEL, RULE);
    doc.font(F_BOLD).fontSize(6.5).fillColor(MUTED);
    doc.text(tx(String(t.diagnosis).toUpperCase()), left + 10, y + 6, { width: contentW - 20 });
    doc.font(F_REG).fontSize(9).fillColor(INK);
    doc.text(tx(dx), left + 10, y + 17, { width: contentW - 20 });
    y += dxH + 10;
  }

  // ── Препараты ─────────────────────────────────────────────────────
  y = sectionTag(t.prescribedMedication, y) + 2;

  // Символ ℞ есть не во всех шрифтах, поэтому пишем «Rx» — узнаётся так же.
  doc.font(F_BOLD).fontSize(26).fillColor(NAVY);
  // lineBreak: false — иначе в узкой колонке «Rx» переносится в столбик и
  // читается как две отдельные буквы.
  doc.text("Rx", left, y - 2, { width: 38, lineBreak: false });

  const tblX = left + 40;
  const tblW = contentW - 40;
  const cNum = 18;
  const cStrength = 62;
  const cForm = 70;
  const cQty = 44;
  const cMed = tblW - cNum - cStrength - cForm - cQty;

  const cols = [
    { x: tblX, w: cNum, title: "#", align: "center" },
    { x: tblX + cNum, w: cMed, title: t.colMedication },
    { x: tblX + cNum + cMed, w: cStrength, title: t.colStrength },
    { x: tblX + cNum + cMed + cStrength, w: cForm, title: t.colForm },
    { x: tblX + cNum + cMed + cStrength + cForm, w: cQty, title: t.colQty },
  ];

  doc.font(F_BOLD).fontSize(6.5).fillColor(MUTED);
  for (const c of cols) {
    doc.text(tx(String(c.title).toUpperCase()), c.x + 3, y, {
      width: c.w - 6,
      align: c.align || (isRtl ? "right" : "left"),
    });
  }
  y = doc.y + 3;
  doc.moveTo(tblX, y).lineTo(tblX + tblW, y).lineWidth(1.2).strokeColor(NAVY).stroke();
  y += 5;

  const items = Array.isArray(prescription?.items) ? prescription.items : [];
  items.forEach((it, i) => {
    // Перенос страницы: строка препарата вместе со строкой приёма занимает
    // до 40 пунктов, и разрывать их между листами нельзя.
    if (y > doc.page.height - 190) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    const medName = [it.inn, it.brandName ? `(${it.brandName})` : ""]
      .filter(Boolean)
      .join(" ");

    doc.font(F_REG).fontSize(9.5).fillColor(INK);
    doc.text(String(i + 1), cols[0].x + 3, y, { width: cols[0].w - 6, align: "center" });
    doc.text(tx(medName), cols[1].x + 3, y, { width: cols[1].w - 6 });
    const medBottom = doc.y;
    doc.text(tx(it.strength || ""), cols[2].x + 3, y, { width: cols[2].w - 6 });
    doc.text(tx(t.forms?.[it.form] || it.form || ""), cols[3].x + 3, y, { width: cols[3].w - 6 });
    doc.text(tx(it.quantity != null ? String(it.quantity) : ""), cols[4].x + 3, y, {
      width: cols[4].w - 6,
    });

    y = Math.max(medBottom, doc.y) + 4;
    doc.moveTo(tblX, y).lineTo(tblX + tblW, y).lineWidth(0.6).strokeColor(RULE).stroke();
    y += 5;

    // Строка приёма — то, по чему пациент принимает препарат. Собирается из
    // разрозненных полей в одну человеческую фразу.
    const sigParts = [
      it.dose,
      t.routes?.[it.route] || it.route,
      it.frequency,
      it.duration,
      it.prn ? t.prn : "",
      it.instructions,
    ].filter(Boolean);

    if (sigParts.length) {
      doc.font(F_BOLD).fontSize(6.5).fillColor(NAVY);
      doc.text(tx(`${String(t.sig).toUpperCase()}:`), cols[1].x + 3, y, { width: 34 });
      doc.font(F_REG).fontSize(9).fillColor(INK);
      doc.text(tx(sigParts.join(" · ")), cols[1].x + 40, y, {
        width: tblX + tblW - (cols[1].x + 40) - 3,
      });
      y = doc.y + 4;
      doc
        .moveTo(tblX, y)
        .lineTo(tblX + tblW, y)
        .lineWidth(0.6)
        .dash(2, { space: 2 })
        .strokeColor(RULE)
        .stroke();
      doc.undash();
      y += 6;
    }
  });

  if (prescription?.generalNotes) {
    y += 2;
    doc.font(F_BOLD).fontSize(6.5).fillColor(MUTED);
    doc.text(tx(String(t.generalNotes).toUpperCase()), left, y, { width: contentW });
    doc.font(F_REG).fontSize(9).fillColor(INK);
    doc.text(tx(prescription.generalNotes), left, doc.y + 1, { width: contentW });
    y = doc.y + 8;
  }

  // ── Условия отпуска ───────────────────────────────────────────────
  if (y > doc.page.height - 170) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(RULE).stroke();
  y += 8;

  const box = (x, yy) => {
    doc.rect(x, yy, 8, 8).lineWidth(1).strokeColor(NAVY).stroke();
  };
  doc.font(F_REG).fontSize(8.5).fillColor(INK);
  box(left, y);
  doc.text(tx(t.substitutionAllowed), left + 13, y - 1, { width: contentW * 0.32 });
  box(left + contentW * 0.36, y);
  doc.text(tx(t.dispenseAsWritten), left + contentW * 0.36 + 13, y - 1, { width: contentW * 0.3 });
  y = doc.y + 6;

  const halfW = (contentW - gap) / 2;
  let ctrlY = field(t.repeats, prescription?.refills != null ? String(prescription.refills) : "", left, y, halfW);
  field(
    t.validUntil,
    prescription?.validUntil ? fmtDate(prescription.validUntil, language) : "",
    left + halfW + gap,
    y,
    halfW,
  );
  y = ctrlY + 4;

  // ── Врач ──────────────────────────────────────────────────────────
  y = sectionTag(t.prescriber, y);

  const doctorName = [
    prescription?.doctorName,
    prescription?.doctorQualification || prescription?.doctorSpecialty,
  ]
    .filter(Boolean)
    .join(", ");

  let docY = field(t.nameQualification, doctorName, left, y, halfW);
  field(t.registrationNo, prescription?.doctorLicenseNumber || "", left + halfW + gap, y, halfW);
  y = docY + 10;

  // ── Подпись и печать ──────────────────────────────────────────────
  // Линия подписи и рамка печати печатаются всегда: рецепт без физической
  // подписи в аптеке недействителен, а место под неё должно быть отведено
  // бланком, а не дорисовано от руки на полях.
  const stampW = 130;
  const stampH = 84;
  const signW = contentW - stampW - 24;

  doc.font(F_BOLD).fontSize(9.5).fillColor(INK);
  doc.text(tx(prescription?.doctorName || ""), left, y, { width: signW });

  const signLineY = y + 44;
  doc.moveTo(left, signLineY).lineTo(left + signW, signLineY).lineWidth(0.9).strokeColor(INK).stroke();
  label(t.signatureCaption, left, signLineY + 4, signW);

  doc
    .rect(right - stampW, y, stampW, stampH)
    .dash(3, { space: 3 })
    .lineWidth(1)
    .strokeColor(RULE)
    .stroke();
  doc.undash();
  doc.font(F_REG).fontSize(7.5).fillColor("#9fb0bd");
  doc.text(tx(t.stamp), right - stampW, y + stampH / 2 - 5, {
    width: stampW,
    align: "center",
  });

  y = Math.max(signLineY + 20, y + stampH) + 10;

  // ── Сноска о стандарте ────────────────────────────────────────────
  if (y < doc.page.height - 60) {
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.7).strokeColor(RULE).stroke();
    y += 6;
    doc.font(F_BOLD).fontSize(7).fillColor(INK);
    doc.text(tx(t.footnoteTitle), left, y, { continued: true });
    doc.font(F_REG).fontSize(7).fillColor(MUTED);
    doc.text(tx(` ${t.footnote}`), { width: contentW });
  }

  doc.end();
  return done;
}

export default buildPrescriptionPdf;
