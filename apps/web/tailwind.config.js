/** @type {import('tailwindcss').Config} */
// KGT AI Hub design tokens. Dark-first: obsidian grounds, hairline borders,
// and the KGT Solutions logo's two colours as accents: `brand` is its blue
// (#1364D8 = brand-600, tints above for use on dark grounds) and Tailwind's
// own `green` is its green (#22C55E = green-500). Success states stay emerald. Chart series colors are separate (lib/chartColors.js)
// because they're validated for colorblind separation on the dark surface.
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}', './lib/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: '#090A0F',
        panel: { DEFAULT: '#0E1117', 2: '#12151D', 3: '#181C26' },
        line: { DEFAULT: '#1E2330', strong: '#2A3141' },
        fg: { DEFAULT: '#E7E9EE', 2: '#A0A8B8', 3: '#6B7385' },
        brand: {
          50: '#EEF5FF', 100: '#DCEAFE', 200: '#BBD5FD', 300: '#8CB9FA', 400: '#5596F3',
          500: '#2F7AE8', 600: '#1364D8', 700: '#0F50B0', 800: '#12438D', 900: '#143A72'
        }
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(47,122,232,0.25), 0 8px 40px -8px rgba(47,122,232,0.35)',
        'glow-green': '0 0 0 1px rgba(34,197,94,0.25), 0 8px 40px -8px rgba(34,197,94,0.35)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.8)'
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        'pulse-dot': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } }
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite'
      }
    }
  },
  plugins: []
};
