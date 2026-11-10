/**
 * Konfigurasi Tailwind CSS v3 (dulu ditulis inline untuk Tailwind CDN di index.html).
 * Build ulang setelah mengubah kelas di HTML/JS: npm run build:css
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './public/js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f2f3ff',
        'surface-container': '#eaedff',
        'surface-container-high': '#e2e7ff',
        'surface-container-highest': '#dae2fd',
        'surface': '#faf8ff',
        'surface-dim': '#d2d9f4',
        'surface-bright': '#faf8ff',
        'on-surface': '#131b2e',
        'on-surface-variant': '#3f4850',
        'outline': '#707881',
        'outline-variant': '#bfc7d2',
        'primary': '#006194',
        'on-primary': '#ffffff',
        'primary-container': '#007bb9',
        'on-primary-container': '#fdfcff',
        'primary-fixed': '#cce5ff',
        'primary-fixed-dim': '#93ccff',
        'on-primary-fixed': '#001d31',
        'on-primary-fixed-variant': '#004b73',
        'secondary': '#006a61',
        'on-secondary': '#ffffff',
        'secondary-container': '#86f2e4',
        'on-secondary-container': '#006f66',
        'tertiary': '#006947',
        'on-tertiary': '#ffffff',
        'tertiary-container': '#00855b',
        'on-tertiary-container': '#f5fff6',
        'error': '#ba1a1a',
        'error-container': '#ffdad6',
        'on-error': '#ffffff',
        'on-error-container': '#93000a'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        heading: ['Plus Jakarta Sans', 'sans-serif']
      }
    }
  }
};
