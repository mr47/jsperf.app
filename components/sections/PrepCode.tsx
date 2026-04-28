import {highlightSanitizedHTML} from '../../utils/hljs'

const PrepCode = (props) => {
  const {prepCode} = props

  return (
    <div className="mb-8">
      <h2 className="font-bold text-xl mb-4 tracking-tight">Preparation HTML</h2>
      <div className="bg-muted border border-border rounded-lg p-4 overflow-x-auto">
        <pre>
          <code className="text-sm font-mono whitespace-pre-wrap text-muted-foreground" dangerouslySetInnerHTML={{__html: highlightSanitizedHTML(prepCode)}} />
        </pre>
      </div>
    </div>
  )
}

export default PrepCode
