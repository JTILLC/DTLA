import { Link } from 'react-router-dom'
import {
  Scale,
  Wrench,
  ScanLine,
  Magnet,
  GraduationCap,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react'

const services = [
  {
    icon: Scale,
    title: 'Ishida Combination Weighers (CCW)',
    desc: 'JTI repairs, services, and validates Ishida CCW combination weighers. These multihead weighers are the heart of high-speed, accurate product weighing. We ensure your weighers are calibrated, reliable, and running at peak performance.',
    features: [
      'Full mechanical and electrical repair',
      'Calibration and accuracy verification',
      'Validation and compliance documentation',
      'Preventive maintenance',
    ],
  },
  {
    icon: Wrench,
    title: 'Ishida Checkweighers (DACS)',
    desc: 'Expert service for Ishida DACS checkweighers that verify every package meets weight specifications. Properly maintained checkweighers protect your brand, reduce giveaway, and ensure regulatory compliance.',
    features: [
      'Precision calibration and testing',
      'Conveyor and load cell service',
      'Validation documentation',
    ],
  },
  {
    icon: ScanLine,
    title: 'Ishida X-ray Inspection Systems (IX)',
    desc: 'Service and validation of Ishida IX X-ray systems that detect foreign contaminants in your products. X-ray inspection is critical for food safety, and JTI keeps your systems performing at the highest standard.',
    features: [
      'X-ray maintenance',
      'Sensitivity testing and validation',
      'System diagnostics and repair',
    ],
  },
  {
    icon: Magnet,
    title: 'Ceia Metal Detectors',
    desc: 'JTI services Ceia metal detectors, an essential part of any food safety program. Metal detection systems must be properly maintained and regularly validated to meet audit and compliance requirements.',
    features: [
      'Sensitivity testing and calibration',
      'Conveyor and reject system service',
      'Validation and documentation',
      'Troubleshooting and repair',
    ],
  },
  {
    icon: GraduationCap,
    title: 'On-Site Training',
    desc: 'JTI conducts classroom-setting instruction at your factory with Ishida and Ceia models. Training your maintenance and machine operators greatly increases their response to downtime situations and improves overall operational efficiency.',
    features: [
      'Hands-on equipment training at your facility',
      'Maintenance team skill development',
      'Machine operator best practices',
      'Downtime response procedures',
    ],
  },
  {
    icon: ClipboardCheck,
    title: 'Equipment Validation',
    desc: 'Comprehensive validation services for all supported equipment. Proper validation ensures your equipment meets industry standards, passes audits, and keeps your products safe and compliant.',
    features: [
      'Full validation protocols',
      'Compliance documentation',
    ],
  },
]

export default function Services() {
  return (
    <div>
      {/* Page Header */}
      <section className="bg-jti-dark py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white">Our Services</h1>
          <p className="mt-4 text-gray-400 text-lg max-w-2xl mx-auto">
            Expert repair, service, validation, and training for Ishida weighing
            and inspection equipment and Ceia metal detectors.
          </p>
        </div>
      </section>

      {/* Services List */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-12">
            {services.map(({ icon: Icon, title, desc, features }) => (
              <div
                key={title}
                className="bg-jti-light rounded-2xl p-8 border border-gray-100"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-jti-blue/10 rounded-xl flex items-center justify-center shrink-0">
                    <Icon size={28} className="text-jti-blue" />
                  </div>
                  <h3 className="text-xl font-bold text-jti-dark">{title}</h3>
                </div>
                <div>
                  <p className="text-gray-600 leading-relaxed mb-4">{desc}</p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                        <div className="w-1.5 h-1.5 bg-jti-blue rounded-full shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-jti-dark py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">
            Need Service or a Quote?
          </h2>
          <p className="mt-4 text-gray-300">
            Tell us about your equipment and we'll put together a plan for your needs.
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
