# Supabase Page Deployment

Date: 2026-05-11

## Target

- Supabase project ref: `ijgimccymuexftiplbwe`
- Table: `public.stock_analysis_projects`
- Record id: `stock-analysis-mvp`
- Slug: `stock-analysis-mvp`

## Stored Assets

The current local frontend page was stored in Supabase as a versioned database record:

- `index.html` -> `html`
- `styles.css` -> `css`
- `app.js` -> `js`

The record also stores project metadata, feature flags, local preview URL, and backend status.

## Verification

Read-back query confirmed:

- `html_len`: 9861
- `css_len`: 16552
- `js_len`: 24209
- `title`: `Stock Analysis MVP`

## Notes

Supabase Postgres stores the page source, but it does not serve the static site by itself. Public hosting still needs Firebase Hosting, Supabase Edge Functions, Vercel, Netlify, or another web host. The local API remains available through `server.js`; Firebase Cloud Functions deployment still requires the Firebase project to use Blaze.
