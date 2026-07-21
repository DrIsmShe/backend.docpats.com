// __tests__/education/categories.test.js
//
// Рубрикатор тестов (категории/подкатегории), жёсткое удаление программы
// и деление большого теста на блоки.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import ExamCategory from "../../modules/education/education-categories/models/examCategory.model.js";
import ExamProgram from "../../modules/education/education-catalog/models/examProgram.model.js";
import ExamItem from "../../modules/education/education-items/models/examItem.model.js";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  listCategoriesTree,
} from "../../modules/education/education-categories/services/category.service.js";
import {
  deleteProgram,
  getProgramBlocks,
} from "../../modules/education/education-catalog/services/program.service.js";
import { startAttempt } from "../../modules/education/education-attempts/services/attempt.service.js";

const oid = () => new mongoose.Types.ObjectId();

let codeSeq = 0;

async function makeProgram(overrides = {}) {
  codeSeq += 1;
  return ExamProgram.create({
    code: `prog-${codeSeq}`,
    title: "Тест",
    country: "SA",
    region: "mena",
    examType: "licensing",
    status: "published",
    ...overrides,
  });
}

// Опубликованные вопросы создаём напрямую (редакторский цикл проверяют
// другие файлы). insertMany сохраняет порядок, а _id монотонны — поэтому
// сортировка (createdAt, _id) детерминирована.
async function seedItems(programId, count) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    docs.push({
      programId,
      stem: `Вопрос №${i + 1}`,
      options: [
        { key: "A", text: "верный" },
        { key: "B", text: "неверный" },
      ],
      correctKeys: ["A"],
      source: { kind: "original" },
      status: "published",
      reviewedBy: oid(),
    });
  }
  return ExamItem.insertMany(docs);
}

describe("рубрикатор: создание и дерево", () => {
  it("создаёт категорию и подкатегорию под ней", async () => {
    const top = await createCategory({ name: "Международные экзамены" });
    const sub = await createCategory({ name: "USMLE", parentId: top._id });

    expect(String(sub.parentId)).toBe(String(top._id));
    // slug выведен из имени (латиница остаётся, кириллица транслитерируется).
    expect(top.slug).toBeTruthy();
  });

  it("допускает произвольную глубину вложенности", async () => {
    const l1 = await createCategory({ name: "Уровень 1" });
    const l2 = await createCategory({ name: "Уровень 2", parentId: l1._id });
    const l3 = await createCategory({ name: "Уровень 3", parentId: l2._id });
    const l4 = await createCategory({ name: "Уровень 4", parentId: l3._id });
    expect(String(l4.parentId)).toBe(String(l3._id));
  });

  it("запрещает цикл: родитель не может лежать в своём же поддереве", async () => {
    const a = await createCategory({ name: "A" });
    const b = await createCategory({ name: "B", parentId: a._id });
    const c = await createCategory({ name: "C", parentId: b._id });

    // Попытка сделать A подкатегорией её же внука C замкнула бы дерево в кольцо.
    await expect(
      updateCategory(a._id, { parentId: c._id }),
    ).rejects.toThrow(/подкатегори/i);
  });

  it("считает тесты рекурсивно по всему поддереву", async () => {
    const l1 = await createCategory({ name: "Корень" });
    const l2 = await createCategory({ name: "Средний", parentId: l1._id });
    const l3 = await createCategory({ name: "Глубокий", parentId: l2._id });
    await makeProgram({ categoryId: l3._id });

    const tree = await listCategoriesTree({ countScope: "public" });
    const root = tree.find((n) => n.name === "Корень");
    // Тест лежит на 3-м уровне, но корень видит его в своей сумме.
    expect(root.programCount).toBe(1);
  });

  it("собирает дерево и считает тесты (свои + подкатегорий)", async () => {
    const top = await createCategory({ name: "Резидентура" });
    const sub = await createCategory({ name: "TUS", parentId: top._id });
    await makeProgram({ categoryId: sub._id });
    await makeProgram({ categoryId: top._id });

    const tree = await listCategoriesTree({ countScope: "public" });
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    // Один тест прямо в категории + один в подкатегории = 2.
    expect(tree[0].programCount).toBe(2);
    expect(tree[0].children[0].directProgramCount).toBe(1);
  });
});

