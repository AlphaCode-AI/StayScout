import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'StayScout · 조건으로 찾는 숙소 에이전트',
  description: '말한 조건 그대로, 예약 가능한 숙소만 찾아주는 에이전트',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans">{children}</body>
    </html>
  );
}
