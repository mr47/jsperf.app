// @ts-nocheck
import { pagesCollection } from '../../lib/mongodb'
import { shortcode } from "../../utils/Url"
import { applyTieredRateLimit, setRateLimitHeaders } from '../../lib/rateLimit'
import { inferBenchmarkLanguage, normalizeLanguageOptions } from '../../lib/benchmark/source'
import { readSessionUser } from '../../lib/session'
import { rejectIfBanned } from '../../lib/bans'
import { logServerError } from '../../lib/errorLog'

// Free: 10/min by IP. Donor: 60/min by donor identity (see lib/rateLimit.js).
// Page create/update is a write to MongoDB — keep it modest to honor server resources.
const RATE_LIMIT = { free: 10, donor: 60, window: '1 m' }

const getSessionUser = readSessionUser

const getErrorMessage = (error) => (
  error instanceof Error ? error.message : String(error)
)

/**
 *
 * Function to ensure we are using a slug that doesn't already exist
 *
 */
const generateSlugId = async (length = 6, attempts = 10) => {
  const pages = await pagesCollection()

  for (let attempt = 0; attempt < attempts; attempt++) {
    // Widen the slug on each collision so retries get exponentially more room.
    const slug = shortcode(length + attempt)
    const existing = await pages.findOne({ slug }, { projection: { _id: 1 } })
    if (!existing) return slug
  }

  throw new Error('Too many attempts')
}

const isDuplicateKeyError = (error) => error?.code === 11000 || /E11000/.test(String(error?.message || ''))

const NO_TESTS_MESSAGE = 'A benchmark needs at least one test case with code.'

/**
 * A benchmark without a runnable test case can never be executed, so the
 * page renders empty and the runner never becomes ready. The editor filters
 * out blank cases before submitting, so an empty list means the author never
 * filled one in. Returns an error message, or null when the list is usable.
 */
const validateTests = (tests) => {
  if (!Array.isArray(tests)) return NO_TESTS_MESSAGE
  const runnable = tests.filter(
    (test) => test && typeof test.code === 'string' && test.code.trim().length > 0,
  )
  return runnable.length > 0 ? null : NO_TESTS_MESSAGE
}

const MAX_INSERT_ATTEMPTS = 5

/**
 * Insert a page, assigning the next revision for its slug. Concurrent saves
 * against the same slug race on `max(revision) + 1`; the unique
 * (slug, revision) index turns the loser into a duplicate-key error, which
 * we resolve by recomputing the revision (or picking a fresh slug when the
 * slug itself was just generated) and trying again.
 */
const insertPageWithNextRevision = async (pages, payload, { slugWasGenerated }) => {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const latest = await pages.findOne(
      { slug: String(payload.slug) },
      { sort: { revision: -1 }, projection: { revision: 1 } },
    )
    payload.revision = latest ? latest.revision + 1 : 1

    try {
      return await pages.insertOne(payload)
    } catch (error) {
      if (!isDuplicateKeyError(error) || attempt === MAX_INSERT_ATTEMPTS - 1) throw error
      if (slugWasGenerated) payload.slug = await generateSlugId()
    }
  }
  throw new Error('Could not allocate a revision number')
}

const revalidatePath = async (baseUrl, path) => {
  const response = await fetch(baseUrl + '/api/revalidate?' + new URLSearchParams({
    secret: process.env.REVALIDATE_SECRET,
    path
  }))

  const {revalidated} = await response.json()

  return revalidated
}

/**
 * Adds a new page.
 *
 * A page includes a page title, slug, and an array of tests.
 *
 * @param {} req The request object.
 * @param {} res The response object.
 */
const addPage = async (req, res) => {
  try {
    const rl = await applyTieredRateLimit(req, 'bench', RATE_LIMIT)
    setRateLimitHeaders(res, rl)

    if (!rl.success) {
      return res.status(429).json({
        message: rl.tier === 'donor'
          ? 'Too many requests, even for a donor — please wait a minute.'
          : 'Too many requests',
        success: false,
        tier: rl.tier,
      })
    }

    const sessionUser = await getSessionUser(req)

    // if (!session) {
    //   throw new Error('User is not authenticated.')
    // }

    if (await rejectIfBanned(req, res, { sessionUserId: sessionUser?.id || null })) return

    const pages = await pagesCollection()

    const payload = JSON.parse(req.body)

    const testsError = validateTests(payload.tests)
    if (testsError) {
      return res.status(400).json({ message: testsError, success: false })
    }

    payload.language = inferBenchmarkLanguage({
      language: payload.language,
      tests: payload.tests,
      setup: payload.setup,
      teardown: payload.teardown,
    })
    payload.languageOptions = normalizeLanguageOptions(payload.language, payload.languageOptions)

    // Could be a revision of an existing page.
    // In which case use the same slug.
    const slugWasGenerated = !payload.slug
    if (slugWasGenerated) {
      payload.slug = await generateSlugId()
    }

    payload.published = new Date()

    // Set the github user ID if authenticated
    if (sessionUser?.id) {
      payload.githubID = sessionUser.id
    }

    // Will throw an error if schema validation fails
    const { acknowledged, insertedId } = await insertPageWithNextRevision(pages, payload, { slugWasGenerated })
    if (!acknowledged || !insertedId) {
      throw new Error('Mongo couldn\'t insertOne')
    }

    res.json({
      message: 'Post added successfully',
      success: true,
      data: { slug: payload.slug, revision: payload.revision },
    })
  } catch (error) {
    void logServerError('bench.create', error, { req })
    return res.json({
      message: getErrorMessage(error),
      success: false,
    })
  }
}

