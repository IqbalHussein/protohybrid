import type { Config } from "tailwindcss";

// Colour carries meaning: blue is always running, orange is always lifting.
// Conflicts use an inverted chalk treatment so they never read as "lift".
const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#000000",
          raised: "#141519",
          sunken: "#0A0A0C",
          line: "#2B2D34",
          "line-strong": "#62666F",
        },
        chalk: {
          DEFAULT: "#F4F5F7",
          muted: "#A3A8B3",
          faint: "#80858F",
        },
        run: {
          DEFAULT: "#4D8DFF",
          strong: "#86B0FF",
          soft: "rgb(77 141 255 / 0.14)",
        },
        lift: {
          DEFAULT: "#FF7A1A",
          strong: "#FFA05C",
          soft: "rgb(255 122 26 / 0.14)",
        },
        danger: "#FF6B6B",
      },
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        control: "6px",
        panel: "10px",
      },
    },
  },
  plugins: [],
};

export default config;
