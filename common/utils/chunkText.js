export const splitTextIntoChunks = (text, maxLength = 4000) => {
  if (!text) return [];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLength;

    // 🔥 стараемся резать по предложениям
    const lastDot = text.lastIndexOf(".", end);

    if (lastDot > start) {
      end = lastDot + 1;
    }

    chunks.push(text.slice(start, end).trim());
    start = end;
  }

  return chunks;
};
