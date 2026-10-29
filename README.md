# The Heritage International School — website

A static, no-build marketing site (HTML, CSS, JavaScript). Upload this folder to any static host (Netlify, Vercel, GitHub Pages, cPanel…) and `index.html` is the site.

## Before going live

1. **Add contact details** — open `script.js` and fill in `SCHOOL_CONTACT` (email, phone, address) at the top. Anything left empty stays hidden. The enquiry form sends via the visitor's email app to `email`, so it only works once this is set.
2. **Social preview image** — once the domain is known, make the `og:image` URL in `index.html` absolute (e.g. `https://your-domain/assets/brand/og-image.jpg`).

## Preview locally

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173>.

## Layout

- `index.html`, `styles.css`, `script.js` — the site
- `assets/brand/` — logo (transparent PNG/WebP), favicons, share image
- `assets/images/` — optimized photos used on the page
- `_source/` — original photos, the content PDF and the original logo. **Not needed for deployment** — leave it out of the upload.
