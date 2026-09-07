import CompactBenchmarkPage from '../../../components/CompactBenchmarkPage'
import { loadBenchmarkPageData } from '../../../lib/benchmark/pageData'
import { compactBenchmarkPath } from '../../../lib/benchmark/paths'

export default CompactBenchmarkPage

export const getStaticProps = async ({ params }) => {
  const { slug, revision } = params

  if (revision === '1') {
    return {
      redirect: {
        destination: compactBenchmarkPath(slug, 1),
      },
    }
  }

  const data = await loadBenchmarkPageData(slug, revision)

  if (!data) {
    return {
      notFound: true,
    }
  }

  return {
    props: {
      pageData: JSON.parse(JSON.stringify(data.pageData)),
    },
    revalidate: 60 * 60 * 24,
  }
}

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: 'blocking',
  }
}
