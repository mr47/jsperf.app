// @ts-nocheck
import { DateTimeLong, toIsoDateTimeAttr } from '../../utils/Date'

const Meta = (props) => {
  const {revision, authorName, published} = props.pageData

  return (
    <h2 className="text-base text-muted-foreground flex flex-wrap gap-1">
      {revision > 1
          ? <span>Revision {revision} published</span>
          : <span>Benchmark published</span>
      }
      { authorName && <span className="font-medium text-foreground"> by {authorName} </span>}
      on{' '}
      <time dateTime={toIsoDateTimeAttr(published)} className="font-medium text-foreground">
        <DateTimeLong date={published}/>
      </time>
    </h2>
  )
}

export default Meta
