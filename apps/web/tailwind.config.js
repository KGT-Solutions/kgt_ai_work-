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
        },

        // ── Orb Console design system (see ./07_Orb_Console_Design_System.md §2) ──
        // ADDITIVE and namespaced: these never touch the dark tokens above, so
        // existing pages are unaffected. Use `orb-*` only inside `.orb-theme`
        // subtrees and the parallel `components/orb/` primitives.
        orb: {
          ink: '#202020',          // main text, primary buttons, markers
          white: '#FFFFFF',        // cards, panels, inputs
          yellow: '#F2F05C',       // "needs you" / current step. Dark text only
          blue: '#5C5EF2',         // Booked pill, Orb accent. White text on it
          'blue-tint': '#C6C7FA',  // Orb messages, Tint pills
          base: '#EEEEEE',         // page background behind cards
          subtle: '#F6F6F6',       // notes, table headers, code boxes
          hairline: '#E8E8E8',     // card borders and dividers
          'light-grey': '#DEDEDE', // visitor messages in chat only
          stroke: '#909090',       // input/select/secondary-button/chip borders
          secondary: '#5C5C5C',    // descriptions, helper text, captions
          tertiary: '#767676'      // placeholders, timestamps (lightened per Gap 5)
        }
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        // Orb fonts (§3.1) — additive. Inter everywhere, Montserrat for page titles, JetBrains Mono for code.
        'orb-sans': ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        'orb-display': ['Montserrat', 'Inter', 'system-ui', 'sans-serif'],
        'orb-mono': ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(47,122,232,0.25), 0 8px 40px -8px rgba(47,122,232,0.35)',
        'glow-green': '0 0 0 1px rgba(34,197,94,0.25), 0 8px 40px -8px rgba(34,197,94,0.35)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 40px -24px rgba(0,0,0,0.8)',
        // Orb elevations (§6) — additive. Shadows use #202020 at the stated opacity; cards have none.
        'orb-raised': '0 1px 2px rgba(32,32,32,0.05), 0 0 0 1px rgba(32,32,32,0.08)',
        'orb-shell': '0 1px 3px rgba(32,32,32,0.04), 0 0 0 1px rgba(32,32,32,0.07)',
        'orb-pop': '0 8px 24px rgba(32,32,32,0.10), 0 0 0 1px rgba(32,32,32,0.08)',
        'orb-panel': '0 12px 32px rgba(32,32,32,0.08)',
        'orb-dialog': '0 16px 48px rgba(32,32,32,0.18)'
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
