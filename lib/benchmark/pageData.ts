import { pagesCollection } from '../mongodb'
import { bumpDateIfOld } from '../../utils/DateBump'
import { inferBenchmarkLanguage, normalizeLanguageOptions } from './source'

export async function loadBenchmarkPageData(slug: string, revisionInput?: string | number) {
  const revision = Number.parseInt(String(revisionInput || ''), 10) || 1
  const pages = await pagesCollection()

  const pageData = await pages.findOne({
    slug,
    revision,
  })

  const revisions = await pages.find({
    slug,
    visible: true,
  }, {
    projection: { slug: 1, revision: 1, authorName: 1, published: 1 },
  }).sort({ revision: 1 }).toArray()

  if (!pageData || !pageData.visible) return null

  const language = inferBenchmarkLanguage({
    language: pageData.language,
    tests: pageData.tests || [],
    setup: pageData.setup,
    teardown: pageData.teardown,
  })
  pageData.language = language
  pageData.languageOptions = normalizeLanguageOptions(language, pageData.languageOptions)

  if (pageData.published) {
    pageData.published = bumpDateIfOld(pageData.published, pageData.slug)
  }
  revisions.forEach(rev => {
    if (rev.published) {
      rev.published = bumpDateIfOld(rev.published, rev.slug)
    }
  })

  return { pageData, revisions }
}
