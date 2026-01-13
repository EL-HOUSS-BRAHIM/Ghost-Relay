/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js}",
  ],
  theme: {
    extend: {
      colors: {
        'deep': '#0a0a0f',
        'deep-light': '#14141f',
        'metal-white': '#ffffff',
        'metal-silver': '#c0c0c0',
        'metal-platinum': '#e5e5e5',
        'metal-chrome': '#d4d4d8',
        'glass-dark': 'rgba(20, 20, 31, 0.6)',
        'glass-border': 'rgba(255, 255, 255, 0.1)',
      },
      backgroundImage: {
        'metal-gradient': 'linear-gradient(135deg, #ffffff 0%, #c0c0c0 100%)',
        'metal-shine': 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 50%, transparent 100%)',
      },
      backdropBlur: {
        'glass': '20px',
      },
      animation: {
        'shine': 'shine 2s ease-in-out infinite',
        'blob': 'blob 3s ease-in-out infinite',
        'ripple': 'ripple 0.6s ease-out',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
      keyframes: {
        shine: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        blob: {
          '0%, 100%': { transform: 'scale(1) rotate(0deg)' },
          '33%': { transform: 'scale(1.1) rotate(120deg)' },
          '66%': { transform: 'scale(0.9) rotate(240deg)' },
        },
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '1' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' },
        },
      },
    },
  },
  plugins: [],
}
