import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const navItems = [
  { path: '/', label: 'System', hash: '#system' },
  { path: '/', label: 'Features', hash: '#features' },
  { path: '/', label: 'Graph', hash: '#graph' },
]

export function Header() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    if (location.pathname !== '/') {
      return // Let React Router handle navigation
    }
    e.preventDefault()
    const element = document.querySelector(hash)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' })
    }
    setMobileMenuOpen(false)
  }

  return (
    <header className="fixed top-0 left-0 w-full z-50 glass-header">
      <nav className="container mx-auto max-w-7xl px-6 py-4 flex justify-between items-center">
        <Link to="/" className="text-2xl font-bold">
          <span className="text-gradient">DeepCurrent</span>
        </Link>
        
        <div className="hidden md:flex items-center space-x-6">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.hash}
              onClick={(e) => handleNavClick(e, item.hash)}
              className="text-gray-300 hover:text-white transition-colors"
            >
              {item.label}
            </a>
          ))}
          <Link to="/research" className="text-gray-300 hover:text-white transition-colors">
            Log In
          </Link>
        </div>
        
        <div className="flex items-center gap-4">
          <a href="#system" className="hidden md:inline-block bg-gradient-button text-white font-semibold px-5 py-2 rounded-lg shadow-lg">
            Request Access
          </a>
          
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-gray-300 hover:text-white"
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </nav>
      
      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/5 bg-black/50 backdrop-blur-lg">
          <div className="container mx-auto max-w-7xl px-6 py-4 flex flex-col space-y-4">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.hash}
                onClick={(e) => handleNavClick(e, item.hash)}
                className="text-gray-300 hover:text-white transition-colors"
              >
                {item.label}
              </a>
            ))}
            <Link to="/research" className="text-gray-300 hover:text-white transition-colors">
              Log In
            </Link>
            <a href="#system" className="bg-gradient-button text-white font-semibold px-5 py-2 rounded-lg shadow-lg text-center">
              Request Access
            </a>
          </div>
        </div>
      )}
    </header>
  )
}
