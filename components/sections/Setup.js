import {highlightSanitizedCode} from '../../utils/hljs'

const Setup = (props) => {
  const {setup, language = 'javascript'} = props
  return (
    <div className="mb-8">
      <h2 className="font-bold text-xl mb-4 tracking-tight">Setup</h2>
      <div className="bg-muted border border-border rounded-lg p-4 overflow-auto max-h-80">
        <pre>
          <code className="text-sm font-mono text-muted-foreground" dangerouslySetInnerHTML={{__html: highlightSanitizedCode(setup, language)}} />
        </pre>
      </div>
    </div>
  )
}

export default Setup
