import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URL);
const CT = mongoose.model('ContentTranslation', new mongoose.Schema({}, { strict: false }), 'contenttranslations');

const docs = await CT.find({ entityType: 'ArticleScine', language: 'en' }).select('entityId title').limit(3).lean();
console.log(JSON.stringify(docs, null, 2));

await mongoose.disconnect();
process.exit(0);
