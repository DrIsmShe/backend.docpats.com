// Временный диагностический скрипт. Запуск из server:
//   node check-allergy.mjs
import "dotenv/config";
import mongoose from "mongoose";

const URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DB_URI ||
  process.env.DATABASE_URL ||
  process.env.MONGO_URL;

if (!URI) {
  console.error(
    "❌ Не нашёл URI. Env с mongo/db:",
    Object.keys(process.env).filter((k) => /mongo|^db|database/i.test(k)),
  );
  process.exit(1);
}

await mongoose.connect(URI);
console.log("✅ Подключено\n");
const db = mongoose.connection.db;

// 1. Все коллекции, где в имени есть allerg
const colls = await db.listCollections().toArray();
const allergColls = colls.map((c) => c.name).filter((n) => /allerg/i.test(n));
console.log("📦 Коллекции с 'allerg':", allergColls, "\n");

// 2. Содержимое КАЖДОЙ такой коллекции
for (const name of allergColls) {
  const docs = await db.collection(name).find({}).limit(10).toArray();
  console.log(`\n─── ${name} (${docs.length} записей) ───`);
  for (const d of docs) {
    console.log(
      JSON.stringify({
        _id: String(d._id),
        patientId: d.patientId ? String(d.patientId) : undefined,
        patient: d.patient ? String(d.patient) : undefined,
        content: d.content,
        name: d.name,
        title: d.title,
        allergen: d.allergen,
        substance: d.substance,
        description: d.description,
        createdByClinicId: d.createdByClinicId
          ? String(d.createdByClinicId)
          : undefined,
      }),
    );
  }
}

// 3. Заодно — хроника (она точно есть по прошлым скринам)
console.log("\n\n═══ ХРОНИКА ═══");
const chronColls = colls.map((c) => c.name).filter((n) => /chronic/i.test(n));
console.log("📦 Коллекции с 'chronic':", chronColls);
for (const name of chronColls) {
  const docs = await db.collection(name).find({}).limit(10).toArray();
  console.log(`\n─── ${name} (${docs.length}) ───`);
  for (const d of docs) {
    console.log(
      JSON.stringify({
        _id: String(d._id),
        patientId: d.patientId ? String(d.patientId) : undefined,
        content: d.content,
        createdByClinicId: d.createdByClinicId
          ? String(d.createdByClinicId)
          : undefined,
      }),
    );
  }
}

console.log("\n🎯 Карта пациента: 6a1ec60568919f6b6cb36fa1");

await mongoose.disconnect();
process.exit(0);
