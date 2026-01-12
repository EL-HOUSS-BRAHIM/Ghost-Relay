#!/bin/bash

# Test script to verify the build process works locally

echo "🔧 Testing Ghost Relay build process..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

# Check if npm is available  
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ Node.js and npm are available"

# Install dependencies
echo "📦 Installing npm dependencies..."
npm install

# Check if tauri CLI is available after installation
if ! npx tauri --version &> /dev/null; then
    echo "❌ Tauri CLI is not available after npm install"
    exit 1
fi

echo "✅ Tauri CLI is available"

# Test the bundle process
echo "🎯 Testing bundle creation..."
npm run bundle

if [ ! -f "src/bundle.js" ]; then
    echo "❌ Bundle creation failed - bundle.js not found"
    exit 1
fi

echo "✅ Bundle created successfully"

# Check if we can run tauri info (doesn't build, just checks config)
echo "🔍 Testing Tauri configuration..."
npx tauri info

echo "✅ All tests passed! The build process should work in GitHub Actions."