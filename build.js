const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Ensure src directory exists
const srcDir = path.join(__dirname, 'src');
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
}

// Bundle the main.js file with all dependencies
esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  outfile: 'src/bundle.js',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  external: [],
  define: {
    'global': 'window',
    'process.env.NODE_ENV': '"production"'
  },
  loader: {
    '.wasm': 'file',
    '.js': 'jsx'
  }
}).then(() => {
  console.log('Bundle created successfully!');
  
  // Update index.html to use bundle.js
  const indexPath = path.join(__dirname, 'src', 'index.html');
  let indexContent = fs.readFileSync(indexPath, 'utf8');
  
  // Replace the script tag to use regular script instead of module
  indexContent = indexContent.replace(
    '<script type="module" src="./main.js"></script>',
    '<script src="./bundle.js"></script>'
  );
  
  fs.writeFileSync(indexPath, indexContent);
  console.log('index.html updated to use bundle.js');
}).catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
