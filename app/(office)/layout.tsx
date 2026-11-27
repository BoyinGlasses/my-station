import type { ReactNode } from 'react';
import Script from 'next/script';
// One stylesheet per area of the 3D office screen, in cascade order (later files override earlier ones).
// Scoped to the (office) route group so /panel only loads base tokens + panel.css.
import '@/styles/topbar.css';
import '@/styles/topbar-plan.css';
import '@/styles/sidebars.css';
import '@/styles/activity.css';
import '@/styles/sessions.css';
import '@/styles/streamer.css';
import '@/styles/permissions.css';
import '@/styles/stage.css';
import '@/styles/labels.css';
import '@/styles/lite.css';
import '@/styles/timeline.css';
import '@/styles/places.css';
import '@/styles/csgt.css';
import '@/styles/todos.css';
import '@/styles/drawers.css';
import '@/styles/chat.css';
import '@/styles/group-chat.css';
import '@/styles/mac.css';
import '@/styles/burn.css';
import '@/styles/vault.css';
import '@/styles/modal.css';
import '@/styles/replay.css';
import '@/styles/photo.css';
import '@/styles/tips.css';
import '@/styles/settings.css';
import '@/styles/responsive.css';
import '@/styles/phone.css';

export default function OfficeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* QR codes for "open on your phone" (qrcode.js, MIT), kept local so the office works offline */}
      <Script src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/assets/vendor/qrcode.min.js`} strategy="afterInteractive" />
    </>
  );
}
