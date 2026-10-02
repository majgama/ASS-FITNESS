import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const updatesPath = path.resolve(__dirname, '..', 'data', 'gif-name-translation-updates.json');

export async function seedGifTranslationUpdates(client) {
  const updates = JSON.parse(await fs.readFile(updatesPath, 'utf8'));
  if (updates.length === 0) return;

  await client.query(
    `INSERT INTO gif_library_translation_updates (gif_id, translated_at)
     SELECT * FROM unnest($1::text[], $2::date[])
     ON CONFLICT (gif_id) DO UPDATE
     SET translated_at = GREATEST(gif_library_translation_updates.translated_at, EXCLUDED.translated_at)`,
    [
      updates.map((update) => update.id),
      updates.map((update) => update.translatedAt)
    ]
  );
}