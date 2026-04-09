import PostMessageBroker from '../utils/postMessageBroker'
import { SANDBOX_IFRAME_FLAGS } from '../utils/sandboxIframe'
import { useState, useEffect, useRef } from 'react'
import UserAgent from './UserAgent'
import Test from './Test'
import { Button } from '@/components/ui/button'
import { formatNumber } from '../utils/ArrayUtils'

export default function Tests(props) {
  const {id} = props

  const [statusMessage, setStatusMessage] = useState('')
  const [benchStatus, setBenchStatus] = useState('notready')
  const [broker, setBroker] = useState(null)
  const [tests, setTests] = useState(props.tests)

  const windowRef = useRef(null)

  useEffect(() => {
    const _broker = new PostMessageBroker(windowRef.current.contentWindow)

    setBroker(_broker)

    _broker.register('cycle', event => {
      const {
        id: rawId, name, count, size, status,
        elapsed, total, opsPerSec, taskIndex, taskCount,
      } = event.data
      const id = Number(rawId)

      if (status === 'running') {
        const pct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0
        const hzEstimate =
          opsPerSec > 0 ? `~${formatNumber(Math.round(opsPerSec))} ops/s` : 'warming up…'
        const taskProgress =
          taskCount > 1 ? `[${taskIndex + 1}/${taskCount}] ` : ''
        setStatusMessage(`${taskProgress}${name} — ${hzEstimate} — ${pct}%`)
      } else if (!['finished', 'completed'].includes(status)) {
        setStatusMessage(`${name} × ${count} (${size} sample${size === 1 ? '' : 's'})`)
      }

      setTests((prevTests) =>
        prevTests.map((test, idx) => {
          if (idx !== id) return test
          if (
            test.hz != null &&
            test.status === 'finished' &&
            status !== 'finished'
          ) {
            return test
          }
          return {
            ...test,
            status,
            ...(status === 'running' ? { elapsed, total, opsPerSec } : {}),
          }
        })
      )
    })

    _broker.register('complete', event => {
      const {results} = event.data

      setTests((prevTests) => {
        const next = [...prevTests]
        for (const result of results) {
          const i = Number(result.id)
          if (!Number.isInteger(i) || i < 0 || i >= next.length) continue
          next[i] = { ...prevTests[i], ...result }
        }
        return next
      })
      setStatusMessage('Done. Ready to run again.')
      setBenchStatus('complete')
    })

    _broker.register('ready', () => {
      setStatusMessage('Ready to run.')
      setBenchStatus('ready')
    })
  }, [])

  const sandboxUrl = `/sandbox/${id}`

  const run = (options) => {
    broker.emit('run', {options})

    setTests((prevTests) =>
      prevTests.map((test) => ({
        ...test,
        status: 'pending',
        elapsed: undefined,
        total: undefined,
        opsPerSec: undefined,
      }))
    )

    setBenchStatus('running')
  }

  const finishedTests = tests.filter((t) => t.status === 'finished')
  const showUnboundedNote =
    finishedTests.length > 0 && finishedTests.every((t) => t.tied)

  return (
    <>
      <h2 className="font-bold my-5">Test runner</h2>
      <div id="controls" className="flex my-5 items-center">
        <p id="status" className="flex-1">{statusMessage}</p>
        { ['ready', 'complete'].includes(benchStatus) &&
          <>
            <Button
              id="run"
              type="button"
              disabled={benchStatus === 'notready'}
              variant="outline"
              className="mx-2 font-bold"
              onClick={() => run({maxTime: 5})}>Run</Button>
            <Button
              type="button"
              disabled={benchStatus === 'notready'}
              variant="outline"
              className="font-bold"
              onClick={() => run({maxTime: 0.5})}>Quick Run</Button>
            </>
        }
        { benchStatus === 'running' &&
          <Button
            type="button"
            variant="outline"
            className="font-bold"
            onClick={() => run()}>Stop</Button>
        }
        <iframe
          src={sandboxUrl}
          ref={windowRef}
          sandbox={SANDBOX_IFRAME_FLAGS}
          title="Benchmark sandbox"
          className="hidden"
          style={{height: "1px", width: "1px"}}></iframe>
      </div>
      <table id="test-table" className="w-full border-collapse">
        <caption className="bg-gray-200 font-bold text-md text-gray-800">Testing in <UserAgent /></caption>
        <thead className="bg-blue-500 text-white">
          <tr>
            <th colSpan="2" className="py-1">Test</th>
            <th title="Operations per second (higher is better)" className="px-2">Ops/sec</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((test, i) => (
            <Test
              key={`${i}-${test.status}-${String(test.hz ?? '')}-${String(test.percent ?? '')}-${String(test.tied ?? '')}`}
              test={test}
            />
          ))}
        </tbody>
      </table>
      {showUnboundedNote && (
        <p className="text-sm text-gray-600 mt-3 max-w-prose">
          Each case finished faster than the benchmark timer could resolve, so ops/sec
          is shown as ∞ and cases are listed as tied — this is a measurement limit, not
          missing data from the runner. Add heavier work inside the test (or a loop) if
          you need a finite ops/sec estimate.
        </p>
      )}
    </>
  )
}
