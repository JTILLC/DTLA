import { useState } from 'react'
import { MapPin, Phone, Mail, Send, CheckCircle } from 'lucide-react'

const WEB3FORMS_KEY = 'f6c06f3c-9f9c-491d-80bf-3750faa4c9c8'

export default function Contact() {
  const [submitted, setSubmitted] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  })

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSending(true)
    setError('')

    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: `JTI Website: ${form.subject}`,
          from_name: form.name,
          name: form.name,
          email: form.email,
          phone: form.phone,
          topic: form.subject,
          message: form.message,
        }),
      })

      const data = await response.json()
      if (data.success) {
        setSubmitted(true)
      } else {
        setError('Something went wrong. Please try again or contact us directly.')
      }
    } catch {
      setError('Failed to send message. Please try again or call us directly.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      {/* Page Header */}
      <section className="bg-jti-dark py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white">Contact Us</h1>
          <p className="mt-4 text-gray-400 text-lg">
            Get in touch with JTI. We're here to help with your equipment needs.
          </p>
        </div>
      </section>

      {/* Contact Content */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Contact Info */}
            <div className="lg:col-span-1 space-y-8">
              <div>
                <h2 className="text-2xl font-bold text-jti-dark mb-6">Get In Touch</h2>
                <p className="text-gray-600 mb-8">
                  Have a question about our services or need a quote? Reach out through the
                  form or contact us directly.
                </p>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-jti-blue/10 rounded-lg flex items-center justify-center shrink-0">
                    <MapPin size={20} className="text-jti-blue" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-jti-dark">Location</h3>
                    <p className="text-gray-600 text-sm">Gilbert, AZ</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-jti-blue/10 rounded-lg flex items-center justify-center shrink-0">
                    <Phone size={20} className="text-jti-blue" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-jti-dark">Phone</h3>
                    <a href="tel:+16233006445" className="text-gray-600 text-sm hover:text-jti-blue transition-colors">
                      (623) 300-6445
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-jti-blue/10 rounded-lg flex items-center justify-center shrink-0">
                    <Mail size={20} className="text-jti-blue" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-jti-dark">Email</h3>
                    <a href="mailto:josh@jtiaz.com" className="text-gray-600 text-sm hover:text-jti-blue transition-colors">
                      josh@jtiaz.com
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              {submitted ? (
                <div className="bg-jti-light rounded-2xl p-12 text-center border border-gray-100">
                  <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-jti-dark mb-2">Message Sent!</h3>
                  <p className="text-gray-600">
                    Thank you for reaching out. We'll get back to you as soon as possible.
                  </p>
                  <button
                    onClick={() => {
                      setSubmitted(false)
                      setForm({ name: '', email: '', phone: '', subject: '', message: '' })
                    }}
                    className="mt-6 text-jti-blue font-semibold hover:text-sky-600 transition-colors"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="bg-jti-light rounded-2xl p-8 border border-gray-100"
                >
                  <h3 className="text-xl font-bold text-jti-dark mb-6">Send Us a Message</h3>
                  {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                      {error}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name *
                      </label>
                      <input
                        type="text"
                        name="name"
                        required
                        value={form.name}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-jti-blue/50 focus:border-jti-blue transition-colors"
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email *
                      </label>
                      <input
                        type="email"
                        name="email"
                        required
                        value={form.email}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-jti-blue/50 focus:border-jti-blue transition-colors"
                        placeholder="your@email.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        value={form.phone}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-jti-blue/50 focus:border-jti-blue transition-colors"
                        placeholder="(623) 300-6445"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Subject *
                      </label>
                      <select
                        name="subject"
                        required
                        value={form.subject}
                        onChange={handleChange}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-jti-blue/50 focus:border-jti-blue transition-colors"
                      >
                        <option value="">Select a topic</option>
                        <option value="Combination Weighers (CCW)">Combination Weighers (CCW)</option>
                        <option value="Checkweighers (DACS)">Checkweighers (DACS)</option>
                        <option value="X-ray Systems (IX)">X-ray Systems (IX)</option>
                        <option value="Metal Detectors (Ceia)">Metal Detectors (Ceia)</option>
                        <option value="Training">Training</option>
                        <option value="Validation">Validation</option>
                        <option value="General Quote">General Quote</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Message *
                    </label>
                    <textarea
                      name="message"
                      required
                      rows={5}
                      value={form.message}
                      onChange={handleChange}
                      className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-jti-blue/50 focus:border-jti-blue transition-colors resize-none"
                      placeholder="Tell us about your equipment and what you need..."
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={sending}
                    className="mt-6 inline-flex items-center gap-2 bg-jti-blue text-white px-8 py-3 rounded-lg font-semibold hover:bg-sky-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Send size={18} />
                    {sending ? 'Sending...' : 'Send Message'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
