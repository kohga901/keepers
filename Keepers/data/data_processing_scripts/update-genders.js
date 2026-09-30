const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const dataDirectory = path.resolve(__dirname, '..');
const defaultInputPath = path.join(dataDirectory, 'clothing_csv', 'gender_updates.csv');
const inputArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const inputPath = inputArgument
  ? path.resolve(process.cwd(), inputArgument)
  : defaultInputPath;
const dryRun = process.argv.includes('--dry-run');
const batchSize = 100;

function parseCsvRow(line, lineNumber) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new Error(`Line ${lineNumber} contains an unterminated quoted field.`);
  }

  fields.push(field);
  return fields;
}

function readGenderUpdates(filePath) {
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('The CSV file is empty.');
  }

  const headers = parseCsvRow(lines[0].line, lines[0].lineNumber).map((header) =>
    header.trim()
  );
  const columnIndex = Object.fromEntries(headers.map((header, index) => [header, index]));
  const requiredColumns = ['item_id', 'item_gender'];
  const missingColumns = requiredColumns.filter((column) => columnIndex[column] === undefined);

  if (missingColumns.length > 0) {
    throw new Error(`Missing required CSV column(s): ${missingColumns.join(', ')}`);
  }

  const updates = [];
  const seenIds = new Set();

  for (const { line, lineNumber } of lines.slice(1)) {
    const fields = parseCsvRow(line, lineNumber);
    const rawItemId = fields[columnIndex.item_id]?.trim();
    const gender = fields[columnIndex.item_gender]?.trim();
    const itemId = Number(rawItemId);

    if (!rawItemId || !Number.isSafeInteger(itemId) || !gender) {
      throw new Error(`Line ${lineNumber} must contain an integer item_id and a non-empty item_gender.`);
    }

    if (seenIds.has(itemId)) {
      throw new Error(`Line ${lineNumber} contains duplicate item_id ${itemId}.`);
    }

    seenIds.add(itemId);
    updates.push({ itemId, gender });
  }

  return updates;
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_KEY;

  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or the corresponding project key) before running.'
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

async function updateGenders(updates) {
  const updatesByGender = new Map();

  for (const update of updates) {
    const itemIds = updatesByGender.get(update.gender) || [];
    itemIds.push(update.itemId);
    updatesByGender.set(update.gender, itemIds);
  }

  const supabase = getSupabaseClient();
  let updatedCount = 0;

  for (const [gender, itemIds] of updatesByGender) {
    for (let offset = 0; offset < itemIds.length; offset += batchSize) {
      const batch = itemIds.slice(offset, offset + batchSize);
      const { data, error } = await supabase
        .from('Clothing')
        .update({ item_gender: gender })
        .in('item_id', batch)
        .select('item_id');

      if (error) {
        throw new Error(`Failed updating gender '${gender}': ${error.message}`);
      }

      updatedCount += data.length;
    }
  }

  return updatedCount;
}

async function main() {
  const updates = readGenderUpdates(inputPath);
  console.log(`Read ${updates.length} gender updates from ${inputPath}`);

  if (dryRun) {
    console.log('Dry run: no database changes were made.');
    return;
  }

  const updatedCount = await updateGenders(updates);
  if (updatedCount !== updates.length) {
    throw new Error(
      `Updated ${updatedCount} rows, but the CSV contained ${updates.length} rows. Check that every item_id exists in Clothing.`
    );
  }

  console.log(`Updated ${updatedCount} Clothing rows.`);
}

main().catch((error) => {
  console.error(`Unable to update genders: ${error.message}`);
  process.exitCode = 1;
});
