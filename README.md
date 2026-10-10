# Parish Calendar Dashboard

Static GitHub Pages dashboard for viewing Google Calendar events in a combined calendar or list view.

## Features

- Google OAuth token flow using Google Identity Services
- Read-only Google Calendar API access
- Lists calendars accessible to the signed-in Google account
- Combined month calendar and list-week view
- Search by event title, location, description, calendar, or organizer
- Per-calendar visibility filters and calendar colors
- Responsive desktop/mobile layout
- Access token is held in memory only; it is not stored in localStorage
- Loads events from 3 months in the past through 1 year in the future

## Files

- `index.html`: page markup
- `style.css`: responsive styling
- `app.js`: OAuth, Calendar API calls, filtering, and calendar rendering
- `config.js`: public OAuth Client ID configuration

## Google Cloud setup

1. Create/select a project at https://console.cloud.google.com/
2. Enable **Google Calendar API**.
3. Configure the Google Auth Platform / OAuth consent screen.
4. If the app is in Testing mode, add the Google accounts that should be allowed to test it.
5. Create an OAuth client ID of type **Web application**.
6. Under **Authorized JavaScript origins**, add the exact origin that serves this site, for example:
   - `https://YOUR-USERNAME.github.io`
   - If using a custom domain, add that origin too.
   Do not add a path such as `/parish-calendar-dashboard` as an origin.
7. Copy the client ID into `config.js`:
   `GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com"`
8. Do not put an OAuth client secret, API private key, or service-account key in this repository.

## Publish with GitHub Pages

1. Create a repository named `parish-calendar-dashboard`.
2. Upload all five files to the repository root.
3. Edit `config.js` and commit the real OAuth Client ID.
4. Open **Settings → Pages**.
5. Select **Deploy from a branch**, choose `main` and `/ (root)`, then save.
6. Wait for deployment and open the published site.
7. Sign in and grant read-only calendar access.

## Privacy and limitations

- This is a static client-side application, not a server-enforced login wall. Anyone can open the page, but calendar API access requires a Google access token granted by the account holder.
- The account only sees calendars it can access under Google Calendar permissions. A user cannot read another person's private calendar unless that calendar has been shared with them and Google grants the relevant API access.
- The app requests `calendar.readonly`; it does not create, edit, or delete events.
- The access token is memory-only. Reloading the page requires connecting again.
- The initial event window is 3 months back to 1 year forward. Adjust `start` and `end` in `loadEvents()` if needed.
- The browser displays events for the Google account that authorized the app. If several staff members should see the same set of private calendars, share those calendars with each staff member or build a backend that securely manages authorization.
- For a public-facing production app, review Google's OAuth verification and user-data policies as applicable.

## Troubleshooting

- `redirect_uri_mismatch` / origin issue: check **Authorized JavaScript origins** exactly matches the page origin.
- `Access blocked` or test-user issue: review OAuth consent screen and add the account as a test user.
- No calendars listed: confirm the account has calendars and that the API is enabled.
- Some calendars fail to load: check calendar sharing permissions and browser console/network errors.
