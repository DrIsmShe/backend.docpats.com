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
  const t = L[language] || L.ru;
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

  // ─── TITLE + Rx number + date ─────────────────────────────────────
  doc.font(F_BOLD).fontSize(20).fillColor("#1e293b");
  doc.text(tx(t.title), left, y, alignOpt);
  y = doc.y + 4;

  doc.font(F_REG).fontSize(10).fillColor("#475569");
  const rxShort = prescription._id ? String(prescription._id).slice(-8) : "";
  doc.text(
    tx(
      `${t.rxNo} ${rxShort}   ·   ${t.date}: ${fmtDate(prescription.issuedAt || prescription.createdAt, language)}`,
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

  if (prescription.diagnosis?.text || prescription.diagnosis?.code) {
    const dx = [prescription.diagnosis.code, prescription.diagnosis.text]
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

  // ─── ITEMS — numbered Rp. list (WHO Good Prescribing) ─────────────
  const items = Array.isArray(prescription.items) ? prescription.items : [];
  items.forEach((it, idx) => {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    const formLabel = t.forms[it.form] || it.form || "";
    const routeLabel = t.routes[it.route] || it.route || "";
    const num = `${idx + 1}.`;

    // Line 1: number + INN (bold) + brand in parens
    doc.font(F_BOLD).fontSize(12).fillColor("#0f172a");
    const innLine = it.brandName
      ? `${num} ${it.inn} (${it.brandName})`
      : `${num} ${it.inn}`;
    doc.text(tx(innLine), left, y, alignOpt);
    y = doc.y + 2;

    // Line 2: strength · form · route
    const pharm = [
      it.strength,
      formLabel && formLabel !== "—" ? formLabel : null,
      routeLabel && routeLabel !== "—" ? `${t.route}: ${routeLabel}` : null,
    ]
      .filter(Boolean)
      .join("   ·   ");
    if (pharm) {
      doc.font(F_REG).fontSize(10).fillColor("#334155");
      doc.text(tx(pharm), left, y, alignOpt);
      y = doc.y + 1;
    }

    // Line 3: dose · freq · duration · qty · prn
    const sched = [
      it.dose && `${t.dose}: ${it.dose}`,
      it.frequency && `${t.freq}: ${it.frequency}`,
      it.duration && `${t.duration}: ${it.duration}`,
      it.quantity && `${t.qty}: ${it.quantity}`,
      it.prn && t.prn,
    ]
      .filter(Boolean)
      .join("   ·   ");
    if (sched) {
      doc.font(F_REG).fontSize(10).fillColor("#475569");
      doc.text(tx(sched), left, y, alignOpt);
      y = doc.y + 1;
    }

    // Line 4: instructions
    if (it.instructions) {
      doc.font(F_REG).fontSize(10).fillColor("#334155");
      doc.text(tx(`${t.instructions}: ${it.instructions}`), left, y, alignOpt);
      y = doc.y + 1;
    }

    y += 10;
  });

  // General notes
  if (prescription.generalNotes) {
    y += 4;
    doc.font(F_BOLD).fontSize(10).fillColor("#0f172a");
    doc.text(tx(`${t.generalNotes}:`), left, y, alignOpt);
    y = doc.y;
    doc.font(F_REG).fontSize(10).fillColor("#334155");
    doc.text(tx(prescription.generalNotes), left, y, alignOpt);
    y = doc.y;
  }

  // ─── SIGNATURE / STAMP area (Level 2 — physical signature) ────────
  const sigY = Math.max(y + 40, doc.page.height - 130);
  doc.font(F_REG).fontSize(10).fillColor("#475569");

  if (!isRtl) {
    doc.text(`${t.doctor}: __________________________`, left, sigY);
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
      tx(`${t.doctor}: __________________________`),
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

export default buildPrescriptionPdf;
