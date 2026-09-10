import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EFF1EC",
        ink: "#1B2430",
        surface: "#FBFBF8",
        highlight: "#F2C94C",
        pen: "#3A6EA5",
        alert: "#B23A3A",
        "ink-faint": "#5B6472",
        "line": "#D8DBD3",
      },
      fontFamily: {
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-plex-sans)", "ui-sans-serif", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
