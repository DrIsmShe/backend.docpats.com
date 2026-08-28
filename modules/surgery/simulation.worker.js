import { Worker } from "bullmq";
import { redis } from "../../common/config/redis.js";
import Simulation from "./simulation.model.js";
import { getSimulationIo } from "./simulationIo.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  getImageProvider,
  describeImageProvider,
} from "./imageProviders/index.js";
import { analyzeMask, planCrop, compositeByMask } from "./maskGeometry.js";
import { describeSubject } from "./subjectAnalysis.service.js";
import {
  isFaceProcedure,
  maxPaintedPct,
  MIN_PAINTED_PCT,
} from "./procedureZones.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../../uploads/surgery");
// Ключи и модели знает провайдер (imageProviders/), а не воркер:
// добавление третьего поставщика не должно править этот файл.

// ─── Подготовка входных данных ───────────────────────────────────────────
//
// Здесь решается главный вопрос симуляции: останется ли на выходе тот же
// человек. Ответ обеспечивают не слова в промте, а три проверки подряд —
// система координат маски, её площадь и окно генерации. Всё, что врач не
// закрасил, до модели не доедет вовсе: кадр собирается обратно из
// оригинала в compositeByMask().
async function prepareInputs(simulation) {
  const imgPath = path.join(UPLOADS_DIR, simulation.sourcePhotoFilename);
  const imageBuffer = fs.readFileSync(imgPath);

  const { width, height } = await sharp(imageBuffer).metadata();
  console.log(`📐 [simulation.worker] фото ${width}x${height}`);

  if (!simulation.maskFilename) {
    // Маски нет вовсе. Прежде здесь подставлялось белое полотно — «перерисуй
    // всё», — и это было худшее из возможных умолчаний: тихо, дорого и с
    // результатом, не имеющим отношения к пациенту. Клиент маску требует, так
    // что сюда попадает только прямой вызов API; ему честно отвечаем отказом.
    throw new Error(
      "К симуляции не приложена маска области. Полная перерисовка кадра" +
        " симуляцией операции не является — отметьте зону вмешательства.",
    );
  }

  const maskPath = path.join(UPLOADS_DIR, simulation.maskFilename);
  const maskMeta = await sharp(maskPath).metadata();

  // ─── Система координат маски ──────────────────────────────────────────
  //
  // Не паранойя, а след поломки, стоившей нам всех симуляций за четыре
  // месяца. Канвас кисти монтировался с дефолтными 300×150, потому что
  // размеры ему задавали до появления в DOM. Врач красил под глазами, а в
  // маску попадала растянутая полоса в другом месте кадра; модель
  // добросовестно перерисовывала именно её, и на выходе был чужой человек.
  // В логах не было ни одного признака.
  //
  // Раньше здесь стоял console.warn — предупреждение, которого врач не
  // видит: он получает результат, платит за него и не понимает, что
  // произошло. Теперь это отказ. Маска обязана быть в пикселях снимка;
  // расхождение пропорций больше 2% означает другую систему координат, и
  // чинить надо клиент, а не объяснять картинку.
  const maskRatio = maskMeta.width / maskMeta.height;
  const photoRatio = width / height;
  if (Math.abs(maskRatio - photoRatio) / photoRatio > 0.02) {
    throw new Error(
      `Маска (${maskMeta.width}×${maskMeta.height}) не соответствует пропорциям` +
        ` снимка (${width}×${height}) — область правки легла бы не туда.` +
        " Обновите страницу (Ctrl+F5) и отметьте зону заново.",
    );
  }

  // ─── Площадь правки ───────────────────────────────────────────────────
  const { paintedPct, bbox } = await analyzeMask(maskPath, width, height);
  console.log(
    `🎭 [simulation.worker] маска ${maskMeta.width}x${maskMeta.height}` +
      ` → ${width}x${height}, закрашено ${paintedPct.toFixed(1)}%`,
  );

  // Пустая маска — ошибка ввода, а не намерение: «покажи результат
  // ринопластики» имеет смысл только применительно к конкретному лицу на
  // конкретном снимке.
  if (paintedPct < MIN_PAINTED_PCT || !bbox) {
    throw new Error(
      `Область для изменения не отмечена (закрашено ${paintedPct.toFixed(1)}%` +
        " кадра). Нарисуйте кистью зону операции и запустите снова.",
    );
  }

  // Верхняя граница. Прежде здесь был console.warn и работа продолжалась —
  // платформа сама разрешала себе вернуть нового человека вместо пациента.
  // Закрашенные полкадра при блефаропластике означают ошибку выделения, а
  // не замысел, и отказ дешевле объяснений постфактум.
  const limit = maxPaintedPct(simulation.procedure);
  if (paintedPct > limit) {
    throw new Error(
      `Закрашено ${paintedPct.toFixed(0)}% кадра при допустимых ${limit}%` +
        (isFaceProcedure(simulation.procedure)
          ? " для операций на лице. Такая область — это уже не зона вмешательства," +
            " на выходе получится другой человек. Отметьте только оперируемый участок."
          : ". Отметьте только оперируемый участок."),
    );
  }

  // Маску приводим к размеру фото один раз: врач рисует поверх превью, и
  // масштаб там почти никогда не совпадает с оригиналом.
  const maskBuffer = await sharp(maskPath)
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  // ─── Окно генерации ───────────────────────────────────────────────────
  //
  // Мешки под глазами занимают 2-3% кадра. Отдавая модели снимок целиком,
  // мы отдаём под зону интереса те же 2-3% её разрешения и получаем мыло
  // вместо кожи. Кроп с запасом контекста поднимает детализацию зоны в
  // разы, а окружение всё равно вернётся из оригинала при сборке.
  const region = planCrop(bbox, width, height);

  const modelImage = region
    ? await sharp(imageBuffer).extract(region).png().toBuffer()
    : imageBuffer;
  const modelMask = region
    ? await sharp(maskBuffer).extract(region).png().toBuffer()
    : maskBuffer;

  if (region) {
    const share = (
      (bbox.width * bbox.height * 100) /
      (region.width * region.height)
    ).toFixed(0);
    console.log(
      `🔍 [simulation.worker] окно генерации ${region.width}x${region.height}` +
        ` @ ${region.left},${region.top} — зона занимает ${share}% окна`,
    );
  }

  return {
    imageBuffer,
    maskBuffer,
    modelImage,
    modelMask,
    width,
    height,
    region,
    paintedPct,
    maskMeta,
  };
}

