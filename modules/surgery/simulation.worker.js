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
    if (painted < 0.5) {
      console.warn(
        "⚠️ [simulation.worker] маска почти пустая — модель перерисует кадр целиком",
      );
    }

    // Приводим к размеру фото: врач рисует поверх превью, и масштаб там
    // почти никогда не совпадает с оригиналом.
    maskBuffer = await sharp(maskPath)
      .resize(width, height, { fit: "fill" })
      .png()
      .toBuffer();
  } else {
    // Маски нет — белое полотно: перерисовывается весь кадр. Это осознанно
    // разрешено, но результат тогда не «правка носа», а новое лицо.
    maskBuffer = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    console.log(`🎭 [simulation.worker] маски нет — белое полотно ${width}x${height}`);
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
