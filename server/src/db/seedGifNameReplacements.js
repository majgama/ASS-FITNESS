import fs from 'node:fs/promises';

// Match previous names so later manual edits are never overwritten on restart.
export async function seedGifNameReplacements(client) {
  const replacements = JSON.parse(await fs.readFile(new URL('../data/gif-name-replacements.json', import.meta.url), 'utf8'));
  if (!replacements.length) return;
  const data = JSON.stringify(replacements);
  await client.query(
    `UPDATE gif_library_overrides AS target
     SET name_pt = replacement.name, updated_at = now()
     FROM jsonb_to_recordset($1::jsonb) AS replacement(id text, name text, "previousNames" jsonb)
     WHERE target.gif_id = replacement.id
       AND replacement."previousNames" ? target.name_pt`,
    [data]
  );
  await client.query(
    `UPDATE gif_library_uploads AS target
     SET name_pt = replacement.name
     FROM jsonb_to_recordset($1::jsonb) AS replacement(id text, name text, "previousNames" jsonb)
     WHERE target.id::text = replacement.id
       AND replacement."previousNames" ? target.name_pt`,
    [data]
  );
}
