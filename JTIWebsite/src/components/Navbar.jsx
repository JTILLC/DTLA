import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

const links = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/services', label: 'Services' },
  { to: '/apps', label: 'Apps' },
  { to: '/contact', label: 'Contact' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  return (
    <nav className="sticky top-0 z-50" style={{ background: 'linear-gradient(to right, #0F172A, #1a2744)', boxShadow: '0 2px 20px rgba(0,0,0,0.3)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-3 group" onClick={() => setOpen(false)}>
            <img src="/Logo.png" alt="JTI Logo" className="h-10 w-10 object-contain transition-transform group-hover:scale-110" />
            <div className="hidden sm:block">
              <span className="text-white font-bold text-lg tracking-wide block leading-tight">
                Joshua Todd Industries
              </span>
              <span className="text-jti-blue text-xs tracking-widest uppercase">
                Packaging Equipment Services
              </span>
            </div>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-3">
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`relative px-4 py-2 rounded-md text-sm font-bold transition-all duration-200 ${
                  pathname === to
                    ? 'bg-jti-blue text-white shadow-lg shadow-jti-blue/30'
                    : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden text-gray-300 hover:text-white p-2 rounded-md hover:bg-white/10 transition-colors"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/10" style={{ background: 'linear-gradient(to bottom, #1a2744, #0F172A)' }}>
          <div className="px-4 py-3 space-y-1">
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={`block px-4 py-3 rounded-md text-base font-medium transition-all duration-200 ${
                  pathname === to
                    ? 'bg-jti-blue text-white shadow-lg shadow-jti-blue/30'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  )
}
