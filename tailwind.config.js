/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        retro: {
          bg: "#08080f",
          card: "#0d0e1a",
          border: "#1e2238",
          cyan: "#00f0ff",
          magenta: "#ff007f",
          yellow: "#ffe600",
          green: "#00ff66",
          red: "#ff2244",
          amber: "#ff9900",
          purple: "#9d00ff",
          muted: "#6b7280"
        }
      },
      fontFamily: {
        display: ['var(--font-titan-one)', 'cursive'],
        sans: ['var(--font-inter)', 'ui-sans-serif', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        pixel: ['var(--font-pixel)', 'monospace'],
        retro: ['var(--font-retro)', 'monospace'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'neon-cyan': '0 0 10px rgba(0, 240, 255, 0.5), 0 0 20px rgba(0, 240, 255, 0.3)',
        'neon-magenta': '0 0 10px rgba(255, 0, 127, 0.5), 0 0 20px rgba(255, 0, 127, 0.3)',
        'neon-yellow': '0 0 10px rgba(255, 230, 0, 0.5), 0 0 20px rgba(255, 230, 0, 0.3)',
        'neon-green': '0 0 10px rgba(0, 255, 102, 0.5), 0 0 20px rgba(0, 255, 102, 0.3)',
        'neon-red': '0 0 10px rgba(255, 34, 68, 0.5), 0 0 20px rgba(255, 34, 68, 0.3)',
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flicker': 'flicker 0.15s infinite',
        'glitch': 'glitch 1s linear infinite',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.85' },
        },
        glitch: {
          '0%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' },
        }
      }
    },
  },
  plugins: [],
}
