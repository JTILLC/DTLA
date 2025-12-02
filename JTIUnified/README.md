# JTI Unified Dashboard

A centralized hub for all your JTI business applications - bringing together job tracking, downtime logging, timesheets, and equipment issue tracking in one place with **REAL-TIME DATA** from Firebase.

## Features

- **✅ Real-Time Data Integration**: Pulls live data from all your Firebase databases
- **Unified Overview**: See key metrics from all your apps at a glance
- **Quick Access**: Launch any of your existing apps with one click
- **Activity Feed**: Track recent events across all systems in real-time
- **Performance Stats**: Monitor income, active jobs, downtime, and hours worked
- **Modern UI**: Clean, responsive design that works on desktop and mobile
- **Auto-Refresh**: One-click refresh to get the latest data

## Integrated Applications

1. **Jobs Tracker** - Manage quotes, invoices, and job tracking
2. **Downtime Logger** - Track equipment downtime events
3. **Time Sheet** - Employee time tracking and payroll
4. **Weigher Issues** - Ishida weigher issue logging

## Firebase Integration

This dashboard is now fully integrated with your three Firebase projects:

- **Jobs Data** (`jobs-data-17ee4`) - Fetches job quotes, invoices, and payment status
- **Downtime Logger** (`downtimelogger-a96fb`) - Tracks active equipment issues
- **Timesheet App** (`timesheetapp-c4e54`) - Calculates hours worked this week

### What Data is Displayed

**Jobs Tracker:**
- Total income (sum of all actual values)
- Active jobs (unpaid jobs)
- Recent job activity

**Downtime Logger:**
- Active downtime events
- Recent issues reported
- Equipment problems

**Timesheet App:**
- Hours worked this week
- Recent timesheet entries
- Employee time tracking

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

This will start the development server at http://localhost:5173

### Build for Production

```bash
npm run build
```

## Deployment to Netlify

1. Build the project:
   ```bash
   npm run build
   ```

2. The build output will be in the `dist` folder

3. Deploy to Netlify:
   - Drag and drop the `dist` folder to Netlify
   - Or connect your Git repository and set:
     - Build command: `npm run build`
     - Publish directory: `dist`

## Project Structure

```
jti-unified-dashboard/
├── src/
│   ├── App.jsx              # Main dashboard component
│   ├── firebase-config.js   # Firebase configuration for all 3 databases
│   ├── data-service.js      # Functions to fetch data from Firebase
│   ├── main.jsx            # React entry point
│   └── index.css           # Global styles
├── public/
│   ├── site.webmanifest    # PWA manifest
│   └── README.md           # Favicon instructions
└── package.json
```

## How It Works

The dashboard uses Firebase's JavaScript SDK to connect to your three Firebase projects simultaneously:

1. **Three separate Firebase app instances** are initialized (one for each database)
2. **Data fetching happens in parallel** for fast loading
3. **Real-time stats** are calculated from the fetched data
4. **Activity feed** combines recent events from all three databases
5. **Refresh button** allows manual data updates

## Future Enhancements

### Planned Features
- [ ] Real-time listeners (data updates automatically without refresh)
- [ ] Advanced analytics and reporting
- [ ] Export data to Excel/PDF
- [ ] Custom date range filtering
- [ ] User authentication and permissions
- [ ] Push notifications for critical events
- [ ] Mobile app version
- [ ] Integration with accounting software

## Customization

### Adding New Apps

Edit `src/App.jsx` and add to the `apps` array:

```javascript
{
  id: 'your-app',
  name: 'Your App Name',
  url: 'https://your-app.netlify.app/',
  icon: <YourIcon size={24} />,
  color: '#your-color',
  description: 'Your app description'
}
```

### Changing Colors

Update the color values in the StatCard and AppCard components to match your brand.

## Tech Stack

- React 18
- Vite
- Lucide React (icons)
- Vanilla CSS (no framework needed)

## License

Private - JTI Internal Use Only
