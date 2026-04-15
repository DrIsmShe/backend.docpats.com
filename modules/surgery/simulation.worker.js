import { Worker } from "bullmq";
import { redis } from "../../common/config/redis.js";
import Simulation from "./simulation.model.js";
import { getSimulationIo } from "./simulationIo.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../../uploads/surgery");
const FAL_KEY = process.env.FAL_KEY;
const FAL_MODEL = "fal-ai/flux-pro/v1/fill";

console.log(
  "🔑 [simulation.worker] FAL_KEY:",
  FAL_KEY ? "✅ задан" : "❌ НЕ ЗАДАН",
);

// ─── Файл → base64 data URI ──────────────────────────────────────────────
function fileToDataUri(filename, mimeOverride) {
  const filePath = path.join(UPLOADS_DIR, filename);
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  const mime =
    mimeOverride || (ext === "jpg" ? "image/jpeg" : `image/${ext || "png"}`);
  return `data:${mime};base64,${data.toString("base64")}`;
}

// ─── Buffer → base64 data URI ─────────────────────────────────────────────
function bufferToDataUri(buf, mime = "image/png") {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// ─── Скачать результат на диск ───────────────────────────────────────────
async function downloadToFile(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(dest, buf);
  return filename;
}

// ─── Вызов Fal.ai ────────────────────────────────────────────────────────
async function callFal(simulation) {
  if (!FAL_KEY) throw new Error("FAL_KEY не задан в .env");

  const imgPath = path.join(UPLOADS_DIR, simulation.sourcePhotoFilename);

  // Получаем размер исходного фото
  const { width, height } = await sharp(imgPath).metadata();
  console.log(`📐 [simulation.worker] Фото размер: ${width}x${height}`);

  // Исходное фото → base64
  const imageDataUri = fileToDataUri(simulation.sourcePhotoFilename);

  // Маска → ресайзим под размер фото → base64
  let maskDataUri;
  if (simulation.maskFilename) {
    const maskPath = path.join(UPLOADS_DIR, simulation.maskFilename);
    const resizedMask = await sharp(maskPath)
      .resize(width, height, { fit: "fill" })
      .png()
      .toBuffer();
    maskDataUri = bufferToDataUri(resizedMask, "image/png");
    console.log(
      `🎭 [simulation.worker] Маска ресайзнута до ${width}x${height}`,
    );
  } else {
    // Нет маски — белая маска полного размера (генерируем всё фото)
    const whiteMask = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    maskDataUri = bufferToDataUri(whiteMask, "image/png");
    console.log(
      `🎭 [simulation.worker] Создана белая маска ${width}x${height}`,
    );
  }

  const body = {
    image_url: imageDataUri,
    mask_url: maskDataUri,
    prompt: simulation.prompt,
    negative_prompt: simulation.negativePrompt,
    num_images: simulation.numOutputs || 4,
    output_format: "jpeg",
    safety_tolerance: "5",
  };

  console.log(`📤 [simulation.worker] Отправка в Fal.ai, модель: ${FAL_MODEL}`);

  // ─── Submit ───────────────────────────────────────────────────────────
  const submitRes = await fetch(`https://queue.fal.run/${FAL_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const submitText = await submitRes.text();
  console.log(
    `📥 [simulation.worker] Submit ${submitRes.status}:`,
    submitText.slice(0, 300),
  );

  if (!submitRes.ok)
    throw new Error(`Fal.ai submit ${submitRes.status}: ${submitText}`);

  const submitData = JSON.parse(submitText);
  const request_id = submitData.request_id;
  const status_url = submitData.status_url;
  const response_url = submitData.response_url;

  console.log(`🔄 [simulation.worker] request_id: ${request_id}`);

  // ─── Poll ─────────────────────────────────────────────────────────────
  const maxWait = 180_000;
  const interval = 3_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, interval));

    const statusRes = await fetch(status_url, {
      headers: { Authorization: `Key ${FAL_KEY}` },
    });

    if (!statusRes.ok) {
      console.warn("[simulation.worker] Status poll failed:", statusRes.status);
      continue;
    }

    const status = await statusRes.json();
    console.log(`⏳ [simulation.worker] Status: ${status.status}`);

    if (status.status === "COMPLETED") {
      // Получаем результат по response_url
      const resultRes = await fetch(response_url, {
        headers: { Authorization: `Key ${FAL_KEY}` },
      });
      const resultText = await resultRes.text();
      console.log(
        `[simulation.worker] Result ${resultRes.status}:`,
        resultText.slice(0, 500),
      );

      if (!resultRes.ok) {
        throw new Error(`Fal.ai result ${resultRes.status}: ${resultText}`);
      }

      const result = JSON.parse(resultText);
      const outputUrls = (result.images || result.output?.images || []).map(
        (img) => (typeof img === "string" ? img : img.url),
      );

      console.log(`[simulation.worker] Found ${outputUrls.length} images`);

      if (outputUrls.length === 0) {
        throw new Error(
          `Fal.ai COMPLETED но images пустой: ${resultText.slice(0, 300)}`,
        );
      }

      return { requestId: request_id, outputUrls };
    }

    if (status.status === "FAILED") {
      throw new Error(
        `Fal.ai FAILED: ${JSON.stringify(status.error || status)}`,
      );
    }
  }

  throw new Error("Fal.ai timeout после 3 минут");
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
      const { requestId, outputUrls } = await callFal(sim);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      const resultFilenames = await Promise.all(
        outputUrls.map(async (url, i) => {
          const filename = `sim-${simulationId}-${i}-${Date.now()}.jpg`;
          await downloadToFile(url, filename);
          return filename;
        }),
      );

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

console.log("🧠 [simulation.worker] Fal.ai воркер симуляций запущен");
export default worker;
