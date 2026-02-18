import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList,
  BookOpen,
  ArrowRight,
  CheckCircle,
  BarChart3,
  Factory,
  Share2,
  WifiOff,
  FileText,
  Search,
  MousePointerClick,
  ShoppingCart,
  Image,
  Moon,
  Monitor,
  AlertCircle,
  LayoutGrid,
  History,
  EyeOff,
  Printer,
} from 'lucide-react'

const apps = [
  {
    title: 'Ishida Weigher Issue Logger',
    subtitle: 'CCW Issues',
    icon: ClipboardList,
    desc: 'A comprehensive issue tracking system built for Ishida combination weighers. Log, track, and resolve issues across production lines with detailed per-head diagnostics, service reporting, and real-time cloud sync.',
    features: [
      { icon: Factory, text: 'Visual factory layout builder to map your production floor' },
      { icon: BarChart3, text: 'Dashboard view of all offline heads and active issues by line' },
      { icon: CheckCircle, text: 'Per-head issue tracking: chute, load cell, hopper, stepper motor, and more' },
      { icon: FileText, text: 'PDF report generation with issue summaries and status' },
      { icon: Share2, text: 'Shareable links for service visits with access control' },
      { icon: WifiOff, text: 'Offline-first architecture \u2014 works without internet and syncs when connected' },
    ],
  },
]

const viewerViews = [
  {
    id: 'home',
    label: 'Home View',
    icon: LayoutGrid,
    image: '/ccw-home.png',
    description: 'Home View page details the total lines, heads, offline heads, and lines with issues. It is also where you can switch between visits by clicking inside the Visit section. Top right where it says Service Report will show you that report for this visit. Each line you can click on for a more detailed description.',
  },
  {
    id: 'line',
    label: 'Line View',
    icon: Monitor,
    image: '/ccw-line.png',
    description: 'Line View (clicking on a line in the Home Screen) will give you detailed information about each head by simply clicking on it. It will also tell you if that head has had past issues with the description so it can be replaced / repaired further.',
  },
  {
    id: 'offline',
    label: 'Offline Heads',
    icon: AlertCircle,
    image: '/ccw-offline.png',
    description: 'Offline Heads View gives you all the offline heads during that visit with descriptions.',
  },
  {
    id: 'factory',
    label: 'Factory View',
    icon: Factory,
    image: '/ccw-factory.png',
    description: 'Factory View gives you a birds-eye view of the factory for easier selection without confusion. Clicking on the line will take you there to view it.',
  },
]

const partsViews = [
  {
    id: 'home',
    label: 'Home Screen',
    icon: LayoutGrid,
    image: '/ipm-home.png',
    description: 'Home Screen shows you whichever diagram you want to view. If you have multiple models you can click where it says All Folders to view them separately or together. You can easily switch between diagrams by either clicking in the diagram section on the left hand side of the page or toggle between them with the Previous and Next buttons.',
  },
  {
    id: 'select',
    label: 'Select Parts',
    icon: MousePointerClick,
    image: '/ipm-select.png',
    description: 'Viewing the diagram you can select the parts you want to order by hovering over them to view details and then confirming it by clicking it.',
  },
  {
    id: 'hidden',
    label: 'Hide Hotspots',
    icon: EyeOff,
    image: '/ipm-hidden.png',
    description: 'You can hide the hotspots to better view the diagram. For ordered parts it will show them as smaller green dots. You can also use the selector bar to the right and click the number to add the part to the order list.',
  },
  {
    id: 'ordered',
    label: 'Ordered Only',
    icon: ShoppingCart,
    image: '/ipm-ordered.png',
    description: 'You can show ordered parts only so you know exactly what has been selected already. If the diagram has too many parts which makes it difficult to see, this makes it easy to review your selections.',
  },
  {
    id: 'pdf',
    label: 'Preview PDF',
    icon: Printer,
    image: '/ipm-pdf.png',
    description: 'Clicking on Preview PDF will bring up the parts list which you can then email to order parts from the OEM. The order includes part numbers, codes, names, diagram references, and quantities.',
  },
]

