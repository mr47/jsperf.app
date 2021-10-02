import hljs from 'highlight.js'
import DOMPurify from 'isomorphic-dompurify'
import crypto from 'crypto'

export const highlightSanitizedJS = js => {
  return DOMPurify.sanitize(hljs.highlight(js, {
    language: 'js', ignoreIllegals: true
  }).value)
}

export const highlightSanitizedHTML = (html) => {
  const token = crypto.randomBytes(20).toString('hex')

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
