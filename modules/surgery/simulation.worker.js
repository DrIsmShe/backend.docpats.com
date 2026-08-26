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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../../uploads/surgery");
// Ключи и модели знает провайдер (imageProviders/), а не воркер:
// добавление третьего поставщика не должно править этот файл.

// ─── Подготовка входных данных ───────────────────────────────────────────
//
// Чтение файлов и работа с размерами живут здесь, а не в провайдерах:
// провайдер отвечает только за сеть, и добавить третьего — значит написать
// один HTTP-вызов, а не заново разбираться с масками.
async function prepareInputs(simulation) {
  const imgPath = path.join(UPLOADS_DIR, simulation.sourcePhotoFilename);
  const imageBuffer = fs.readFileSync(imgPath);

  const { width, height } = await sharp(imageBuffer).metadata();
  console.log(`📐 [simulation.worker] фото ${width}x${height}`);

  let maskBuffer;
  if (simulation.maskFilename) {
    const maskPath = path.join(UPLOADS_DIR, simulation.maskFilename);
    const maskMeta = await sharp(maskPath).metadata();

    // Проверка геометрии маски — не паранойя, а след реальной поломки.
    // Канвас кисти монтировался с дефолтными 300×150, потому что размеры
    // ему задавали до появления в DOM. Врач красил нос, а в маску попадало
    // пятно в другом месте кадра; результат выглядел как «другой человек,
    // ничего не изменилось», и в логах не было НИ ОДНОГО признака. Теперь
    // расхождение пропорций видно сразу.
    const maskRatio = maskMeta.width / maskMeta.height;
    const photoRatio = width / height;
    if (Math.abs(maskRatio - photoRatio) / photoRatio > 0.1) {
      console.warn(
        `⚠️ [simulation.worker] пропорции маски (${maskMeta.width}x${maskMeta.height})` +
          ` не совпадают с фото (${width}x${height}) — область правки уедет.` +
          ` Похоже на ошибку размера канваса на клиенте.`,
      );
    }

    // Доля закрашенного. Ноль означает пустую маску: перерисовывать нечего,
    // и модель вернёт просто пересобранный кадр.
    const stats = await sharp(maskPath).greyscale().stats();
    const painted = (stats.channels[0].mean / 255) * 100;
    console.log(
      `🎭 [simulation.worker] маска ${maskMeta.width}x${maskMeta.height}` +
        ` → ${width}x${height}, закрашено ${painted.toFixed(1)}%`,
    );
    // Почти пустая маска — это ОТКАЗ, а не предупреждение.
    //
    // Раньше здесь стоял console.warn, и работа продолжалась: FLUX Fill получал
    // маску без области правки и перерисовывал кадр целиком. Врач видел четырёх
    // незнакомых людей вместо своего пациента, платил за генерацию и не понимал,
    // что произошло, — в интерфейс warn не попадает.
    //
    // Симуляция без области — это всегда ошибка ввода, а не намерение: «покажи
    // результат ринопластики» имеет смысл только применительно к конкретному
    // лицу на конкретном снимке.
    if (painted < 0.5) {
      throw new Error(
        "Область для изменения не отмечена (закрашено " +
          `${painted.toFixed(1)}% кадра). Нарисуйте кистью зону операции и запустите снова.`,
      );
    }
    // Закрашен почти весь кадр — формально работать можно, но результатом будет
    // новое лицо, а не правка. Предупреждаем в лог: запрещать не станем, врач
    // мог осознанно выделить большую область.
    if (painted > 90) {
      console.warn(
        `⚠️ [simulation.worker] закрашено ${painted.toFixed(1)}% кадра —` +
          " от исходного лица почти ничего не останется",
      );
    }

    // Приводим к размеру фото: врач рисует поверх превью, и масштаб там
    // почти никогда не совпадает с оригиналом.
    maskBuffer = await sharp(maskPath)
      .resize(width, height, { fit: "fill" })
      .png()
      .toBuffer();
  } else {
    // Маски нет вовсе. Прежде здесь подставлялось белое полотно — «перерисуй
    // всё», — и это было худшее из возможных умолчаний: тихо, дорого и с
    // результатом, не имеющим отношения к пациенту. Клиент маску требует, так
    // что сюда попадает только прямой вызов API; ему честно отвечаем отказом.
    throw new Error(
      "К симуляции не приложена маска области. Полная перерисовка кадра" +
        " симуляцией операции не является — отметьте зону вмешательства.",
    );
  }

  return { imageBuffer, maskBuffer, width, height };
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

      const { imageBuffer, maskBuffer } = await prepareInputs(sim);
      const { requestId, images, ext } = await provider.run({
        imageBuffer,
        maskBuffer,
        prompt: sim.prompt,
        negativePrompt: sim.negativePrompt,
        numOutputs: sim.numOutputs || 4,
      });

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Провайдер отдаёт готовые буферы — записываем сами. Раньше воркер
      // умел только скачивать по ссылке, а OpenAI ссылок не даёт вовсе.
      const resultFilenames = images.map((buf, i) => {
        const filename = `sim-${simulationId}-${i}-${Date.now()}.${ext || "jpg"}`;
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
        `✅ [simulation.worker] ${simulationId} готова за ${elapsed}с — ${resultFilenames.length} вариантов`,
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

console.log(`🧠 [simulation.worker] воркер симуляций запущен — ${describeImageProvider()}`);
export default worker;