export default function Apps() {
  const [activeView, setActiveView] = useState(0)
  const [activePartsView, setActivePartsView] = useState(0)

  return (
    <div>
      {/* Page Header */}
      <section className="bg-jti-dark py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-white">Our Apps</h1>
          <p className="mt-4 text-gray-400 text-lg max-w-2xl mx-auto">
            Custom-built digital tools designed to support Ishida equipment
            maintenance, issue tracking, and parts management.
          </p>
        </div>
      </section>

      {/* Apps */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
          {apps.map(({ title, subtitle, icon: Icon, desc, features }, i) => (
            <div
              key={title}
              className="bg-jti-light rounded-2xl border border-gray-100 overflow-hidden"
            >
              {/* App Header */}
              <div className="bg-jti-dark px-8 py-6 flex items-center gap-4">
                <div className="w-12 h-12 bg-jti-blue/20 rounded-xl flex items-center justify-center">
                  <Icon size={26} className="text-jti-blue" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">{title}</h2>
                  <p className="text-gray-400 text-sm">{subtitle}</p>
                </div>
              </div>

              {/* App Content */}
              <div className="p-8">
                <p className="text-gray-600 leading-relaxed mb-8 max-w-3xl">
                  {desc}
                </p>

                <h3 className="font-semibold text-jti-dark mb-4">Key Features</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {features.map(({ icon: FIcon, text }) => (
                    <div
                      key={text}
                      className="flex items-start gap-3 bg-white rounded-lg p-4 border border-gray-100"
                    >
                      <FIcon size={20} className="text-jti-blue mt-0.5 shrink-0" />
                      <span className="text-gray-700 text-sm">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {/* CCW Customer Viewer — Interactive Showcase */}
          <div className="bg-jti-light rounded-2xl border border-gray-100 overflow-hidden">
            {/* Header */}
            <div className="bg-jti-dark px-8 py-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-jti-blue/20 rounded-xl flex items-center justify-center">
                <Share2 size={26} className="text-jti-blue" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">CCW Customer Viewer</h2>
                <p className="text-gray-400 text-sm">Real-Time Equipment Status Portal</p>
              </div>
            </div>

            <div className="p-8">
              <p className="text-gray-600 leading-relaxed mb-8 max-w-3xl">
                A read-only portal shared with customers so they can see their equipment
                status from each service visit. View lines, offline heads, past issue history, and
                a factory-floor layout — all updated during service visits.
              </p>

              {/* View Tabs */}
              <div className="mb-6">
                <p className="text-sm text-gray-700 font-bold mb-3 flex items-center gap-1.5">
                  <MousePointerClick size={14} />
                  Click a view to see it in action:
                </p>
                <div className="flex flex-wrap gap-2">
                  {viewerViews.map((view, idx) => {
                    const VIcon = view.icon
                    return (
                      <button
                        key={view.id}
                        onClick={() => setActiveView(idx)}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                          activeView === idx
                            ? 'bg-jti-blue text-white shadow-lg shadow-jti-blue/30 scale-105'
                            : 'bg-white text-gray-600 border-2 border-gray-200 hover:border-jti-blue hover:text-jti-blue hover:shadow-md cursor-pointer'
                        }`}
                      >
                        <VIcon size={16} />
                        {view.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Screenshot Frame + Description */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
                {/* Image Frame */}
                <div className="lg:col-span-3">
                  <div className="rounded-xl overflow-hidden border-2 border-gray-200 bg-gray-900 shadow-lg">
                    {/* Browser chrome bar */}
                    <div className="bg-gray-800 px-4 py-2 flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-red-500" />
                      <span className="w-3 h-3 rounded-full bg-yellow-500" />
                      <span className="w-3 h-3 rounded-full bg-green-500" />
                      <span className="ml-3 text-xs text-gray-400 truncate">jtihv.netlify.app</span>
                    </div>
                    <img
                      src={viewerViews[activeView].image}
                      alt={viewerViews[activeView].label}
                      className="w-full block"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-xl border border-gray-100 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      {(() => {
                        const VIcon = viewerViews[activeView].icon
                        return <VIcon size={22} className="text-jti-blue" />
                      })()}
                      <h3 className="font-semibold text-jti-dark text-lg">
                        {viewerViews[activeView].label}
                      </h3>
                    </div>
                    <p className="text-gray-600 leading-relaxed text-sm">
                      {viewerViews[activeView].description}
                    </p>
                  </div>

                  {/* Key highlights */}
                  <div className="mt-4 space-y-3">
                    {[
                      { icon: History, text: 'Switch between past visits to compare status over time' },
                      { icon: Share2, text: 'Shared via secure link — no login required for customers' },
                      { icon: FileText, text: 'Print or download PDF reports directly from the viewer' },
                    ].map(({ icon: FIcon, text }) => (
                      <div key={text} className="flex items-start gap-3 bg-white rounded-lg p-3 border border-gray-100">
                        <FIcon size={18} className="text-jti-blue mt-0.5 shrink-0" />
                        <span className="text-gray-700 text-sm">{text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* JTI Interactive Parts Manual — Interactive Showcase */}
          <div className="bg-jti-light rounded-2xl border border-gray-100 overflow-hidden">
            {/* Header */}
            <div className="bg-jti-dark px-8 py-6 flex items-center gap-4">
              <div className="w-12 h-12 bg-jti-blue/20 rounded-xl flex items-center justify-center">
                <BookOpen size={26} className="text-jti-blue" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">JTI Interactive Parts Manual</h2>
                <p className="text-gray-400 text-sm">Parts Viewer</p>
              </div>
            </div>

            <div className="p-8">
              <p className="text-gray-600 leading-relaxed mb-8 max-w-3xl">
                An interactive parts diagram viewer that lets customers browse Ishida
                equipment diagrams, identify parts by clicking on hotspots, and build
                parts orders with PDF export — all from a web browser.
              </p>

              {/* View Tabs */}
              <div className="mb-6">
                <p className="text-sm text-gray-700 font-bold mb-3 flex items-center gap-1.5">
                  <MousePointerClick size={14} />
                  Click a view to see it in action:
                </p>
                <div className="flex flex-wrap gap-2">
                  {partsViews.map((view, idx) => {
                    const VIcon = view.icon
                    return (
                      <button
                        key={view.id}
                        onClick={() => setActivePartsView(idx)}
                        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                          activePartsView === idx
                            ? 'bg-jti-blue text-white shadow-lg shadow-jti-blue/30 scale-105'
                            : 'bg-white text-gray-600 border-2 border-gray-200 hover:border-jti-blue hover:text-jti-blue hover:shadow-md cursor-pointer'
                        }`}
                      >
                        <VIcon size={16} />
                        {view.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Screenshot Frame + Description */}
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
                {/* Image Frame */}
                <div className="lg:col-span-3">
                  <div className="rounded-xl overflow-hidden border-2 border-gray-200 bg-gray-900 shadow-lg">
                    {/* Browser chrome bar */}
                    <div className="bg-gray-800 px-4 py-2 flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-red-500" />
                      <span className="w-3 h-3 rounded-full bg-yellow-500" />
                      <span className="w-3 h-3 rounded-full bg-green-500" />
                      <span className="ml-3 text-xs text-gray-400 truncate">jti-parts-viewer.netlify.app</span>
                    </div>
                    <img
                      src={partsViews[activePartsView].image}
                      alt={partsViews[activePartsView].label}
                      className="w-full block"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-xl border border-gray-100 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      {(() => {
                        const VIcon = partsViews[activePartsView].icon
                        return <VIcon size={22} className="text-jti-blue" />
                      })()}
                      <h3 className="font-semibold text-jti-dark text-lg">
                        {partsViews[activePartsView].label}
                      </h3>
                    </div>
                    <p className="text-gray-600 leading-relaxed text-sm">
                      {partsViews[activePartsView].description}
                    </p>
                  </div>

                  {/* Key highlights */}
                  <div className="mt-4 space-y-3">
                    {[
                      { icon: Search, text: 'Search across all diagrams to find specific parts quickly' },
                      { icon: Image, text: 'Rotate and flip diagrams for different viewing angles' },
                      { icon: Share2, text: 'Shareable links with token-based security for customer access' },
                    ].map(({ icon: FIcon, text }) => (
                      <div key={text} className="flex items-start gap-3 bg-white rounded-lg p-3 border border-gray-100">
                        <FIcon size={18} className="text-jti-blue mt-0.5 shrink-0" />
                        <span className="text-gray-700 text-sm">{text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-jti-dark py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white">
            Interested in These Tools?
          </h2>
          <p className="mt-4 text-gray-300">
            Contact JTI to learn how these apps can help streamline your equipment
            maintenance and parts management.
          </p>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 mt-8 bg-jti-blue text-white px-8 py-3 rounded-lg font-semibold hover:bg-sky-500 transition-colors"
          >
            Get in Touch <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </div>
  )
}
