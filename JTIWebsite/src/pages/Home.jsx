import { Link } from 'react-router-dom'
import {
  Wrench,
  Scale,
  ScanLine,
  GraduationCap,
  ArrowRight,
  CheckCircle,
  Award,
  ClipboardList,
  BookOpen,
} from 'lucide-react'

const services = [
  {
    icon: Scale,
    title: 'Combination Weighers',
    desc: 'Repair, service, and validation of Ishida CCW combination weighers to keep your production lines accurate and efficient.',
  },
  {
    icon: Wrench,
    title: 'Checkweighers',
    desc: 'Expert service and calibration of Ishida DACS checkweighers ensuring compliance and quality control.',
  },
  {
    icon: ScanLine,
    title: 'X-ray & Metal Detection',
    desc: 'Service and validation of Ishida IX X-ray inspection systems and Ceia metal detectors for food safety compliance.',
  },
  {
    icon: GraduationCap,
    title: 'On-Site Training',
    desc: 'Classroom instruction at your facility to train maintenance and machine operators on Ishida and Ceia equipment.',
  },
]

const stats = [
  { icon: Award, value: '18+', label: 'Years of Ishida Expertise' },
  { icon: ClipboardList, value: 'Detailed', label: 'Maintenance Logging' },
  { icon: BookOpen, value: 'Interactive', label: 'Ishida Parts Manuals' },
  { icon: Wrench, value: 'Specializing in', label: 'Preventative Maintenance' },
]

export default function Home() {
  return (
    <div>
      {/* Hero Section */}
      <section className="relative bg-jti-dark overflow-hidden min-h-[600px] md:min-h-[700px]">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/55" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-36">
          <div className="flex flex-col items-center gap-8 text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)' }}>
              Ishida & Ceia
              <span className="block text-jti-blue mt-2" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)' }}>Equipment Experts</span>
            </h1>
            <img
              src="/Logo-transparent.png"
              alt="Joshua Todd Industries"
              className="w-48 md:w-64 lg:w-72 drop-shadow-2xl"
            />
            <p className="text-lg text-gray-200 max-w-xl mx-auto font-bold" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
              With over 18 years of experience, Joshua Todd Industries provides expert repair,
              service, validation, and training for Ishida weighing and inspection equipment
              and Ceia metal detectors.
            </p>
            <p className="text-jti-blue font-bold italic text-lg" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
              Experience matters. I Know Service!
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/contact"
                className="inline-flex items-center justify-center gap-2 bg-jti-blue text-white px-8 py-3 rounded-lg font-semibold hover:bg-sky-500 transition-colors"
              >
                Get in Touch
                <ArrowRight size={18} />
              </Link>
              <Link
                to="/services"
                className="inline-flex items-center justify-center gap-2 border border-white/40 text-white px-8 py-3 rounded-lg font-semibold hover:bg-white/10 transition-colors"
              >
                Our Services
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-jti-blue">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map(({ icon: Icon, value, label }) => (
              <div key={label} className="text-center text-white">
                <Icon size={28} className="mx-auto mb-2 opacity-90" />
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-sm opacity-80">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Services Overview */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-jti-dark">What We Do</h2>
            <p className="mt-4 text-gray-600 max-w-2xl mx-auto">
              JTI specializes in the repair, service, and validation of Ishida products and
              Ceia metal detectors, plus hands-on training for your team.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {services.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-jti-light rounded-xl p-6 border border-gray-100 hover:shadow-lg hover:border-jti-blue/30 transition-all group"
              >
                <div className="w-12 h-12 bg-jti-blue/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-jti-blue/20 transition-colors">
                  <Icon size={24} className="text-jti-blue" />
                </div>
                <h3 className="font-semibold text-jti-dark text-lg mb-2">{title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-10">
            <Link
              to="/services"
              className="inline-flex items-center gap-2 text-jti-blue font-semibold hover:text-sky-600 transition-colors"
            >
              View All Services <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>

      {/* CCW Spa Banner */}
      <section className="relative">
        <img
          src="/ccw-spa.jpg"
          alt="Ishida CCW combination weigher on a tropical beach"
          className="w-full h-[28rem] md:h-[34rem] object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 w-full">
            <h2 className="text-3xl md:text-5xl font-bold text-white drop-shadow-lg">
              Give your hard working CCW the spa treatment.
            </h2>
          </div>
        </div>
      </section>

      {/* Why Choose JTI */}
      <section className="bg-jti-light py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            <div className="flex-1">
              <h2 className="text-3xl md:text-4xl font-bold text-jti-dark">
                Why Choose JTI?
              </h2>
              <p className="mt-4 text-gray-600 leading-relaxed">
                When your production line depends on Ishida and Ceia equipment, you need a
                service partner with real expertise and a commitment to getting the job done right.
              </p>
              <ul className="mt-6 space-y-4">
                {[
                  'Over 18 years of hands-on Ishida and Ceia experience',
                  'Specialized in combination weighers, checkweighers, X-ray, and metal detection',
                  'On-site training programs to empower your maintenance and operations team',
                  'Specializing in preventative maintenance. Emergencies are costly. Save money and time by being proactive',
                  'Locally based in Gilbert, AZ serving businesses across the nation',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle size={20} className="text-jti-blue mt-0.5 shrink-0" />
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex-shrink-0">
              <img src="/Logo-transparent.png" alt="JTI" className="w-48 md:w-64" />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-jti-dark py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Need Service or Training?
          </h2>
          <p className="mt-4 text-gray-300 text-lg">
            Contact JTI today to discuss your Ishida or Ceia equipment needs.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="tel:+16233006445"
              className="inline-flex items-center justify-center gap-2 bg-jti-red text-white px-8 py-3 rounded-lg font-semibold hover:bg-red-600 transition-colors"
            >
              Call (623) 300-6445
            </a>
            <Link
              to="/contact"
              className="inline-flex items-center gap-2 justify-center bg-jti-blue text-white px-8 py-3 rounded-lg font-semibold hover:bg-sky-500 transition-colors"
            >
              Send a Message <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
