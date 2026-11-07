# ResQConnect Real-Time Community Coordination MVP

This is a multi-user MVP with Supabase Auth, Postgres database, Row Level Security (RLS), and realtime database subscriptions.

## What works after Supabase setup
- Email/password account registration and sign-in
- Citizen and volunteer account profiles
- Submit community issue reports
- Signed-in users see shared reports
- Report owners can update their own report status
- Admins can update any report after the project owner promotes their account in SQL
- Volunteer profile creation/update
- Realtime incident and volunteer updates for users currently online
- Search and status filtering
- Responsive desktop/mobile UI

## Safety and scope
This is an educational community coordination MVP, **not** an emergency service, dispatch centre, medical triage system or verified volunteer network. It cannot guarantee a response. It does not contact police, ambulance, fire services or other official responders. Do not use it for life-threatening emergencies. Users must contact local official emergency services immediately when urgent assistance is needed.

For this MVP:
- Only non-emergency community issues should be submitted.
- Do not collect home addresses, phone numbers, medical details, identity documents or photos.
- Reports and basic volunteer profiles are visible to authenticated members of the Supabase project.
- Volunteer profiles are not background-checked or verified.
- Realtime means database changes are pushed to connected browsers; it is not guaranteed delivery, SMS, push notification or dispatch.
- There is no map/GPS tracking, file upload, messaging, identity verification, rate limiting, moderation queue or audit dashboard in this MVP.

Before public launch, arrange a privacy/security review, abuse reporting and moderation, volunteer vetting, data retention/deletion policy, legal review, emergency disclaimers, backups, rate limiting and a real incident-response operating process.

## Requirements
- Node.js 20.19+ or 22.12+ recommended for Vite 6
- VS Code
- Free Supabase account/project

## A. Create the Supabase backend
1. Go to https://supabase.com and create a project.
2. Open SQL Editor in the Supabase dashboard.
3. Open `supabase/migrations/001_init.sql` from this project, copy the entire file and run it in SQL Editor.
4. Open Project Settings > API (or Connect, depending on dashboard layout).
5. Copy the Project URL and the public anon/publishable key. Do not copy the `service_role` or secret key.
6. In the project root, duplicate `.env.example` and name the copy `.env`.
7. Set:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
   ```
8. In Supabase Authentication settings, configure your local and production Site URL / redirect URLs. For local development add `http://localhost:5173`.

## B. Run in VS Code on Windows
Open the extracted `ResQConnect_RealTime_MVP` folder in VS Code. Open Terminal > New Terminal and run:

```powershell
npm install
```

Then:

```powershell
npm run dev
```

Open the URL Vite prints, normally:

http://localhost:5173

Keep the terminal running. Press Ctrl+C to stop.

## C. Test with two accounts
1. Register account A in one browser.
2. Register account B in another browser or private window.
3. Submit a report from account A.
4. Keep both browsers open. Account B should see the new report appear through realtime.
5. Update status as the report owner and confirm the other browser updates.
6. Create a volunteer profile from a volunteer account.

Email confirmation may be enabled by default. If so, confirm the signup email before signing in. For a classroom demo only, the project owner may configure Supabase Auth email confirmation settings deliberately; do not weaken authentication on a public production deployment.

## D. Make an admin account
The app does not allow a user to self-assign admin privileges.
1. Sign up normally using the account that should become the project admin.
2. In Supabase Dashboard > Authentication > Users, find that user and copy their UUID.
3. Run this in SQL Editor, replacing the placeholder:
   ```sql
   update public.profiles
   set role = 'admin'
   where id = 'PASTE_AUTH_USER_UUID_HERE';
   ```
4. Sign out and sign in again. Admin Review should appear.

Never expose the Supabase service role key in the browser or commit it to Git.

## E. Build for production
```powershell
npm run build
```
The static production files are generated in `dist/`.

## F. Free hosting with Cloudflare Pages
1. Push this project to a private or public GitHub repository (never commit `.env`).
2. In Cloudflare Dashboard open Workers & Pages > Create > Pages > Connect to Git.
3. Select the repository.
4. Framework preset: Vite.
5. Build command: `npm run build`
6. Build output directory: `dist`
7. Add these environment variables in Pages project settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
8. Deploy. Cloudflare gives a `*.pages.dev` URL.
9. Add the deployed URL to Supabase Authentication allowed redirect URLs / Site URL.
10. Test registration, login and realtime with two separate accounts.

## Important
- `.env` is ignored by Git.
- The frontend uses the public Supabase anon/publishable key. Security depends on RLS. Do not disable RLS.
- The database SQL is part of the app's trust boundary. Review policies before public deployment.
- Supabase free-tier quotas and inactivity/pause policies can change. Check current Supabase pricing before relying on it.
