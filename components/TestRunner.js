import PostMessageBroker from '../utils/postMessageBroker'
import { SANDBOX_IFRAME_FLAGS } from '../utils/sandboxIframe'
import { useState, useEffect, useRef } from 'react'
import UserAgent from './UserAgent'
import Test from './Test'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
        elapsed, total, opsPerSec, taskIndex, taskCount, error
      } = event.data
      const id = Number(rawId)

      if (status === 'running') {
        const pct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0
        const hzEstimate =
          opsPerSec > 0 ? `~${formatNumber(Math.round(opsPerSec))} ops/s` : 'warming up…'
        const taskProgress =
          taskCount > 1 ? `[${taskIndex + 1}/${taskCount}] ` : ''
        setStatusMessage(`${taskProgress}${name} — ${hzEstimate} — ${pct}%`)
      } else if (!['finished', 'completed', 'error'].includes(status)) {
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
            ...(status === 'error' ? { error } : {}),
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
      <Card className="my-8">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h2 className="text-xl font-bold tracking-tight mb-1">Test Runner</h2>
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>
            
            <div className="flex items-center gap-3">
              { ['ready', 'complete'].includes(benchStatus) &&
                <>
                  <Button
                    id="run"
                    type="button"
                    disabled={benchStatus === 'notready'}
                    size="lg"
                    className="font-bold"
                    onClick={() => run({maxTime: 5})}>Run Tests</Button>
                  <Button
                    type="button"
                    disabled={benchStatus === 'notready'}
                    variant="outline"
                    size="lg"
                    className="font-bold"
                    onClick={() => run({maxTime: 0.5})}>Quick Run</Button>
                </>
              }
              { benchStatus === 'running' &&
                <Button
                  type="button"
                  variant="destructive"
                  size="lg"
                  className="font-bold"
                  onClick={() => run()}>Stop</Button>
              }
            </div>
          </div>
        </CardContent>
      </Card>
      
      <iframe
        src={sandboxUrl}
        ref={windowRef}
        sandbox={SANDBOX_IFRAME_FLAGS}
        title="Benchmark sandbox"
        className="hidden"
        style={{height: "1px", width: "1px"}}></iframe>

      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-left text-sm">
          <caption className="bg-muted p-3 text-sm font-medium border-b border-border text-left">
            Testing in <UserAgent />
          </caption>
          <thead className="bg-primary text-primary-foreground">
            <tr>
              <th colSpan="2" className="py-3 px-4 font-semibold border-r border-primary-foreground/20">Test Case</th>
              <th title="Operations per second (higher is better)" className="py-3 px-4 font-semibold text-center">Ops/sec</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tests.map((test, i) => (
              <Test
                key={`${i}-${test.status}-${String(test.hz ?? '')}-${String(test.percent ?? '')}-${String(test.tied ?? '')}`}
                test={test}
              />
            ))}
          </tbody>
        </table>
      </div>
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
