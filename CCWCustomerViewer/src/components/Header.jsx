import { Moon, Sun, Printer, FileText, ExternalLink } from 'lucide-react';

import { mediaUrl } from '../config/media';

const Header = ({ customerName, visitName, visitDate, isDark, onToggleDark, onPrint, serviceReportUrl, serviceReportPath, shareToken }) => {
  // Route the report through the broker so access dies with the share link.
  // Falls back to the stored public URL when the broker isn't configured.
  const reportHref = serviceReportPath
    ? mediaUrl({ path: serviceReportPath, url: serviceReportUrl }, shareToken)
    : serviceReportUrl;
  const formattedDate = visitDate ? new Date(visitDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : '';

  return (
    <header className="header">
      <div className="container-fluid">
        <div className="header-row">
          <div className="d-flex align-items-center gap-3 header-identity">
            <img
              src="https://i.imgur.com/GQRZTtW.png"
              alt="JTI Logo"
              className="header-logo"
            />
            <div className="header-titles">
              <h1 className="h4 mb-0">{customerName || 'Customer Portal'}</h1>
              {visitName && <small className="text-muted">{visitName}</small>}
              {/* Full date is desktop-only — on a phone it pushes content below the fold. */}
              {formattedDate && <small className="text-muted d-block header-date">{formattedDate}</small>}
            </div>
          </div>

          <div className="d-flex align-items-center gap-2 header-actions">
            {/* Provenance is nice-to-have; it moves to the footer on small screens. */}
            <span className="badge bg-info text-dark header-shared-badge">
              Shared by JTI Service
            </span>
            {serviceReportUrl && (
              <a
                href={reportHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                title="View Service Report"
              >
                <FileText size={16} className="me-1" />
                <span className="label-full">Service Report</span>
                <span className="label-short">Report</span>
                <ExternalLink size={14} className="ms-1" />
              </a>
            )}
            <button
              onClick={onPrint}
              className="btn btn-outline-secondary btn-sm"
              title="Print Report"
            >
              <Printer size={16} />
            </button>
            <button
              onClick={onToggleDark}
              className="btn btn-outline-secondary btn-sm"
              title="Toggle Theme"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
