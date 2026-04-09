import OpenAI from "openai";
import { splitTextIntoChunks } from "../../common/utils/chunkText.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------- utils --------

const parseJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("❌ JSON parse error:", text);
    throw new Error("Translation JSON parse error");
  }
};

// GPT иногда возвращает объект вместо строки для abstract (background/objective/...)
// Эта функция всегда возвращает строку
const normalizeField = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return Object.values(value).filter(Boolean).join(" ");
  }
  return String(value);
};

const cleanResponse = (text) => {
  return text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
};

// -------- ONE CHUNK --------

const translateSingle = async ({
  title,
  content,
  abstract = "",
  fromLanguage,
  toLanguage,
}) => {
  const prompt = `
Translate the following medical content from ${fromLanguage} to ${toLanguage}.

Rules:
- Keep medical terminology precise
- Do NOT shorten
- Return ONLY valid JSON with EXACTLY these three string fields: title, abstract, content
- abstract MUST be a single plain string, NOT an object with background/objective/methods/etc
- Do NOT add extra fields

{
  "title": "...",
  "abstract": "...",
  "content": "..."
}

TITLE:
${title}

ABSTRACT:
${abstract}

CONTENT:
${content}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "Return ONLY valid JSON.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
  });

  let text = response.choices?.[0]?.message?.content?.trim() || "";

  if (!text) throw new Error("Empty response");

  text = cleanResponse(text);

  return parseJSON(text);
};

// -------- CHUNKS (parallel) --------

const translateChunks = async ({ chunks, fromLanguage, toLanguage }) => {
  const results = await Promise.all(
    chunks.map((chunk) =>
      translateSingle({
        title: "",
        content: chunk,
        abstract: "",
        fromLanguage,
        toLanguage,
      }),
    ),
  );

  return results.map((r) => r.content).join("\n\n");
};

// -------- MAIN --------

export const translateWithAI = async ({
  title,
  content,
  abstract = "",
  fromLanguage,
  toLanguage,
}) => {
  try {
    const chunks = splitTextIntoChunks(content, 4000);

    // 🔥 короткий текст → обычный перевод
    if (chunks.length === 1) {
      const result = await translateSingle({
        title,
        content,
        abstract,
        fromLanguage,
        toLanguage,
      });

      return {
        title: normalizeField(result.title),
        abstract: normalizeField(result.abstract),
        content: normalizeField(result.content),
      };
    }

    // 🔥 длинный текст → параллельный chunk перевод
    const [translatedContent, meta] = await Promise.all([
      translateChunks({ chunks, fromLanguage, toLanguage }),
      translateSingle({
        title,
        abstract,
        content: chunks[0].slice(0, 500),
        fromLanguage,
        toLanguage,
      }),
    ]);

    return {
      title: normalizeField(meta.title),
      abstract: normalizeField(meta.abstract),
      content: translatedContent,
    };
  } catch (error) {
    console.error("❌ Chunk translation failed:", error.message);

    return {
      title,
      abstract,
      content,
    };
  }
};
