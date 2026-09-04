// This app has no Tailwind and needs no PostCSS plugins beyond autoprefixer —
// but PostCSS searches UP the directory tree for a config, and the repo root
// holds one (belonging to a stray copy of the quote app) that loads
// @tailwindcss/postcss. That plugin is installed only in the ROOT node_modules,
// so the build worked on this machine and failed anywhere the root install had
// not been run: "Failed to load PostCSS config ... Cannot find module
// '@tailwindcss/postcss'". Found by building the app from a clean checkout.
//
// A config here stops the search at the app, so the app builds from its own
// package.json alone.
module.exports = {
  plugins: {
    autoprefixer: {},
  },
}
