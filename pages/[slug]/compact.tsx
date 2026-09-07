import CompactBenchmarkPage from '../../components/CompactBenchmarkPage'
import { loadBenchmarkPageData } from '../../lib/benchmark/pageData'

export default CompactBenchmarkPage

export const getStaticProps = async ({ params }) => {
  const data = await loadBenchmarkPageData(params.slug, 1)

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
