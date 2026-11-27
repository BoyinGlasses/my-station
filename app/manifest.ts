import type { MetadataRoute } from 'next';

// The office as an app on a phone's home screen ("Add to Home Screen"): full screen, its own icon. On an iPhone it is
// also what notifications need: Web Push reaches only a web app added to the home screen there (iOS 16.4 and later).
export const dynamic = 'force-static';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const at = (p: string) => `${BASE}${p}`;
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'My Office', short_name: 'My Office', id: at('/'), start_url: at('/'), scope: at('/'), display: 'standalone', orientation: 'any',
    background_color: '#0E131B', theme_color: '#0E131B',
    icons: [
      { src: at('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: at('/apple-icon.png'), sizes: '180x180', type: 'image/png' },
      { src: at('/icon.svg'), sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
