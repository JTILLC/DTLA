import React from 'react';
import { Link } from 'react-router-dom';

export default function StartPage() {
  return (
    <div className="text-center mt-20">
      <h1 className="text-4xl mb-4 sm:text-2xl">Downtime Logger</h1>
      <Link to="/logger" className="px-6 py-3 bg-blue-500 text-white rounded-lg shadow sm:px-4 sm:py-2 sm:text-sm">
        Go to Logger
      </Link>
    </div>
  );
}