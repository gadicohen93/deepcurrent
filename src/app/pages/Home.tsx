export function Home() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative h-screen flex items-center justify-center text-center overflow-hidden px-4">
        <div className="z-10 relative space-y-6 max-w-4xl">
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-extrabold tracking-tighter text-white">
            Beyond the Prompt.
          </h1>
          
          <p className="text-lg md:text-2xl text-gray-300 max-w-2xl mx-auto">
            DeepCurrent is a persistent, autonomous system that evolves with you. It doesn't wait for instructions—it builds insight.
          </p>
          
          <div className="pt-4">
            <a href="#system" className="bg-gradient-button text-white font-semibold px-8 py-4 rounded-lg text-lg shadow-xl inline-block">
              Begin Your Research
            </a>
          </div>
        </div>
      </section>

      {/* Section 2: The Core Loop */}
      <section id="system" className="py-24 md:py-32 relative z-10">
        <div className="container mx-auto max-w-7xl px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white">An Autonomous Loop of Insight</h2>
            <p className="text-lg text-gray-400 mt-4 max-w-3xl mx-auto">
              Our system operates continuously. It isn't a tool you use—it's a partner that learns.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* 1. GATHER */}
            <div className="glass-card p-8 rounded-2xl text-center">
              <div className="mb-4">
                <svg className="w-12 h-12 mx-auto text-gradient" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a9 9 0 11-18 0 9 9 0 0118 0zM5 11v3a4 4 0 004 4h6a4 4 0 004-4v-3"></path>
                </svg>
              </div>
              <h3 className="text-2xl font-semibold text-white mb-2">Gather</h3>
              <p className="text-gray-300">
                Continuously gathers and indexes real-time knowledge from millions of sources, curated to your interests.
              </p>
            </div>
            
            {/* 2. SYNTHESIZE */}
            <div className="glass-card p-8 rounded-2xl text-center">
              <div className="mb-4">
                <svg className="w-12 h-12 mx-auto text-gradient" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                </svg>
              </div>
              <h3 className="text-2xl font-semibold text-white mb-2">Synthesize</h3>
              <p className="text-gray-300">
                Uses curated memory and adaptive workflows to connect concepts and synthesize expert-level reports.
              </p>
            </div>
            
            {/* 3. EVOLVE */}
            <div className="glass-card p-8 rounded-2xl text-center">
              <div className="mb-4">
                <svg className="w-12 h-12 mx-auto text-gradient" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
              </div>
              <h3 className="text-2xl font-semibold text-white mb-2">Evolve</h3>
              <p className="text-gray-300">
                Learns your preferences and automatically evolves its own strategies to refine and perfect its output.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: The Graph */}
      <section id="graph" className="py-24 md:py-32 relative z-10 overflow-hidden">
        <div className="container mx-auto max-w-7xl px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <span className="text-gradient font-semibold tracking-wide uppercase">Your Personal Graph</span>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
              This is Not a Conversation.
            </h2>
            <p className="text-lg text-gray-300">
              Chat UIs are ephemeral. DeepCurrent builds a persistent, interconnected map of your knowledge. It understands context, remembers your preferences, and finds connections you didn't know existed.
            </p>
            <p className="text-lg text-gray-300">
              This living graph is your personal research asset, growing more valuable as it learns your taste and adapts its strategies over time.
            </p>
          </div>
          
          <div className="w-full h-96">
            <div className="w-full h-full rounded-2xl border border-purple-900/30 shadow-2xl shadow-purple-900/20 bg-gradient-to-br from-purple-900/20 to-pink-900/20 flex items-center justify-center">
              <span className="text-gray-400 text-lg">Personal Knowledge Graph</span>
            </div>
          </div>
        </div>
      </section>
      
      {/* Section 4: Features */}
      <section id="features" className="py-24 md:py-32 relative z-10">
        <div className="container mx-auto max-w-7xl px-6">
          <div className="text-center mb-16 max-w-2xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white">A Full-Stack Research System</h2>
            <p className="text-lg text-gray-400 mt-4">
              From data ingestion to expert-level synthesis, DeepCurrent manages the entire workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="glass-card p-6 rounded-2xl">
              <h4 className="text-xl font-semibold text-white mb-2">Autonomous Synthesis</h4>
              <p className="text-gray-300">Go beyond search. Our system synthesizes novel, expert-level reports from diverse, real-time sources.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl">
              <h4 className="text-xl font-semibold text-white mb-2">Evolving Strategy Engine</h4>
              <p className="text-gray-300">DeepCurrent automatically refines its own research strategies, learning what you find valuable.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl">
              <h4 className="text-xl font-semibold text-white mb-2">Curated & Persistent Memory</h4>
              <p className="text-gray-300">A persistent graph that understands context, user preferences, and your unique research goals.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl">
              <h4 className="text-xl font-semibold text-white mb-2">Real-Time Knowledge Base</h4>
              <p className="text-gray-300">Continuously ingests and indexes data, ensuring your insights are built on the latest information.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl">
              <h4 className="text-xl font-semibold text-white mb-2">Adaptive Workflows</h4>
              <p className="text-gray-300">Learns your taste and adapts its research workflows, automatically focusing on what matters to you.</p>
            </div>

            <div className="glass-card p-6 rounded-2xl">
              <h4 className="text-xl font-semibold text-white mb-2">Expert-Level Reports</h4>
              <p className="text-gray-300">Generates comprehensive, cited reports that are ready for review, not just a list of links.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-24 md:py-40 relative z-10 text-center px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-4xl md:text-6xl font-extrabold tracking-tighter text-white">
            Start Building Your <br /> <span className="text-gradient">Autonomous Intellect.</span>
          </h2>
          <p className="text-lg md:text-xl text-gray-300 mt-6 max-w-xl mx-auto">
            Stop searching. Start knowing. Join the private beta and experience the future of research.
          </p>
          <div className="mt-10">
            <a href="#system" className="bg-gradient-button text-white font-semibold px-10 py-4 rounded-lg text-lg shadow-xl inline-block">
              Request Private Access
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
