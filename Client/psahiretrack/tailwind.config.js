/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        tahoma: ['Tahoma', 'sans-serif'],
        times: ['"Times New Roman"', 'serif'],
        akeila: ['"Akeila"', 'Georgia', 'Palatino Linotype', 'Times New Roman', 'serif'],
		    arial: ['Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}