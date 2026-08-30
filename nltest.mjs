
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri(), { dbName: "t" });

// Почту не шлём: проверяем логику, а не Brevo.
const sent = [];
const svc = await import("./modules/newsletter/newsletter.service.js");
const emailMod = await import("./common/services/emailService.js");

const { default: Sub, hashEmail } = await import(
  "./common/models/Newsletter/newsletterSubscriber.js"
);

// Перехватываем отправку через подмену переменной окружения: без ключа
// sendEmail просто ничего не делает — этого достаточно.
process.env.BREVO_API_KEY = "";

const email = "guest@example.com";
console.log("1) подписка:", (await svc.subscribe({ email, audience: "doctor", locale: "ru" })).status);
let doc = await Sub.findOne({ emailHash: hashEmail(email) });
console.log("   адрес зашифрован:", doc.emailEncrypted !== email);
console.log("   расшифровывается:", doc.email === email);
console.log("   подтверждён сразу:", Boolean(doc.confirmedAt), "(должно быть false)");
console.log("   токен хранится хешем:", doc.confirmTokenHash?.length === 64);

console.log("2) повтор сразу:", (await svc.subscribe({ email, audience: "doctor" })).status, "(ожидаем throttled)");

console.log("3) подтверждение чужим токеном:", JSON.stringify(await svc.confirm("deadbeef")));

// Настоящий токен знаем только из письма — воспроизводим: ставим свой.
import crypto from "node:crypto";
const token = crypto.randomBytes(32).toString("hex");
doc.confirmTokenHash = crypto.createHash("sha256").update(token).digest("hex");
await doc.save();
const ok = await svc.confirm(token);
console.log("4) подтверждение верным токеном:", JSON.stringify(ok));

doc = await Sub.findOne({ emailHash: hashEmail(email) });
console.log("   токен погашен:", doc.confirmTokenHash === null);

console.log("5) повтор после подтверждения:", (await svc.subscribe({ email, audience: "doctor" })).status, "(ожидаем already)");
console.log("6) отписка:", JSON.stringify(await svc.unsubscribeByEmail(email, "тест")));
doc = await Sub.findOne({ emailHash: hashEmail(email) });
console.log("   отписан:", Boolean(doc.unsubscribedAt));

await mongoose.disconnect();
await mem.stop();
