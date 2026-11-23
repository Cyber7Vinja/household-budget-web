# Household Budget — Render static hosting edition

This is a **free static website** based on the v0.13 budgeting app. It does not have accounts, cloud storage, server-side authentication, or cross-device synchronization. Data lives exclusively in your browser's localStorage.

## Publish on Render

1. Create a GitHub repository and add **only** `index.html` and `render.yaml` from this folder (plus this README if desired). Do NOT publish `Bills.xlsx`, `seed.json`, an exported budget backup, or other private financial data.
2. In Render, select **New > Static Site**, connect your GitHub repository.
3. Use **Build Command:** `mkdir -p public && cp index.html public/index.html`.
4. Use **Publish Directory:** `public`.
5. Create the Static Site. Render assigns an HTTPS `*.onrender.com` URL. Alternatively use the provided `render.yaml` with a Render Blueprint.

## Bring your October 26 financial records onto the hosted site

1. Open your previous local v0.13 HTML website. Select **Export backup** and save the JSON file privately on your computer. This exports the historical Oct 26 seed values and any edits saved in that particular browser origin.
2. On the HTTPS Render site **in the SAME browser/device where you want to work**, select **Import backup**, choose the JSON file, and confirm.
3. Your data is stored on that browser/device, not on Render. Repeat the import on another browser if you want a second independent copy. The copies will **not** stay in sync.

**Privacy:** Never put financial backups into a public Git repository. The published HTML intentionally contains no original account balances or October 26 records. This free static version has no login and should not be considered a secure shared financial application. Keep backups private and do not enter bank passwords or full account/card numbers. Use a protected, persistent database and authentication for a future shared-account version.