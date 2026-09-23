import type { Metadata } from 'next'
import './globals.css'
import { Shell } from '@/components/shell'
import { BRAND_NAME } from '@/lib/brand'
import { getCurrentUser } from '@/lib/auth/current-user'

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description:
    'Initiative and project timelines, dependencies, prioritization and intake.',
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
