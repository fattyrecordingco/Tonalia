# Website maintenance

Public site: https://fattyrecordingco.github.io/Tonalia/

- `/` introduces the app and links directly to all five published installers.
- `/guide/` contains installation instructions, a first-edit exercise, the basic controls, clean-up tools, saving/exporting, shortcuts, local sharing and troubleshooting.
- `/app/` runs the real browser editor, with local WAV import, analysis, reversible layers, playback, project save and WAV export. Desktop sharing is explicitly unavailable in the browser. Browser access needs a connection to load; the installed app remains the offline option.

Source lives in `website/`. The page uses local CSS, JavaScript, fonts and screenshots. There is no analytics script, account, tracking SDK or recording-upload endpoint. External links go to the release, repository or relevant official help.

## Build and check

```sh
npm ci
npm run build:website
npm run test:website
npm run preview:website
```

The preview URL is http://127.0.0.1:1430/Tonalia/. It deliberately uses the same project path as GitHub Pages and supplies no special isolation headers; this catches asset and audio-worklet path errors before deployment.

`build:website` builds the app at `/Tonalia/app/`, then copies the static pages and app into ignored `site-dist/`. No installer is rebuilt or release binary changed. `--reuse-app` may be passed directly to `scripts/build-website.mjs` after an unchanged, correctly based app build. Normal desktop/dev builds keep `/` as their base.

The website test configuration runs seven website checks plus the twelve existing editor tests at the Pages path. This includes real playback and exported sample checks, project recovery and offline neural processing after the app has loaded. Website tests check local links/images, the five versioned installer URLs against release metadata, OS tabs, command copy, search, screenshot focus, phone/tablet layout, no-JavaScript reading and complete print layout.

## Screenshots

Eight shared app-interface screenshots were captured from Tonalia 0.2 using its generated calibration/practice recording; no private recordings appear. Regenerate with `npm run screenshots:guide` against a running app preview. If the preview uses the Pages path, set `TONALIA_SCREENSHOT_URL` to that full URL. Inspect the new files before committing them.

The Windows setup image is an actual screenshot of the 0.2 installer welcome page, captured without starting an installation. No Mac or Linux OS screen is fabricated. Their installation instructions are text, with a link to Apple's official security-prompt guide. App screenshots apply to all three systems.

Keep screenshot captions clear about generated practice audio. The local font's original licence is at `website/assets/fonts/LICENSE.txt`; complete bundled notices are available under `/app/licenses/`.

## Publishing

`.github/workflows/pages.yml` builds and tests the complete site before deploying it through GitHub Pages. The repository's Pages source is set to GitHub Actions. The workflow needs `pages: write` and `id-token: write` on its deploy job, with the `github-pages` environment. No deployment secret is stored in source.

Push relevant changes to `main`, or run the Tonalia website workflow manually. A failed build/test does not replace the live site. The download buttons remain ordinary links if JavaScript is disabled. The guide also remains readable, with every OS visible.

When publishing a later app release, update the version, filenames and feature descriptions in both HTML files, review the screenshots, and update `docs/implementation/build-artifacts.json` from the published release. Tests intentionally reject download links that drift from that metadata. Do not silently advertise unfinished features or label old screenshots as a new version.

GitHub's hosting reference: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
