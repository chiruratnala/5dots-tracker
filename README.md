# 5Dots

5Dots is a responsive personal workspace web app for tracking daily tasks, logging daily habits, managing job and internship applications, and writing notes, with real-time cloud sync via Firebase.

## Features

- **Overview (`#/dashboard`)**: Daily habit completion, task completion, application pipeline counts (`Applied`, `Interviewing`, `Offer`, `Rejected`), status funnel bars, and daily trend charts powered by Chart.js.
- **Tasks (`#/excel`)**: Add, edit, complete, delete, and set deadlines for tasks. Creation and completion dates are recorded automatically, overdue tasks are flagged, and the layout switches between a desktop table and mobile cards.
- **Daily habits (`#/recurring`)**: Add habits, reorder columns, archive or restore habits (historical logs are preserved), log today's entry, tick daily checkboxes, and lock past dates.
- **Jobs (`#/jobs`) and Internships (`#/internships`)**: Track company or organization, role, application status, date applied, and notes or links, with responsive desktop tables and mobile cards.
- **Notes (`#/notepad`)**: Create, edit, and delete notes with auto-save status feedback, bullet insertion (`• `), and PDF export via `html2pdf.js`.
- **Authentication and sync**: Google sign-in through Firebase Authentication. Workspace data syncs under `users/{uid}` in Firebase Realtime Database. Light and dark themes follow the system preference.

## Project Structure

```text
.
├── index.html   # Page markup, navigation shell, and page templates
├── style.css    # Theme variables, responsive layout, tables, cards, and editor styles
└── app.js       # Firebase auth/sync, routing, charts, CRUD logic, and PDF export
```

## Setup and Configuration

### 1. Configure Firebase credentials

Open `app.js` and replace the placeholder values in `firebaseConfig` with your Firebase project configuration (or inject them during your build/deployment process):

```javascript
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};
```

### 2. Enable Google Sign-In and Realtime Database

1. In the Firebase Console, enable **Google** under **Authentication > Sign-in method**.
2. Add your local and hosting domains to **Authorized domains**.
3. Create a **Realtime Database** and apply these security rules so users can only access their own data:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

### 3. Run locally

`app.js` uses ES modules (`<script type="module" src="app.js">`), so serve the directory over HTTP instead of opening `index.html` directly via `file://`:

```bash
npx serve .
```

## Dependencies

Loaded via CDN in `index.html` and `app.js`:

- [Firebase JS SDK (v10.7.1)](https://firebase.google.com/): Authentication and Realtime Database
- [Lucide Icons (v0.454.0)](https://lucide.dev/): UI icons
- [Chart.js (v4.4.1)](https://www.chartjs.org/): Overview trend charts
- [html2pdf.js (v0.10.1)](https://ekoopmans.github.io/html2pdf.js/): Note PDF export
- [Manrope](https://fonts.google.com/specimen/Manrope): Typography via Google Fonts
