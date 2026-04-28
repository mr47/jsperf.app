import {codeLanguageClass, highlightSanitizedCode} from '../../utils/hljs'

const Teardown = (props) => {
  const {teardown, language = 'javascript'} = props
  return (
    <div className="mb-8">
      <h2 className="font-bold text-xl mb-4 tracking-tight">Teardown</h2>
      <div className="bg-muted border border-border rounded-lg p-4 overflow-auto max-h-80">
        <pre>
          <code className={`${codeLanguageClass(language, teardown)} text-sm font-mono text-muted-foreground`} dangerouslySetInnerHTML={{__html: highlightSanitizedCode(teardown, language)}} />
        </pre>
      </div>
    </div>
  )
}

export default Teardown
