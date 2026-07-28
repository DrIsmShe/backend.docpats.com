// server/modules/diagnostics/core/services/export.service.js
//
// Выгрузка дела одним документом.
//
// ЧТО ЭТО ЗА ДОКУМЕНТ. Не медицинское заключение и не выписка — это протокол
// разбора: что было на входе, что предложил разбор, с чем врач согласился, и
// что врач написал сам. Различие принципиальное, поэтому:
//
//   • оговорка «это не диагноз» стоит первой строкой и повторяется в подвале;
//   • вывод врача идёт ПЕРВЫМ разделом, а разбор ИИ — после него. Порядок
//     здесь равен ответственности: тот, кто откроет файл через год, должен
//     увидеть сначала решение врача, а уже потом материал, на котором оно
//     строилось;
//   • у каждого вывода печатается вердикт врача. Вывод, с которым врач не
//     согласился, остаётся в документе — вычищать его значило бы подделывать
//     историю разбора.
//
// ПРО PDF. Здесь HTML, а не PDF, и это не полумера: HTML печатается в PDF из
// браузера одной кнопкой, а серверная генерация тянет шрифты с кириллицей,
// вёрстку и +30 МБ зависимостей. Когда понадобится подпись или строгий бланк —
// добавим генератор, разметка уже готова.
//
// PHI В ДОКУМЕНТЕ ЕСТЬ — он и есть выгрузка данных пациента. Поэтому событие
// выгрузки пишется в журнал (diagnostics.export), а сам файл никуда не
// сохраняется: отдаётся врачу и забывается.

import { getModality } from "./registry.js";
import { ADVISORY_NOTICE } from "../../constants.js";

const SEVERITY_LABELS = {
  critical: "Критично",
  important: "Важно",
  note: "Замечание",
};

const CONFIDENCE_LABELS = {
  high: "уверенность высокая",
  moderate: "уверенность средняя",
  low: "уверенность низкая",
};

const VERDICT_LABELS = {
  agree: "врач согласен",
  partly: "врач согласен частично",
  disagree: "врач не согласен",
  pending: "врач не отметил",
};

const KIND_LABELS = {
  text: "Запись врача",
  report: "Заключение",
  lab_panel: "Лабораторная панель",
  image: "Снимок",
  dicom: "DICOM",
  document: "Документ",
  video: "Видео",
  audio: "Аудио",
  signal: "Сигнал",
};

