import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const fullDatasetPath = fs.existsSync(path.join(rootDir, 'data', 'books_dataset.json'))
  ? path.join(rootDir, 'data', 'books_dataset.json')
  : path.join(rootDir, 'public', 'data', 'books_dataset.json');
const chunksDir = path.join(rootDir, 'public', 'data', 'chunks');

console.log('Partitioning dataset from:', fullDatasetPath);

if (!fs.existsSync(fullDatasetPath)) {
  console.error('Dataset not found at:', fullDatasetPath);
  process.exit(1);
}

if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir, { recursive: true });
}

console.log('Reading full dataset JSON into memory...');
const raw = fs.readFileSync(fullDatasetPath, 'utf8');
const dataset = JSON.parse(raw);

const isbns = Object.keys(dataset);
console.log(`Total ISBN keys: ${isbns.length}`);

const partitions = {};

isbns.forEach(isbn => {
  // Use first 4 characters of clean ISBN as chunk prefix (e.g. "9780", "0195", "0374")
  const prefix = isbn.slice(0, 4);
  if (!partitions[prefix]) {
    partitions[prefix] = {};
  }
  partitions[prefix][isbn] = dataset[isbn];
});

const prefixes = Object.keys(partitions);
console.log(`Partitioning into ${prefixes.length} chunk files...`);

let chunkCount = 0;
prefixes.forEach(prefix => {
  const chunkPath = path.join(chunksDir, `${prefix}.json`);
  fs.writeFileSync(chunkPath, JSON.stringify(partitions[prefix]));
  chunkCount++;
});

console.log(`Successfully written ${chunkCount} chunk files in ${chunksDir}!`);
