# RestoDesk: Restaurant Admin & POS

An internal tool for restaurant admins and staff. There is no customer-facing portal.
Static frontend (HTML, Tailwind CSS, vanilla JS, Chart.js) with Supabase for login and data.
It deploys to GitHub Pages as-is, with no build step.

```
index.html              App shell, login screen, all page layouts
css/style.css           Receipt, kanban, segmented controls, print styles
js/config.js            ← your Supabase URL + anon key go here
js/core.js              Shared helpers, modals, charts, smart search, receipts
js/main.js              Sign-in, role-based routing, realtime
js/views/*.js           One file per screen (dashboard, pos, orders, kitchen, menu, attendance, reports, settings)
supabase/schema.sql     Tables, security rules, order-number trigger, RPCs, sample menu
```

## 1. Set up Supabase (about 5 minutes)

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**.
3. Open **Authentication → Sign In / Providers** (or **Providers → Email**) and **turn off "Allow new users to sign up"**.
   Accounts should only be created by you.
4. Open **Authentication → Users → Add user → Create new user**. Enter your email and a password and tick **Auto Confirm User**.
   **The first user ever created becomes the admin automatically.**
5. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
6. Paste both into `js/config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://abcdxyz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
};
```

Never put the `service_role` key in this project. The anon key is meant to be public, and the Row Level Security rules in `schema.sql` are what protect your data.

## 2. Try it locally

Any static server works. Opening `index.html` by double-click can also work, but a server is more reliable:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## 3. Deploy to GitHub Pages

1. Create a new repository on GitHub, for example `restodesk`.
2. From the project folder:

```bash
git init
git add .
git commit -m "RestoDesk"
git branch -M main
git remote add origin https://github.com/<your-username>/restodesk.git
git push -u origin main
```

3. On GitHub open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, then **Save**.
4. After a minute your app is live at `https://<your-username>.github.io/restodesk/`.
5. (Recommended) In Supabase open **Authentication → URL Configuration** and set **Site URL** to that address.

The app uses relative paths and hash routing (`#/pos`, `#/kitchen`), so it works from a repository sub-path without extra configuration.

## 4. Adding staff

1. In Supabase: **Authentication → Users → Add user** (email + password, auto-confirm).
2. In RestoDesk: **Settings → Team and access**. New users appear as *Pending*. Switch them to **Active** and choose a role.

| Role | Can use |
|---|---|
| Admin | Everything: dashboard, POS, orders, kitchen, menu & inventory, attendance (all staff), reports, settings |
| Cashier | POS, orders, kitchen board, own attendance |
| Kitchen | Kitchen board, own attendance |
| Staff | Kitchen board (view/move), own attendance |

## How the main pieces work

- **Order numbers.** A database trigger gives every order the next number from a sequence, formatted `A-1001`, `A-1002`, and so on. The browser can't choose or duplicate one.
- **Checkout.** The POS calls a database function (`create_order`) that reads prices from `inventory`, applies the tax rate from Settings, deducts stock, and creates the order and its lines in one transaction. Cancelling an order returns the stock.
- **Revenue.** Reports and the dashboard count **paid, non-cancelled** orders as revenue, grouped by the day the order was created. Orders placed with "pay later" count once you collect payment from the Orders page. Gross profit is revenue minus tax minus recipe cost.
- **Smart search.** Each keystroke (debounced 150 ms) runs `ilike 'term%'` against Supabase, so typing "A" lists every item starting with A, and the list narrows as you type.
- **Attendance.** Check-in and check-out go through `clock_in()` / `clock_out()`, which stamp the server time, so staff can't back-date themselves. Admins can close a forgotten session from the history table.
- **Live updates.** The dashboard, kitchen board, orders list and attendance refresh through Supabase Realtime (enabled by `schema.sql`).

## Production notes

- **Tailwind** is loaded from its CDN for a zero-build setup. For heavy production use, compile it with the Tailwind CLI and link the generated CSS instead.
- **Reporting at scale.** Reports aggregate in the browser (in pages of 1,000 rows). That is fine for a single restaurant. If you reach hundreds of thousands of orders, move the aggregations into SQL views or RPCs.
- **Receipt printing** uses the browser print dialog and is sized for an 80 mm thermal printer.
- **Time zones.** Days and hours are grouped using the browser's local time zone.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Login page says Supabase isn't connected | `js/config.js` still has the placeholder values |
| "Your account is waiting for approval" | Activate the user in Settings → Team and access (or, for the very first admin, check the SQL ran before the user was created) |
| Orders or items don't appear | Confirm `schema.sql` ran without errors; check you're signed in as an active user |
| Live badge stays on "Reconnecting" | Realtime must be enabled for your project; re-run section 11 of `schema.sql` |
| First user isn't admin, or has no profile | The user was created before the schema ran. In SQL Editor run: `insert into public.profiles (id, full_name, email, role, is_active) select id, split_part(email,'@',1), email, 'admin', true from auth.users where email = 'you@example.com' on conflict (id) do update set role = 'admin', is_active = true;` |
