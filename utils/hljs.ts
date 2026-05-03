// @ts-nocheck
import hljs from 'highlight.js/lib/core'
import DOMPurify from 'isomorphic-dompurify'

import javascript from 'highlight.js/lib/languages/javascript'
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);

import typescript from 'highlight.js/lib/languages/typescript'
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);

import xml from 'highlight.js/lib/languages/xml'
hljs.registerLanguage('xml', xml);

import x86asm from 'highlight.js/lib/languages/x86asm'
hljs.registerLanguage('x86asm', x86asm);
hljs.registerLanguage('asm', x86asm);

hljs.configure({ ignoreUnescapedHTML: true })

const TYPESCRIPT_SYNTAX_RE = [
  /\btype\s+[$A-Z_a-z][$\w]*(?:\s*<[^>{}]*>)?\s*=/,
  /\binterface\s+[$A-Z_a-z][$\w]*(?:\s*<[^>{}]*>)?\s*{/,
  /\benum\s+[$A-Z_a-z][$\w]*\s*{/,
  /\b(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*:\s*[^=;\n]+[=;]/,
  /\bfunction\s+[$A-Z_a-z][$\w]*\s*(?:<[^>{}]*>)?\([^)]*:\s*[^)]*\)\s*(?::\s*[^{]+)?{/,
  /\)\s*:\s*[$A-Z_a-z][$\w]*(?:\[\])?\s*=>/,
  /\bas\s+const\b/,
  /\bas\s+[$A-Z_a-z][$\w]*(?:<[^>{}]*>)?/,
]

function normalizeCodeLanguage(language = 'javascript', code = '') {
  const requested = String(language || '').toLowerCase()
  if (requested === 'asm' || requested === 'x86asm' || requested === 'jit' || requested === 'v8') return 'x86asm'
  if (language === 'typescript' || language === 'ts') return 'ts'
  if (TYPESCRIPT_SYNTAX_RE.some(pattern => pattern.test(code || ''))) return 'ts'
  return 'js'
}

export function codeLanguageClass(language = 'javascript', code = '') {
  const normalized = normalizeCodeLanguage(language, code)
  if (normalized === 'x86asm') return 'hljs language-x86asm'
  return normalized === 'ts'
    ? 'hljs language-typescript'
    : 'hljs language-javascript'
}

export const highlightSanitizedJS = js => {
  return DOMPurify.sanitize(hljs.highlight(js, {
    language: 'js', ignoreIllegals: true
  }).value)
}

export const highlightSanitizedCode = (code, language = 'javascript') => {
  const normalized = normalizeCodeLanguage(language, code)
  return DOMPurify.sanitize(hljs.highlight(code, {
    language: normalized, ignoreIllegals: true
  }).value)
}

export const highlightSanitizedHTML = (html) => {
  const token = '@jsperfAppToken'

  const reScripts = new RegExp('(<script[^>]*?>)([\\s\\S]*?)(</script>)', 'gi');

  let swappedScripts = []

  const highlighted = hljs.highlight(
    html.replace(
      reScripts,
      (match, open, contents, close) => {
        // highlight JS inside script tags
        const highlightedContents = hljs.highlight(contents, {language: 'js', ignoreIllegals: true}).value
        // store to put back in place later
        swappedScripts.unshift(highlightedContents.replace(/&nbsp;$/, ''))
        // insert marker to replace shortly
        return `${open}${token}${close}`
      }
    ), {language: 'html', ignoreIllegals: true}
  ).value.replace(new RegExp(token, 'g'), () => swappedScripts.pop())

  return DOMPurify.sanitize(highlighted)
}

export default hljs
