import './globals.css';
import { DimensionIconsProvider } from '@/context/DimensionIconsContext';
import ExternalNavigationManager from '@/components/system/ExternalNavigationManager';

export const metadata = {
  title: 'RA-H Open Source',
  description: 'Local-first research workspace with a BYO-key AI orchestrator',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var rawTheme = localStorage.getItem('ui.theme');
                  var theme = 'dark';
                  if (rawTheme !== null) {
                    try {
                      theme = JSON.parse(rawTheme) === 'light' ? 'light' : 'dark';
                    } catch (parseError) {
                      theme = rawTheme === 'light' ? 'light' : 'dark';
                    }
                  }
                  document.documentElement.setAttribute('data-theme', theme);
                } catch (error) {
                  document.documentElement.setAttribute('data-theme', 'dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body>
        <DimensionIconsProvider>
          <ExternalNavigationManager />
          {children}
        </DimensionIconsProvider>
      </body>
    </html>
  );
}
