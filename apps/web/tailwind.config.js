/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  // The rest of admin-web is an internal tool styled entirely with inline
  // style objects (components/ui.js) — Preflight's global element resets
  // (margins, headings, form-control defaults, etc.) would ripple into
  // every one of those already-built, already-tested pages. Disabling it
  // scopes Tailwind to opt-in utility classes only; register.js (the one
  // page that actually uses Tailwind) sets its own resets locally instead.
  corePlugins: { preflight: false },
  theme: {
    extend: {}
  },
  plugins: []
};
