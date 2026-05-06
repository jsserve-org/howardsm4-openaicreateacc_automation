import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,js,jsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#09090b',
          elev: '#101013',
          panel: '#0d0d10',
          hairline: '#1c1c20',
          hairlineHi: '#28282d',
        },
        ink: {
          DEFAULT: '#e9e9ec',
          muted: '#85858d',
          dim: '#4a4a52',
        },
        accent: {
          lime: '#b6ff36',
          limeDim: '#7eb324',
          hazard: '#f4cf3f',
          hazardInk: '#1a1502',
          danger: '#ff5c5c',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        serif: ['var(--font-serif)', 'Times New Roman', 'serif'],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
      animation: {
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 320ms ease-out both',
        'slide-up': 'slideUp 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
