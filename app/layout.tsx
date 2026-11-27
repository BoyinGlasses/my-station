import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getLang, getT } from '@/i18n/server';
// Shared font declarations and design tokens; 3D office stylesheets live in app/(office)/layout.tsx.
import '@/styles/fonts.css';
import '@/styles/base.css';

/* The page's title, description and share card (the image and icons are files in app/: opengraph-image.jpg,
   twitter-image.jpg, icon.svg, favicon.ico, apple-icon.png). The online demo knows its address (OFFICE_SITE_URL, set by
   the Pages workflow), so links shared on Facebook, Zalo or X get an absolute image and one URL per language. */
const SITE = process.env.OFFICE_SITE_URL || '', ROOT = process.env.NEXT_PUBLIC_SITE_ROOT || '';
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang(), t = await getT();
  const title = t('ui.meta.title'), description = t('ui.meta.description');
  const at = (sub: string) => `${SITE}${ROOT}${sub}`, url = at(lang === 'en' ? '/' : `/${lang}/`);
  return {
    ...(SITE && { metadataBase: new URL(SITE) }),
    title: { absolute: 'My Office' }, description, applicationName: 'My Office',
    // (on an iPhone's home screen: full screen, its own name; the manifest is app/manifest.ts)
    appleWebApp: { capable: true, title: 'My Office', statusBarStyle: 'black-translucent' }, formatDetection: { telephone: false },
    keywords: ['Claude Code', 'AI agents', '3D office', 'developer tools', 'văn phòng 3D', 'Claude Code dashboard'],
    openGraph: { type: 'website', siteName: 'My Office', title, description, locale: lang === 'vi' ? 'vi_VN' : lang === 'th' ? 'th_TH' : 'en_US', ...(SITE && { url }) },
    twitter: { card: 'summary_large_image', title, description },
    ...(SITE && { alternates: { canonical: url, languages: { en: at('/'), vi: at('/vi/'), th: at('/th/') } } }),
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0E131B' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-os: the machine's platform, for the words "Mac" / "PC" / "computer" (the online demo is a pretend Mac)
    <html lang={await getLang()} data-os={process.env.OFFICE_STATIC === '1' ? 'darwin' : process.platform}>
      <body>
        {children}
      </body>
    </html>
  );
}
