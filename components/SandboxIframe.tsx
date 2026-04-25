// @ts-nocheck
// The content of the iframe which includes an API to interact with Benchmark.js

import { SANDBOX_IFRAME_FLAGS } from '../utils/sandboxIframe'

export default function SandboxIframe(props) {
  const {id} = props
  const sandboxUrl = `/sandbox/${id}`
  return (
    <iframe src={sandboxUrl} sandbox={SANDBOX_IFRAME_FLAGS} title="Benchmark sandbox"></iframe>
  )
}
