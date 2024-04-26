import { DateTimeLong } from '../../utils/Date'
import styles from './Meta.module.css'

const Meta = (props) => {
  const {revision, authorName, published} = props.pageData

  return (
    <>
      <h2 className="text-md">
        {revision > 1
            ? <span>Revision {revision} of this benchmark created </span>
            : <span>Benchmark created </span>
        }
        { authorName && <span> by {authorName} </span>}
        on <time dateTime={published} pubdate="true"><DateTimeLong date={published}/></time>
      </h2>
    </>
  )
}

export default Meta
