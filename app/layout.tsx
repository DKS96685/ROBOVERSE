import type { Metadata } from 'next';
import { Inter, Press_Start_2P, Titan_One, VT323 } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const titanOne = Titan_One({ subsets: ['latin'], weight: '400', variable: '--font-titan-one' });
const pressStart = Press_Start_2P({ subsets: ['latin'], weight: '400', variable: '--font-pixel' });
const vt323 = VT323({ subsets: ['latin'], weight: '400', variable: '--font-retro' });

export const metadata: Metadata = {
  title: 'ROBOVERSE · Live Robotics Event Game Engine',
  description: 'Live gamified retro arcade layer for robotics teams, component clues, and lifelines.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${titanOne.variable} ${pressStart.variable} ${vt323.variable}`}>
      <body className="bg-retro-bg text-gray-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
