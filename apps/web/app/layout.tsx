import './globals.css'

export const metadata = {
  title: 'OpenClaw Dashboard',
  description: 'OpenClaw 多机器人数字化看板',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
