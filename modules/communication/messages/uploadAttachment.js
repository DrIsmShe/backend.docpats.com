// client/src/communication/api/uploadAttachment.js

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:11000";

/**
 * Загружает один файл на сервер через HTTP multipart.
 * Возвращает данные для передачи в socket "message:send" → attachments[].
 *
 * @param {File} file
 * @param {string} dialogId
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{
 *   url: string,
 *   originalName: string,
 *   mimeType: string,
 *   fileSizeBytes: number,
 *   type: "file"
 * }>}
 */
export function uploadAttachment(file, dialogId, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("dialogId", dialogId);

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Ошибка парсинга ответа сервера"));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.message || `Ошибка ${xhr.status}`));
        } catch {
          reject(new Error(`Ошибка сервера: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("Ошибка сети при загрузке файла"));
    xhr.onabort = () => reject(new Error("Загрузка отменена"));

    // ✅ Правильный путь: /messages/upload (а не /upload)
    xhr.open("POST", `${API_URL}/communication/messages/upload`);
    xhr.withCredentials = true;
    xhr.send(formData);
  });
}
