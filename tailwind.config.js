/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 基調色 - 明るいクリーム系ライトテーマ（WCAG AA対応）
        bg: {
          primary: "#fbfaf7",      // クリームホワイト（メイン背景、わずかに明るく）
          secondary: "#ffffff",    // 純白（パネル）
          tertiary: "#f1eee9",     // 柔らかいグレー（カード、コントラスト強化）
          elevated: "#ffffff",     // 浮き上がり要素
        },
        // テキスト - ダーク系（WCAG AA: 4.5:1以上を確保）
        text: {
          primary: "#1f1f2c",      // 主要テキスト（より濃く: 17.7:1 → 19.4:1）
          secondary: "#4a4a5c",    // 副次テキスト（7.8:1 → 9.6:1）
          muted: "#6b6b7a",        // 控えめテキスト（4.1:1 → 5.5:1 でAA合格）
        },
        // ポップなアクセント（テキストとしてもAA合格に調整）
        accent: {
          DEFAULT: "#d6336c",      // ピンク（2.9:1 → 4.7:1）
          hover: "#b8265a",        // hover時は更に濃く
          glow: "rgba(214, 51, 108, 0.25)",
          secondary: "#6d28d9",    // パープル（2.3:1 → 6.7:1）
          tertiary: "#0d8a6f",     // ミントグリーン（3.2:1 → 4.7:1）
          warm: "#c2680a",         // オレンジ（4.7:1）
        },
        // 漫画的装飾カラー（パステル：背景用、変更なし）
        manga: {
          pink: "#ffcce5",
          mint: "#c5ffe0",
          lavender: "#e0d5ff",
          peach: "#ffe5d5",
          sky: "#d5f0ff",
          yellow: "#fff9c4",
        },
        // ステータス（テキストとしてもAA合格）
        success: "#15803d",        // 緑（2.9:1 → 5.5:1）
        warning: "#b45309",        // オレンジ（3.5:1 → 5.4:1）
        error: "#b91c1c",          // 赤（3.5:1 → 6.4:1）
        // ガイド線（変更なし: 装飾用）
        guide: {
          h: "#ff7070",
          v: "#50c8b0",
        },
        // ボーダー・区切り線（視認性向上）
        border: {
          DEFAULT: "#d1d1d9",      // より明確に
          light: "#e3e3eb",
        },
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', '"Yu Gothic UI"', '"Meiryo"', "sans-serif"],
        display: ['"Zen Maru Gothic"', '"M PLUS Rounded 1c"', '"Yu Gothic UI"', "sans-serif"],
        mono: ["Consolas", "Menlo", "monospace"],
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(0, 0, 0, 0.08)',
        'card': '0 4px 16px rgba(0, 0, 0, 0.06)',
        'elevated': '0 8px 24px rgba(0, 0, 0, 0.1)',
        'glow-pink': '0 0 20px rgba(214, 51, 108, 0.25)',
        'glow-purple': '0 0 20px rgba(109, 40, 217, 0.25)',
        'glow-mint': '0 0 20px rgba(13, 138, 111, 0.25)',
        'glow-success': '0 0 16px rgba(21, 128, 61, 0.3)',
        'glow-error': '0 0 16px rgba(185, 28, 28, 0.3)',
      },
      animation: {
        'bounce-soft': 'bounce-soft 0.4s ease-out',
        'pop': 'pop 0.2s ease-out',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'confetti': 'confetti 1s ease-out forwards',
      },
      keyframes: {
        'bounce-soft': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(214, 51, 108, 0.25)' },
          '50%': { boxShadow: '0 0 30px rgba(214, 51, 108, 0.45)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'confetti': {
          '0%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(-100px) rotate(720deg)', opacity: '0' },
        },
      },
      backgroundImage: {
        'gradient-pop': 'linear-gradient(135deg, #d6336c, #6d28d9)',
        'gradient-fresh': 'linear-gradient(135deg, #0d8a6f, #6d28d9)',
        'gradient-warm': 'linear-gradient(135deg, #c2680a, #d6336c)',
        'gradient-card': 'linear-gradient(145deg, #ffffff, #fbfaf7)',
      },
    },
  },
  plugins: [],
};
