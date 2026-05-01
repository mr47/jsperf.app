// @ts-nocheck
import SEO from '../../components/SEO'

import { pagesCollection } from '../../lib/mongodb'
import { ObjectId } from 'mongodb'
import dynamic from 'next/dynamic'
import SandboxBanner from '../../components/SandboxBanner'
import {
  prepareBenchmarkSources,
  inferBenchmarkLanguage,
  normalizeLanguageOptions,
  SourcePreparationError,
} from '../../lib/benchmark/source'

const UI = dynamic(() => import('../../components/UI'), { ssr: false })

export default function Sandbox(props) {
  const {pageData} = props

  return (
    <>
      <SEO noindex={true} />
      <SandboxBanner pageData={pageData} />
      <UI pageData={pageData} />
    </>
  )
}

export async function getServerSideProps({params, res}) {
  const {id} = params
  let pageData

  try {
    const _id = ObjectId(id)

    const pages = await pagesCollection()

    pageData = await pages.findOne(_id)
  } catch (e) {
  }

  if (!pageData) {
    return {
      notFound: true
    }
  }

  const language = inferBenchmarkLanguage({
    language: pageData.language,
    tests: pageData.tests || [],
    setup: pageData.setup,
    teardown: pageData.teardown,
  })
  const languageOptions = normalizeLanguageOptions(language, pageData.languageOptions)
  pageData.language = language
  pageData.languageOptions = languageOptions

  try {
    const prepared = prepareBenchmarkSources({
      tests: pageData.tests || [],
      setup: pageData.setup,
      teardown: pageData.teardown,
      language,
      languageOptions,
    })
    pageData.runtime = {
      tests: prepared.runtime.tests,
      setup: prepared.runtime.setup,
      teardown: prepared.runtime.teardown,
      meta: {
        sourcePrepMs: prepared.conversionMs,
        compiler: prepared.compilerVersion
          ? { name: 'typescript', version: prepared.compilerVersion }
          : null,
        language: prepared.language,
        languageOptions: prepared.languageOptions,
      },
    }
  } catch (err) {
    if (err instanceof SourcePreparationError) {
      pageData.runtimeCompileError = {
        message: err.message,
        details: err.details || null,
      }
    } else {
      throw err
    }
  }

  res.setHeader('Cache-Control', 'no-store')

  return {
    props: {
      pageData: structuredClone(pageData)
    }
  }
}
