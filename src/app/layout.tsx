import type { Metadata } from 'next'
import './globals.css'
import { Shell } from '@/components/shell'
import { BRAND_NAME } from '@/lib/brand'
import { getCurrentUser } from '@/lib/auth/current-user'

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description:
    'Project and workstream timelines, dependencies, prioritization and intake.',
}

/**
 * Applies the stored theme and detail level before first paint, so a viewer
 * who chose dark mode never sees a white flash on navigation. React picks the
 * same values up from localStorage on hydration.
 */
const NO_FLASH = `(function(){try{
var t=localStorage.getItem('pcr:theme');
if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;
var d=localStorage.getItem('pcr:detail');
if(d==='lead'||d==='full')document.documentElement.dataset.detail=d;
}catch(e){}})();`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          mediaradar.com's typefaces.
          
          A stylesheet link rather than next/font, which is the documented
          route and would self-host them — but next/font downloads the files
          at BUILD time, and a build host with no route to fonts.googleapis.com
          does not fail: it warns and ships the fallback. A silent miss is the
          one outcome worth engineering around, and the ACR build could not
          reach Google when this was tested.
          
          So the browser fetches them instead. preconnect first so the request
          does not wait on a fresh TLS handshake, display=swap so a slow or
          blocked Google Fonts never leaves the page blank, and --font-sans in
          globals.css carries a full fallback stack for when it never lands.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- that rule
            is about pages/_document.js; in the App Router this root layout IS
            every page. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=Instrument+Serif:ital@0;1&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body suppressHydrationWarning>
        <Shell
          user={{
            name: user.name,
            email: user.email,
            picture: user.picture,
            authenticated: user.authenticated,
          }}
        >
          {children}
        </Shell>
      </body>
    </html>
  )
}
