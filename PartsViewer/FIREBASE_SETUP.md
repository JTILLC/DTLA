# Firebase Setup - Already Configured! ✅

Your Parts Viewer app is **already configured** to use your existing Firebase project (jobs-data-17ee4).

## What's Been Set Up

- ✅ Firebase configuration copied from your JOBS app
- ✅ Using the same Firebase project: `jobs-data-17ee4`
- ✅ Parts Viewer data stored in separate collection: `parts-viewer-diagrams`
- ✅ No interference with your JOBS app data

## Your Firebase Project

**Project ID**: jobs-data-17ee4
**Collection**: parts-viewer-diagrams
**Console**: [View in Firebase Console](https://console.firebase.google.com/project/jobs-data-17ee4)

## Step 5: Set Firestore Security Rules (Optional but Recommended)

If you chose test mode, your database is publicly accessible for 30 days. For better security:

1. Go to Firestore Database > Rules
2. Update the rules based on your needs:

### Allow anyone to read/write (for testing):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

### Allow only authenticated users (recommended):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## How to Use Firebase Features

The app is ready to use! Just:

1. **Save individual diagrams**: Click the ☁️ button next to each diagram
2. **Load from cloud**: Click "☁️ Load from Firebase" button in the toolbar
3. **Sync all**: Click "☁️ Sync All to Firebase" to backup all local diagrams

## Firestore Data Structure

Your Parts Viewer data is stored separately from other apps:

```
Firebase Project: jobs-data-17ee4
├── parts-viewer-diagrams (collection) ← Parts Viewer data
│   └── {diagramId} (document)
│       ├── id: string
│       ├── name: string
│       ├── pdfData: string (base64)
│       ├── partsData: object
│       ├── hotspots: object
│       ├── folder: string
│       ├── createdAt: timestamp
│       └── lastModified: timestamp
│
└── [other collections for JOBS app, etc.]
```

**Note**: Your JOBS app data and Parts Viewer data are in completely separate collections, so they won't interfere with each other.

## Troubleshooting

### "Firebase: No Firebase App '[DEFAULT]' has been created"
- Make sure you've updated `src/firebase/config.js` with your actual Firebase credentials

### "Missing or insufficient permissions"
- Check your Firestore security rules
- Make sure they allow the operations you're trying to perform

### CORS errors
- This should not happen with Firebase, but if it does, check that your domain is authorized in Firebase project settings

## Cost

Firebase Firestore has a generous free tier:
- **Storage**: 1 GB free
- **Read**: 50K reads/day
- **Write**: 20K writes/day
- **Delete**: 20K deletes/day

For most personal projects, you'll stay well within the free tier limits.