/** Экранирование: в документ уходит текст врача и пациента, не разметка. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Абзацы из простого текста — переносы строк должны сохраниться. */
function paragraphs(text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  return value
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function patientLine(caseDoc) {
  const p = caseDoc.patient ?? {};
  return [
    p.label,
    p.ageYears ? `${p.ageYears} лет` : null,
    p.sex === "male" ? "мужчина" : p.sex === "female" ? "женщина" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderArtifact(a) {
  const items = a.structured?.items ?? [];
  const body = items.length
    ? `<table class="panel"><thead><tr><th>Показатель</th><th>Значение</th><th>Норма</th></tr></thead><tbody>${items
        .map(
          (i) =>
            `<tr><td>${esc(i.name)}</td><td>${esc(i.value)}${
              i.unit ? " " + esc(i.unit) : ""
            }</td><td>${i.refLow ?? "—"}–${i.refHigh ?? "—"}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : paragraphs(a.text);

  const modality = a.modality ? getModality(a.modality)?.title ?? a.modality : null;
  return `<section class="material">
    <h4>${esc(KIND_LABELS[a.kind] ?? a.kind)}${modality ? ` · ${esc(modality)}` : ""}</h4>
    ${body}
  </section>`;
}

function renderFinding(f, index) {
  const modality = getModality(f.modality)?.title ?? f.modality;
  return `<section class="finding finding--${esc(f.severity)}">
    <div class="finding-head">
      <span class="badge">${esc(SEVERITY_LABELS[f.severity] ?? f.severity)}</span>
      <span class="dim">${esc(CONFIDENCE_LABELS[f.confidence] ?? "")} · ${esc(modality)}</span>
      <span class="verdict">${esc(VERDICT_LABELS[f.verdict] ?? f.verdict)}</span>
    </div>
    <h4>${index}. ${esc(f.title)}</h4>
    ${paragraphs(f.detail)}
    ${
      f.recommendations?.length
        ? `<p class="sub">Что сделать</p><ul>${f.recommendations
            .map((r) => `<li>${esc(r)}</li>`)
            .join("")}</ul>`
        : ""
    }
    ${
      String(f.correction ?? "").trim()
        ? `<div class="correction"><p class="sub">Поправка врача</p>${paragraphs(f.correction)}</div>`
        : ""
    }
  </section>`;
}

/**
 * Документ по делу.
 *
 * @param {object} full — результат getCaseFull (уже расшифрованный)
 * @returns {{ html: string, fileName: string }}
 */
export function renderCaseDocument(full) {
  const c = full.case ?? {};
  const findings = full.findings ?? [];
  const artifacts = full.artifacts ?? [];
  const jobs = full.jobs ?? [];

  // Происхождение: какие модели отвечали. Без этого через год невозможно
  // понять, чем именно был получен текст.
  const models = [...new Set(jobs.map((j) => j.provenance?.model).filter(Boolean))];
  const promptVersions = [...new Set(jobs.map((j) => j.provenance?.promptVersion).filter(Boolean))];

  const title = c.title || "Дело без названия";
  const fileName = `razbor-${String(c._id ?? "").slice(-6)}-${new Date(
    c.updatedAt ?? Date.now(),
  )
    .toISOString()
    .slice(0, 10)}.html`;

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  body { font: 15px/1.6 "Segoe UI", system-ui, sans-serif; color: #17212b; max-width: 800px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 32px 0 10px; padding-top: 18px; border-top: 1px solid #e6e0d4; }
  h4 { font-size: 15px; margin: 0 0 6px; }
  p { margin: 0 0 8px; }
  .dim { color: #6b7684; font-size: 13px; }
  .notice { border: 1px solid #1b3a5c; border-left: 4px solid #1b3a5c; background: #eceff4; padding: 12px 14px; margin: 16px 0 24px; font-size: 14px; }
  .material, .finding { border-left: 3px solid #cfc7b6; padding: 10px 0 10px 14px; margin: 0 0 14px; }
  .finding--critical { border-left-color: #9d2235; }
  .finding--important { border-left-color: #a2802f; }
  .finding-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; margin-bottom: 6px; font-size: 13px; }
  .badge { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }
  .verdict { margin-left: auto; color: #1b3a5c; font-weight: 600; }
  .correction { background: #faf6ec; border-radius: 4px; padding: 8px 12px; margin-top: 8px; }
  .sub { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #939caa; margin: 10px 0 4px; }
  table.panel { border-collapse: collapse; width: 100%; font-size: 14px; }
  table.panel th, table.panel td { border-bottom: 1px solid #e6e0d4; padding: 5px 8px; text-align: left; }
  table.panel td:nth-child(2), table.panel td:nth-child(3) { font-variant-numeric: tabular-nums; }
  footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e6e0d4; color: #6b7684; font-size: 12.5px; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } .finding, .material { break-inside: avoid; } }
</style>
</head>
<body>

<h1>${esc(title)}</h1>
<p class="dim">${esc(patientLine(c)) || "Пациент не описан"} · дело от ${esc(formatDate(c.createdAt))}${
    c.closedAt ? ` · закрыто ${esc(formatDate(c.closedAt))}` : ""
  }</p>

<div class="notice"><strong>${esc(ADVISORY_NOTICE)}</strong></div>

${c.question ? `<h2>Вопрос</h2>${paragraphs(c.question)}` : ""}

<h2>Вывод врача</h2>
${
  String(c.doctorSummary ?? "").trim()
    ? paragraphs(c.doctorSummary)
    : '<p class="dim">Вывод врача не записан — дело не закрыто.</p>'
}

<h2>Клинические данные</h2>
${paragraphs(c.clinicalContext) || '<p class="dim">Не заполнены.</p>'}

<h2>Материалы · ${artifacts.length}</h2>
${artifacts.map(renderArtifact).join("\n") || '<p class="dim">Материалов нет.</p>'}

<h2>Разбор · ${findings.length}</h2>
${
  findings.length
    ? findings.map((f, i) => renderFinding(f, i + 1)).join("\n")
    : '<p class="dim">Выводов нет.</p>'
}

<footer>
  <p>${esc(ADVISORY_NOTICE)}</p>
  <p>Документ сформирован ${esc(formatDate(new Date()))}.
  ${models.length ? `Разбор выполнен моделью: ${esc(models.join(", "))}.` : ""}
  ${promptVersions.length ? `Версия протокола: ${esc(promptVersions.join(", "))}.` : ""}</p>
  <p>Выводы разбора носят вспомогательный характер и приведены вместе с отметками врача о
  согласии. Решение по пациенту принимает и подписывает врач.</p>
</footer>

</body>
</html>`;

  return { html, fileName };
}
