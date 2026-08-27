/** Pierre imports `createHighlighter` and helpers from `shiki`. Re-export those
 *  without `bundledLanguages` from the full registry; the curated map lives in
 *  `pierre-bundled-languages.ts`. */
export {
  codeToHtml,
  createCssVariablesTheme,
  createHighlighter,
  createJavaScriptRegexEngine,
  createOnigurumaEngine,
  getTokenStyleObject,
  stringifyTokenStyle,
} from 'shiki';
export { bundledLanguages } from './pierre-bundled-languages';