// ─── BullMQ Worker ────────────────────────────────────────────────────────
const worker = new Worker(
  "surgery-simulation",
  async (job) => {
    const { simulationId, surgeonId } = job.data;
    const io = getSimulationIo();

    const sim = await Simulation.findById(simulationId);
    if (!sim) throw new Error(`Simulation ${simulationId} не найдена`);

    sim.status = "processing";
    await sim.save();

    if (io) {
      io.of("/communication")
        .to(`surgeon:${surgeonId}`)
        .emit("simulation:processing", {
          simulationId,
          caseId: String(sim.caseId),
        });
    }

    try {
      const startTime = Date.now();

      const provider = getImageProvider();
      if (!provider.isConfigured()) throw new Error(provider.missingHint);

      const prepared = await prepareInputs(sim);
      const {
        imageBuffer,
        maskBuffer,
        modelImage,
        modelMask,
        width,
        height,
        region,
      } = prepared;

      // Кого рисуем. Без этой строки модель заполняет пустое место
      // статистикой обучающей выборки — для пластической хирургии это
      // мужчина 50-65 лет, отсюда и смена пола на выходе.
      const subject = await describeSubject(
        imageBuffer,
        sim.sourcePhotoFilename,
      );
      const promptFinal = [
        subject,
        sim.prompt,
        "same person, identity and facial features unchanged",
      ]
        .filter(Boolean)
        .join(", ");

      sim.subjectDescription = subject || null;
      sim.promptFinal = promptFinal;
      sim.provider = provider.name;
      sim.maskStats = {
        width: prepared.maskMeta.width,
        height: prepared.maskMeta.height,
        paintedPct: Number(prepared.paintedPct.toFixed(2)),
      };
      sim.cropRegion = region || null;
      await sim.save();

      const { requestId, images, ext } = await provider.run({
        imageBuffer: modelImage,
        maskBuffer: modelMask,
        prompt: promptFinal,
        negativePrompt: sim.negativePrompt,
        numOutputs: sim.numOutputs || 4,
      });

      // ─── Сборка кадра ───────────────────────────────────────────────
      //
      // Здесь и обеспечивается «тот же человек». Из ответа модели берётся
      // только область маски, остальное — исходные пиксели снимка. Даже
      // если модель нарисовала в окне кого-то другого, за пределы
      // закрашенной зоны это не выйдет физически.
      const merged = await Promise.all(
        images.map((buf) =>
          compositeByMask(imageBuffer, buf, maskBuffer, width, height, region),
        ),
      );

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Провайдер отдаёт буферы, формат итога задаём мы: после сборки это
      // всегда JPEG размером с оригинал, независимо от того, что вернул
      // поставщик.
      const resultFilenames = merged.map((buf, i) => {
        const filename = `sim-${simulationId}-${i}-${Date.now()}.jpg`;
        fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
        return filename;
      });

      sim.status = "done";
      sim.replicateId = requestId;
      sim.resultFilenames = resultFilenames;
      await sim.save();

      if (io) {
        io.of("/communication")
          .to(`surgeon:${surgeonId}`)
          .emit("simulation:done", {
            simulationId,
            caseId: String(sim.caseId),
            resultFilenames,
          });
      }

      console.log(
        `✅ [simulation.worker] ${simulationId} готова за ${elapsed}с —` +
          ` ${resultFilenames.length} вариантов (${ext} от ${provider.name}, собрано по маске)`,
      );
    } catch (err) {
      sim.status = "failed";
      sim.errorMessage = err.message;
      await sim.save();

      if (io) {
        io.of("/communication")
          .to(`surgeon:${surgeonId}`)
          .emit("simulation:failed", {
            simulationId,
            caseId: String(sim.caseId),
            error: err.message,
          });
      }

      console.error(
        `❌ [simulation.worker] ${simulationId} провалилась:`,
        err.message,
      );
      throw err;
    }
  },
  { connection: redis, concurrency: 2 },
);

worker.on("completed", (job) =>
  console.log(`✅ [simulation.worker] Job ${job.id} done`),
);
worker.on("failed", (job, err) =>
  console.error(`❌ [simulation.worker] Job ${job?.id} failed:`, err.message),
);

console.log(
  `🧠 [simulation.worker] воркер симуляций запущен — ${describeImageProvider()}`,
);
export default worker;
