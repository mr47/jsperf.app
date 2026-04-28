import {DateTimeLong} from '../../utils/Date'
import Link from 'next/link'

const Revisions = (props) => {
  const {revisions, slug, revision} = props
  return (
    <div className="mb-8">
      <h2 className="font-bold text-xl mb-4 tracking-tight">Revisions</h2>
      <p className="text-muted-foreground mb-6">
        You can <Link href={`/${slug}/${revision}/edit`} className="text-primary hover:underline">edit these tests or add more tests to this page</Link> by appending /edit to the URL.
      </p>
      
      <div className="space-y-3">
        {revisions.map((pageData, index) => {
          const {revision: rev, slug, authorName, published} = pageData
          return (
            <div key={index} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors">
              <Link href={rev === 1 ? `/${slug}` : `/${slug}/${rev}`} className="font-semibold text-primary hover:underline w-24">
                Revision {rev}
              </Link>
              <div className="text-sm text-muted-foreground flex-1 flex flex-wrap items-center gap-1">
                <span>published</span>
                {authorName && <span className="font-medium text-foreground">by {authorName}</span>}
                <span>on</span>
                <time dateTime={published} className="text-foreground">
                  <DateTimeLong date={published} />
                </time>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default Revisions
