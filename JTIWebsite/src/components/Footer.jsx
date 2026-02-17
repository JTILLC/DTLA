import { Link } from 'react-router-dom'
import { MapPin, Phone, Mail } from 'lucide-react'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="bg-jti-dark text-gray-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <img src="/Logo.png" alt="JTI" className="h-10 w-10 object-contain" />
              <span className="text-white font-bold text-lg">JTI</span>
            </div>
            <p className="text-sm leading-relaxed">
              Joshua Todd Industries LLC &mdash; over 18 years of experience servicing
              Ishida products and Ceia metal detectors. Eagle Scout. Marine Corps Veteran.
            </p>
            <p className="mt-2 text-jti-blue text-sm font-semibold italic">
              Experience matters. I Know Service!
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-jti-blue transition-colors">Home</Link></li>
              <li><Link to="/about" className="hover:text-jti-blue transition-colors">About Us</Link></li>
              <li><Link to="/services" className="hover:text-jti-blue transition-colors">Services</Link></li>
              <li><Link to="/apps" className="hover:text-jti-blue transition-colors">Apps</Link></li>
              <li><Link to="/contact" className="hover:text-jti-blue transition-colors">Contact</Link></li>
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-white font-semibold mb-4">Contact</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2">
                <MapPin size={16} className="text-jti-blue mt-0.5 shrink-0" />
                <span>Gilbert, AZ</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone size={16} className="text-jti-blue shrink-0" />
                <a href="tel:+16233006445" className="hover:text-jti-blue transition-colors">
                  (623) 300-6445
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Mail size={16} className="text-jti-blue shrink-0" />
                <a href="mailto:josh@jtiaz.com" className="hover:text-jti-blue transition-colors">
                  josh@jtiaz.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-700 mt-10 pt-6 text-center text-sm">
          &copy; {year} Joshua Todd Industries LLC. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
