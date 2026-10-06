/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif:  ['"Instrument Serif"', 'Georgia', 'serif'],
        sans:   ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono:   ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        vault: {
          bg:       '#060d18',
          surface:  '#0a1628',
          panel:    'rgba(10,16,26,0.7)',
          border:   'rgba(148,163,184,0.09)',
          green:    '#1a8a5e',
          'green-light': '#34d399',
          gold:     '#C9A84C',
        },
      },
    },
  },
  plugins: [],
};
