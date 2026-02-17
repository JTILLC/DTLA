import { Link } from 'react-router-dom'
import { Target, Eye, Heart, Shield, ArrowRight } from 'lucide-react'

const values = [
  {
    icon: Target,
    title: 'Mission',
    desc: 'To deliver reliable, expert service for Ishida and Ceia equipment that keeps our clients\u2019 production lines running efficiently and profitably.',
  },
  {
    icon: Eye,
    title: 'Experience',
    desc: 'Over 18 years of hands-on experience servicing a wide variety of Ishida products and Ceia metal detectors across the food processing industry.',
  },
  {
    icon: Heart,
    title: 'Values',
    desc: 'Integrity in every interaction. Quality in every repair. The discipline and commitment of an Eagle Scout and Marine Corps Veteran applied to every job.',
  },
]

export default function About() {
  return (
    <div>
      {/* Page Header */}
      <section className="bg-jti-dark py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white">About Us</h1>
          <p className="mt-4 text-gray-400 text-lg">
            Learn more about Joshua Todd Industries and the experience behind the service.
          </p>
        </div>
      </section>

      {/* Company Overview */}
      <section className="bg-white py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-shrink-0 bg-jti-dark rounded-2xl p-12 shadow-xl">
              <img src="/Logo.png" alt="JTI" className="w-52 md:w-64" />
            </div>
            <div className="flex-1">
              <h2 className="text-3xl md:text-4xl font-bold text-jti-dark">
                Joshua Todd Industries LLC
              </h2>
              <div className="mt-8 space-y-6 text-gray-600 text-lg leading-relaxed">
                <p>
                  Joshua Todd Industries (JTI) has more than 18 years of experience servicing
                  a wide variety of Ishida products and Ceia metal detectors. Based in Gilbert,
                  Arizona, JTI provides expert repair, service, validation, and training for
                  the equipment that food processing and packaging operations depend on.
                </p>
                <p>
                  JTI specializes in Ishida combination weighers (CCW), checkweighers (DACS),
                  and X-ray inspection systems (IX), as well as Ceia metal detectors. Whether
                  your equipment needs a routine service, emergency repair, or full validation,
                  JTI brings the expertise to get it done right.
                </p>
                <p>
                  Beyond equipment service, JTI offers on-site classroom training to help your
                  maintenance and machine operators better understand their equipment. Well-trained
                  teams respond faster to downtime situations and operate more efficiently &mdash;
                  saving you time and money.
                </p>
              </div>
              <div className="mt-8 flex items-center gap-4 bg-jti-light rounded-xl p-5 border border-gray-100">
                <Shield size={28} className="text-jti-blue shrink-0" />
                <p className="text-jti-dark font-semibold italic text-lg">
                  Eagle Scout. Marine Corps Veteran. Experience matters &mdash; I Know Service!
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Mission, Experience, Values */}
      <section className="bg-jti-light py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-jti-dark">
              What Drives Us
            </h2>
            <p className="mt-4 text-gray-500 text-lg max-w-2xl mx-auto">
              The principles behind every service call, repair, and training session.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {values.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-white rounded-2xl p-10 shadow-sm border border-gray-100 text-center hover:shadow-md transition-shadow"
              >
                <div className="w-16 h-16 bg-jti-blue/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Icon size={32} className="text-jti-blue" />
                </div>
                <h3 className="font-bold text-jti-dark text-xl mb-4">{title}</h3>
                <p className="text-gray-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Equipment Expertise */}
      <section className="bg-white py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-jti-dark">
              Equipment Expertise
            </h2>
            <p className="mt-4 text-gray-500 text-lg max-w-2xl mx-auto">
              Deep knowledge across the full range of Ishida and Ceia product lines.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-5xl mx-auto">
            {[
              {
                title: 'Ishida Combination Weighers (CCW)',
                desc: 'Full service, repair, and validation of Ishida multihead combination weighers \u2014 the backbone of accurate, high-speed product weighing.',
              },
              {
                title: 'Ishida Checkweighers (DACS)',
                desc: 'Calibration, service, and repair of Ishida DACS checkweighers to ensure every package meets weight specifications and compliance standards.',
              },
              {
                title: 'Ishida X-ray Systems (IX)',
                desc: 'Service and validation of Ishida IX X-ray inspection systems for detecting contaminants and ensuring product safety.',
              },
              {
                title: 'Ceia Metal Detectors',
                desc: 'Expert service and maintenance of Ceia metal detection systems, a critical component of any food safety and quality assurance program.',
              },
            ].map(({ title, desc }) => (
              <div
                key={title}
                className="bg-jti-light rounded-2xl p-8 border-l-4 border-jti-blue hover:shadow-md transition-shadow"
              >
                <h3 className="font-bold text-jti-dark text-lg mb-3">{title}</h3>
                <p className="text-gray-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-jti-dark py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Want to Work With Us?
          </h2>
          <p className="mt-6 text-gray-300 text-lg">
            Get in touch to discuss your Ishida or Ceia equipment needs.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 mt-10 bg-jti-blue text-white px-10 py-4 rounded-lg font-semibold text-lg hover:bg-sky-500 transition-colors"
          >
            Contact Us <ArrowRight size={20} />
          </Link>
        </div>
      </section>
    </div>
  )
}
