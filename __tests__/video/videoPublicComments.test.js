// Обсуждение под открытым роликом — что видит гость.
//
// Витрина открыта без входа, и комментарии под роликом должны читаться
// так же. Но открытый ответ обязан отдавать ровно то, что нужно читателю:
// шифротекст имён в кабинете безразличен, а здесь его собирает кто угодно.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import Video from "../../modules/video/models/video.model.js";
import Comment from "../../common/models/Comments/CommentDocpats.js";
import { собратьДерево } from "../../modules/commentsLikes/controllers/commentController/commentController.js";
import { getPublicVideoRaw } from "../../modules/video/services/video.service.js";

const id = () => new mongoose.Types.ObjectId();

async function ролик(поля = {}) {
  return Video.create({
    ownerType: "user",
    ownerId: id(),
    title: "Разбор снимка",
    lang: "ru",
    kind: "explainer",
    visibility: "public",
    status: "ready",
    phi: false,
    publishedAt: new Date(),
    media: { storageKey: "videos/x.mp4", durationSec: 42, sizeBytes: 100 },
    ...поля,
  });
}

describe("обсуждение под роликом", () => {
  it("дерево собирается с ответами внутри корневых", async () => {
    const в = await ролик();
    const корень = await Comment.create({
      content: "А что с левой стороной?",
      author: id(),
      targetId: в._id,
      targetType: "Video",
    });
    await Comment.create({
      content: "Там норма",
      author: id(),
      targetId: в._id,
      targetType: "Video",
      parentComment: корень._id,
    });

    const дерево = await собратьДерево(в._id);

    expect(дерево).toHaveLength(1);
    expect(дерево[0].replies).toHaveLength(1);
    expect(дерево[0].replies[0].content).toBe("Там норма");
    // Ответ несёт цитату родителя — на неё опирается интерфейс.
    expect(дерево[0].replies[0].parentContent).toBe("А что с левой стороной?");
  });

  it("закрытый ролик не пускает к обсуждению", async () => {
    // Проверка стоит до сборки дерева: иначе открытый вход стал бы
    // способом читать комментарии под чужим черновиком.
    const в = await ролик({ visibility: "private", publishedAt: null });
    await expect(getPublicVideoRaw(в._id)).rejects.toThrow();
  });

  it("архивный ролик не пускает к обсуждению", async () => {
    const в = await ролик({ archivedAt: new Date(), archiveReason: "жалоба" });
    await expect(getPublicVideoRaw(в._id)).rejects.toThrow();
  });

  it("открытый ролик пускает", async () => {
    const в = await ролик();
    const найден = await getPublicVideoRaw(в._id);
    expect(String(найден._id)).toBe(String(в._id));
  });
});
