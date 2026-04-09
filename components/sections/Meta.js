import { DateTimeLong, toIsoDateTimeAttr } from '../../utils/Date'

const Meta = (props) => {
  const {revision, authorName, published} = props.pageData

  return (
    <>
      <h2 className="text-md">
        {revision > 1
            ? <span>Revision {revision} published </span>
            : <span>Benchmark published </span>
        }
        { authorName && <span> by {authorName} </span>}
        on{' '}
        <time dateTime={toIsoDateTimeAttr(published)}>
          <DateTimeLong date={published}/>
        </time>
      </h2>
    </>
  )
}

export default Meta
