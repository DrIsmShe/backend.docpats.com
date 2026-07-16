// server/modules/admin/services/analyticsPdf.service.js
//
// Формирование PDF-отчёта аналитики (раздел «База данных»).
// Кириллица: pdfkit по умолчанию использует Helvetica без кириллицы,
// поэтому подключаем bundled-шрифт DejaVu Sans (assets/fonts).

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_REG = path.join(__dirname, "../../../assets/fonts/DejaVuSans.ttf");
const FONT_BOLD = path.join(
  __dirname,
  "../../../assets/fonts/DejaVuSans-Bold.ttf",
);

const SECTION_TITLES = {
  patients: "Пациенты",
  articles: "Статьи",
  doctors: "Врачи",
  users: "Пользователи",
};

/**
 * @param {object} data     — результат computeAnalytics()
 * @param {string[]} sections — какие блоки включать: patients|articles|doctors|users
 * @returns {Promise<Buffer>}
 */
export function buildAnalyticsPdf(data, sections) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("reg", FONT_REG);
    doc.registerFont("bold", FONT_BOLD);

    const M = 40;
    const W = doc.page.width - M * 2;
    const bottom = doc.page.height - M;

    const ensure = (h) => {
      if (doc.y + h > bottom) doc.addPage();
    };

    // ---------- Шапка ----------
    doc
      .font("bold")
      .fontSize(20)
      .fillColor("#0f172a")
      .text("DocPats — аналитика платформы", M, doc.y);
    doc
      .font("reg")
      .fontSize(10)
      .fillColor("#64748b")
      .text(
        `Сформировано: ${new Date(data.generatedAt).toLocaleString("ru-RU")}`,
        M,
      );
    doc
      .font("reg")
      .fontSize(9)
      .fillColor("#94a3b8")
      .text(
        `Разделы: ${sections.map((s) => SECTION_TITLES[s] || s).join(", ")}`,
        M,
      );
    doc.moveDown(1);

    // ---------- Хелперы ----------
    const sectionHeader = (t) => {
      ensure(34);
      doc.moveDown(0.4);
      doc
        .font("bold")
        .fontSize(15)
        .fillColor("#0f172a")
        .text(t, M, doc.y);
      // разделительная линия
      const ly = doc.y + 2;
      doc.rect(M, ly, W, 1).fill("#e2e8f0");
      doc.fillColor("#000");
      doc.y = ly + 8;
    };

    const summaryLine = (items) => {
      ensure(20);
      doc
        .font("reg")
        .fontSize(10)
        .fillColor("#475569")
        .text(items.join("     •     "), M, doc.y);
      doc.moveDown(0.5);
    };

    const barList = (title, rows, color) => {
      const list = Array.isArray(rows) ? rows : [];
      ensure(38);
      doc
        .font("bold")
        .fontSize(11.5)
        .fillColor("#334155")
        .text(title, M, doc.y);
      doc.moveDown(0.25);

      if (!list.length) {
        doc
          .font("reg")
          .fontSize(9.5)
          .fillColor("#94a3b8")
          .text("Нет данных", M, doc.y);
        doc.moveDown(0.6);
        return;
      }

      const max = list.reduce((m, r) => Math.max(m, r.count || 0), 0) || 1;
      list.forEach((r) => {
        ensure(22);
        const y = doc.y;
        const label = String(r.label ?? "—").slice(0, 64);
        doc
          .font("reg")
          .fontSize(9)
          .fillColor("#334155")
          .text(label, M, y, { width: W - 55, lineBreak: false });
        doc
          .font("bold")
          .fontSize(9)
          .fillColor("#0f172a")
          .text(Number(r.count).toLocaleString("ru-RU"), M, y, {
            width: W,
            align: "right",
            lineBreak: false,
          });

        const by = y + 12;
        doc.rect(M, by, W, 5).fill("#eef2f7");
        doc.rect(M, by, Math.max(2, (r.count / max) * W), 5).fill(color);
        doc.fillColor("#000");
        doc.x = M;
        doc.y = by + 9;
      });
      doc.moveDown(0.5);
    };

    // ---------- Разделы ----------
    const renderers = {
      patients: () => {
        const p = data.patients;
        sectionHeader("Пациенты");
        summaryLine([
          `Карт пациентов: ${p.totalCards}`,
          `Аккаунтов пациентов: ${p.registeredUsers}`,
        ]);
        barList("По возрасту", p.byAge, "#3d7fff");
        barList("По странам", p.byCountry, "#0ea5e9");
        barList("По полу", p.byGender, "#8b5cf6");
        barList("По статусу карты", p.byStatus, "#f59e0b");
        barList("По диагнозам (топ-20)", p.byDiagnosis, "#e11d48");
      },
      articles: () => {
        const a = data.articles;
        sectionHeader("Статьи");
        summaryLine([
          `Всего: ${a.total}`,
          `Опубликовано: ${a.published}`,
          `Черновики: ${a.draft}`,
          `Просмотры: ${a.totalViews}`,
        ]);
        barList("По категориям", a.byCategory, "#8b5cf6");
        barList("По специальностям авторов", a.bySpecialization, "#0ea5e9");
        barList("По странам авторов", a.byAuthorCountry, "#16a34a");
        barList("По языкам", a.byLanguage, "#f59e0b");
        barList("Топ авторов", a.topAuthors, "#ec4899");
      },
      doctors: () => {
        const d = data.doctors;
        sectionHeader("Врачи");
        barList("По верификации", d.byVerification, "#16a34a");
        barList("По специальностям", d.bySpecialization, "#3d7fff");
        barList("По странам", d.byCountry, "#0ea5e9");
      },
      users: () => {
        const u = data.users;
        sectionHeader("Пользователи");
        summaryLine([`Всего пользователей: ${u.total}`]);
        barList("По ролям", u.byRole, "#0f766e");
        barList("Регистрации по месяцам", u.registrationsByMonth, "#8b5cf6");
      },
    };

    sections.forEach((s) => {
      if (renderers[s]) renderers[s]();
    });

    doc.end();
  });
}
