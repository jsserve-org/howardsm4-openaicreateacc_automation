import { Providers } from './providers';

export const metadata = { title: 'ChatGPT Account Creator' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 0, background: '#0b0b0c', color: '#e7e7e9' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
