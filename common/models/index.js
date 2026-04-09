import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const models = {};

// ===============================
// 🔍 Безопасная рекурсивная загрузка моделей
// ===============================
async function loadModelsRecursively(dirPath) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`⚠️ Папка не найдена: ${dirPath}`);
    return;
  }

  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    // ⚠️ Пропускаем сам index.js, чтобы избежать рекурсивного импорта
    if (item === "index.js") continue;

    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      await loadModelsRecursively(fullPath);
    } else if (stat.isFile() && item.endsWith(".js")) {
      const fileUrl = pathToFileURL(fullPath).href;
      console.log(`📄 [ModelLoader] Импортирую файл: ${fileUrl}`);

      try {
        const module = await import(fileUrl);
        const model = module.default || module;

        if (model?.modelName) {
          if (!mongoose.models[model.modelName]) {
            models[model.modelName] = model;
            console.log(
              `✅ [ModelLoader] Модель загружена: ${model.modelName}`
            );
          } else {
            console.log(
              `ℹ️ [ModelLoader] Модель уже существует: ${model.modelName}`
            );
          }
        } else {
          console.log(
            `⚠️ [ModelLoader] Файл ${item} не экспортирует Mongoose-модель.`
          );
        }
      } catch (err) {
        console.error(
          `❌ [ModelLoader] Ошибка при загрузке ${item}: ${err.message}`
        );
        console.error(err.stack);
      }
    }
  }
}

console.log(`📂 [ModelLoader] Старт загрузки моделей из ${__dirname}`);
await loadModelsRecursively(__dirname);
console.log(
  "📦 [ModelLoader] ✅ Все модели обработаны (успешно или с ошибками)."
);

export default models;
