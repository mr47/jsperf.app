import { useState } from 'react'
import SEO from '../../../components/SEO'

import { pagesCollection } from '../../../lib/mongodb'
import Router from 'next/router'
import { signIn, useSession } from "next-auth/react"

import TestRunner from '../../../components/TestRunner'

import Layout from '../../../components/Layout'

import Meta from '../../../components/sections/Meta'
import Info from '../../../components/sections/Info'
import Setup from '../../../components/sections/Setup'
import Teardown from '../../../components/sections/Teardown'
import PrepCode from '../../../components/sections/PrepCode'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import UUID from '../../../components/UUID'

export default function Preview(props) {
  const { data: session, status } = useSession()
  const { 
    _id, 
    authorName, 
    info, 
    initHTML, 
    published, 
    revision, 
    setup, 
    slug, 
    teardown, 
    tests,
    title, 
    uuid,
    visible,
    githubID,
  } = props.pageData

  const userID = UUID()
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState(null)

  let canEdit = false

  if (!visible) {
    if (githubID && session?.user?.id) {
      if (session?.user?.id === githubID) {
        canEdit = true
      }
    } 
    if (uuid === userID) {
      canEdit = true
    }
  }

  const publish = async (event) => {
    event.preventDefault();
    setIsPublishing(true)
    setPublishError(null)

    try {
      const response = await fetch('/api/bench', {
        method: 'PUT',
        body: JSON.stringify({
          slug, revision, uuid,
          visible: true
        }),
      })

      if (response.status === 429) {
        setPublishError('Too many requests. Please wait a moment and try again.')
        setIsPublishing(false)
        return
      }

      const {success, message} = await response.json()

      if (success) {
        Router.push(`/${slug}/${revision}`)
      } else {
        setPublishError(message || 'Failed to publish benchmark.')
        setIsPublishing(false)
      }
    } catch (error) {
      console.error(error)
      setPublishError('Network error. Please check your connection and try again.')
      setIsPublishing(false)
    }
  }

  return (
    <>
      <SEO title={`Preview: ${title}`} noindex={true} />
      <Layout>
        <hgroup>
          <h1 className="text-2xl py-6 font-bold">{title}</h1>
        </hgroup>
        <section>
          <Meta pageData={props.pageData} />
        </section>
        <hr className="my-5" />
        {info &&
          <section>
            <Info info={info} />
          </section>
        }
        {initHTML &&
          <section>
            <PrepCode prepCode={initHTML} />
          </section>
        }
        {setup &&
          <section>
            <Setup setup={setup} />
          </section>
        }
        {teardown &&
          <section>
            <Teardown teardown={teardown} />
          </section>
        }
        <section>
          <TestRunner id={_id} slug={slug} revision={revision} tests={tests} />
        </section>
        <hr className="my-5" />
        {publishError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
            <span className="flex-1">{publishError}</span>
            <button type="button" onClick={() => setPublishError(null)} className="shrink-0 hover:opacity-70 text-xs font-bold px-1">✕</button>
          </div>
        )}
        <div className="flex justify-end items-center gap-2 flex-wrap">
          { canEdit &&
              <>
                <Button variant="outline" className="font-bold" disabled={isPublishing} asChild>
                  <a href={`/${slug}/${revision}/edit`}>Edit Tests</a>
                </Button>
                <span className="hidden sm:inline-flex items-center px-2 text-muted-foreground">or</span>
                <Button type="button" variant="outline" className="border-red-400 bg-red-100 font-bold hover:bg-red-200" onClick={publish} disabled={isPublishing}>
                  {isPublishing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Publishing…
                    </>
                  ) : (
                    'Publish'
                  )}
                </Button>
              </>
          }
        </div>
      </Layout>
    </>
  )
}

export async function getServerSideProps({params}) {
  const { slug, revision } = params

  const pages = await pagesCollection()

  const pageData = await pages.findOne({
    slug, revision: parseInt(revision) || 1
  })

  if (!pageData) {
    return {
      notFound: true
    }
  }

  return { 
    props: { 
      pageData: JSON.parse(JSON.stringify(pageData))
    }
  }
}
