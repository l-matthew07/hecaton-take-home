import type { ReactNode } from "react"

export const metadata = {
  title: "Infringement Detection",
  description: "Live marketplace infringement detection scan",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
