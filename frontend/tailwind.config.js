/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: {
          950: '#07110a',
          900: '#0c1d12',
          800: '#133220',
          700: '#1a472d',
          600: '#225e3b',
          500: '#2f7d51',
        },
        chip: {
          gold: '#f6c453',
          red: '#dc4c64',
          blue: '#55b6ff',
          green: '#36c986',
        },
      },
      boxShadow: {
        felt: '0 20px 50px rgba(0, 0, 0, 0.35)',
      },
      fontFamily: {
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
