import { Card, CardContent } from '@/components/ui/card'

const STEPS = [
  { key: 'quickjs', label: 'QuickJS-WASM (deterministic)' },
  { key: 'v8', label: 'V8 Isolate (realistic JIT)' },
  { key: 'prediction', label: 'Building prediction model' },
]

export default function AnalysisProgress({ currentStep, testIndex, testCount }) {
  const stepIndex = STEPS.findIndex(s => s.key === currentStep)

  return (
    <Card className="my-4 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          <h3 className="text-sm font-semibold text-foreground">
            Deep Analysis
            {testCount > 1 && ` — Test ${testIndex + 1}/${testCount}`}
          </h3>
        </div>

        <div className="w-full bg-muted rounded-full h-1.5 mb-4">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${Math.max(5, ((stepIndex + 1) / STEPS.length) * 100)}%` }}
          />
        </div>

        <div className="space-y-2">
          {STEPS.map((step, i) => {
            let status = 'pending'
            if (i < stepIndex) status = 'done'
            else if (i === stepIndex) status = 'running'

            return (
              <div key={step.key} className="flex items-center gap-2 text-sm">
                {status === 'done' && (
                  <span className="text-emerald-500 font-medium w-4 text-center">✓</span>
                )}
                {status === 'running' && (
                  <span className="w-4 text-center">
                    <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                  </span>
                )}
                {status === 'pending' && (
                  <span className="text-muted-foreground w-4 text-center">○</span>
                )}
                <span className={status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
