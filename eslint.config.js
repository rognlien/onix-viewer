// ESLint, flat config. The shipped scripts run in a page or as content
// scripts; the tools and tests run in node. The generated data files are
// tables, not code, and are skipped.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "Resources/onix-codelists.js",
      "Resources/onix-content-model-*.js",
      "dist/**", "site/**", "node_modules/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["Resources/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, chrome: "readonly", browser: "readonly", OnixViewerShell: "readonly" },
    },
  },
  {
    files: ["tools/**/*.js", "tests/**/*.js", "eslint.config.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
];
