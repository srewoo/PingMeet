/**
 * Package script for creating distributable .zip
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPath = path.join(__dirname, '..', 'dist', 'pingmeet.zip');
const sourceDir = path.join(__dirname, '..');

// Create dist directory if it doesn't exist
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

// Create a file to stream archive data to
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', {
  zlib: { level: 9 }, // Maximum compression
});

console.log('📦 Packaging PingMeet for distribution...\n');

output.on('close', () => {
  console.log(`✅ Package created: ${outputPath}`);
  console.log(`   Size: ${(archive.pointer() / 1024).toFixed(2)} KB\n`);
  console.log('Ready to upload to Chrome Web Store! 🚀\n');
});

archive.on('error', err => {
  throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Add files and directories, excluding unnecessary items
archive.glob('**/*', {
  cwd: sourceDir,
  ignore: [
    'node_modules/**',
    'dist/**',
    '.git/**',
    '.gitignore',
    'package-lock.json',
    'plan.md',
    'test/**',
    '.eslintrc.json',
    '.prettierrc.json',
    'scripts/**',
  ],
});

archive.finalize();

