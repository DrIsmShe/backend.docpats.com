import { Queue } from "bullmq";
import { redis } from "../../common/config/redis.js";
import Simulation from "./simulation.model.js";
import SurgicalCase from "./surgicalCase.model.js";
import { compilePrompt } from "./promptCompiler.service.js";
import { assertSimulationAllowed } from "./simulationQuota.service.js";
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

  // Процедуры, которых в каталоге не было вовсе, из-за чего кейс «Подтяжка
  // бровей» проваливался в other и получал «общий косметический результат»:
  // модель не знала ни зоны, ни характера правки.
  brow_lift: [
    {
      "label": "Подтяжка бровей",
      "text": "elevated eyebrow position, smooth open upper eyelid area, reduced forehead heaviness, natural brow arch, rested alert expression, clinical medical photography, natural skin texture, photorealistic",
    },
    {
      "label": "Латеральный лифтинг",
      "text": "lifted lateral brow tail, opened outer eye area, natural brow arch without surprise look, subtle temporal elevation, clinical medical photography, photorealistic, high detail",
    },
    {
      "label": "Эндоскопический лифтинг лба",
      "text": "smooth forehead, elevated brows, reduced horizontal forehead lines, natural hairline position, refreshed upper face, clinical medical photography, natural skin texture, photorealistic",
    },
    {
      "label": "Коррекция асимметрии бровей",
      "text": "symmetric eyebrow height, balanced brow arches, even upper eyelid exposure, natural expression preserved, clinical medical photography, photorealistic, high detail",
    },
  ],

  neck_lift: [
    {
      "label": "Подтяжка шеи",
      "text": "defined jawline, smooth neck contour, no submental fullness, natural cervicomental angle, rejuvenated lower face, clinical medical photography, natural skin texture, photorealistic",
    },
    {
      "label": "Платизмопластика",
      "text": "smooth neck without platysmal bands, tightened neck contour, defined jaw border, natural appearance, clinical medical photography, photorealistic, high detail",
    },
    {
      "label": "Второй подбородок",
      "text": "eliminated double chin, defined submental area, smooth neck line, natural profile, clinical medical photography, natural skin texture, photorealistic",
    },
  ],

  cheek_implant: [
    {
      "label": "Скуловые импланты",
      "text": "defined cheekbones, natural midface projection, smooth cheek contour, balanced facial proportions, no overfilled look, clinical medical photography, photorealistic",
    },
    {
      "label": "Мягкое усиление скул",
      "text": "subtle cheekbone enhancement, natural midface volume, soft contour transition, age-appropriate result, clinical medical photography, natural skin texture, photorealistic",
    },
    {
      "label": "Коррекция западения щёк",
      "text": "restored cheek volume, no hollow midface, smooth natural contour, healthy rested appearance, clinical medical photography, photorealistic, high detail",
    },
  ],

  lip_lift: [
    {
      "label": "Булхорн (укорочение)",
      "text": "shortened philtrum, more visible upper lip vermilion, natural cupid bow, balanced lip proportions, no scar visible, clinical medical photography, photorealistic",
    },
    {
      "label": "Уголки губ",
      "text": "lifted mouth corners, neutral relaxed expression, no downturned corners, natural lip line, clinical medical photography, natural skin texture, photorealistic",
    },
  ],

  fat_grafting_face: [
    {
      "label": "Липофилинг лица",
      "text": "restored facial volume, smooth natural contours, no hollow areas, healthy rested appearance, natural skin texture preserved, clinical medical photography, photorealistic",
    },
    {
      "label": "Носослёзная борозда",
      "text": "smooth tear trough, no under-eye hollowing, even lower eyelid contour, rested refreshed eyes, clinical medical photography, natural skin texture, photorealistic",
    },
    {
      "label": "Скуловая область",
      "text": "restored midface volume, natural cheek fullness, smooth transition to lower eyelid, balanced proportions, clinical medical photography, photorealistic, high detail",
    },
  ],

  breast_lift: [
    { label: "Мастопексия", text: "breast lift result, restored breast position, no ptosis, natural upper pole, symmetric nipple position, proportional shape, clinical medical photography, photorealistic, tasteful" },
    { label: "Периареолярная", text: "periareolar mastopexy result, subtle lift, natural breast shape, minimal scarring appearance, symmetric areolae, clinical medical photography, photorealistic, tasteful" },
    { label: "Подтяжка с имплантом", text: "mastopexy with implant result, lifted breasts with restored upper pole fullness, natural proportions, symmetric, clinical medical photography, photorealistic, tasteful" },
    { label: "После кормления", text: "breast lift after breastfeeding, restored shape and position, natural volume distribution, symmetric, clinical medical photography, photorealistic, tasteful" },
  ],

  breast_reconstruction: [
    { label: "Реконструкция имплантом", text: "breast reconstruction with implant, restored breast mound, symmetric with opposite side, natural contour, clinical medical photography, photorealistic, tasteful" },
    { label: "Лоскутная реконструкция", text: "autologous flap breast reconstruction result, natural breast shape and softness, symmetric projection, clinical medical photography, photorealistic, tasteful" },
    { label: "Восстановление симметрии", text: "breast symmetry restoration result, matched volume and position of both breasts, natural contour, clinical medical photography, photorealistic, tasteful" },
  ],

  bbl: [
    { label: "Бразильская подтяжка ягодиц", text: "Brazilian butt lift result, enhanced buttock projection and roundness, smooth natural contour, proportional to waist and hips, clinical medical photography, photorealistic, tasteful" },
    { label: "Натуральный объём", text: "subtle buttock augmentation result, natural rounded shape, smooth transition to thighs, balanced proportions, clinical medical photography, photorealistic, tasteful" },
    { label: "Контур талия — бёдра", text: "buttock augmentation with waist contouring, hourglass silhouette, smooth hip transition, natural proportions, clinical medical photography, photorealistic, tasteful" },
  ],

  body_contouring: [
    { label: "Комплексный контуринг", text: "full body contouring result, smooth even contours, balanced proportions, no skin irregularities, natural silhouette, clinical medical photography, photorealistic, tasteful" },
    { label: "После похудения", text: "post-weight-loss body contouring result, removed excess skin, smooth toned contour, natural silhouette, clinical medical photography, photorealistic, tasteful" },
    { label: "Талия и бока", text: "waist and flank contouring result, defined waistline, smooth flanks, balanced torso proportions, clinical medical photography, photorealistic, tasteful" },
  ],

  arm_lift: [
    { label: "Брахиопластика", text: "arm lift result, tightened upper arm contour, no sagging skin, smooth natural arm shape, clinical medical photography, photorealistic, tasteful" },
    { label: "Мини-подтяжка", text: "short-scar arm lift result, firmer upper arm, subtle contour improvement, natural appearance, clinical medical photography, photorealistic, tasteful" },
    { label: "С липосакцией", text: "arm lift with liposuction result, slimmer firm arm contour, smooth skin, defined shape, clinical medical photography, photorealistic, tasteful" },
  ],

  thigh_lift: [
    { label: "Подтяжка бёдер", text: "thigh lift result, tightened inner thigh contour, no sagging skin, smooth natural leg shape, clinical medical photography, photorealistic, tasteful" },
    { label: "Внутренняя поверхность", text: "medial thigh lift result, firm smooth inner thighs, improved leg contour, natural proportions, clinical medical photography, photorealistic, tasteful" },
    { label: "С липосакцией", text: "thigh lift with liposuction result, slimmer firm thighs, smooth even contour, natural leg shape, clinical medical photography, photorealistic, tasteful" },
  ],

  lower_body_lift: [
    { label: "Круговая подтяжка", text: "lower body lift result, tightened abdomen, flanks and buttocks in one continuous contour, no excess skin, natural silhouette, clinical medical photography, photorealistic, tasteful" },
    { label: "После бариатрии", text: "post-bariatric lower body lift result, removed excess skin, smooth toned contour, restored proportions, clinical medical photography, photorealistic, tasteful" },
  ],

  gynecomastia: [
    { label: "Коррекция гинекомастии", text: "gynecomastia correction result, flat masculine chest contour, defined pectoral shape, no glandular fullness, natural nipple position, clinical medical photography, photorealistic" },
    { label: "Липосакция груди", text: "chest liposuction result for gynecomastia, flatter chest contour, smooth transition to torso, masculine appearance, clinical medical photography, photorealistic" },
    { label: "С подтяжкой кожи", text: "gynecomastia correction with skin tightening, flat firm chest, no sagging, defined pectoral border, clinical medical photography, photorealistic" },
  ],

  ear_reconstruction: [
    { label: "Реконструкция ушной раковины", text: "ear reconstruction result, restored natural ear shape and contour, symmetric with opposite ear, natural helix and antihelix, clinical medical photography, photorealistic" },
    { label: "Восстановление после травмы", text: "post-traumatic ear reconstruction result, natural ear outline, symmetric position, smooth skin, clinical medical photography, photorealistic, high detail" },
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

// Хвост, который держит пациента собой в режиме без маски. Там кадр не
// собирается по маске, и единственное, что удерживает личность, — сам
// запрос плюс input_fidelity у модели.
const KEEP_IDENTITY =
  "Keep the same person with the same identity, face shape, bone structure," +
  " skin texture, hair, lighting, background and framing, change nothing else," +
  " photorealistic clinical photograph.";

/**
 * Пресет каталога под нужный режим. Каталог писался для инпейнта — это
 * ОПИСАНИЕ желаемого вида зоны. Отданное модели без маски, такое описание
 * читается как «нарисуй новый портрет по этим приметам», поэтому здесь оно
 * превращается в указание, что сделать со снимком.
 */
export function presetFor(procedure, promptIdx = 0, mode = "full") {
  const text = pickPrompt(procedure, promptIdx);
  if (mode !== "full") return text;
  return `Edit this clinical photograph to achieve: ${text}. ${KEEP_IDENTITY}`;
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
    promptProcedure,
    disclaimerAccepted,
  },
) {
  if (!disclaimerAccepted) {
    throw new Error("Необходимо принять дисклеймер перед симуляцией");
  }

  const cas = await SurgicalCase.findOne({ _id: caseId, surgeonId });
  if (!cas) throw new Error("Кейс не найден");

  // Квота проверяется ДО постановки в очередь: отказ, за который мы уже
  // заплатили генерацию, — худший вид отказа. Симуляция стоит дороже любой
  // другой операции платформы, и открытый счёт здесь недопустим.
  await assertSimulationAllowed(surgeonId);

  // ─── Режим правки ───────────────────────────────────────────────────
  //
  // Маска необязательна, и без неё — основной путь. Endpoint images/edits
  // маску не требует: модель сама находит на снимке лицо, нос и веки и
  // правит то, о чём просят. Ровно так работает ChatGPT, где «убери мешки
  // под глазами» выполняется без всякого выделения.
  //
  // Маска остаётся инструментом ограничения: когда врач хочет, чтобы
  // правка не вышла за отмеченный участок, — тогда включается прежний
  // строгий контракт со сборкой кадра по маске.
  const mode = maskFilename ? "masked" : "full";

  // Свободный текст врача компилируем — под тот режим, в котором он пойдёт:
  // без маски модель нужно ПРОСИТЬ («подними кончик носа»), а с маской —
  // ОПИСЫВАТЬ желаемый вид зоны, потому что содержимого под маской она не
  // видит и «убери» ей бесполезно.
  // Зона правки может не совпадать с типом операции в кейсе: кейс заведён
  // на брови, а посмотреть врач хочет нос. Незнакомый ключ игнорируем молча
  // и возвращаемся к процедуре кейса — подделать каталог через API нельзя.
  const promptZone = PROCEDURE_PROMPTS[promptProcedure]
    ? promptProcedure
    : cas.procedure;

  const raw = (customPrompt || "").trim();
  const { prompt, compiled } = raw
    ? await compilePrompt(raw, cas.procedure, mode === "full" ? "edit" : "inpaint")
    : {
        prompt: presetFor(promptZone, Number(promptIdx) || 0, mode),
        compiled: false,
      };

  const simulation = await Simulation.create({
    caseId,
    surgeonId,
    sourcePhotoFilename,
    maskFilename,
    mode,
    procedure: cas.procedure,
    prompt,
    promptRaw: raw || null,
    promptCompiled: compiled,
    negativePrompt: NEGATIVE_PROMPT,
    // Сколько вариантов просить у модели. Каждый — отдельная оплаченная
    // генерация, и на gpt-image-2 с quality=high это самая дорогая часть
    // симуляции: четыре варианта стоят вчетверо дороже одного, а врач всё
    // равно выбирает один. Уменьшается без правки кода: SIMULATION_VARIANTS=2.
    numOutputs: Math.min(4, Math.max(1, Number(process.env.SIMULATION_VARIANTS) || 4)),
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

/**
 * Весь каталог: какие процедуры вообще умеют подсказать результат.
 *
 * Нужен потому, что тип операции в кейсе и зона правки на снимке — разные
 * вещи. Кейс заведён как «подтяжка бровей», а на снимке врач хочет
 * посмотреть нос: раньше выбора не было вовсе, список молча ограничивался
 * процедурой кейса, и всё незнакомое проваливалось в «общий косметический
 * результат».
 *
 * Названия процедур здесь не переводятся: у клиента они уже есть на всех
 * пяти языках: locales, язык, Surgery.json, ключ procedures.<процедура>.
 */
export function getPromptCatalog() {
  return Object.keys(PROCEDURE_PROMPTS).map((procedure) => ({
    procedure,
    prompts: PROCEDURE_PROMPTS[procedure].map((p, idx) => ({
      idx,
      label: p.label,
    })),
  }));
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
