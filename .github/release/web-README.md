# ZPLab web build (self-hosted)

Static single-page app. Serve this folder with any web server. No backend is required. The same app is published as a Docker image, `ghcr.io/u8array/zplab`.

- Plain `http://` on a LAN host works. Only copying the preview image to the clipboard needs **HTTPS or localhost**, because browsers expose that API in secure contexts only.
- Serve at the **domain root**. Assets use absolute paths (`base: '/'`); for a sub-path deployment, build from source with a matching Vite `base`.
