import { Queue } from "bullmq";
import { redis } from "../../common/config/redis.js";
import Simulation from "./simulation.model.js";
import SurgicalCase from "./surgicalCase.model.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NEGATIVE_PROMPT =
  "cartoon, illustration, drawing, unrealistic, distorted anatomy, deformed, ugly, blurry, low quality, watermark, text, CGI, 3D render, artifact, noise, overexposed, underexposed, makeup filter, beauty filter, fake, plastic skin, doll-like, uncanny valley";

const PROCEDURE_PROMPTS = {
  rhinoplasty: [
    {
      label: "Утончение кончика носа",
      text: "refined nasal tip, symmetrical elegant nose, subtle tip rhinoplasty result, natural skin texture preserved, clinical medical photography, soft studio lighting, high resolution, photorealistic",
    },
    {
      label: "Коррекция горбинки",
      text: "straightened nasal bridge, no dorsal hump, refined nose profile, natural rhinoplasty outcome, harmonious facial profile, medical photography, photorealistic, 85mm portrait lens",
    },
    {
      label: "Натуральное утончение",
      text: "natural-looking nose refinement, balanced facial features, post-rhinoplasty appearance 6 months, proportional nose, ethnic features preserved, clinical photography, photorealistic skin texture",
    },
    {
      label: "Кончик + спинка",
      text: "refined nasal tip and bridge, symmetric nose, subtle reduction rhinoplasty, natural result 6 months post-op, medical photography, realistic skin pores, high detail",
    },
    {
      label: "Открытая ринопластика",
      text: "open rhinoplasty result, refined nose shape, smooth nasal bridge, natural tip projection, balanced with facial features, clinical medical photography, photorealistic",
    },
    {
      label: "Закрытая ринопластика",
      text: "closed rhinoplasty result, subtle nose refinement, no visible scarring, natural profile, symmetric nostrils, medical photography, photorealistic, realistic skin",
    },
    {
      label: "Этническая ринопластика",
      text: "ethnic rhinoplasty result, preserved cultural features, refined nose with natural appearance, ethnic identity maintained, harmonious face, clinical photography, photorealistic",
    },
    {
      label: "Коррекция ноздрей",
      text: "nostril reduction result, symmetric nostrils, balanced base width, natural appearance, subtle refinement, medical photography, photorealistic, high detail",
    },
    {
      label: "Профиль (вид сбоку)",
      text: "rhinoplasty profile view, elegant nose profile, straight nasal bridge, refined tip, natural projection, harmonious side profile, clinical photography, photorealistic",
    },
    {
      label: "Ревизионная ринопластика",
      text: "revision rhinoplasty result, corrected nose shape, improved symmetry, natural appearance, subtle refinement over previous surgery, clinical medical photography, photorealistic",
    },
  ],

  breast_augmentation: [
    {
      label: "Натуральное увеличение",
      text: "natural breast augmentation result, proportional symmetrical breasts, soft natural contour, post-operative appearance 3 months, clinical medical photography, realistic skin texture, tasteful medical documentation",
    },
    {
      label: "Анатомический имплант",
      text: "anatomical teardrop implant result, natural breast slope, proportional to body frame, lower pole fullness, clinical photography, photorealistic, tasteful medical documentation",
    },
    {
      label: "Круглый имплант",
      text: "round implant breast augmentation, upper pole fullness, symmetric breasts, natural appearance, proportional volume, medical photography, photorealistic, tasteful",
    },
    {
      label: "Умеренный объём",
      text: "moderate breast augmentation, balanced proportions, natural movement appearance, subtle enhancement, symmetric, medical photography, photorealistic, tasteful documentation",
    },
    {
      label: "Высокий профиль",
      text: "high profile implant breast augmentation result, enhanced projection, symmetric breasts, natural skin texture, proportional to chest width, clinical photography, photorealistic, tasteful",
    },
    {
      label: "Субмускулярное размещение",
      text: "submuscular breast implant result, natural slope, soft appearance, athletic body type, symmetric breasts, no visible implant edges, clinical photography, photorealistic, tasteful",
    },
    {
      label: "Субгландулярное размещение",
      text: "subglandular breast implant result, natural breast appearance, smooth contour, symmetric, proportional volume enhancement, clinical medical photography, photorealistic, tasteful",
    },
    {
      label: "Dual plane техника",
      text: "dual plane breast augmentation result, natural upper pole, full lower pole, excellent symmetry, natural appearance, clinical photography, photorealistic, tasteful medical documentation",
    },
    {
      label: "После похудения",
      text: "breast augmentation after weight loss, restored breast volume, natural contour, proportional to new body shape, symmetric, clinical photography, photorealistic, tasteful",
    },
    {
      label: "Коррекция асимметрии",
      text: "breast asymmetry correction augmentation result, symmetric breasts, matched volume, natural appearance, balanced chest, clinical medical photography, photorealistic, tasteful",
    },
  ],

  breast_reduction: [
    {
      label: "Стандартная редукция",
      text: "breast reduction result, lifted natural breast contour, significantly reduced volume, symmetric, improved posture appearance, post-operative clinical photography, realistic skin texture, tasteful documentation",
    },
    {
      label: "Умеренная редукция",
      text: "moderate breast reduction result, natural breast size reduction, lifted contour, symmetric, proportional to body frame, clinical medical photography, photorealistic, tasteful",
    },
    {
      label: "Редукция + подтяжка",
      text: "breast reduction with mastopexy, lifted natural breast contour, reduced volume, eliminated ptosis, symmetric nipple position, clinical photography, photorealistic, tasteful documentation",
    },
    {
      label: "Техника лollipop",
      text: "lollipop breast reduction result, reduced breast size, natural shape, minimal scarring appearance, symmetric, lifted position, clinical medical photography, photorealistic, tasteful",
    },
    {
      label: "Техника якоря",
      text: "anchor breast reduction result, significantly reduced volume, natural breast shape, lifted position, symmetric, improved proportions, clinical photography, photorealistic, tasteful",
    },
    {
      label: "Спортивный тип телосложения",
      text: "breast reduction athletic body type, proportional breast size, natural contour, active lifestyle proportions, symmetric, clinical medical photography, photorealistic, tasteful",
    },
  ],

  blepharoplasty: [
    {
      label: "Верхние веки",
      text: "upper blepharoplasty result, refreshed eye appearance, smooth upper eyelid, no excess skin folds, natural eye opening, well-rested look, medical photography, photorealistic, high detail",
    },
    {
      label: "Нижние веки",
      text: "lower blepharoplasty result, reduced under-eye bags, smooth lower eyelid, natural tear trough, refreshed appearance, no hollow look, clinical photography, photorealistic skin texture",
    },
    {
      label: "Четыре века (полная)",
      text: "complete four-eyelid blepharoplasty result, rejuvenated eye area, natural upper and lower eyelid contour, no swelling, symmetric eyes, rested youthful appearance, medical photography, photorealistic",
    },
    {
      label: "Трансконъюнктивальная",
      text: "transconjunctival lower blepharoplasty result, no visible scar, smooth under-eye area, reduced fat pads, natural appearance, refreshed look, clinical medical photography, photorealistic",
    },
    {
      label: "Азиатская (двойное веко)",
      text: "Asian double eyelid surgery result, natural supratarsal crease, symmetric eyelids, ethnic features preserved, subtle natural enhancement, clinical photography, photorealistic",
    },
    {
      label: "С кантопексией",
      text: "blepharoplasty with canthopexy result, lifted outer eye corners, almond eye shape, refreshed appearance, symmetric, natural expression, medical photography, photorealistic",
    },
    {
      label: "Омоложение периорбитальной зоны",
      text: "periorbital rejuvenation blepharoplasty, smooth skin around eyes, reduced wrinkles, refreshed eye area, natural appearance, age-appropriate result, clinical photography, photorealistic",
    },
    {
      label: "Коррекция птоза",
      text: "ptosis correction result, symmetric eyelid height, natural eye opening, improved visual field, refreshed appearance, clinical medical photography, photorealistic, high detail",
    },
  ],

  liposuction: [
    {
      label: "Живот",
      text: "liposuction abdomen result, smooth flat stomach contour, natural body shape, no skin irregularities, toned appearance, clinical medical photography, photorealistic skin texture",
    },
    {
      label: "Бока + живот",
      text: "flanks and abdomen liposuction result, defined waistline, smooth contour, natural fat distribution, balanced proportions, hourglass silhouette, medical photography, photorealistic",
    },
    {
      label: "Внутренние бёдра",
      text: "inner thigh liposuction result, smooth inner thigh contour, thigh gap improvement, natural leg shape, balanced proportions, clinical photography, photorealistic skin texture",
    },
    {
      label: "Внешние бёдра",
      text: "outer thigh liposuction result, smooth hip contour, eliminated saddlebags, natural leg proportions, balanced silhouette, clinical medical photography, photorealistic",
    },
    {
      label: "Руки",
      text: "arm liposuction result, slimmer arm contour, smooth skin, defined arm shape, natural appearance, balanced with body, clinical photography, photorealistic",
    },
    {
      label: "Подбородок",
      text: "chin and neck liposuction result, defined jawline, eliminated double chin, natural neck contour, youthful profile, clinical medical photography, photorealistic, profile view",
    },
    {
      label: "Спина",
      text: "back liposuction result, smooth back contour, eliminated bra rolls, natural back shape, balanced proportions, clinical photography, photorealistic skin texture",
    },
    {
      label: "VASER липосакция",
      text: "VASER liposuction result, smooth refined contour, excellent skin retraction, defined body shape, natural appearance, clinical medical photography, photorealistic",
    },
    {
      label: "Hi-def липосакция",
      text: "high definition liposuction result, athletic muscle definition visible, sculpted body contour, natural athletic appearance, fit physique, clinical photography, photorealistic",
    },
    {
      label: "Комплексная коррекция фигуры",
      text: "full body liposuction contouring result, balanced proportions throughout body, natural silhouette, smooth contours, harmonious figure, clinical medical photography, photorealistic",
    },
  ],

  abdominoplasty: [
    {
      label: "Полная абдоминопластика",
      text: "full tummy tuck result, flat smooth abdomen, natural belly button position, no excess skin, toned midsection, natural waistline, clinical medical photography, photorealistic, 6 months post-op",
    },
    {
      label: "Мини абдоминопластика",
      text: "mini abdominoplasty result, lower abdomen correction, smooth lower contour, natural navel, improved lower body proportions, subtle enhancement, medical photography, photorealistic",
    },
    {
      label: "После беременности",
      text: "abdominoplasty post-pregnancy result, restored flat abdomen, repaired diastasis recti, natural belly button, toned midsection, clinical medical photography, photorealistic, natural",
    },
    {
      label: "После похудения",
      text: "tummy tuck after weight loss result, eliminated excess skin, flat toned abdomen, natural contour, improved body proportion, clinical photography, photorealistic",
    },
    {
      label: "С диастазом",
      text: "tummy tuck with diastasis repair result, flat abdomen, repaired muscle wall, defined midline, smooth contour, natural belly button, clinical photography, photorealistic",
    },
    {
      label: "С липосакцией",
      text: "tummy tuck with liposuction result, flat abdomen, defined waistline, smooth overall contour, natural appearance, proportional figure, clinical medical photography, photorealistic",
    },
    {
      label: "Флёр де лис",
      text: "fleur de lis abdominoplasty result, significant skin removal, flat abdomen, improved waist definition, natural contour, clinical photography, photorealistic skin texture",
    },
  ],

  facelift: [
    {
      label: "Полная подтяжка лица",
      text: "full facelift result, rejuvenated facial appearance, defined jawline, lifted cheeks, natural expression preserved, smooth neck, no pulled look, medical photography, photorealistic, age-appropriate",
    },
    {
      label: "Мини-лифтинг",
      text: "mini facelift result, subtle facial rejuvenation, natural refreshed appearance, defined lower face, no obvious signs of surgery, 5 years younger look, clinical photography, photorealistic",
    },
    {
      label: "SMAS-лифтинг",
      text: "SMAS facelift outcome, deep tissue lifting, natural facial contour, lifted midface, restored volume distribution, youthful appearance without overcorrection, medical photography, photorealistic",
    },
    {
      label: "Подтяжка шеи",
      text: "neck lift result, defined jawline, smooth neck contour, eliminated jowls, natural neck angle, rejuvenated lower face and neck, clinical photography, photorealistic",
    },
    {
      label: "Средняя зона лица",
      text: "midface lift result, lifted cheekbones, restored midface volume, natural cheek contour, refreshed appearance, no hollow look, medical photography, photorealistic",
    },
    {
      label: "Эндоскопический лифтинг",
      text: "endoscopic facelift result, minimal scarring appearance, natural lifting, refreshed look, preserved facial expression, subtle rejuvenation, clinical medical photography, photorealistic",
    },
    {
      label: "После 60 лет",
      text: "facelift result mature patient, age-appropriate rejuvenation, natural older appearance improved, maintained character, refreshed not overdone, clinical photography, photorealistic",
    },
    {
      label: "Комплексное омоложение",
      text: "comprehensive facelift result, lifted face and neck, restored facial contours, youthful proportions, natural expression, harmonious rejuvenation, clinical medical photography, photorealistic",
    },
  ],

  otoplasty: [
    {
      label: "Коррекция оттопыренности",
      text: "otoplasty result, natural ear position close to head, reduced protrusion, symmetric ears, natural antihelix fold, clinical medical photography, photorealistic, subtle natural correction",
    },
    {
      label: "Формирование антигеликса",
      text: "ear pinning antihelix creation result, natural ear fold, balanced ear position, symmetric ears, proportional to head size, medical photography, photorealistic",
    },
    {
      label: "Дети (педиатрическая)",
      text: "pediatric otoplasty result, natural ear position, symmetric ears, age-appropriate appearance, subtle correction, natural antihelix, clinical photography, photorealistic",
    },
    {
      label: "Коррекция мочки уха",
      text: "earlobe reduction correction result, proportional earlobe, natural ear appearance, symmetric, balanced ear shape, clinical medical photography, photorealistic, high detail",
    },
    {
      label: "Двусторонняя коррекция",
      text: "bilateral otoplasty result, symmetric ear position, both ears balanced, natural antihelix fold, proportional ear size, refined appearance, clinical photography, photorealistic",
    },
    {
      label: "После травмы",
      text: "reconstructive otoplasty result, restored natural ear shape, symmetric appearance, natural contour, improved aesthetics, clinical medical photography, photorealistic",
    },
  ],

  chin_implant: [
    {
      label: "Усиление проекции",
      text: "chin implant result, enhanced chin projection, harmonious facial profile, balanced jaw, natural appearance, profile view, medical photography, photorealistic",
    },
    {
      label: "Мягкое усиление",
      text: "subtle chin augmentation, refined jawline, natural chin projection, improved facial balance, no exaggeration, clinical photography, photorealistic, natural result",
    },
    {
      label: "Вид в профиль",
      text: "chin implant profile view result, balanced facial thirds, natural chin projection, harmonious nose-chin relationship, improved side profile, clinical photography, photorealistic",
    },
    {
      label: "Укрепление линии челюсти",
      text: "chin implant jawline enhancement result, defined jaw contour, stronger chin, masculine or feminine profile, natural appearance, clinical medical photography, photorealistic",
    },
    {
      label: "В сочетании с ринопластикой",
      text: "chin implant with rhinoplasty combined result, balanced facial profile, harmonious nose and chin relationship, improved facial proportions, natural appearance, clinical photography, photorealistic",
    },
    {
      label: "Анатомический имплант",
      text: "anatomical chin implant result, extended chin width, natural jaw contour, balanced facial appearance, no obvious implant, clinical medical photography, photorealistic",
    },
    {
      label: "Коррекция слабого подбородка",
      text: "weak chin correction implant result, improved facial balance, stronger chin profile, natural appearance, better facial proportions, clinical photography, photorealistic",
    },
  ],

  lip_augmentation: [
    {
      label: "Натуральное увеличение",
      text: "natural lip augmentation result, fuller lips, defined cupid bow, balanced upper and lower lip ratio, no duck lips, natural movement appearance, clinical photography, photorealistic",
    },
    {
      label: "Тонкая коррекция",
      text: "subtle lip filler result, slightly enhanced lip volume, natural shape preserved, hydrated appearance, symmetric, no overfilling, medical photography, photorealistic",
    },
    {
      label: "Контур + объём",
      text: "lip augmentation with definition, enhanced vermilion border, balanced volume, natural smile, well-defined lip outline, photorealistic skin texture, clinical photography",
    },
    {
      label: "Объём верхней губы",
      text: "upper lip augmentation result, fuller upper lip, defined cupid bow, balanced lip ratio, natural appearance, no unnatural pout, clinical photography, photorealistic",
    },
    {
      label: "Объём нижней губы",
      text: "lower lip augmentation result, fuller lower lip, natural pout, balanced lip ratio, proportional fullness, natural appearance, medical photography, photorealistic",
    },
    {
      label: "Русский метод",
      text: "Russian lips technique result, vertical lip lift appearance, defined lip body, natural heart shape, balanced projection, no duck lips, clinical photography, photorealistic",
    },
    {
      label: "Коррекция асимметрии",
      text: "lip asymmetry correction filler result, symmetric lips, balanced volume, natural shape, even lip border, clinical medical photography, photorealistic, high detail",
    },
    {
      label: "Омоложение (периоральная зона)",
      text: "lip augmentation perioral rejuvenation, restored lip volume, reduced lip lines, natural fuller appearance, age-appropriate enhancement, clinical photography, photorealistic",
    },
    {
      label: "Гиалуроновая кислота",
      text: "hyaluronic acid lip filler result, soft natural lip enhancement, hydrated appearance, natural movement, balanced fullness, symmetric, medical photography, photorealistic",
    },
    {
      label: "Переворот губы (lip flip)",
      text: "lip flip result, subtle upper lip eversion, more visible upper lip, natural appearance, no added volume effect, refreshed look, clinical photography, photorealistic",
    },
  ],

  other: [
    {
      label: "Общий косметический результат",
      text: "natural cosmetic surgery result, subtle enhancement, balanced proportions, realistic skin texture, clinical medical photography, photorealistic, high quality",
    },
    {
      label: "Мягкое улучшение",
      text: "subtle cosmetic enhancement result, natural appearance, improved proportions, realistic, clinical photography, photorealistic skin texture, high detail",
    },
  ],
};

