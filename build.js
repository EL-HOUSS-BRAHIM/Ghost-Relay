const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');

const srcDir = path.join(__dirname, 'src');
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
}

async function buildCSS() {
  const cssPath = path.join(srcDir, 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const result = await postcss([tailwindcss, autoprefixer]).process(css, {
    from: cssPath,
    to: path.join(srcDir, 'bundle.css'),
    map: false,
  });

  fs.writeFileSync(path.join(srcDir, 'bundle.css'), result.css);
  console.log('CSS bundle created');
}

async function buildJS() {
  await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    outfile: 'src/bundle.js',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: false,
    minify: true,
    treeShaking: true,
    define: {
      global: 'window',
      'process.env.NODE_ENV': '"production"',
    },
    loader: {
      '.wasm': 'file',
      '.css': 'css',
      '.mp3': 'file',
    },
  });
  console.log('JS bundle created');
}

async function buildAll() {
  try {
    await Promise.all([buildCSS(), buildJS()]);
    console.log('Build complete');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildAll();
