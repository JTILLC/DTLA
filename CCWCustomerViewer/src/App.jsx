import { Routes, Route } from 'react-router-dom';
import CustomerViewer from './components/CustomerViewer';

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/view/:token" element={<CustomerViewer />} />
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="container py-5 text-center">
      <div className="card mx-auto" style={{ maxWidth: '500px' }}>
        <div className="card-body py-5">
          <img
            src="https://i.imgur.com/GQRZTtW.png"
            alt="JTI Logo"
            style={{ width: '120px', marginBottom: '20px' }}
          />
          <h1 className="h3 mb-3">JTI CCW History Viewer</h1>
          <p className="text-muted mb-4">
            This portal allows you to view equipment status and service history shared with you.
          </p>
          <p className="text-muted small">
            If you received a share link, please use it to access your equipment information.
          </p>
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="container py-5 text-center">
      <div className="card mx-auto" style={{ maxWidth: '500px' }}>
        <div className="card-body py-5">
          <h1 className="h3 mb-3">Page Not Found</h1>
          <p className="text-muted">
            The page you're looking for doesn't exist or the share link is invalid.
          </p>
          <a href="/" className="btn btn-primary mt-3">Go Home</a>
        </div>
      </div>
    </div>
  );
}

export default App;
