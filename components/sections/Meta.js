import { datetimeLong } from '../../utils/Date'
import { useSession } from "next-auth/react"
import { useState } from 'react'
import { useRouter } from 'next/router'
import styles from './Meta.module.css'

const Meta = (props) => {
  const {slug, revision, authorName, published, githubID} = props.pageData

  const [visible, setVisible] = useState(props.pageData?.visible)

  const { data: session, status } = useSession()

  const isOwner = session?.user?.id === githubID

  const publish = async (event) => {
    event.preventDefault();
    const response = await fetch('/api/tests', {
      method: 'PUT',
      body: JSON.stringify({
        slug, revision,
        visible: true
      }),
    })

    const json = await response.json()

    if (json.success) {
      setVisible(true)
    }
  }

  const { asPath } = useRouter()

  return (
    <h2 className="text-xl">
      {revision > 1
          ? <span>Revision {revision} of this benchmark created </span>
          : <span>Benchmark created </span>
      }
      { authorName && <span> by {authorName} </span>}
      on <time dateTime={published} pubdate="true">{datetimeLong(published)}</time>
      { isOwner && !visible &&
          <a onClick={publish} href="#" className={styles.unpublishedButton}>Not published yet!</a> 
      }
      {
        isOwner &&
          <>
            <span> - </span><a href={`${asPath}/edit`}>Edit</a>
          </>
      }
    </h2>
  )
}

export default Meta
