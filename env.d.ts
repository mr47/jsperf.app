declare namespace NodeJS {
  interface ProcessEnv {
    MONGODB_URI?: string
    MONGODB_COLLECTION?: string
    KV_REST_API_URL?: string
    KV_REST_API_TOKEN?: string
    NEXTAUTH_SECRET?: string
    GITHUB_ID?: string
    GITHUB_SECRET?: string
    DONATELLO_TOKEN?: string
    REVALIDATE_SECRET?: string
    NEXT_PUBLIC_GA_ID?: string
    BENCHMARK_WORKER_URL?: string
    BENCHMARK_WORKER_SECRET?: string
    VERCEL_TOKEN?: string
    VERCEL_OIDC_TOKEN?: string
    VERCEL_TEAM_ID?: string
    VERCEL_PROJECT_ID?: string
  }
}

interface Window {
  __jsperfLiveAnalysis?: {
    slug?: string | number
    revision?: string | number
    analysis?: unknown
    multiRuntime?: unknown
    multiRuntimeStatus?: string
    capturedAt?: number
  }
}

interface Navigator {
  deviceMemory?: number
}
