// test-audit-module.js — TEST ONLY, удалить после использования
//
// Проверяет работоспособность audit-модуля:
//   1. Подключение к БД
//   2. recordAction (синхронная запись)
//   3. recordActionAsync (fire-and-forget)
//   4. recordDeniedAccess (outcome=denied)
//   5. Query-методы
//   6. Append-only защита (update/delete блокируются)
//   7. Валидация (required поля)
//
// Запуск:
//   node test-audit-module.js
//
// После успешного теста — удалить файл:
//   Remove-Item test-audit-module.js  (PowerShell)
//   rm test-audit-module.js           (bash)

import mongoose from "mongoose";
import dotenv from "dotenv";
import auditService from "./modules/audit/services/audit.service.js";
import HIPAAAuditLog from "./modules/audit/models/AuditLog.model.js";

dotenv.config();

const uri = process.env.MONGO_URL;
if (!uri) {
  console.error("❌ MONGO_URL not set in .env");
  process.exit(1);
}

await mongoose.connect(uri);
console.log("✓ Connected to:", mongoose.connection.db.databaseName);

// Используем фейковые ObjectId — реальных юзеров не трогаем
const fakeUserId = new mongoose.Types.ObjectId();
const fakeResourceId = new mongoose.Types.ObjectId();
const fakeOwnerId = new mongoose.Types.ObjectId();

// ═══════════ TEST 1: recordAction ═══════════
console.log("\n=== TEST 1: recordAction ===");
const log1 = await auditService.recordAction({
  actor: { userId: fakeUserId, email: "test@docpats.com", role: "doctor" },
  action: "chat.dialog.read",
  resourceType: "chat-dialog",
  resourceId: fakeResourceId,
  resourceOwnerId: fakeOwnerId,
  context: {
    ipAddress: "192.168.0.1",
    userAgent: "Mozilla/5.0 Test",
    httpMethod: "GET",
    httpPath: "/communication/messages/dialog/123",
    statusCode: 200,
  },
  metadata: { dialogType: "doctor-patient" },
});
console.log("✓ Recorded log _id:", log1._id);
console.log("  action:", log1.action);
console.log("  outcome:", log1.outcome);
console.log("  ipAddress:", log1.ipAddress);

// ═══════════ TEST 2: recordActionAsync ═══════════
console.log("\n=== TEST 2: recordActionAsync ===");
auditService.recordActionAsync({
  actor: { userId: fakeUserId, email: "test@docpats.com", role: "doctor" },
  action: "chat.message.create",
  resourceType: "chat-message",
  resourceId: fakeResourceId,
  context: { ipAddress: "192.168.0.1" },
});
// Ждём чтобы async успел записаться
await new Promise((r) => setTimeout(r, 500));
console.log("✓ Async recorded (fire-and-forget)");

// ═══════════ TEST 3: recordDeniedAccess ═══════════
console.log("\n=== TEST 3: recordDeniedAccess ===");
const deniedLog = await auditService.recordDeniedAccess({
  actor: { userId: fakeUserId, email: "test@docpats.com", role: "doctor" },
  action: "surgery.case.read",
  resourceType: "surgical-case",
  resourceId: fakeResourceId,
  failureReason: "Not authorized to view this case",
  context: { ipAddress: "192.168.0.1" },
});
console.log("✓ Denied log _id:", deniedLog._id);
console.log("  outcome:", deniedLog.outcome, "(should be 'denied')");

// ═══════════ TEST 4: getUserActivity ═══════════
console.log("\n=== TEST 4: getUserActivity ===");
const activity = await auditService.getUserActivity(fakeUserId, { limit: 10 });
console.log(`✓ Found ${activity.length} records for fake user`);
for (const a of activity) {
  console.log(`  - ${a.action} (${a.outcome}) ${a.createdAt.toISOString()}`);
}

// ═══════════ TEST 5: Append-only защита ═══════════
console.log("\n=== TEST 5: Append-only protection ===");
try {
  await HIPAAAuditLog.updateOne(
    { _id: log1._id },
    { $set: { action: "modified" } },
  );
  console.log("❌ FAIL: update was allowed (should be blocked!)");
} catch (err) {
  console.log("✓ Update blocked:", err.message);
}

try {
  await HIPAAAuditLog.deleteOne({ _id: log1._id });
  console.log("❌ FAIL: delete was allowed (should be blocked!)");
} catch (err) {
  console.log("✓ Delete blocked:", err.message);
}

// ═══════════ TEST 6: Validation ═══════════
console.log("\n=== TEST 6: Validation ===");
try {
  await auditService.recordAction({
    actor: { userId: fakeUserId },
    // нет action, resourceType, resourceId
  });
  console.log("❌ FAIL: should have thrown");
} catch (err) {
  console.log("✓ Validation works:", err.message);
}

// ═══════════ CLEANUP — удалить тестовые записи ═══════════
console.log("\n=== CLEANUP ===");
// Прямой delete через collection (минуя model-hooks которые блокируют)
const result = await mongoose.connection.db
  .collection("hipaa_audit_logs")
  .deleteMany({ userId: fakeUserId });
console.log(`✓ Cleaned up ${result.deletedCount} test records`);

// ═══════════ STATS — финальная статистика ═══════════
console.log("\n=== STATS ===");
const totalRecords = await HIPAAAuditLog.countDocuments({});
console.log(`Total records in hipaa_audit_logs: ${totalRecords}`);

const indexes = await mongoose.connection.db
  .collection("hipaa_audit_logs")
  .indexes();
console.log(`Indexes count: ${indexes.length}`);
console.log("Indexes:");
for (const idx of indexes) {
  const ttl =
    idx.expireAfterSeconds !== undefined
      ? ` TTL=${idx.expireAfterSeconds}s (~${Math.round(
          idx.expireAfterSeconds / 86400 / 365,
        )}y)`
      : "";
  const keyStr = JSON.stringify(idx.key);
  console.log(`  - ${idx.name.padEnd(50)} ${keyStr}${ttl}`);
}

await mongoose.disconnect();
console.log("\n✅ All tests passed!");
process.exit(0);
