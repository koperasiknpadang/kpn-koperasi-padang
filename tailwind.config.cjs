/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sage: { 50: "#f4f7f2", 100: "#e8eee4", 200: "#d4dfce", 500: "#718b70", 600: "#5c765d", 700: "#435d49" },
        ink: "#24332e",
        mist: "#f7f8f5"
      },
      boxShadow: {
        soft: "0 12px 35px rgba(37, 55, 43, 0.07)"
      }
    }
  },
  plugins: []
};