# Household Budget — Private Household App

Live site: https://household-budget-web-vvza.onrender.com

## Privacy and architecture
- Render hosts a public login page. The budgeting dashboard and records are not accessible until a user signs in and belongs to the household.
- Supabase Auth manages email/password authentication, and Supabase PostgreSQL stores household budgets privately.
- Database row-level security (RLS) restricts budget reads to household members. Write actions use signed-in, membership-checked database procedures.
- Only a public Supabase **publishable** API key is included in the website. Never add server or secret keys, passwords, account numbers, or financial data to GitHub.
- Historical October card balances and bill allocations were stored in a private database seed and become available after the authorized owner creates their household.
- Household owners can issue one-time, seven-day invitation codes for members.
- The frontend currently uses a bundled single HTML file because the Render static-site build publishes only `index.html`.

## First sign-in
An administrator must visit the Supabase project's **Authentication → URL Configuration** page and set the Site URL to `https://household-budget-web-vvza.onrender.com` and allow the same URL as an additional redirect URL before signing up. Verify the confirmation email, sign in, then choose **Create my household**.

## Limits
- Do not enter bank passwords or complete payment-card numbers.
- This site does not connect to banks or move money.
- The values imported from the October worksheet are historical, not verified current balances.
- Export private backups occasionally.
- Supabase free project and Render free hosting have plan limits; verify provider pricing before upgrading.
