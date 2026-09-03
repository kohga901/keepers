const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(path.dirname(process.argv[1]), '..');
const inputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(projectRoot, 'data', 'coordinates.csv');
const outputPath = process.argv[3]
  ? path.resolve(process.cwd(), process.argv[3])
  : path.join(projectRoot, 'data', 'nodeData.json');

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

function convertCoordinates(csvText) {
  const lines = csvText
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
  const requiredColumns = ['item_id', 'x', 'y'];
  const missingColumns = requiredColumns.filter((column) => columnIndex[column] === undefined);

  if (missingColumns.length > 0) {
    throw new Error(`Missing required CSV column(s): ${missingColumns.join(', ')}`);
  }

  const seenIds = new Set();

  return lines.slice(1).map(({ line, lineNumber }) => {
    const fields = parseCsvRow(line, lineNumber);
    const rawClothesId = fields[columnIndex.item_id]?.trim();
    const rawX = fields[columnIndex.x]?.trim();
    const rawY = fields[columnIndex.y]?.trim();
    const clothesId = Number(rawClothesId);
    const x = Number(rawX);
    const y = Number(rawY);

    if (
      !rawClothesId ||
      !rawX ||
      !rawY ||
      !Number.isInteger(clothesId) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      throw new Error(`Line ${lineNumber} must contain an integer item_id and finite x/y values.`);
    }

    if (seenIds.has(clothesId)) {
      throw new Error(`Line ${lineNumber} contains duplicate item_id ${clothesId}.`);
    }

    seenIds.add(clothesId);
    return { clothesId, x, y };
  });
}

try {
  const csvText = fs.readFileSync(inputPath, 'utf8');
  const nodeData = convertCoordinates(csvText);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(nodeData)}\n`, 'utf8');

  console.log(`Converted ${nodeData.length} rows from ${inputPath}`);
  console.log(`Wrote node data to ${outputPath}`);
} catch (error) {
  console.error(`Unable to convert coordinates: ${error.message}`);
  process.exitCode = 1;
}
