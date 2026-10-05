import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const csvPath = path.join(rootDir, 'data', 'archive (1)', 'Books.csv');
console.log('Reading dataset from:', csvPath);

if (!fs.existsSync(csvPath)) {
  console.error('Books.csv not found at:', csvPath);
  process.exit(1);
}

const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity
});

let count = 0;
let validCount = 0;
const database = {};

/**
 * Split CSV line handling quotes correctly
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

rl.on('line', (line) => {
  count++;
  if (count === 1) return; // Skip header

  const parts = parseCSVLine(line);
  if (parts.length < 5) return;

  const clean = (str) => str ? str.replace(/^"|"$/g, '').trim() : '';

  const rawIsbn = clean(parts[0]);
  const isbn = rawIsbn.replace(/[^0-9X]/gi, '').toUpperCase();
  const title = clean(parts[1]);
  const author = clean(parts[2]);
  const year = clean(parts[3]);
  const publisher = clean(parts[4]);

  let coverUrl = null;
  if (parts[7] && parts[7].length > 10) {
    coverUrl = clean(parts[7]).replace('http:', 'https:');
  } else if (parts[6] && parts[6].length > 10) {
    coverUrl = clean(parts[6]).replace('http:', 'https:');
  }

  if (isbn && title && title.length > 1 && !title.toLowerCase().includes('unknown')) {
    validCount++;
    const bookObj = {
      isbn,
      title,
      authors: author ? [author] : ['Unknown Author'],
      publisher: publisher || 'Unknown Publisher',
      publishDate: year || 'N/A',
      coverUrl: coverUrl || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
      source: 'Institutional Library Dataset (Books.csv)'
    };

    database[isbn] = bookObj;

    // Convert ISBN-10 to ISBN-13 (e.g. 0195153448 -> 9780195153445)
    if (isbn.length === 10 && /^\d{9}[\dX]$/i.test(isbn)) {
      const isbn13Base = '978' + isbn.slice(0, 9);
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += parseInt(isbn13Base[i], 10) * (i % 2 === 0 ? 1 : 3);
      }
      const checkDigit = (10 - (sum % 10)) % 10;
      const isbn13 = isbn13Base + checkDigit;

      database[isbn13] = { ...bookObj, isbn: isbn13 };
    }
  }
});

rl.on('close', () => {
  console.log(`Finished reading. Parsed ${count} lines, indexed ${Object.keys(database).length} total ISBN keys.`);

  const outDir = path.join(rootDir, 'public', 'data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Save main catalog JSON file
  const outPath = path.join(outDir, 'books_dataset.json');
  fs.writeFileSync(outPath, JSON.stringify(database));
  console.log(`Saved indexed dataset to ${outPath} (${(fs.statSync(outPath).size / (1024 * 1024)).toFixed(2)} MB)`);
});