/**
 * Updates a page.
 *
 * @param {} req The request object.
 * @param {} res The response object.
 */
const updatePage = async (req, res) => {
  try {
    const rl = await applyTieredRateLimit(req, 'bench', RATE_LIMIT)
    setRateLimitHeaders(res, rl)

    if (!rl.success) {
      return res.status(429).json({
        message: rl.tier === 'donor'
          ? 'Too many requests, even for a donor — please wait a minute.'
          : 'Too many requests',
        success: false,
        tier: rl.tier,
      })
    }

    const sessionUser = await getSessionUser(req)

    if (await rejectIfBanned(req, res, { sessionUserId: sessionUser?.id || null })) return

    const pages = await pagesCollection()

    const payload = JSON.parse(req.body)

    const {slug, revision, uuid} = payload

    // Get the page we wish to update
    const page = await pages.findOne(
      { slug: String(slug), revision: parseInt(revision, 10) },
      {
        projection: {
          revision: 1,
          githubID: 1,
          uuid: 1,
          _id: 1
        }
      })

    if (!page) {
      throw new Error('Page does not exist.')
    }

    if (page.mirror) {
      throw new Error('Protect imported perfs')
    }

    // Only the original creator of this page can update it
    let allowedToEdit = false

    if (page.githubID && sessionUser?.id) {
      if (page.githubID === sessionUser?.id) {
        allowedToEdit = true
      }
    }

    if (page.uuid && uuid && page.uuid === uuid) {
      allowedToEdit = true
    }

    if (!allowedToEdit) {
      throw new Error('Does not have the authority to update this page.')
    }

    // Partial updates (e.g. publishing sets only `visible`) leave the tests
    // untouched; only validate when the caller is replacing them.
    if (payload.tests !== undefined) {
      const testsError = validateTests(payload.tests)
      if (testsError) {
        return res.status(400).json({ message: testsError, success: false })
      }
    }

    const safeLanguage = inferBenchmarkLanguage({
      language: payload.language,
      tests: payload.tests,
      setup: payload.setup,
      teardown: payload.teardown,
    })

    const safePayload = {
      title: payload.title,
      info: payload.info,
      initHTML: payload.initHTML,
      setup: payload.setup,
      teardown: payload.teardown,
      tests: payload.tests,
      language: safeLanguage,
      languageOptions: normalizeLanguageOptions(safeLanguage, payload.languageOptions),
      authorName: payload.authorName,
      visible: payload.visible,
    }

    // Remove undefined fields
    Object.keys(safePayload).forEach(key => {
      if (safePayload[key] === undefined) {
        delete safePayload[key]
      }
    })

    if (sessionUser?.id) {
      safePayload.githubID = sessionUser?.id
    }

    await pages.updateOne({
      '_id': page._id
    }, {
      $set: safePayload
    }).then(async () => {

      // Invalidate cache
      // We need to specify absolute URL because node/server/fetch
      const protocol = req.headers['x-forwarded-proto'] || 'http'
      const baseUrl = req ? `${protocol}://${req.headers.host}` : ''

      // const revalidated = await revalidatePath(baseUrl, `/${slug}/${revision}`)

      res.json({
        message: 'Updated page successfully',
        success: true,
        data: { slug, revision },
      })
    })

  } catch (error) {
    // Authorisation / validation failures are expected; only persist real faults.
    const message = getErrorMessage(error)
    if (!/authority|does not exist|Protect imported/i.test(message)) {
      void logServerError('bench.update', error, { req })
    }
    return res.json({
      message: getErrorMessage(error),
      success: false,
    })
  }
}

export default (req, res) => {
  const { method } = req

  switch (method) {
    case 'POST':
      return addPage(req, res)
    case 'PUT':
      return updatePage(req, res)
    default:
      res.setHeader('Allow', ['POST', 'PUT'])
      res.status(405).end(`Method ${method} Not Allowed`)
  }
}
