/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Alegreya Sans"', '"Noto Sans KR"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Newsreader"', '"Noto Serif KR"', 'ui-serif', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
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
