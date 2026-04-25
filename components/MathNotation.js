function renderTerm(term, key) {
  const power = term.match(/^([a-zA-Z]+|\d+)\^(-?\d+)$/)

  if (power) {
    return (
      <span key={key} className="inline-flex items-baseline">
        {renderTerm(power[1], `${key}-base`)}
        <sup className="ml-0.5 text-[0.62em] leading-none">{power[2]}</sup>
      </span>
    )
  }

  if (/^(log|ln)$/i.test(term)) {
    return <span key={key} className="text-[0.9em]">{term}</span>
  }

  if (/^[a-zA-Z]+$/.test(term)) {
    return <span key={key}>{term}</span>
  }

  return <span key={key}>{term}</span>
}

function renderExpression(expression) {
  return String(expression)
    .trim()
    .split(/(\s+|\*|\u00b7|\+|\/)/)
    .filter(Boolean)
    .map((part, index) => {
      if (/^\s+$/.test(part)) {
        return <span key={`space-${index}`} className="mx-0.5" aria-hidden="true" />
      }

      if (part === '*' || part === '\u00b7') {
        return <span key={`op-${index}`} className="mx-1">&middot;</span>
      }

      if (part === '+' || part === '/') {
        return <span key={`op-${index}`} className="mx-1">{part}</span>
      }

      return renderTerm(part, `term-${index}`)
    })
}

export default function MathNotation({ value, className = '' }) {
  if (!value) return <span className={className}>unknown</span>

  const notation = String(value)
  const bigO = notation.match(/^O\((.+)\)$/i)

  if (!bigO) {
    return <span className={className}>{notation}</span>
  }

  return (
    <span
      role="math"
      aria-label={notation}
      title={notation}
      className={`inline-flex items-baseline whitespace-nowrap font-serif leading-none tracking-tight ${className}`}
    >
      <span className="mr-0.5 font-medium">O</span>
      <span>(</span>
      {renderExpression(bigO[1])}
      <span>)</span>
    </span>
  )
}
