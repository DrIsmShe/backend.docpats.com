import multer from "multer";
import fs from "fs";
import path from "path";

// Папка для загрузки файлов
const uploadDir = "uploads";

// Убедимся, что папка существует
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Настройка `multer`
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const fileExt = path.extname(file.originalname);
    const fileName = `${Date.now()}-${file.originalname}`;
    cb(null, fileName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
    const isValidExt = allowedTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const isValidMime = allowedTypes.test(file.mimetype);

    if (isValidExt && isValidMime) {
      cb(null, true);
    } else {
      cb(new Error("Можно загружать только изображения и PDF!"));
    }
  },
});

// Контроллер загрузки PDF
export const uploadPDF = (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Ошибка загрузки файла", error: err.message });
    }
    res.json({
      message: "Файл загружен!",
      fileUrl: `/uploads/${req.file.filename}`,
    });
  });
};

// Контроллер для получения PDF по имени файла
export const getPDF = (req, res) => {
  const fileName = req.params.fileName;
  const filePath = path.join(uploadDir, fileName);

  if (fs.existsSync(filePath)) {
    res.sendFile(path.resolve(filePath));
  } else {
    res.status(404).json({ message: "Файл не найден" });
  }
};
const downloadPDF = async () => {
  const element = pdfRef.current;

  const canvas = await html2canvas(element, {
    useCORS: true, // ✅ позволяет загружать изображения с сервера
    allowTaint: true, // ✅ допускает "загрязнение" кэша для кастомных URL
    scale: 2, // ✅ увеличивает качество PDF
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const imgWidth = 190;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  pdf.addImage(imgData, "PNG", 10, 10, imgWidth, imgHeight);
  pdf.save(`${history?.diagnosis || "medical_history"}.pdf`);
};
