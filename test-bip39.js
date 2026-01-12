// Test if bip39 is working
const bip39 = require('bip39');

try {
  console.log("Testing bip39...");
  const mnemonic = bip39.generateMnemonic(128);
  console.log("Generated mnemonic:", mnemonic);
  console.log("Word count:", mnemonic.split(' ').length);
  console.log("Is valid:", bip39.validateMnemonic(mnemonic));
} catch (error) {
  console.error("Error with bip39:", error);
}