function pickPrompt(procedure, promptIdx = 0) {
  const list = PROCEDURE_PROMPTS[procedure] || PROCEDURE_PROMPTS.other;
  const item = list[Math.min(promptIdx, list.length - 1)];
  return item.text;
}

export const simulationQueue = new Queue("surgery-simulation", {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export async function createSimulation(
  caseId,
  surgeonId,
  {
    sourcePhotoFilename,
    maskFilename,
    customPrompt,
    promptIdx,
    disclaimerAccepted,
  },
) {
  if (!disclaimerAccepted) {
    throw new Error("Необходимо принять дисклеймер перед симуляцией");
  }

  const cas = await SurgicalCase.findOne({ _id: caseId, surgeonId });
  if (!cas) throw new Error("Кейс не найден");

  const prompt =
    customPrompt || pickPrompt(cas.procedure, Number(promptIdx) || 0);

  const simulation = await Simulation.create({
    caseId,
    surgeonId,
    sourcePhotoFilename,
    maskFilename,
    procedure: cas.procedure,
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    numOutputs: 4,
    disclaimerAccepted,
    status: "pending",
  });

  await simulationQueue.add(
    "generate",
    { simulationId: String(simulation._id), surgeonId: String(surgeonId) },
    { jobId: String(simulation._id) },
  );

  return simulation;
}

export function getPromptsForProcedure(procedure) {
  return (PROCEDURE_PROMPTS[procedure] || PROCEDURE_PROMPTS.other).map(
    (p, i) => ({
      idx: i,
      label: p.label,
      text: p.text,
    }),
  );
}

export async function getSimulations(caseId, surgeonId) {
  return Simulation.find({ caseId, surgeonId })
    .sort({ createdAt: -1 })
    .limit(20);
}

export async function selectResult(simulationId, surgeonId, idx) {
  const sim = await Simulation.findOne({ _id: simulationId, surgeonId });
  if (!sim) throw new Error("Симуляция не найдена");
  if (idx < 0 || idx >= sim.resultFilenames.length)
    throw new Error("Неверный индекс");
  sim.selectedIdx = idx;
  await sim.save();
  return sim;
}

export async function deleteSimulation(simulationId, surgeonId) {
  const sim = await Simulation.findOneAndDelete({
    _id: simulationId,
    surgeonId,
  });
  return !!sim;
}
