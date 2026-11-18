// Central branding. Every app (viewer, Android, admin, LED) and the viewer's launch loader read it.
// Images are generated from the official logo by branding/generate.py into each app's public/brand/.

export const BRAND = Object.freeze({
  name: 'Maheshwari Premier League',
  shortName: 'MPL',
  season: 21,
  year: 2026,
  // Paths inside each app's public folder (prefix with the app's base URL).
  logo: 'brand/mpl-logo.webp', // 384 px: loaders, large displays
  logoSmall: 'brand/mpl-logo-128.webp', // headers, lists
  launchBackground: '#0b0b0b', // web loader + Android splash
  // The studio that built the app. Set `logo` to a file in public/brand/ once supplied; until then
  // the credit is shown as text.
  studio: Object.freeze({ name: 'iKRA Studios', logo: null, url: null }),
});

/** "by iKRA Studios" — the credit line used on the loader and footers. */
export const studioCredit = () => `by ${BRAND.studio.name}`;
