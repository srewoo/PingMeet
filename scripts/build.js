/**
 * Build script for PingMeet
 * Currently just validates the structure
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔨 Building PingMeet...\n');

// Validate manifest.json
try {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log('✅ manifest.json is valid');
  console.log(`   Name: ${manifest.name} v${manifest.version}`);
} catch (error) {
  console.error('❌ Error reading manifest.json:', error.message);
  process.exit(1);
}

// Check required directories
const requiredDirs = ['src', 'assets', 'test'];
for (const dir of requiredDirs) {
  const dirPath = path.join(__dirname, '..', dir);
  if (fs.existsSync(dirPath)) {
    console.log(`✅ ${dir}/ directory exists`);
  } else {
    console.warn(`⚠️  ${dir}/ directory missing`);
  }
}

console.log('\n✨ Build complete!\n');
console.log('To load in Chrome:');
console.log('1. Navigate to chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked"');
console.log('4. Select the PingMeet directory\n');

