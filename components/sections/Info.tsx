// @ts-nocheck
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

const Info = (props) => {
  const {info} = props
  return (
    <div className="mb-8">
      <h2 className="font-bold text-xl mb-4 tracking-tight">Description</h2>
      <div className="prose dark:prose-invert max-w-none text-muted-foreground" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked(info))}} />
    </div>
  )
}

export default Info
