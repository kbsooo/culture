/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // One accent: warm gold — timeless, cinematic, editorial
        accent: {
          DEFAULT: 'var(--accent)',
          muted: 'var(--accent-muted)',
        },
      },
      gridTemplateColumns: {
        cards: 'repeat(auto-fill, minmax(175px, 1fr))',
      },
      letterSpacing: {
        label: '0.15em',
      },
    },
  },
  plugins: [],
};
