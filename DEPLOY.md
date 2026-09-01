# Free Zero-Maintenance Deployment Guide for FairReact Web Player

Publish your FairReact Web Player on the internet for **$0 forever** with zero server maintenance.

---

## 🚀 Option 1: GitHub Pages (Recommended - 100% Free Forever)

1. Create a free public repository on GitHub called `fairreact` (or any name).
2. Upload the files inside `fairreact-web-player/` to your repo:
   - `index.html`
   - `watch.html`
   - `css/`
   - `js/`
   - `manifest.json`
3. In your GitHub repository:
   - Go to **Settings** ➔ **Pages**.
   - Under **Build and deployment** ➔ **Branch**, select `main` (or `master`) and click **Save**.
4. In 30 seconds, your free global player link is live:
   ```text
   https://<your-username>.github.io/fairreact/watch.html?r=REACTION_ID&o=ORIGINAL_ID&t=TOKEN
   ```

---

## ⚡ Option 2: Cloudflare Pages / Vercel (Free Global CDN with Custom Domains)

1. Go to [pages.cloudflare.com](https://pages.cloudflare.com) or [vercel.com](https://vercel.com) (Free account).
2. Drag and drop the `fairreact-web-player` folder.
3. Your web player is immediately live on 300+ edge locations worldwide with 0 latency:
   ```text
   https://fairreact.pages.dev/watch.html?r=REACTION_ID&o=ORIGINAL_ID&t=TOKEN
   ```
4. (Optional) You can connect any custom domain (like `fairreact.com`) with 1 click for free!
