# Privacy Policy

ZPLab is a label designer that runs on your device. It has no user accounts, no analytics, no telemetry and no ads. The app sends no data to the developer.

## Data stored on your device

- Label designs, templates and settings are stored locally on your device, either in ZPLab's application data or in files you save yourself.
- Secrets such as a Labelary API key or database passwords are kept in the operating system's credential store: Windows Credential Manager, macOS Keychain or Secret Service on Linux. In the browser version, a Labelary key is kept in that browser's storage. If the credential store is unavailable, the desktop app keeps the MCP server token unencrypted in its application data instead.

## Network connections

ZPLab only connects to the following destinations:

- **Printers and data sources you configure.** Labels go to the printer you choose, over the network or USB, or through the system print spooler or the Zebra Browser Print agent on your computer. Variable data is read from the files, databases or servers you connect.
- **Labelary rendering.** Labelary is the default renderer for previews, the **Other printer** way under **File → Output** and PDF export. ZPLab asks for your consent before the first request to the public service. After that, each of these actions sends the label's ZPL to `api.labelary.com`, including values filled in from connected data sources. Labelary is an independent third-party service with its own [terms and privacy practices](https://labelary.com/service.html). If you set your own endpoint, requests go there instead. You can withdraw your consent or disable Labelary entirely under **File → Settings… → App → Preview**. In the desktop app, a connected printer can render instead.
- **Updates.** A build downloaded from GitHub checks `github.com` for a new version at every start and downloads an update from GitHub's release hosts only when you choose to install it. The Store version and other packaged installs update through their package and skip this check.
- **MCP server, optional.** When you start it, the server listens on `127.0.0.1` only and requires a token that the app generates. An assistant you connect can read and edit the open label, so its content goes to whatever service that assistant uses.
- **The web version.** Your browser loads `app.zplab.org` from GitHub Pages, which is covered by [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## App stores

If you install ZPLab from an app store, the store operator may collect installation, crash or usage data under its own privacy policy. The developer may see aggregated statistics that the store provides.

## Contact

For questions about this policy, open an issue at <https://github.com/u8array/ZPLab/issues>.

Last updated: 2026-10-02