describe("рубрикатор: удаление", () => {
  it("блокирует удаление категории с подкатегориями", async () => {
    const top = await createCategory({ name: "Категория" });
    await createCategory({ name: "Подкатегория", parentId: top._id });

    await expect(deleteCategory(top._id)).rejects.toThrow(/подкатегории/i);
  });

  it("блокирует удаление категории с привязанными тестами", async () => {
    const cat = await createCategory({ name: "С тестами" });
    await makeProgram({ categoryId: cat._id });

    await expect(deleteCategory(cat._id)).rejects.toThrow(/тесты/i);
  });

  it("удаляет пустую категорию", async () => {
    const cat = await createCategory({ name: "Пустая" });
    const res = await deleteCategory(cat._id);
    expect(res.deleted).toBe(true);
    expect(await ExamCategory.findById(cat._id).lean()).toBeNull();
  });

  it("переносит подкатегорию в другую категорию", async () => {
    const a = await createCategory({ name: "A" });
    const b = await createCategory({ name: "B" });
    const sub = await createCategory({ name: "sub", parentId: a._id });

    const moved = await updateCategory(sub._id, { parentId: b._id });
    expect(String(moved.parentId)).toBe(String(b._id));
  });
});

describe("жёсткое удаление теста", () => {
  it("удаляет тест и его вопросы, когда попыток нет", async () => {
    const program = await makeProgram();
    await seedItems(program._id, 3);

    const res = await deleteProgram(program._id);
    expect(res.deleted).toBe(true);
    expect(res.itemsDeleted).toBe(3);
    expect(await ExamProgram.findById(program._id).lean()).toBeNull();
    expect(await ExamItem.countDocuments({ programId: program._id })).toBe(0);
  });

  it("запрещает удаление, если по тесту уже есть попытки", async () => {
    const program = await makeProgram({ defaultQuestionCount: 2 });
    await seedItems(program._id, 3);
    await startAttempt({ userId: oid(), programId: program._id, mode: "tutor" });

    await expect(deleteProgram(program._id)).rejects.toThrow(/архив/i);
    // Тест на месте — ничего не стёрли.
    expect(await ExamProgram.findById(program._id).lean()).not.toBeNull();
  });

  it("force удаляет тест вместе с историей попыток", async () => {
    const program = await makeProgram({ defaultQuestionCount: 2 });
    await seedItems(program._id, 3);
    await startAttempt({ userId: oid(), programId: program._id, mode: "tutor" });

    const res = await deleteProgram(program._id, { force: true });
    expect(res.deleted).toBe(true);
    expect(res.attemptsDeleted).toBeGreaterThan(0);
    expect(await ExamProgram.findById(program._id).lean()).toBeNull();
  });
});

describe("деление на блоки", () => {
  it("считает блоки по blockSize", async () => {
    const program = await makeProgram({ blockSize: 2 });
    await seedItems(program._id, 5);

    const { blockSize, totalCount, blocks } = await getProgramBlocks(program._id);
    expect(blockSize).toBe(2);
    expect(totalCount).toBe(5);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ index: 0, from: 1, to: 2, count: 2 });
    expect(blocks[2]).toMatchObject({ index: 2, from: 5, to: 5, count: 1 });
  });

  it("попытка по блоку берёт ровно свой детерминированный срез", async () => {
    const program = await makeProgram({ blockSize: 2 });
    const items = await seedItems(program._id, 5);
    const sortedIds = items.map((i) => String(i._id)); // порядок вставки = _id asc

    const attempt = await startAttempt({
      userId: oid(),
      programId: program._id,
      mode: "tutor",
      blockIndex: 1,
    });

    expect(attempt.blockIndex).toBe(1);
    const gotIds = attempt.questions.map((q) => String(q.itemId));
    // Блок 1 (0-based) = 3-й и 4-й вопросы.
    expect(gotIds).toEqual([sortedIds[2], sortedIds[3]]);
  });

  it("разные блоки можно проходить одновременно", async () => {
    const program = await makeProgram({ blockSize: 2 });
    await seedItems(program._id, 5);
    const userId = oid();

    await startAttempt({ userId, programId: program._id, mode: "tutor", blockIndex: 0 });
    // Второй блок стартует, несмотря на незавершённый первый.
    const second = await startAttempt({
      userId,
      programId: program._id,
      mode: "tutor",
      blockIndex: 1,
    });
    expect(second.blockIndex).toBe(1);
  });

  it("тот же блок нельзя начать дважды, пока первый не завершён", async () => {
    const program = await makeProgram({ blockSize: 2 });
    await seedItems(program._id, 5);
    const userId = oid();

    await startAttempt({ userId, programId: program._id, mode: "tutor", blockIndex: 0 });
    await expect(
      startAttempt({ userId, programId: program._id, mode: "tutor", blockIndex: 0 }),
    ).rejects.toThrow(/in progress/i);
  });
});
