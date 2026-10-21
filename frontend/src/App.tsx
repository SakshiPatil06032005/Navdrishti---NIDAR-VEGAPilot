import { Radio } from 'lucide-react'

function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#071426] px-6 text-slate-100">
      <section className="w-full max-w-3xl border border-slate-700/70 bg-[#0b1d34] px-8 py-16 text-center shadow-2xl shadow-black/30 sm:px-16">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
          <Radio size={30} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">
          Team Third Axis
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          NAVDRISHTI <span className="text-cyan-300">|</span> VEGA-PILOT
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-sm leading-6 text-slate-400">
          Professional drone monitoring and flight intelligence platform.
        </p>
        <div className="mx-auto mt-10 h-px w-24 bg-cyan-400/60" />
        <p className="mt-6 text-xs uppercase tracking-[0.25em] text-slate-500">
          System initialization in progress
        </p>
      </section>
    </main>
  )
}

export default App
